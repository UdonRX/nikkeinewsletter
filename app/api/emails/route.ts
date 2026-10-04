import { NextRequest, NextResponse } from "next/server";
import { refreshAccessToken } from "@/lib/google";
import { getRefreshToken, setAccessToken } from "@/lib/session";
import { daypart, issueDate } from "@/lib/rss";
import { collectTrendNews } from "@/lib/trend-news";
import { getNikkeiNews } from "@/lib/news/gmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function token(req: NextRequest) {
  const current = req.cookies.get("nn_access_token")?.value;
  if (current) return current;
  const refresh = await getRefreshToken();
  if (!refresh) return null;
  try {
    const fresh = await refreshAccessToken(refresh);
    if (fresh) await setAccessToken(fresh);
    return fresh;
  } catch (e) {
    console.warn("[api/emails] Gmail token refresh failed; continuing with RSS:", e);
    try {
      const jar = await import("next/headers").then(({ cookies }) => cookies());
      jar.delete("nn_refresh_token"); jar.delete("nn_access_token");
    } catch {}
    return null;
  }
}

export async function GET(req:NextRequest){
  const requestStarted=Date.now(); const debugId=req.headers.get("x-news-debug-id")||crypto.randomUUID();
  const mark=(stage:string,extra:Record<string,unknown>={})=>console.log("[NEWS_LOAD]",stage,{debugId,elapsedMs:Date.now()-requestStarted,...extra});
  mark("API_START");
  try{
    const trendStarted=Date.now(),tokenStarted=Date.now();
    const [trendData,accessToken]=await Promise.all([collectTrendNews(),token(req)]);
    mark("TREND_PIPELINE_DONE",{durationMs:Date.now()-trendStarted,google:trendData.google.length,yahoo:trendData.yahoo.length,keywords:trendData.trends.length,articles:trendData.articles.length,topics:trendData.topics.length});
    console.log("[NEWS_LOAD] TREND_DATA_SAMPLE",{debugId,googleTop:trendData.google.slice(0,5).map(x=>x.term),yahooTop:trendData.yahoo.slice(0,5).map(x=>x.term),keywordTop:trendData.trends.slice(0,10).map(x=>x.term),articleSample:trendData.articles.slice(0,5).map(x=>({source:x.source,title:x.title,publishedAt:x.publishedAt,trendTerms:x.trendTerms})),topicSample:trendData.topics.slice(0,5).map(x=>({title:x.title,articles:x.articles.length,stars:x.importanceStars}))});
    mark("TOKEN_DONE",{durationMs:Date.now()-tokenStarted,connected:Boolean(accessToken)});
    let nikkei:any[]=[]; let nikkeiEmails:any[]=[]; let gmailSync:any={historyId:"",deletedIds:[],fullSync:true};
    console.log("[GMAIL] STATUS",accessToken?"connected":"not_connected");
    if(accessToken){
      try{
        const gmailStarted=Date.now();
        let historyId=req.headers.get("x-gmail-history-id");
        try{const raw=req.headers.get("x-gmail-cached-ids"); if(raw)JSON.parse(raw);}catch{}
        const result=await getNikkeiNews(accessToken,historyId);
        nikkei=result.articles; nikkeiEmails=result.emails;
        gmailSync={historyId:result.historyId,deletedIds:result.deletedIds,fullSync:result.fullSync};
        mark("GMAIL_DONE",{durationMs:Date.now()-gmailStarted,emails:nikkeiEmails.length,articles:nikkei.length,fullSync:result.fullSync,addedEmails:result.emails.length,deletedIds:result.deletedIds.length});
      }catch(e){
        console.warn("[api/emails] Nikkei Gmail retrieval failed; continuing with RSS:",e);
        try{const jar=await import("next/headers").then(({cookies})=>cookies());jar.delete("nn_access_token");jar.delete("nn_refresh_token");}catch{}
      }
    }

    const topicEmails=trendData.topics.map((topic:any)=>({id:topic.id,threadId:topic.id,from:topic.articles.map((a:any)=>a.source).filter(Boolean).filter((v:any,i:number,arr:any[])=>arr.indexOf(v)===i).join(" / "),subject:topic.title,receivedAt:topic.publishedAt,internalDate:String(new Date(topic.publishedAt).getTime()),issueDate:issueDate(topic.publishedAt),kind:daypart(topic.publishedAt),snippet:topic.summary||"",newsCount:topic.articles.length,news:topic.articles.map((a:any)=>({...a,body:a.description,importanceStars:topic.importanceStars,trendBadges:topic.trendBadges,topicId:topic.id}))}));
    const emails=[...nikkeiEmails,...topicEmails].sort((a,b)=>Number(b.internalDate||0)-Number(a.internalDate||0));
    const displayCounts={topics:trendData.topics.length,articles:trendData.articles.length,nikkeiArticles:nikkei.length};
    console.log("[NEWS] DISPLAY_SUMMARY",{topics:trendData.topics.length,articles:trendData.articles.length,nikkeiArticles:nikkei.length,topicEmails:topicEmails.length,totalEmails:emails.length,displayCounts,sourceBreakdown:{google:trendData.google.length,yahoo:trendData.yahoo.length,newsDataArticles:trendData.articles.length,trendTopics:trendData.topics.length,nikkeiArticles:nikkei.length}});
    mark("API_RESPONSE_READY",{totalMs:Date.now()-requestStarted,issues:emails.length,articles:emails.reduce((n:number,email:any)=>n+email.news.length,0)});
    return NextResponse.json({emails,topics:trendData.topics,trends:trendData.trends,heatByHour:trendData.heatByHour,gmailConnected:Boolean(accessToken),gmailSync,sources:{enabled:["Google Trends","Yahoo!リアルタイム検索","NewsData.io","日経メール"]}},{headers:{"Cache-Control":"no-store","x-news-debug-id":debugId}});
  }catch(e){mark("API_ERROR",{error:e instanceof Error?e.message:String(e)});console.error("[api/emails]",e);return NextResponse.json({error:e instanceof Error?e.message:"news_error"},{status:502,headers:{"Cache-Control":"no-store"}});}
}