import { NextRequest, NextResponse } from "next/server";
import { listNikkeiMessages, batchGetMessages, getProfileHistoryId, getHistoryChanges, extractMimeBody, header } from "@/lib/gmail";
import { parseNikkeiEmail } from "@/lib/parser";
import { refreshAccessToken } from "@/lib/google";
import { getRefreshToken, setAccessToken } from "@/lib/session";
import { fetchNewsArticles, fetchGoogleTrendTerms, applyImportanceStars, daypart, issueDate, toLegacyNews, inferCategory, scoreArticle } from "@/lib/rss";

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

function editionInfo(internalDate: string | undefined, dateHeader: string, content = "") {
  const plain = content.slice(0, 12000).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
  const explicit = plain.match(/(?:^|\s)(20\d{2}[年\/-])?(\d{1,2})\s*[\/-月]\s*(\d{1,2})\s*日?\s*(朝刊|朝版|昼刊|昼版|夕刊|夕版)(?=\s|$)/i);
  const d = internalDate ? new Date(Number(internalDate)) : new Date(dateHeader);
  const parts = new Intl.DateTimeFormat("ja-JP",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(d);
  const year = Number(parts.find(p=>p.type==="year")?.value ?? d.getFullYear());
  const month = Number(parts.find(p=>p.type==="month")?.value ?? d.getMonth()+1);
  const day = Number(parts.find(p=>p.type==="day")?.value ?? d.getDate());
  if (explicit) {
    const label=explicit[4];
    return {kind:label.includes("朝")?"朝刊":label.includes("昼")?"昼刊":"夕刊",issueDate:`${explicit[1]?Number(explicit[1].replace(/[^0-9]/g,"")):year}-${String(Number(explicit[2])).padStart(2,"0")}-${String(Number(explicit[3])).padStart(2,"0")}`};
  }
  const hour=Number(new Intl.DateTimeFormat("ja-JP",{timeZone:"Asia/Tokyo",hour:"numeric",hour12:false}).format(d));
  return {kind:hour>=5&&hour<11?"朝刊":hour>=11&&hour<17?"昼刊":"夕刊",issueDate:`${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`};
}

function parseNikkeiNews(parsed:any[],mailId:string,sourceIndex:number,publishedAt:string){
  return parsed.map((n:any,i:number)=>({
    id:`nikkei:${mailId}:${i}`, source:"日経", title:n.title||"無題", url:n.url||"", publishedAt,
    description:n.body||"", content:n.body||"", imageUrl:n.imageUrl,
    category:inferCategory(n.title||"",n.body||""), primaryCategory:inferCategory(n.title||"",n.body||""),
    tags:["日経"], importanceScore:scoreArticle(n.title||"",n.body||"",inferCategory(n.title||"",n.body||"")), index:sourceIndex+i,
  })).filter((n:any)=>n.url&&/^https?:\/\//i.test(n.url));
}

async function processGmailMessage(full:any){
  const messageStarted=Date.now();
  const id=full.id!;
  const from=header(full,"From"); const sender=from.toLowerCase();
  const dateHeader=header(full,"Date")??"";
  const mimeStarted=Date.now();
  const {html,text}=await extractMimeBody(id,full.payload);
  const mimeExtractMs=Date.now()-mimeStarted;
  const contentForEdition=html||text||"";
  const edition=editionInfo(full.internalDate??undefined,dateHeader,contentForEdition);
  const publishedAt=full.internalDate ? new Date(Number(full.internalDate)).toISOString() : new Date(dateHeader).toISOString();
  const kind=sender.includes("sokuho-news@mx.nikkei.com")?"速報":edition.kind;
  const parseStarted=Date.now();
  const parsedEmail=parseNikkeiEmail(html,text);
  const htmlParseAndExtractionMs=Date.now()-parseStarted;
  const parsedArticles=parseNikkeiNews(parsedEmail,id,0,publishedAt);
  console.log("[GMAIL] MESSAGE",{
    id,from,kind,subject:header(full,"Subject"),emailParserArticles:parsedEmail.length,validArticles:parsedArticles.length,
    hasHtml:Boolean(html),hasText:Boolean(text),mimeExtractMs,htmlParseAndExtractionMs,durationMs:Date.now()-messageStarted
  });
  return {
    email:{id,threadId:full.threadId,from,kind,subject:header(full,"Subject"),receivedAt:dateHeader,internalDate:full.internalDate||"",issueDate:edition.issueDate,snippet:full.snippet||"",newsCount:parsedArticles.length,news:parsedArticles},
    articles:parsedArticles
  };
}

async function getNikkeiNews(accessToken:string, historyId:string|null){
  console.log("[GMAIL] CONNECTED access token available");
  const started=Date.now();
  let fullSync=!historyId;
  let addedIds:string[]=[];
  let deletedIds:string[]=[];
  let nextHistoryId=historyId||"";

  if(historyId){
    try {
      const changes=await getHistoryChanges(accessToken,historyId);
      addedIds=changes.addedIds;
      deletedIds=changes.deletedIds;
      nextHistoryId=changes.historyId||historyId;
    } catch(e:any) {
      console.warn("[GMAIL] HISTORY_FALLBACK", {message:e?.message||String(e)});
      fullSync=true;
    }
  }

  let messages:any[]=[];
  if(fullSync){
    const ids=await listNikkeiMessages(accessToken);
    messages=await batchGetMessages(accessToken,ids.map((m:any)=>m.id).filter(Boolean));
    nextHistoryId=await getProfileHistoryId(accessToken);
  } else if(addedIds.length){
    messages=await batchGetMessages(accessToken,addedIds);
  }

  const emails:any[]=[]; const articles:any[]=[];
  for(const full of messages){
    const from=header(full,"From").toLowerCase();
    if(!from.includes("nikkei-news@mx.nikkei.com")&&!from.includes("sokuho-news@mx.nikkei.com")) continue;
    const result=await processGmailMessage(full);
    emails.push(result.email); articles.push(...result.articles);
  }

  console.log("[GMAIL] SYNC_SUMMARY",{
    fullSync,historyId:nextHistoryId,added:addedIds.length,deleted:deletedIds.length,
    fetchedMessages:messages.length,parsedEmails:emails.length,parsedArticles:articles.length,durationMs:Date.now()-started
  });
  return {emails,articles,historyId:nextHistoryId,deletedIds,fullSync};
}

function dedupeArticles(articles:any[]){const normalize=(s:string)=>s.toLowerCase().replace(/\s+/g,"").replace(/[「」『』【】（）()［］\[\]・:：、,.，．!！?？]/g,"");const unique:any[]=[];for(const a of articles){const duplicate=unique.some(b=>{if(a.url&&b.url&&a.url===b.url)return true;const x=normalize(a.title),y=normalize(b.title);return x&&y&&(x===y||x.includes(y)||y.includes(x));});if(!duplicate)unique.push(a);}return unique;}

export async function GET(req:NextRequest){
  const requestStarted=Date.now(); const debugId=req.headers.get("x-news-debug-id")||crypto.randomUUID();
  const mark=(stage:string,extra:Record<string,unknown>={})=>console.log("[NEWS_LOAD]",stage,{debugId,elapsedMs:Date.now()-requestStarted,...extra});
  mark("API_START");
  try{
    const rssStarted=Date.now(),trendStarted=Date.now(),tokenStarted=Date.now();
    const [trendTerms,rssArticles,accessToken]=await Promise.all([fetchGoogleTrendTerms(),fetchNewsArticles(),token(req)]);
    mark("TRENDS_DONE",{durationMs:Date.now()-trendStarted,terms:trendTerms.length});
    mark("RSS_DONE",{durationMs:Date.now()-rssStarted,articles:rssArticles.length});
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

    const groups=new Map<string,any[]>();
    for(const article of rssArticles){const key=issueDate(article.publishedAt)+"|"+daypart(article.publishedAt);const list=groups.get(key)||[];list.push(article);groups.set(key,list);}
    const groupedRssArticles=[...groups.values()].reduce((n,list)=>n+list.length,0);
    console.log("[NEWS] GROUP_SUMMARY",{rssInputArticles:rssArticles.length,groupedRssArticles,groupedDroppedBeforeIssueCap:Math.max(0,rssArticles.length-groupedRssArticles),issueCount:groups.size,issueCapDropped:0,nikkeiInputArticles:nikkei.length,nikkeiDisplayCount:nikkeiEmails.reduce((n:number,email:any)=>n+email.news.length,0)});
    const rssEmails=[...groups.entries()].map(([key,list])=>{const [date,kind]=key.split("|") as [string,"朝刊"|"昼刊"|"夕刊"];const sorted=list.slice();const internalDate=sorted[0]?.publishedAt||new Date().toISOString();return{id:`rss:${key}`,threadId:`rss:${key}`,from:[...new Set(sorted.map(a=>a.source))].join(" / "),subject:`ニュース ${date} ${kind}`,receivedAt:internalDate,internalDate:String(new Date(internalDate).getTime()),issueDate:date,kind,snippet:sorted.slice(0,3).map(a=>a.title).join(" / "),newsCount:sorted.length,news:sorted.map(toLegacyNews)};});

    const starsStarted=Date.now();
    const allForStars=[...nikkei.flatMap((article:any)=>[article]),...rssEmails.flatMap((email:any)=>email.news.map((news:any)=>news))];
    const starred=applyImportanceStars(allForStars.map((article:any)=>({id:article.id,source:article.source,title:article.title,url:article.url||"",publishedAt:article.publishedAt||new Date().toISOString(),description:article.description||article.body||"",content:article.content||article.body||"",category:article.category,primaryCategory:article.primaryCategory||article.category,tags:article.tags,importanceScore:article.importanceScore||0})),trendTerms);
    mark("STARS_DONE",{durationMs:Date.now()-starsStarted,articles:allForStars.length});
    const starMap=new Map(starred.map((article:any)=>[article.id,article]));
    for(const email of nikkeiEmails)for(const news of email.news){const scored=starMap.get(news.id);if(scored){news.trendScore=scored.trendScore||0;news.importanceStars=scored.importanceStars;}}
    for(const email of rssEmails)for(const news of email.news as any[]){const scored=starMap.get(news.id);if(scored){news.trendScore=scored.trendScore||0;news.importanceStars=scored.importanceStars;}}
    const emails=[...nikkeiEmails,...rssEmails].sort((a,b)=>Number(b.internalDate||0)-Number(a.internalDate||0));
    const displayCounts=Object.fromEntries(["AFPBB","FNN","マイナビニュース","ITmedia","日経"].map(source=>[source,emails.reduce((n:number,email:any)=>n+email.news.filter((news:any)=>news.source===source).length,0)]));
    const rssDisplayCounts=Object.fromEntries(["AFPBB","FNN","マイナビニュース","ITmedia"].map(source=>[source,rssEmails.reduce((n:number,email:any)=>n+email.news.filter((news:any)=>news.source===source).length,0)]));
    const nikkeiDisplayCount=nikkeiEmails.reduce((n:number,email:any)=>n+email.news.filter((news:any)=>news.source==="日経").length,0);
    console.log("[NEWS] DISPLAY_SUMMARY",{rssArticles:rssArticles.length,nikkeiArticles:nikkei.length,nikkeiEmails:nikkeiEmails.length,rssIssues:rssEmails.length,totalIssues:emails.length,totalDisplayedArticles:emails.reduce((n:number,email:any)=>n+email.news.length,0),rssDisplayCounts,rssIssueCapDropped:0,groupedRssArticles,nikkeiDisplayCount,displayCounts});
    mark("API_RESPONSE_READY",{totalMs:Date.now()-requestStarted,issues:emails.length,articles:emails.reduce((n:number,email:any)=>n+email.news.length,0)});
    return NextResponse.json({emails,gmailConnected:Boolean(accessToken),gmailSync,sources:{enabled:["AFPBB","FNN","マイナビニュース","ITmedia","日経メール"]}},{headers:{"Cache-Control":"no-store","x-news-debug-id":debugId}});
  }catch(e){mark("API_ERROR",{error:e instanceof Error?e.message:String(e)});console.error("[api/emails]",e);return NextResponse.json({error:e instanceof Error?e.message:"news_error"},{status:502,headers:{"Cache-Control":"no-store"}});}
}
