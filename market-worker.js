// Cloudflare Worker for the personal Portfolio Tracker.
// v5.20 Cloud First: D1 primary sync + scheduled daily net worth snapshots.
// Yahoo Finance: prices/history/search.
// Dividend provider priority:
//   1) Official fund issuer pages for supported Harvest / Purpose ETFs
//   2) Alpha Vantage corporate actions
//   3) Yahoo ex-date fallback
// v5.12: CIBC mutual-fund NAV auto-update for ATL486 / ATL496 / ATL525.
// v5.2: Evolve BANK now uses Evolve's monthly distribution announcements, which contain the real ex-date/pay-date pair.
// Purpose history is supplemented from official monthly distribution announcements so YTD includes older payments.
// ALPHAVANTAGE_API_KEY is stored as a Cloudflare Worker Secret.

const ALLOWED_RANGES = new Set(["1d","5d","1mo","3mo","6mo","1y","2y","5y","10y","ytd","max"]);
const ALLOWED_INTERVALS = new Set(["1m","2m","5m","15m","30m","60m","90m","1d","5d","1wk","1mo","3mo"]);

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,PUT,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization"
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
  const s=String(v||"").trim().replace(/,/g,"").replace(/\s+/g," ");
  let m=s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  if(m)return `${m[1]}-${String(m[2]).padStart(2,"0")}-${String(m[3]).padStart(2,"0")}`;
  m=s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if(m)return `${m[3]}-${String(m[1]).padStart(2,"0")}-${String(m[2]).padStart(2,"0")}`;
  m=s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2})$/);
  if(m){const y=Number(m[3])>=70?1900+Number(m[3]):2000+Number(m[3]);return `${y}-${String(m[1]).padStart(2,"0")}-${String(m[2]).padStart(2,"0")}`;}
  m=s.match(/^(January|February|March|April|May|June|July|August|September|Sept|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s+(\d{4})$/i);
  if(m){
    const months={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
    const key=m[1].slice(0,3).toLowerCase();
    return `${m[3]}-${String(months[key]).padStart(2,"0")}-${String(m[2]).padStart(2,"0")}`;
  }
  return null;
}
function extractDateTokens(text){
  return String(text||"").match(/\b(?:\d{4}[\/-]\d{1,2}[\/-]\d{1,2}|\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4})\b/gi)||[];
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
  if(!/\.(TO|NE)$/.test(symbol))return null;
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

const HAMILTON_FUND_URLS={
  HYLD:"https://hamiltonetfs.com/etf/hyld/"
};
const VANGUARD_FUND_URLS={
  VFV:"https://www.vanguard.ca/en/product/etf/equity/9563/vanguard-sp-500-index-etf"
};
const EVOLVE_FUND_URLS={
  BANK:"https://evolveetfs.com/product/bank/"
};

function extractTwoDateDistributionRows(html){
  const out=[];
  const rows=String(html||"").match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)||[];
  for(const rawRow of rows){
    const text=rowText(rawRow);
    const tokens=extractDateTokens(text);
    if(tokens.length<2)continue;
    const exDate=parseFlexibleDate(tokens[0]);
    const paymentDate=parseFlexibleDate(tokens[1]);
    if(!exDate||!paymentDate)continue;
    const m=text.match(/\$\s*([0-9]+(?:\.[0-9]+)?)/);
    if(!m)continue;
    const amount=Number(m[1]);
    if(!(amount>0))continue;
    out.push({exDate,paymentDate,declarationDate:null,recordDate:exDate,amount,paymentDateEstimated:false});
  }
  return uniqueByDividendKey(out);
}
function extractThreeDateDistributionRows(html){
  const out=[];
  const rows=String(html||"").match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)||[];
  for(const rawRow of rows){
    const text=rowText(rawRow);
    const tokens=extractDateTokens(text);
    if(tokens.length<3)continue;
    const exDate=parseFlexibleDate(tokens[0]);
    const recordDate=parseFlexibleDate(tokens[1]);
    const paymentDate=parseFlexibleDate(tokens[2]);
    if(!exDate||!recordDate||!paymentDate)continue;
    const lastDatePos=text.toLowerCase().lastIndexOf(tokens[2].toLowerCase());
    const tail=lastDatePos>=0?text.slice(lastDatePos+tokens[2].length):text;
    const m=tail.match(/\$\s*([0-9]+(?:\.[0-9]+)?)/) || text.match(/\$\s*([0-9]+(?:\.[0-9]+)?)/);
    if(!m)continue;
    const amount=Number(m[1]);
    if(!(amount>0))continue;
    out.push({exDate,paymentDate,declarationDate:null,recordDate,amount,paymentDateEstimated:false});
  }
  return uniqueByDividendKey(out);
}
async function hamiltonDividendHistory(symbol){
  if(!symbol.endsWith(".TO"))return null;
  const ticker=baseTicker(symbol);
  const url=HAMILTON_FUND_URLS[ticker];
  if(!url)return null;
  const html=await fetchOfficialHtml(url);
  if(!html)return null;
  const dividends=extractTwoDateDistributionRows(html);
  if(!dividends.length)return null;
  return {providerSymbol:ticker,source:"Hamilton official",sourceUrl:url,dividends};
}
async function vanguardDividendHistory(symbol){
  if(!symbol.endsWith(".TO"))return null;
  const ticker=baseTicker(symbol);
  const url=VANGUARD_FUND_URLS[ticker];
  if(!url)return null;
  const html=await fetchOfficialHtml(url);
  if(!html)return null;
  const dividends=extractThreeDateDistributionRows(html);
  if(!dividends.length)return null;
  return {providerSymbol:ticker,source:"Vanguard official",sourceUrl:url,dividends};
}
function evolveMonthlyAnnouncementUrls(monthsBack=15){
  const names=["january","february","march","april","may","june","july","august","september","october","november","december"];
  const now=new Date();
  const urls=[];
  for(let i=0;i<monthsBack;i++){
    const d=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-i,1));
    const year=d.getUTCFullYear();
    const month=names[d.getUTCMonth()];
    urls.push(`https://evolveetfs.com/${year}/${String(d.getUTCMonth()+1).padStart(2,"0")}/evolve-announces-${month}-${year}-distributions-for-ultrayield-etfs-and-certain-evolve-funds/`);
  }
  return urls;
}

function extractEvolveFundAnnouncementRow(html,ticker){
  const pageText=rowText(html);
  const namedDate="(?:January|February|March|April|May|June|July|August|September|October|November|December)\\s+\\d{1,2},?\\s+\\d{4}";

  // Evolve's "Evolve Funds" table usually contains only ticker + amount.
  // The exact ex-date and payment date are stated in the paragraph immediately above the table.
  const exRe=new RegExp(
    `For the Distributions for all other Evolve Funds[\\s\\S]{0,450}?ex-dividend date and record date is anticipated to be (${namedDate})`,
    "i"
  );
  const payRe=new RegExp(
    `Unitholders of Evolve Funds on record date will receive cash distributions payable on or about (${namedDate})`,
    "i"
  );

  const exMatch=pageText.match(exRe);
  const payMatch=pageText.match(payRe);
  if(!exMatch || !payMatch)return null;

  const exDate=parseFlexibleDate(exMatch[1]);
  const paymentDate=parseFlexibleDate(payMatch[1]);
  if(!exDate || !paymentDate)return null;

  const rows=String(html||"").match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)||[];
  const tickerRe=new RegExp(`(?:^|\\s)${escapeRegex(ticker)}(?:\\s|$)`,"i");

  for(const rawRow of rows){
    const text=rowText(rawRow);
    if(!tickerRe.test(text))continue;

    // Look after the ticker so we don't accidentally capture a number from the fund name.
    const tickerPos=text.toUpperCase().indexOf(ticker.toUpperCase());
    const tail=tickerPos>=0?text.slice(tickerPos+ticker.length):text;
    const amountMatch=tail.match(/\$\s*([0-9]+(?:\.[0-9]+)?)/);
    if(!amountMatch)continue;

    const amount=Number(amountMatch[1]);
    if(!(amount>0))continue;

    return {
      exDate,
      paymentDate,
      declarationDate:null,
      recordDate:exDate,
      amount,
      paymentDateEstimated:false
    };
  }
  return null;
}

async function evolveAnnouncementDividendHistory(ticker){
  const rows=[];
  let usedPages=0;
  const urls=evolveMonthlyAnnouncementUrls(15);

  for(const url of urls){
    try{
      const html=await fetchOfficialHtml(url);
      if(!html)continue;
      const row=extractEvolveFundAnnouncementRow(html,ticker);
      if(row){
        rows.push(row);
        usedPages++;
      }
    }catch(e){
      console.warn("Evolve monthly announcement lookup failed",ticker,url,String(e?.message||e));
    }
  }

  return {
    dividends:uniqueByDividendKey(rows),
    usedPages
  };
}

async function evolveDividendHistory(symbol){
  if(!symbol.endsWith(".TO"))return null;
  const ticker=baseTicker(symbol);
  const url=EVOLVE_FUND_URLS[ticker];
  if(!url)return null;

  // The BANK product page does not expose its history as a normal 3-date HTML table.
  // Evolve's official monthly announcements do expose the exact ex-date, pay date and amount.
  const announcementHistory=await evolveAnnouncementDividendHistory(ticker);
  if(announcementHistory.dividends.length){
    return {
      providerSymbol:ticker,
      source:"Evolve official",
      sourceUrl:url,
      historySourceUrl:"https://evolveetfs.com/news/",
      officialAnnouncementPages:announcementHistory.usedPages,
      dividends:announcementHistory.dividends
    };
  }

  // Keep the product-page parser as a future-compatible fallback.
  const html=await fetchOfficialHtml(url);
  if(!html)return null;
  const dividends=extractThreeDateDistributionRows(html);
  if(!dividends.length)return null;
  return {providerSymbol:ticker,source:"Evolve official",sourceUrl:url,dividends};
}

async function officialDividendHistory(symbol){
  const purpose=await purposeDividendHistory(symbol);
  if(purpose)return purpose;
  const harvest=await harvestDividendHistory(symbol);
  if(harvest)return harvest;
  const hamilton=await hamiltonDividendHistory(symbol);
  if(hamilton)return hamilton;
  const vanguard=await vanguardDividendHistory(symbol);
  if(vanguard)return vanguard;
  return await evolveDividendHistory(symbol);
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


// ----- CIBC mutual funds (Class A) -----
// CIBC changed the FundServ prefixes from CIB to ATL in Oct 2025.  The user's
// three holdings are the CAD Class A funds below.  We try CIBC public pages
// first and use the public YCharts price page as a resilient fallback because
// the CIBC pricing pages are sometimes rendered dynamically.
const CIBC_MUTUAL_FUND_CONFIG={
  ATL486:{legacy:"486",name:"CIBC Dividend Growth Fund, Class A"},
  ATL496:{legacy:"496",name:"CIBC Technology Innovation Fund, Class A"},
  ATL525:{legacy:"525",name:"CIBC U.S. Equity Fund, Class A"}
};
function stripHtmlText(html){
  return htmlDecode(String(html||"")
    .replace(/<script\b[\s\S]*?<\/script>/gi," ")
    .replace(/<style\b[\s\S]*?<\/style>/gi," ")
    .replace(/<[^>]+>/g," ")
    .replace(/\s+/g," ")
    .trim());
}
function isoHumanDate(s){
  const d=parseFlexibleDate(String(s||"").replace(/\./g,""));
  return d||null;
}
function parseCibcOfficialPrice(ticker,html){
  const text=stripHtmlText(html);
  if(!text)return null;

  // Product pages usually expose an "As of" date and a Class A price.
  let date=null;
  let dm=text.match(/\bAs of\s*:?\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})/i);
  if(dm)date=isoHumanDate(dm[1]);

  let price=null;
  const pricesPos=text.search(/\bPrices\b/i);
  const segment=pricesPos>=0?text.slice(pricesPos,pricesPos+1800):text;
  let pm=segment.match(/(?:Class|Series)\s+A\s+\$?\s*([0-9]{1,4}(?:\.[0-9]{2,6}))/i);
  if(pm)price=Number(pm[1]);

  // Historical pricing page fallback: first visible row after "Unit Prices".
  if(!(price>0)){
    const up=text.search(/Unit Prices/i);
    const hist=up>=0?text.slice(up,up+2500):text;
    const hm=hist.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}|\d{4}[\/-]\d{1,2}[\/-]\d{1,2})\s+\$?\s*([0-9]{1,4}(?:\.[0-9]{2,6}))/i);
    if(hm){date=isoHumanDate(hm[1]);price=Number(hm[2]);}
  }
  return price>0?{ticker,price,date,source:"CIBC Global Asset Management"}:null;
}
function parseYChartsMutualFundPrice(ticker,html){
  const text=stripHtmlText(html);
  if(!text)return null;
  const esc=escapeRegex(ticker);
  let m=text.match(new RegExp(`${esc}\\s+Price:\\s*([0-9][0-9,]*(?:\\.[0-9]+)?)\\s+for\\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\\.?\\s+\\d{1,2},?\\s+\\d{4})`,`i`));
  if(m)return {ticker,price:Number(m[1].replaceAll(",","")),date:isoHumanDate(m[2]),source:"YCharts public mutual-fund price page"};

  // Header fallback, e.g. "(ATL496) 112.40 +0.71 ... CAD | Oct 09 2026".
  const pos=text.toUpperCase().indexOf(`(${ticker})`);
  const seg=pos>=0?text.slice(pos,pos+600):text;
  m=seg.match(/\)\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s+[+\-−]?[0-9.,]+[\s\S]{0,80}?CAD\s*\|?\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})/i);
  if(m)return {ticker,price:Number(m[1].replaceAll(",","")),date:isoHumanDate(m[2]),source:"YCharts public mutual-fund price page"};
  return null;
}
async function fetchCibcMutualFundPrice(ticker){
  const cfg=CIBC_MUTUAL_FUND_CONFIG[ticker];
  if(!cfg)throw new Error(`Unsupported CIBC fund ${ticker}`);
  const headers={"User-Agent":"Mozilla/5.0 (compatible; PortfolioTracker/1.5)","Accept":"text/html,application/xhtml+xml"};
  const officialUrls=[
    `https://www.cibcassetmanagement.com/investments/products/${cfg.legacy}`,
    `https://www.cibcassetmanagement.com/investments/prices/hprice?fund=${cfg.legacy}&type=mutual`
  ];
  for(const sourceUrl of officialUrls){
    try{
      const r=await fetch(sourceUrl,{headers,cf:{cacheTtl:1800,cacheEverything:true}});
      if(r.ok){
        const parsed=parseCibcOfficialPrice(ticker,await r.text());
        if(parsed)return {...parsed,name:cfg.name,sourceUrl};
      }
    }catch(e){console.warn("CIBC official NAV lookup failed",ticker,sourceUrl,String(e?.message||e));}
  }

  const sourceUrl=`https://ycharts.com/mutual_funds/M%3A${encodeURIComponent(ticker)}.TO/price`;
  const r=await fetch(sourceUrl,{headers,cf:{cacheTtl:1800,cacheEverything:true}});
  if(!r.ok)throw new Error(`CIBC NAV fallback HTTP ${r.status}`);
  const parsed=parseYChartsMutualFundPrice(ticker,await r.text());
  if(!parsed)throw new Error(`Could not parse latest NAV for ${ticker}`);
  return {...parsed,name:cfg.name,sourceUrl};
}


const CLOUD_MAX_BODY_BYTES=1800000;
const CLOUD_USER_ID="primary";
const CLOUD_NET_WORTH_HISTORY_KEY="netWorthHistoryV58";
function privateJson(body,status=200,origin=""){
  return new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json;charset=UTF-8","Cache-Control":"no-store",...cors(origin)}});
}
function cloudAuthorized(request,env){
  const configured=String(env.PORTFOLIO_SYNC_TOKEN||"");
  if(!configured)return false;
  const header=String(request.headers.get("Authorization")||"");
  return header===`Bearer ${configured}`;
}
async function cloudStateRow(env){
  return await env.DB.prepare("SELECT revision, payload_json, device_id, local_updated_at, updated_at FROM portfolio_state WHERE user_id = ?").bind(CLOUD_USER_ID).first();
}
function safeJsonParse(raw,fallback=null){try{return JSON.parse(String(raw??""))}catch(e){return fallback}}
function cloudLocalDate(date=new Date(),timeZone="America/Vancouver"){
  try{
    const parts=new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date);
    const m=Object.fromEntries(parts.map(x=>[x.type,x.value]));
    if(m.year&&m.month&&m.day)return `${m.year}-${m.month}-${m.day}`;
  }catch(e){}
  return date.toISOString().slice(0,10);
}
function cloudModelFromPayload(payload){
  return payload?.cloudModel && typeof payload.cloudModel==="object" ? payload.cloudModel : null;
}
async function yahooLatestQuote(symbol){
  const u=new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  u.searchParams.set("range","5d");u.searchParams.set("interval","1d");u.searchParams.set("includeAdjustedClose","false");
  const r=await fetch(u.toString(),{headers:{"User-Agent":"Mozilla/5.0 (compatible; PortfolioTracker/2.0)","Accept":"application/json"},cf:{cacheTtl:120,cacheEverything:true}});
  if(!r.ok)throw new Error(`Yahoo quote ${symbol} ${r.status}`);
  const raw=await r.json();
  const result=raw?.chart?.result?.[0];
  if(!result)throw new Error(raw?.chart?.error?.description||`Yahoo quote unavailable for ${symbol}`);
  const meta=result.meta||{};
  const closes=result.indicators?.quote?.[0]?.close||[];
  const last=[...closes].reverse().find(v=>Number.isFinite(Number(v)));
  const price=Number(meta.regularMarketPrice ?? last ?? 0);
  if(!(price>0))throw new Error(`No price for ${symbol}`);
  return {symbol:String(meta.symbol||symbol),price,currency:String(meta.currency||((/\.(TO|NE|V)$/i.test(symbol))?"CAD":"USD"))};
}
async function runStatements(env,statements,chunkSize=70){
  for(let i=0;i<statements.length;i+=chunkSize){await env.DB.batch(statements.slice(i,i+chunkSize));}
}
function transactionCreatedAtIso(v){
  const n=Number(v||0);if(n>0){try{return new Date(n).toISOString()}catch(e){}}
  return null;
}
async function syncStructuredTablesFromPayload(env,payload,now){
  const model=cloudModelFromPayload(payload);
  const storage=payload?.storage||{};
  if(!model)return;

  const statements=[];
  statements.push(env.DB.prepare("DELETE FROM accounts WHERE user_id = ?").bind(CLOUD_USER_ID));
  for(const a of (Array.isArray(model.manualAccounts)?model.manualAccounts:[])){
    if(!a?.id)continue;
    statements.push(env.DB.prepare(`INSERT INTO accounts (id,user_id,name,account_type,currency,balance,updated_at) VALUES (?,?,?,?,?,?,?)`)
      .bind(String(a.id),CLOUD_USER_ID,String(a.name||"Account"),String(a.category||a.type||"asset"),String(a.currency||"CAD"),Math.abs(Number(a.balance)||0),now));
  }

  statements.push(env.DB.prepare("DELETE FROM investment_accounts WHERE user_id = ?").bind(CLOUD_USER_ID));
  for(const a of (Array.isArray(model.investmentAccounts)?model.investmentAccounts:[])){
    if(!a?.id)continue;
    statements.push(env.DB.prepare(`INSERT INTO investment_accounts (id,user_id,name,cash_cad,net_deposits_cad,updated_at) VALUES (?,?,?,?,?,?)`)
      .bind(String(a.id),CLOUD_USER_ID,String(a.name||a.id),Number(a.cashCAD)||0,Number(a.netDepositsCAD)||0,now));
  }

  statements.push(env.DB.prepare("DELETE FROM investment_lots WHERE user_id = ?").bind(CLOUD_USER_ID));
  for(const l of (Array.isArray(model.lots)?model.lots:[])){
    if(!l?.ticker||!l?.date||!(Number(l.shares)!==0))continue;
    statements.push(env.DB.prepare(`INSERT INTO investment_lots (user_id,account_id,ticker,trade_date,shares,cost_per_share,opening_position,source,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .bind(CLOUD_USER_ID,String(l.accountId||"wealthsimple_tfsa"),String(l.ticker).toUpperCase(),String(l.date),Number(l.shares)||0,Number(l.cost)||0,l.openingPosition?1:0,String(l.source||""),now));
  }

  const txRows=safeJsonParse(storage.personalLedgerTransactionsV513,[]);
  statements.push(env.DB.prepare("DELETE FROM transactions WHERE user_id = ?").bind(CLOUD_USER_ID));
  for(const t of (Array.isArray(txRows)?txRows:[])){
    if(!t?.id||!t?.date||!(Math.abs(Number(t.amount)||0)>0))continue;
    statements.push(env.DB.prepare(`INSERT INTO transactions (id,user_id,transaction_date,transaction_type,category,note,amount,currency,account_id,from_account_id,to_account_id,affects_balance,source,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(String(t.id),CLOUD_USER_ID,String(t.date),String(t.type||"expense"),String(t.category||""),String(t.note||""),Math.abs(Number(t.amount)||0),String(t.currency||"CAD"),String(t.accountId||""),String(t.fromAccountId||""),String(t.toAccountId||""),t.affectsBalance===false?0:1,String(t.source||"manual"),transactionCreatedAtIso(t.createdAt),now));
  }

  const history=safeJsonParse(storage[CLOUD_NET_WORTH_HISTORY_KEY],[]);
  for(const h of (Array.isArray(history)?history:[])){
    const date=String(h?.date||"");const value=Number(h?.value);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(value))continue;
    statements.push(env.DB.prepare(`INSERT INTO net_worth_daily (user_id,snapshot_date,net_worth,net_asset_base,investment_growth,debts,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(user_id,snapshot_date) DO UPDATE SET net_worth=excluded.net_worth,net_asset_base=excluded.net_asset_base,investment_growth=excluded.investment_growth,debts=excluded.debts,updated_at=excluded.updated_at`)
      .bind(CLOUD_USER_ID,date,value,Number.isFinite(Number(h.base))?Number(h.base):null,Number.isFinite(Number(h.growth))?Number(h.growth):null,Number.isFinite(Number(h.liabilities))?Number(h.liabilities):null,now,now));
  }
  await runStatements(env,statements);
}
async function computeDailySnapshotFromPayload(payload){
  const model=cloudModelFromPayload(payload);
  if(!model)throw new Error("Cloud state is from V5.19 and does not contain the V5.20 cloud model yet");
  const timezone=String(model.timezone||"America/Vancouver");
  const fxQuote=await yahooLatestQuote("CAD=X");
  const fx=Number(fxQuote.price)||1;

  const lotMap=new Map();
  for(const l of (Array.isArray(model.lots)?model.lots:[])){
    const ticker=String(l?.ticker||"").toUpperCase();if(!ticker)continue;
    lotMap.set(ticker,(lotMap.get(ticker)||0)+(Number(l.shares)||0));
  }
  const tickers=[...lotMap.entries()].filter(([,shares])=>Math.abs(shares)>1e-9).map(([ticker])=>ticker);
  const settled=await Promise.allSettled(tickers.map(t=>yahooLatestQuote(t)));
  const quotes=new Map();
  settled.forEach((r,i)=>{if(r.status==="fulfilled")quotes.set(tickers[i],r.value)});
  const missing=tickers.filter(t=>!quotes.has(t));
  if(missing.length)throw new Error(`Missing market prices: ${missing.join(", ")}`);

  let listedMarketValue=0;
  for(const [ticker,shares] of lotMap.entries()){
    if(Math.abs(shares)<=1e-9)continue;
    const q=quotes.get(ticker);if(!q)continue;
    listedMarketValue+=shares*q.price*(String(q.currency).toUpperCase()==="USD"?fx:1);
  }

  let cibcMarketValue=0;
  const cibcFunds=Array.isArray(model.cibcFunds)?model.cibcFunds:[];
  if(cibcFunds.length){
    const navResults=await Promise.allSettled(cibcFunds.map(f=>fetchCibcMutualFundPrice(String(f.ticker||"").toUpperCase())));
    navResults.forEach((r,i)=>{
      const units=Number(cibcFunds[i]?.units)||0;
      if(r.status==="fulfilled" && Number(r.value?.price)>0)cibcMarketValue+=units*Number(r.value.price);
      else cibcMarketValue+=units*(Number(cibcFunds[i]?.lastPrice)||0);
    });
  }

  const invAccounts=Array.isArray(model.investmentAccounts)?model.investmentAccounts:[];
  const investmentCash=invAccounts.reduce((sum,a)=>sum+(Number(a?.cashCAD)||0),0);
  const investmentBasis=invAccounts.reduce((sum,a)=>sum+(Number(a?.netDepositsCAD)||0),0);
  const investmentValue=listedMarketValue+cibcMarketValue+investmentCash;

  let manualAssets=0,debts=0;
  for(const a of (Array.isArray(model.manualAccounts)?model.manualAccounts:[])){
    const cad=Math.abs(Number(a?.balance)||0)*(String(a?.currency||"CAD").toUpperCase()==="USD"?fx:1);
    if(String(a?.type||"asset")==="liability")debts+=cad;else manualAssets+=cad;
  }
  const netAssetBase=manualAssets+investmentBasis;
  const investmentGrowth=investmentValue-investmentBasis;
  const netWorth=investmentValue+manualAssets-debts;
  return {date:cloudLocalDate(new Date(),timezone),netWorth,netAssetBase,investmentGrowth,debts,investmentValue,manualAssets,investmentBasis,fx};
}
function mergeSnapshotIntoPayload(payload,snapshot,now){
  const storage=payload.storage && typeof payload.storage==="object" ? payload.storage : (payload.storage={});
  let history=safeJsonParse(storage[CLOUD_NET_WORTH_HISTORY_KEY],[]);
  if(!Array.isArray(history))history=[];
  const row={date:snapshot.date,value:snapshot.netWorth,base:snapshot.netAssetBase,growth:snapshot.investmentGrowth,liabilities:snapshot.debts};
  const ix=history.findIndex(x=>String(x?.date||"")===snapshot.date);
  if(ix>=0)history[ix]=row;else history.push(row);
  history=history.filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(String(x?.date||""))&&Number.isFinite(Number(x?.value))).sort((a,b)=>String(a.date).localeCompare(String(b.date))).slice(-730);
  storage[CLOUD_NET_WORTH_HISTORY_KEY]=JSON.stringify(history);
  if(payload.cloudModel && typeof payload.cloudModel==="object")payload.cloudModel.currentSnapshot={date:snapshot.date,netWorth:snapshot.netWorth,netAssetBase:snapshot.netAssetBase,investmentGrowth:snapshot.investmentGrowth,debts:snapshot.debts};
  payload.serverSnapshotAt=now;
  return payload;
}
async function updateDailyNetWorthFromCloud(env){
  if(!env.DB)return {ok:false,reason:"no-db"};
  const current=await cloudStateRow(env);
  if(!current?.payload_json)return {ok:false,reason:"no-cloud-state"};
  const payload=safeJsonParse(current.payload_json,null);
  if(!payload)return {ok:false,reason:"invalid-cloud-state"};
  const snapshot=await computeDailySnapshotFromPayload(payload);
  const now=new Date().toISOString();
  const nextPayload=mergeSnapshotIntoPayload(payload,snapshot,now);
  const nextJson=JSON.stringify(nextPayload);
  const currentRevision=Number(current.revision||0);
  const nextRevision=currentRevision+1;
  const result=await env.DB.prepare(`UPDATE portfolio_state SET revision=?,payload_json=?,device_id=?,updated_at=? WHERE user_id=? AND revision=?`)
    .bind(nextRevision,nextJson,"server-daily",now,CLOUD_USER_ID,currentRevision).run();
  if(Number(result?.meta?.changes||0)!==1)return {ok:false,reason:"revision-race"};
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO portfolio_backups (user_id,backup_date,revision,payload_json,created_at) VALUES (?,?,?,?,?)
      ON CONFLICT(user_id,backup_date) DO UPDATE SET revision=excluded.revision,payload_json=excluded.payload_json,created_at=excluded.created_at`)
      .bind(CLOUD_USER_ID,snapshot.date,currentRevision,current.payload_json,now),
    env.DB.prepare(`INSERT INTO net_worth_daily (user_id,snapshot_date,net_worth,net_asset_base,investment_growth,debts,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(user_id,snapshot_date) DO UPDATE SET net_worth=excluded.net_worth,net_asset_base=excluded.net_asset_base,investment_growth=excluded.investment_growth,debts=excluded.debts,updated_at=excluded.updated_at`)
      .bind(CLOUD_USER_ID,snapshot.date,snapshot.netWorth,snapshot.netAssetBase,snapshot.investmentGrowth,snapshot.debts,now,now)
  ]);
  return {ok:true,revision:nextRevision,snapshot};
}
async function handleCloudRequest(request,env,origin,url){
  if(!env.DB)return privateJson({error:"D1 binding DB is not configured"},503,origin);
  if(!env.PORTFOLIO_SYNC_TOKEN)return privateJson({error:"PORTFOLIO_SYNC_TOKEN Worker secret is not configured"},503,origin);
  if(!cloudAuthorized(request,env))return privateJson({error:"Unauthorized"},401,origin);

  if(url.pathname==="/api/cloud/status" && request.method==="GET"){
    const row=await cloudStateRow(env);
    const stateMeta=row?.payload_json?safeJsonParse(row.payload_json,{}):{};
    const daily=await env.DB.prepare("SELECT snapshot_date,net_worth,updated_at FROM net_worth_daily WHERE user_id=? ORDER BY snapshot_date DESC LIMIT 1").bind(CLOUD_USER_ID).first();
    return privateJson({ok:true,configured:true,mode:"cloud-first",hasCloudState:Boolean(row),revision:Number(row?.revision||0),updatedAt:row?.updated_at||null,deviceId:row?.device_id||null,schemaVersion:Number(stateMeta?.schemaVersion||0),appVersion:String(stateMeta?.appVersion||""),lastDailySnapshot:daily||null},200,origin);
  }

  if(url.pathname==="/api/cloud/state" && request.method==="GET"){
    const row=await cloudStateRow(env);
    if(!row)return privateJson({error:"No cloud data exists yet"},404,origin);
    const payload=safeJsonParse(row.payload_json,null);
    if(!payload)return privateJson({error:"Stored cloud data is unreadable"},500,origin);
    return privateJson({revision:Number(row.revision||0),updatedAt:row.updated_at,deviceId:row.device_id||null,localUpdatedAt:row.local_updated_at||null,payload},200,origin);
  }

  if(url.pathname==="/api/cloud/state" && request.method==="PUT"){
    const announced=Number(request.headers.get("Content-Length")||0);
    if(announced>CLOUD_MAX_BODY_BYTES)return privateJson({error:"Cloud payload is too large"},413,origin);
    const raw=await request.text();
    if(raw.length>CLOUD_MAX_BODY_BYTES)return privateJson({error:"Cloud payload is too large"},413,origin);
    const body=safeJsonParse(raw,null);
    if(!body)return privateJson({error:"Invalid JSON"},400,origin);
    if(!body?.payload || typeof body.payload!=="object")return privateJson({error:"payload object is required"},400,origin);
    const payloadJson=JSON.stringify(body.payload);
    if(payloadJson.length>CLOUD_MAX_BODY_BYTES)return privateJson({error:"Cloud payload is too large"},413,origin);

    const current=await cloudStateRow(env);
    const currentRevision=Number(current?.revision||0);
    const baseRevision=Math.max(0,Number(body.baseRevision||0)||0);
    const force=body.force===true;
    if(current && !force && baseRevision!==currentRevision){
      return privateJson({error:"Cloud state changed on another device",conflict:true,cloudRevision:currentRevision,updatedAt:current.updated_at},409,origin);
    }

    const now=new Date().toISOString();
    const model=cloudModelFromPayload(body.payload);
    const day=cloudLocalDate(new Date(),String(model?.timezone||"America/Vancouver"));
    const nextRevision=currentRevision+1;
    const deviceId=String(body.deviceId||"").slice(0,160);
    const localUpdatedAt=String(body?.payload?.exportedAt||body.localUpdatedAt||"").slice(0,64);

    if(current){
      let writeResult;
      if(force){
        writeResult=await env.DB.prepare(`UPDATE portfolio_state SET revision=?,payload_json=?,device_id=?,local_updated_at=?,updated_at=? WHERE user_id=?`)
          .bind(nextRevision,payloadJson,deviceId,localUpdatedAt,now,CLOUD_USER_ID).run();
      }else{
        writeResult=await env.DB.prepare(`UPDATE portfolio_state SET revision=?,payload_json=?,device_id=?,local_updated_at=?,updated_at=? WHERE user_id=? AND revision=?`)
          .bind(nextRevision,payloadJson,deviceId,localUpdatedAt,now,CLOUD_USER_ID,currentRevision).run();
      }
      if(Number(writeResult?.meta?.changes||0)!==1){
        const latest=await cloudStateRow(env);
        return privateJson({error:"Cloud state changed on another device",conflict:true,cloudRevision:Number(latest?.revision||0),updatedAt:latest?.updated_at||null},409,origin);
      }
      await env.DB.prepare(`INSERT INTO portfolio_backups (user_id,backup_date,revision,payload_json,created_at) VALUES (?,?,?,?,?)
        ON CONFLICT(user_id,backup_date) DO UPDATE SET revision=excluded.revision,payload_json=excluded.payload_json,created_at=excluded.created_at`)
        .bind(CLOUD_USER_ID,day,currentRevision,current.payload_json,now).run();
    }else{
      await env.DB.prepare(`INSERT INTO portfolio_state (user_id,revision,payload_json,device_id,local_updated_at,updated_at) VALUES (?,?,?,?,?,?)`)
        .bind(CLOUD_USER_ID,nextRevision,payloadJson,deviceId,localUpdatedAt,now).run();
    }

    let structuredSyncWarning="";
    try{await syncStructuredTablesFromPayload(env,body.payload,now)}catch(e){structuredSyncWarning=String(e?.message||e).slice(0,240);console.warn("Structured D1 sync failed",structuredSyncWarning)}
    return privateJson({ok:true,revision:nextRevision,updatedAt:now,structuredSyncWarning:structuredSyncWarning||undefined},200,origin);
  }

  if(url.pathname==="/api/cloud/backups" && request.method==="GET"){
    const result=await env.DB.prepare("SELECT backup_date, revision, created_at FROM portfolio_backups WHERE user_id = ? ORDER BY backup_date DESC LIMIT 30").bind(CLOUD_USER_ID).all();
    return privateJson({backups:result?.results||[]},200,origin);
  }

  if(url.pathname==="/api/cloud/daily" && request.method==="GET"){
    const result=await env.DB.prepare("SELECT snapshot_date,net_worth,net_asset_base,investment_growth,debts,updated_at FROM net_worth_daily WHERE user_id=? ORDER BY snapshot_date DESC LIMIT 90").bind(CLOUD_USER_ID).all();
    return privateJson({snapshots:result?.results||[]},200,origin);
  }

  if(url.pathname==="/api/cloud/daily/refresh" && request.method==="POST"){
    try{return privateJson(await updateDailyNetWorthFromCloud(env),200,origin)}catch(e){return privateJson({error:String(e?.message||e)},500,origin)}
  }

  return privateJson({error:"Unsupported cloud sync operation"},404,origin);
}

export default {
  async fetch(request, env, ctx) {
    const origin=request.headers.get("Origin")||"";
    if(request.method==="OPTIONS")return new Response(null,{status:204,headers:cors(origin)});
    const url=new URL(request.url);
    if(url.pathname.startsWith("/api/cloud/"))return handleCloudRequest(request,env,origin,url);
    if(request.method!=="GET")return json({error:"GET only"},405,origin);

    if(url.pathname==="/health"){
      return json({
        ok:true,
        priceSource:"Yahoo Finance chart proxy",
        dividendSource:"Official issuer history, then Alpha Vantage, then Yahoo fallback",
        officialFundSources:["Harvest Portfolios","Purpose Investments","Hamilton ETFs","Vanguard Canada","Evolve ETFs","CIBC Global Asset Management"],
        cibcMutualFundNav:"CIBC public pages first; YCharts public price page fallback",
        alphaVantageConfigured:Boolean(env.ALPHAVANTAGE_API_KEY),
        cloudDatabaseConfigured:Boolean(env.DB),
        cloudSyncSecretConfigured:Boolean(env.PORTFOLIO_SYNC_TOKEN),
        cloudMode:"v5.20 cloud-first",
        dailyNetWorthSnapshotSupport:true,
        recommendedCron:"15 0 * * *",
        dividendCache:"v5.2 official/exact responses cached; Yahoo fallback is not cached"
      },200,origin,30);
    }

    if(url.pathname==="/cibc-funds"){
      const requested=(url.searchParams.get("symbols")||"ATL486,ATL496,ATL525")
        .split(",").map(x=>x.trim().toUpperCase()).filter(Boolean);
      const symbols=[...new Set(requested)].filter(x=>CIBC_MUTUAL_FUND_CONFIG[x]);
      if(!symbols.length)return json({error:"No supported CIBC fund symbols"},400,origin);

      const settled=await Promise.allSettled(symbols.map(fetchCibcMutualFundPrice));
      const funds=[];const errors=[];
      settled.forEach((r,i)=>{
        if(r.status==="fulfilled")funds.push(r.value);
        else errors.push({ticker:symbols[i],error:String(r.reason?.message||r.reason)});
      });
      if(!funds.length)return json({error:"CIBC mutual-fund NAV unavailable",errors},502,origin,0);
      return json({funds,errors,updatedAt:new Date().toISOString()},200,origin,900);
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
      const cacheKey=new Request(`${url.origin}/__portfolio_cache/v52/dividends?symbol=${encodeURIComponent(symbol)}`,{method:"GET"});
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

    if(url.pathname!=="/quote")return json({error:"Use /quote?symbol=AAPL, /dividends?symbol=AAPL, or /cibc-funds"},404,origin);

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
  },
  async scheduled(event,env,ctx){
    ctx.waitUntil((async()=>{
      try{
        const result=await updateDailyNetWorthFromCloud(env);
        console.log("Daily net worth snapshot",JSON.stringify(result));
      }catch(e){
        console.error("Daily net worth snapshot failed",String(e?.message||e));
      }
    })());
  }
};
