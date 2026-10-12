// Cloudflare Worker for the personal Portfolio Tracker.
// Yahoo Finance: prices/history/search.
// Alpha Vantage: dividend corporate actions with ex-date + payment date.
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
function alphaSymbol(symbol){
  if(symbol.endsWith(".TO")) return symbol.slice(0,-3)+".TRT";
  if(symbol.endsWith(".V")) return symbol.slice(0,-2)+".TRV";
  return symbol;
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
        dividendSource:"Alpha Vantage with Yahoo fallback",
        alphaVantageConfigured:Boolean(env.ALPHAVANTAGE_API_KEY)
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

      // Cache normalized dividend history at the Cloudflare edge. Dividend corporate actions
      // do not need 5-minute refreshes; this also protects the Alpha Vantage free quota.
      const cache=caches.default;
      const cacheKey=new Request(`${url.origin}/dividends?symbol=${encodeURIComponent(symbol)}`,{method:"GET"});
      const cached=await cache.match(cacheKey);
      if(cached){
        const h=new Headers(cached.headers); h.set("Access-Control-Allow-Origin","*"); h.set("X-Portfolio-Cache","HIT");
        return new Response(cached.body,{status:cached.status,headers:h});
      }

      let alphaProblem="";
      if(env.ALPHAVANTAGE_API_KEY){
        try{
          const avSymbol=alphaSymbol(symbol);
          const av=new URL("https://www.alphavantage.co/query");
          av.searchParams.set("function","DIVIDENDS");
          av.searchParams.set("symbol",avSymbol);
          av.searchParams.set("apikey",env.ALPHAVANTAGE_API_KEY);

          const ar=await fetch(av.toString(),{
            headers:{"Accept":"application/json","User-Agent":"PortfolioTracker/1.2"}
          });
          if(!ar.ok) throw new Error(`Alpha Vantage ${ar.status}`);
          const raw=await ar.json();
          if(raw?.Note || raw?.Information) throw new Error(raw.Note||raw.Information);
          if(raw?.ErrorMessage) throw new Error(raw.ErrorMessage);

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

          // A legitimate non-dividend-paying security may return an empty data array.
          // If Alpha gave a normal response, trust it instead of inventing Yahoo events.
          const body={symbol,providerSymbol:avSymbol,source:"Alpha Vantage",dividends};
          const resp=json(body,200,origin,86400);
          ctx.waitUntil(cache.put(cacheKey,resp.clone()));
          return resp;
        }catch(e){
          alphaProblem=String(e?.message||e);
          console.warn("Alpha Vantage dividend lookup failed",symbol,alphaProblem);
        }
      }else{
        alphaProblem="ALPHAVANTAGE_API_KEY is not configured";
      }

      // Graceful fallback: keeps the app working if Alpha is rate-limited or does not know a symbol.
      // These dates are ex-dividend dates, so paymentDateEstimated=true is explicit.
      try{
        const dividends=await yahooDividendFallback(symbol);
        const body={symbol,providerSymbol:symbol,source:"Yahoo fallback",warning:alphaProblem,dividends};
        const resp=json(body,200,origin,1800);
        ctx.waitUntil(cache.put(cacheKey,resp.clone()));
        return resp;
      }catch(e){
        return json({error:String(e?.message||e),alphaError:alphaProblem},502,origin,30);
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
