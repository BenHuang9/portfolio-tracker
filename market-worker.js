// Cloudflare Worker for the personal Portfolio Tracker.
// Yahoo Finance: prices/history/search.
// Dividend provider priority:
//   1) Official fund issuer pages for supported Harvest / Purpose ETFs
//   2) Alpha Vantage corporate actions
//   3) Yahoo ex-date fallback
// v4.9: Purpose history is supplemented from official monthly distribution announcements so YTD includes older payments, not only the few rows visible on the fund page.
// ALPHAVANTAGE_API_KEY is stored as a Cloudflare Worker Secret.

const ALLOWED_RANGES = new Set(["1d","5d","1mo","3mo","6mo","1y","2y","5y","10y","ytd","max"]);
const ALLOWED_INTERVALS = new Set(["1m","2m","5m","15m","30m","60m","90m","1d","5d","1wk","1mo","3mo"]);

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}
function json(body,status=200,origin="",cacheSeconds=30){
  return new Response(JSON.stringify(body),{
    status,
    headers:{
      "Content-Type":"application/json;charset=UTF-8",
      "Cache-Control":`public,max-age=${cacheSeconds}`,
      ...cors(origin)
    }
  });
}
function dateKey(sec){return new Date(sec*1000).toISOString().slice(0,10)}
function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(String(v||""))}
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
function isBurstLimitMessage(msg){
  const s=String(msg||"").toLowerCase();
  return s.includes("1 request per second") || s.includes("per-second burst") || s.includes("more sparingly");
}
function isDailyLimitMessage(msg){
  const s=String(msg||"").toLowerCase();
  return s.includes("25 requests per day") || s.includes("daily limit");
}
function alphaSymbol(symbol){
  if(symbol.endsWith(".TO")) return symbol.slice(0,-3)+".TRT";
  if(symbol.endsWith(".V")) return symbol.slice(0,-2)+".TRV";
  return symbol;
}


function baseTicker(symbol){
  return String(symbol||"").toUpperCase().replace(/\.(TO|V|NE)$/,"" );
}
function htmlDecode(s){
  return String(s||"")
    .replace(/&nbsp;|&#160;/gi," ")
    .replace(/&amp;/gi,"&")
    .replace(/&quot;/gi,'"')
    .replace(/&#39;|&apos;/gi,"'")
    .replace(/&lt;/gi,"<")
    .replace(/&gt;/gi,">");
}
function rowText(html){
  return htmlDecode(String(html||"")
    .replace(/<script\b[\s\S]*?<\/script>/gi," ")
    .replace(/<style\b[\s\S]*?<\/style>/gi," ")
    .replace(/<[^>]+>/g," ")
    .replace(/\s+/g," ")
    .trim());
}
function normDate(v){return String(v||"").replaceAll("/","-")}

function parseFlexibleDate(v){
  const s=String(v||"").trim();
  let m=s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  if(m)return `${m[1]}-${String(m[2]).padStart(2,"0")}-${String(m[3]).padStart(2,"0")}`;
  m=s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if(m)return `${m[3]}-${String(m[1]).padStart(2,"0")}-${String(m[2]).padStart(2,"0")}`;
  return null;
}
function escapeRegex(s){return String(s||"").replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}
function uniqueByDividendKey(rows){
  const map=new Map();
  for(const d of (rows||[])){
    if(!d?.exDate || !(Number(d.amount)>0))continue;
    const key=`${d.exDate}|${d.paymentDate||""}|${Number(d.amount).toFixed(6)}`;
    if(!map.has(key))map.set(key,d);
  }
  return [...map.values()].sort((a,b)=>a.exDate.localeCompare(b.exDate));
}
function extractPurposeAnnouncementRows(html,ticker){
  const out=[];
  const rows=String(html||"").match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)||[];
  const tickerRe=new RegExp(`(?:^|[^A-Z0-9.])${escapeRegex(ticker)}(?:[^A-Z0-9.]|$)`,`i`);
  for(const rawRow of rows){
    const text=rowText(rawRow);
    const tm=text.match(tickerRe);
    if(!tm)continue;
    const dates=text.match(/\b(?:\d{4}[\/-]\d{1,2}[\/-]\d{1,2}|\d{1,2}[\/-]\d{1,2}[\/-]\d{4})\b/g)||[];
    if(dates.length<2)continue;
    const recordDate=parseFlexibleDate(dates[0]);
    const paymentDate=parseFlexibleDate(dates[1]);
    if(!recordDate || !paymentDate)continue;
    const tickerPos=text.toUpperCase().indexOf(ticker.toUpperCase());
    const firstDatePos=text.indexOf(dates[0]);
    const middle=tickerPos>=0 && firstDatePos>tickerPos ? text.slice(tickerPos+ticker.length,firstDatePos) : text;
    const am=middle.match(/(?:US\s*)?\$\s*([0-9]+(?:\.[0-9]+)?)/i);
    if(!am)continue;
    const amount=Number(am[1]);
    if(!(amount>0))continue;
    out.push({
      exDate:recordDate, // Purpose open-end ETF announcements use the same ex-distribution and record date.
      paymentDate,
      declarationDate:null,
      recordDate,
      amount,
      paymentDateEstimated:false
    });
  }
  return uniqueByDividendKey(out);
}
function purposeAnnouncementLinks(html){
  const links=[];
  const seen=new Set();
  const re=/href=["']([^"']+)["']/gi;
  let m;
  while((m=re.exec(String(html||"")))){
    let href=htmlDecode(m[1]);
    if(!/announces-(?:january|february|march|april|may|june|july|august|september|october|november|december)-\d{4}-distributions(?:[?#/]|$)/i.test(href))continue;
    if(href.startsWith("/"))href=`https://www.purposeinvest.com${href}`;
    if(!/^https:\/\/www\.purposeinvest\.com\//i.test(href))continue;
    href=href.split("#")[0].split("?")[0];
    if(seen.has(href))continue;
    seen.add(href);links.push(href);
  }
  return links.slice(0,18); // enough to cover current YTD plus prior December payment crossover without excessive subrequests
}
function extractDistributionRows(html, mode){
  const out=[];
  const seen=new Set();
  const rows=String(html||"").match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)||[];
  for(const rawRow of rows){
    const text=rowText(rawRow);
    const dates=text.match(/\b\d{4}[\/-]\d{2}[\/-]\d{2}\b/g)||[];
    if(dates.length<3)continue;
    const recordDate=normDate(dates[0]);
    const exDate=normDate(dates[1]);
    const paymentDate=normDate(dates[2]);
    if(!validDate(recordDate)||!validDate(exDate)||!validDate(paymentDate))continue;
    const thirdPos=text.indexOf(dates[2]);
    const tail=thirdPos>=0?text.slice(thirdPos+dates[2].length):text;
    let amount=null;
    if(mode==="harvest"){
      const m=tail.match(/\$\s*([0-9]+(?:\.[0-9]+)?)/);
      if(m)amount=Number(m[1]);
    }else{
      const m=tail.match(/(?:C?A?D?\s*\$\s*)?([0-9]+(?:\.[0-9]{2,6}))\b/i);
      if(m)amount=Number(m[1]);
    }
    if(!(amount>0))continue;
    const key=`${exDate}|${paymentDate}|${amount}`;
    if(seen.has(key))continue;
    seen.add(key);
    out.push({
      exDate,
      paymentDate,
      declarationDate:null,
      recordDate,
      amount,
      paymentDateEstimated:false
    });
  }
  return out.sort((a,b)=>a.exDate.localeCompare(b.exDate));
}

const PURPOSE_FUND_SLUGS={
  APLY:"apple-yield-shares-purpose-etf",
  YGOG:"alphabet-yield-shares-purpose-etf",
  BRKY:"berkshire-hathaway-yield-shares-purpose-etf",
  YMET:"meta-yield-shares-purpose-etf",
  YNET:"netflix-yield-shares-purpose-etf",
  YNVD:"nvidia-yield-shares-purpose-etf",
  YPLT:"palantir-yield-shares-purpose-etf",
  YTSL:"tesla-yield-shares-purpose-etf",
  YUNH:"unitedhealth-group-yield-shares-purpose-etf",
  SPXY:"purpose-spacex-yield-shares-etf",
  ATDY:"purpose-couche-tard-yield-shares-etf",
  BNSY:"purpose-scotiabank-yield-shares-etf",
  BNY:"purpose-brookfield-yield-shares-etf"
};

async function fetchOfficialHtml(url){
  const r=await fetch(url,{
    headers:{"User-Agent":"Mozilla/5.0 (compatible; PortfolioTracker/1.4)","Accept":"text/html,application/xhtml+xml"},
    cf:{cacheTtl:21600,cacheEverything:true}
  });
  if(r.status===404)return null;
  if(!r.ok)throw new Error(`Official source HTTP ${r.status}`);
  return await r.text();
}

async function harvestDividendHistory(symbol){
  if(!symbol.endsWith(".TO"))return null;
  const ticker=baseTicker(symbol);
  // Harvest High Income Shares use a stable ticker-based URL. A non-Harvest ticker simply 404s.
  const slug=ticker.toLowerCase().replaceAll(".","-");
  const url=`https://harvestportfolios.com/high-income-shares/${encodeURIComponent(slug)}/`;
  const html=await fetchOfficialHtml(url);
  if(!html)return null;
  const dividends=extractDistributionRows(html,"harvest");
  if(!dividends.length)return null;
  return {providerSymbol:ticker,source:"Harvest official",sourceUrl:url,dividends};
}

async function purposeDividendHistory(symbol){
  if(!symbol.endsWith(".TO"))return null;
  const ticker=baseTicker(symbol);
  const slug=PURPOSE_FUND_SLUGS[ticker];
  if(!slug)return null;

  const performanceUrl=`https://www.purposeinvest.com/funds/${slug}/performance`;
  const newsUrl=`https://www.purposeinvest.com/funds/${slug}/news`;

  const [performanceHtml,newsHtml]=await Promise.all([
    fetchOfficialHtml(performanceUrl),
    fetchOfficialHtml(newsUrl).catch(()=>null)
  ]);

  const currentRows=performanceHtml?extractDistributionRows(performanceHtml,"purpose"):[];
  let announcementRows=[];
  let announcementLinks=[];

  if(newsHtml){
    announcementLinks=purposeAnnouncementLinks(newsHtml);
    if(announcementLinks.length){
      const pages=await Promise.allSettled(announcementLinks.map(u=>fetchOfficialHtml(u)));
      for(const page of pages){
        if(page.status!=="fulfilled" || !page.value)continue;
        announcementRows.push(...extractPurposeAnnouncementRows(page.value,ticker));
      }
    }
  }

  const dividends=uniqueByDividendKey([...currentRows,...announcementRows]);
  if(!dividends.length)return null;
  return {
    providerSymbol:ticker,
    source:"Purpose official",
    sourceUrl:performanceUrl,
    historySourceUrl:newsUrl,
    officialAnnouncementPages:announcementLinks.length,
    dividends
  };
}

async function officialDividendHistory(symbol){
  // Known Purpose tickers are checked first, then Harvest's generic ticker URL.
  const purpose=await purposeDividendHistory(symbol);
  if(purpose)return purpose;
  return await harvestDividendHistory(symbol);
}

function safeAlphaProblem(msg,apiKey){
  let s=String(msg||"");
  if(apiKey)s=s.split(apiKey).join("[redacted]");
  if(isDailyLimitMessage(s))return "Alpha Vantage daily free-tier limit reached";
  if(isBurstLimitMessage(s))return "Alpha Vantage temporary rate limit";
  s=s.replace(/https?:\/\/\S+/g,"[provider link]");
  return s.slice(0,240)||"Alpha Vantage unavailable";
}
async function yahooDividendFallback(symbol){
  const u=new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  u.searchParams.set("range","10y");
  u.searchParams.set("interval","1mo");
  u.searchParams.set("events","div");
  u.searchParams.set("includeAdjustedClose","false");
  const r=await fetch(u.toString(),{
    headers:{"User-Agent":"Mozilla/5.0 (compatible; PortfolioTracker/1.2)","Accept":"application/json"},
    cf:{cacheTtl:3600,cacheEverything:true}
  });
  if(!r.ok) throw new Error(`Yahoo dividend fallback ${r.status}`);
  const raw=await r.json();
  const result=raw?.chart?.result?.[0];
  if(!result) throw new Error(raw?.chart?.error?.description||"Yahoo dividend fallback unavailable");
  return Object.values(result.events?.dividends||{}).map(d=>({
    exDate:dateKey(d.date),
    paymentDate:dateKey(d.date),
    declarationDate:null,
    recordDate:null,
    amount:Number(d.amount)||0,
    paymentDateEstimated:true
  })).filter(d=>d.amount>0).sort((a,b)=>a.exDate.localeCompare(b.exDate));
}

async function alphaDividendHistory(symbol, apiKey){
  const avSymbol=alphaSymbol(symbol);
  let lastProblem="";
  for(let attempt=0;attempt<2;attempt++){
    const av=new URL("https://www.alphavantage.co/query");
    av.searchParams.set("function","DIVIDENDS");
    av.searchParams.set("symbol",avSymbol);
    av.searchParams.set("apikey",apiKey);

    const ar=await fetch(av.toString(),{headers:{"Accept":"application/json","User-Agent":"PortfolioTracker/1.3"}});
    if(!ar.ok) throw new Error(`Alpha Vantage ${ar.status}`);
    const raw=await ar.json();
    const problem=raw?.Note||raw?.Information||raw?.ErrorMessage||"";
    if(problem){
      lastProblem=String(problem);
      // Cloudflare Preview/browser refreshes can create two requests at once. Retry a burst throttle once.
      if(attempt===0 && isBurstLimitMessage(lastProblem) && !isDailyLimitMessage(lastProblem)){
        await sleep(1400);
        continue;
      }
      throw new Error(safeAlphaProblem(lastProblem,apiKey));
    }

    const rows=Array.isArray(raw?.data)?raw.data:[];
    const dividends=rows.map(d=>{
      const ex=validDate(d.ex_dividend_date)?d.ex_dividend_date:null;
      const pay=validDate(d.payment_date)?d.payment_date:ex;
      return {
        exDate:ex,
        paymentDate:pay,
        declarationDate:validDate(d.declaration_date)?d.declaration_date:null,
        recordDate:validDate(d.record_date)?d.record_date:null,
        amount:Number(d.amount)||0,
        paymentDateEstimated:!validDate(d.payment_date)
      };
    }).filter(d=>d.exDate && d.amount>0).sort((a,b)=>a.exDate.localeCompare(b.exDate));
    return {providerSymbol:avSymbol,dividends};
  }
  throw new Error(safeAlphaProblem(lastProblem||"Alpha Vantage unavailable",apiKey));
}

export default {
  async fetch(request, env, ctx) {
    const origin=request.headers.get("Origin")||"";
    if(request.method==="OPTIONS")return new Response(null,{status:204,headers:cors(origin)});
    if(request.method!=="GET")return json({error:"GET only"},405,origin);
    const url=new URL(request.url);

    if(url.pathname==="/health"){
      return json({
        ok:true,
        priceSource:"Yahoo Finance chart proxy",
        dividendSource:"Official issuer history (including Purpose monthly announcements), then Alpha Vantage, then Yahoo fallback",
        officialFundSources:["Harvest Portfolios","Purpose Investments fund pages + monthly distribution announcements"],
        alphaVantageConfigured:Boolean(env.ALPHAVANTAGE_API_KEY),
        dividendCache:"v4.9 official/exact responses cached; Yahoo fallback is not cached"
      },200,origin,30);
    }

    if(url.pathname==="/search"){
      const q=(url.searchParams.get("q")||"").trim();
      if(!q)return json({results:[]},200,origin);
      if(q.length>80)return json({error:"Query too long"},400,origin);

      const searchUrl=new URL("https://query1.finance.yahoo.com/v1/finance/search");
      searchUrl.searchParams.set("q",q);
      searchUrl.searchParams.set("quotesCount","12");
      searchUrl.searchParams.set("newsCount","0");
      searchUrl.searchParams.set("listsCount","0");
      searchUrl.searchParams.set("enableFuzzyQuery","true");

      const sr=await fetch(searchUrl.toString(),{
        headers:{"User-Agent":"Mozilla/5.0","Accept":"application/json,text/plain,*/*"}
      });
      if(!sr.ok)return json({error:`Yahoo search ${sr.status}`},502,origin);
      const sj=await sr.json();
      const allowedTypes=new Set(["EQUITY","ETF","MUTUALFUND"]);
      const rows=(sj.quotes||[])
        .filter(x=>x && x.symbol && allowedTypes.has(String(x.quoteType||"").toUpperCase()))
        .map(x=>({
          symbol:String(x.symbol||"").toUpperCase(),
          name:x.longname||x.shortname||x.symbol,
          exchange:x.exchDisp||x.exchange||"",
          currency:x.currency||"",
          type:x.quoteType||""
        }))
        .filter((x,i,a)=>a.findIndex(y=>y.symbol===x.symbol)===i)
        .slice(0,10);
      return json({results:rows},200,origin);
    }

    if(url.pathname==="/dividends"){
      const symbol=(url.searchParams.get("symbol")||"").trim().toUpperCase();
      if(!symbol || symbol.length>32 || !/^[A-Z0-9.^=\-]+$/.test(symbol))return json({error:"Invalid symbol"},400,origin);

      // Versioned cache key prevents older fallback/estimated-payment data from being reused.
      // Only exact payment-date responses (official issuer or Alpha) are cached here.
      const cache=caches.default;
      const cacheKey=new Request(`${url.origin}/__portfolio_cache/v49/dividends?symbol=${encodeURIComponent(symbol)}`,{method:"GET"});
      const cached=await cache.match(cacheKey);
      if(cached){
        const h=new Headers(cached.headers);
        h.set("Access-Control-Allow-Origin","*");
        h.set("X-Portfolio-Cache","HIT");
        return new Response(cached.body,{status:cached.status,headers:h});
      }

      let officialProblem="";
      try{
        const official=await officialDividendHistory(symbol);
        if(official?.dividends?.length){
          const body={
            symbol,
            providerSymbol:official.providerSymbol,
            source:official.source,
            sourceUrl:official.sourceUrl,
            ...(official.historySourceUrl?{historySourceUrl:official.historySourceUrl}:{}),
            ...(Number.isFinite(official.officialAnnouncementPages)?{officialAnnouncementPages:official.officialAnnouncementPages}:{}),
            dividends:official.dividends
          };
          const resp=json(body,200,origin,21600); // 6h: issuer pages update only when new distributions are declared
          ctx.waitUntil(cache.put(cacheKey,resp.clone()));
          return resp;
        }
      }catch(e){
        officialProblem=String(e?.message||e);
        console.warn("Official dividend lookup failed",symbol,officialProblem);
      }

      let alphaProblem="";
      if(env.ALPHAVANTAGE_API_KEY){
        try{
          const exact=await alphaDividendHistory(symbol,env.ALPHAVANTAGE_API_KEY);
          const body={symbol,providerSymbol:exact.providerSymbol,source:"Alpha Vantage",dividends:exact.dividends};
          const resp=json(body,200,origin,604800); // 7 days; used mostly for ordinary stocks after official-fund checks
          ctx.waitUntil(cache.put(cacheKey,resp.clone()));
          return resp;
        }catch(e){
          alphaProblem=safeAlphaProblem(e?.message||e,env.ALPHAVANTAGE_API_KEY);
          console.warn("Alpha Vantage dividend lookup failed",symbol,alphaProblem);
        }
      }else{
        alphaProblem="ALPHAVANTAGE_API_KEY is not configured";
      }

      // Temporary fallback only. Do NOT cache it at the Worker edge: otherwise a one-second
      // Alpha throttle would poison the payment-date data for the next 30 minutes.
      try{
        const dividends=await yahooDividendFallback(symbol);
        return json({
          symbol,
          providerSymbol:symbol,
          source:"Yahoo fallback",
          warning:[officialProblem,alphaProblem].filter(Boolean).join(" · "),
          alphaRateLimited:isBurstLimitMessage(alphaProblem)||isDailyLimitMessage(alphaProblem),
          dividends
        },200,origin,0);
      }catch(e){
        return json({error:String(e?.message||e),alphaError:alphaProblem},502,origin,0);
      }
    }

    if(url.pathname!=="/quote")return json({error:"Use /quote?symbol=AAPL or /dividends?symbol=AAPL"},404,origin);

    const symbol=(url.searchParams.get("symbol")||"").trim().toUpperCase();
    if(!symbol || symbol.length>32 || !/^[A-Z0-9.^=\-]+$/.test(symbol))return json({error:"Invalid symbol"},400,origin);
    let range=url.searchParams.get("range")||"1y"; if(!ALLOWED_RANGES.has(range))range="1y";
    let interval=url.searchParams.get("interval")||"1d"; if(!ALLOWED_INTERVALS.has(interval))interval="1d";

    const yahoo=new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
    yahoo.searchParams.set("range",range);
    yahoo.searchParams.set("interval",interval);
    yahoo.searchParams.set("events","div,splits");
    yahoo.searchParams.set("includeAdjustedClose","true");

    try{
      const resp=await fetch(yahoo.toString(),{
        headers:{"User-Agent":"Mozilla/5.0 (compatible; PortfolioTracker/1.2)","Accept":"application/json"},
        cf:{cacheTtl:30,cacheEverything:true}
      });
      if(!resp.ok)return json({error:`Yahoo upstream ${resp.status}`},502,origin);
      const raw=await resp.json();
      const result=raw?.chart?.result?.[0];
      if(!result)return json({error:raw?.chart?.error?.description||"Symbol not found"},404,origin);
      const meta=result.meta||{};
      const ts=result.timestamp||[];
      const closes=result.indicators?.quote?.[0]?.close||[];
      const history=[];
      for(let i=0;i<ts.length;i++){
        const close=Number(closes[i]);
        if(Number.isFinite(close))history.push({time:ts[i],date:dateKey(ts[i]),close});
      }
      const dividends=Object.values(result.events?.dividends||{}).map(d=>({
        date:dateKey(d.date), amount:Number(d.amount)||0
      })).filter(d=>d.amount>0).sort((a,b)=>a.date.localeCompare(b.date));
      const price=Number(meta.regularMarketPrice ?? history.at(-1)?.close ?? 0);
      let previousClose=price;
      if(history.length){
        const marketDate=meta.regularMarketTime?dateKey(meta.regularMarketTime):null;
        const last=history.at(-1);
        const prior=history.at(-2);
        if(marketDate && last?.date===marketDate && prior?.close>0) previousClose=Number(prior.close);
        else if(last?.close>0) previousClose=Number(last.close);
        else if(prior?.close>0) previousClose=Number(prior.close);
      }
      return json({
        symbol:meta.symbol||symbol,
        title:meta.longName||meta.shortName||symbol,
        currency:meta.currency||null,
        exchange:meta.fullExchangeName||meta.exchangeName||null,
        marketState:meta.marketState||null,
        price,
        previousClose,
        change:price-previousClose,
        changePercent:previousClose?((price/previousClose)-1)*100:0,
        regularMarketTime:meta.regularMarketTime||null,
        range,interval,history,dividends,splits:Object.values(result.events?.splits||{}),
        source:"Yahoo Finance (unofficial chart endpoint)"
      },200,origin);
    }catch(e){
      return json({error:String(e?.message||e)},502,origin);
    }
  }
};
