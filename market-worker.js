// Cloudflare Worker for the personal Portfolio Tracker.
// Proxies Yahoo Finance's undocumented chart endpoint and normalizes the result.
// No API key is stored in the front-end.

const ALLOWED_RANGES = new Set(["1d","5d","1mo","3mo","6mo","1y","2y","5y","10y","ytd","max"]);
const ALLOWED_INTERVALS = new Set(["1m","2m","5m","15m","30m","60m","90m","1d","5d","1wk","1mo","3mo"]);

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}
function json(body,status=200,origin=""){
  return new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json;charset=UTF-8","Cache-Control":"public,max-age=30",...cors(origin)}});
}
function dateKey(sec){return new Date(sec*1000).toISOString().slice(0,10)}

export default {
  async fetch(request, env, ctx) {
    const origin=request.headers.get("Origin")||"";
    if(request.method==="OPTIONS")return new Response(null,{status:204,headers:cors(origin)});
    if(request.method!=="GET")return json({error:"GET only"},405,origin);
    const url=new URL(request.url);
    if(url.pathname==="/health")return json({ok:true,source:"Yahoo Finance chart proxy"},200,origin);
    
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
        headers:{
          "User-Agent":"Mozilla/5.0",
          "Accept":"application/json,text/plain,*/*"
        }
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

    if(url.pathname!=="/quote")return json({error:"Use /quote?symbol=AAPL"},404,origin);

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
        headers:{"User-Agent":"Mozilla/5.0 (compatible; PortfolioTracker/1.1)","Accept":"application/json"},
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
        // Yahoo metadata can report a stale pre-split previousClose for some ETFs.
        // Derive the prior trading close from the actual chart series instead.
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
