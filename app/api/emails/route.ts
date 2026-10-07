export const dynamic = "force-dynamic";
export const revalidate = 0;

import {NextRequest,NextResponse} from "next/server";import {refreshAccessToken} from "@/lib/google";import {getRefreshToken,setAccessToken} from "@/lib/session";import {getNikkeiNews} from "@/lib/news/gmail";import {collectTimelineData,type TimelineArticle} from "@/lib/trend-news";
export const runtime="nodejs";
async function token(){const r=await getRefreshToken();if(!r)return null;try{const t=await refreshAccessToken(r);if(t)await setAccessToken(t);return t}catch(e){return null}}
function article(n:any):TimelineArticle{return{id:String(n.id||crypto.randomUUID()),title:String(n.title||"無題"),summary:String(n.body||""),description:String(n.body||""),url:n.url||undefined,source:n.source||"日経",category:n.category||"other",publishedAt:n.publishedAt||new Date().toISOString(),updatedAt:n.updatedAt,imageUrl:n.imageUrl,importanceScore:Number(n.importanceScore||0)*7,trendScore:Number(n.trendScore||0),keywords:Array.isArray(n.tags)?n.tags:[]}}
export async function GET(req:NextRequest){const started=Date.now(),debugId=req.headers.get("x-news-debug-id")||crypto.randomUUID();try{const access=await token();let emails:any[]=[],arts:any[]=[],sync:any={historyId:"",deletedIds:[],fullSync:true};if(access){try{const r=await getNikkeiNews(access,req.headers.get("x-gmail-history-id"));emails=r.emails||[];arts=r.articles||[];sync={historyId:r.historyId,deletedIds:r.deletedIds,fullSync:r.fullSync};}catch(e){}}const p=await collectTimelineData(arts.map(article));const timeline=p.timeline.map((x:any)=>({...x,relatedArticles:Array.isArray(x.relatedArticles)?x.relatedArticles.slice(0,8).map((a:any)=>({id:a.id,title:a.title,summary:a.summary||a.description||"",url:a.url,source:a.source,category:a.category,publishedAt:a.publishedAt,importanceScore:a.importanceScore||0,trendScore:a.trendScore||0,keywords:a.keywords||[],imageUrl:a.imageUrl})):[]}));
console.log("[TIMELINE_API]",{debugId,gmail:{connected:Boolean(access),emails:emails.length,articles:arts.length},trends:{google:p.google.length,yahoo:p.yahoo.length,newsdata:p.newsdata.length,total:p.signals.length},universe:{articles:p.articles.length,timeline:timeline.length,events:timeline.filter((x:any)=>x.type==="event").length,topics:timeline.filter((x:any)=>x.type==="topic").length},durationMs:Date.now()-started});
return NextResponse.json({timeline,trends:p.signals,emails,gmailConnected:Boolean(access),gmailSync:sync,debug:{debugId,google:p.google.length,yahoo:p.yahoo.length,newsdata:p.newsdata.length,trendSignals:p.signals.length,articles:p.articles.length,timelineItems:timeline.length,events:timeline.filter((x:any)=>x.type==="event").length,topics:timeline.filter((x:any)=>x.type==="topic").length,articleItems:timeline.filter((x:any)=>x.type==="article").length}},{headers:{"Cache-Control":"no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0","Pragma":"no-cache","Expires":"0","Surrogate-Control":"no-store"}})}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"timeline_error"},{status:502})}}
export async function POST(req:NextRequest){
  try{
    const body=await req.json();
    if(body?.type!=="trend_position_diagnostics") return NextResponse.json({ok:false},{status:400});
    const p=body.payload||{};
    console.log("[TREND_POSITION_DIAGNOSTICS]",{
      version:p.version,
      bounds:p.bounds,
      count:p.count,
      xRange:p.xRange,
      yRange:p.yRange,
      duplicateCoordinateGroups:p.duplicateCoordinateGroups,
      clusters:p.clusters,
      stars:p.stars
    });
    return NextResponse.json({ok:true});
  }catch(e){
    return NextResponse.json({ok:false,error:e instanceof Error?e.message:"diagnostic_error"},{status:400});
  }
}
