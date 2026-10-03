import { unstable_cache } from "next/cache";

export type GdeltSignal={
  hit:0|1; count1h:number; count3h:number; count6h:number; count24h:number;
  growth1hTo3h:number; growth3hTo6h:number; responseMs:number;
  japaneseTitle:boolean; japaneseTitleHit:0|1; fetchedAt:number;
};

const MAX_CONCURRENCY=1;
const MAX_NEW_PER_REQUEST=3;
const REQUEST_INTERVAL_MS=2500;
const REQUEST_TIMEOUT_MS=12000;
const cache=new Map<string,GdeltSignal>();
let gdeltNetworkRequests=0;

function isJapanese(value:string){return /[\u3040-\u30ff\u3400-\u9fff]/.test(value);}
function normalizeKey(value:string){return value.trim().replace(/\s+/g," ");}
function sleep(ms:number){return new Promise(resolve=>setTimeout(resolve,ms));}

function parseTimeline(payload:any){
  const rows:Array<{date:string,value:number}>= [];
  for(const series of Array.isArray(payload?.timeline)?payload.timeline:[])
    for(const point of Array.isArray(series?.data)?series.data:[]){
      const value=Number(point?.value);
      if(Number.isFinite(value)&&point?.date)rows.push({date:String(point.date),value});
    }
  return rows;
}

function sumWindow(rows:Array<{date:string,value:number}>,hours:number){
  const cutoff=Date.now()-hours*60*60*1000;
  return Math.round(rows.reduce((sum,row)=>{
    const t=Date.parse(row.date);
    return Number.isFinite(t)&&t>=cutoff?sum+row.value:sum;
  },0));
}

async function queryGdelt(title:string,japaneseTitle:boolean):Promise<GdeltSignal>{
  const started=Date.now();
  gdeltNetworkRequests++;
  const url="https://api.gdeltproject.org/api/v2/doc/doc?query="+encodeURIComponent('"'+title+'"')+"&mode=timelinevolraw&format=json&timespan=24h";

  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT_MS);
  try{
      const response=await fetch(url,{
        signal:controller.signal,
        headers:{"User-Agent":"nikkeinewsletter/1.0","Accept":"application/json"},
      });
      if(response.status===429){
        console.warn("[GDELT] RATE_LIMIT_429",{title,japaneseTitle,responseMs:Date.now()-started,status:429});
        throw new Error("GDELT_429");
      }
      if(!response.ok)throw new Error("GDELT_HTTP_"+response.status);
      const rows=parseTimeline(await response.json());
      const count1h=sumWindow(rows,1),count3h=sumWindow(rows,3),count6h=sumWindow(rows,6),count24h=sumWindow(rows,24);
      const hit=count24h>0?1:0;
      console.log("[GDELT] SEARCH_RESULT",{title,japaneseTitle,status:hit?"NORMAL_HIT":"NORMAL_ZERO",count24h,responseMs:Date.now()-started});
      return {
        hit,
        count1h,count3h,count6h,count24h,
        growth1hTo3h:count3h-count1h,
        growth3hTo6h:count6h-count3h,
        responseMs:Date.now()-started,
        japaneseTitle,
        japaneseTitleHit:japaneseTitle&&count24h>0?1:0,
        fetchedAt:Date.now()
      };
  }catch(error){
      const message=error instanceof Error?error.message:String(error);
      const name=error instanceof Error?error.name:"";
      const status=message==="GDELT_429"?"RATE_LIMIT_429":name==="AbortError"?"TIMEOUT":message==="fetch failed"?"FETCH_FAILED":message.startsWith("GDELT_HTTP_")?"HTTP_OTHER":"REQUEST_ERROR";
      console.warn("[GDELT] REQUEST_FAIL",{title,japaneseTitle,status,error:message,responseMs:Date.now()-started});
      throw error;
  }finally{
    clearTimeout(timer);
  }
}

const getPersistentGdeltSignal=unstable_cache(
  async(title:string,japaneseTitle:boolean)=>queryGdelt(title,japaneseTitle),
  ["gdelt-signal-v2"],
  {revalidate:false}
);

export async function fetchGdeltSignals(articles:Array<{id:string;title:string}>){
  const started=Date.now();
  gdeltNetworkRequests=0;
  const result=new Map<string,GdeltSignal>();
  const pending=articles.filter(article=>!cache.has(normalizeKey(article.title))).slice(0,MAX_NEW_PER_REQUEST);
  let cursor=0;

  const worker=async()=>{
    while(true){
      const index=cursor++;
      if(index>=pending.length)return;
      const article=pending[index];
      const key=normalizeKey(article.title);
      if(index>0)await sleep(REQUEST_INTERVAL_MS);
      try{
        const localCached=cache.get(key);
        const signal=localCached||await getPersistentGdeltSignal(article.title.trim(),isJapanese(article.title));
        cache.set(key,signal);
        result.set(article.id,signal);

        if(!localCached){
          console.log("[GDELT] ARTICLE",{
            id:article.id,title:article.title,
            hit:signal.hit,count1h:signal.count1h,count3h:signal.count3h,
            count6h:signal.count6h,count24h:signal.count24h,
            growth1hTo3h:signal.growth1hTo3h,growth3hTo6h:signal.growth3hTo6h,
            responseMs:signal.responseMs,japaneseTitle:signal.japaneseTitle,
            japaneseTitleHit:signal.japaneseTitleHit
          });
        }
      }catch(error){
        console.warn("[GDELT] ARTICLE_FAIL",{
          id:article.id,title:article.title,
          error:error instanceof Error?error.message:String(error)
        });
      }
    }
  };

  await Promise.all(Array.from({length:Math.min(MAX_CONCURRENCY,pending.length)},()=>worker()));

  const localMemoryHits=articles.length-pending.length;
  const japaneseTitles=articles.filter(a=>isJapanese(a.title)).length;
  const japaneseHits=[...result.values()].filter(s=>s.japaneseTitleHit).length;
  const hits=[...result.values()].filter(s=>s.hit).length;
  const responseValues=[...result.values()].map(s=>s.responseMs).filter(Number.isFinite);

  console.log("[GDELT] SUMMARY",{
    totalArticles:articles.length,
    newArticleLimit:MAX_NEW_PER_REQUEST,
    requestIntervalMs:REQUEST_INTERVAL_MS,
    maxConcurrency:MAX_CONCURRENCY,
    localMemoryHits,
    persistentCacheEnabled:true,
    persistentCacheLifetime:"indefinite",
    gdeltNetworkRequests,
    attemptedNewArticles:pending.length,
    failedOrUnavailable:Math.max(0,pending.length-result.size),
    gdeltHits:hits,
    gdeltHitRate:result.size?Number((hits/result.size).toFixed(4)):0,
    japaneseTitleCount:japaneseTitles,
    japaneseTitleHits:japaneseHits,
    japaneseTitleHitRate:japaneseTitles?Number((japaneseHits/japaneseTitles).toFixed(4)):0,
    avgResponseMs:responseValues.length?Math.round(responseValues.reduce((a,b)=>a+b,0)/responseValues.length):0,
    durationMs:Date.now()-started
  });

  return result;
}
