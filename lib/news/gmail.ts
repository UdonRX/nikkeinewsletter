import { listNikkeiMessages, batchGetMessages, getProfileHistoryId, getHistoryChanges, extractMimeBody, header } from "@/lib/gmail";
import { parseNikkeiEmail } from "@/lib/parser";
import { inferCategory, scoreArticle, daypart, issueDate } from "@/lib/rss";

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

async function fetchArticlePublishedAt(rawUrl:string):Promise<string|undefined>{
  try{
    const response=await fetch(rawUrl,{redirect:"follow",headers:{"User-Agent":"NikkeiNewsReader/1.0","Accept":"text/html,application/xhtml+xml","Accept-Language":"ja-JP,ja;q=0.9,en;q=0.8"},cache:"no-store"});
    if(!response.ok)return undefined;
    const finalUrl=new URL(response.url||rawUrl);
    if(!/^(?:www\\.)?nikkei\\.com$/i.test(finalUrl.hostname))return undefined;
    const html=await response.text();
    const {JSDOM}=await import("jsdom");
    const doc=new JSDOM(html).window.document;
    const candidates=[
      doc.querySelector('meta[property="article:published_time"]')?.getAttribute("content"),
      doc.querySelector('meta[name="article:published_time"]')?.getAttribute("content"),
      doc.querySelector('meta[property="og:published_time"]')?.getAttribute("content"),
      doc.querySelector('time[datetime]')?.getAttribute("datetime"),
      doc.querySelector('meta[itemprop="datePublished"]')?.getAttribute("content"),
      doc.querySelector('[itemprop="datePublished"]')?.getAttribute("datetime"),
      doc.querySelector('[itemprop="datePublished"]')?.textContent,
    ].filter(Boolean) as string[];
    for(const value of candidates){
      const d=new Date(value);
      if(!Number.isNaN(d.getTime()))return d.toISOString();
      const m=value.match(/(20\\d{2})[年\\/.-](\\d{1,2})[月\\/.-](\\d{1,2})日?[^\\d]{0,20}(\\d{1,2}):(\\d{2})/);
      if(m){
        const d2=new Date(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]),Number(m[4])-9,Number(m[5])));
        if(!Number.isNaN(d2.getTime()))return d2.toISOString();
      }
    }
    const ldScripts=Array.from(doc.querySelectorAll('script[type="application/ld+json"]'));
    for(const script of ldScripts){
      try{
        const raw=JSON.parse(script.textContent||"");
        const list=Array.isArray(raw)?raw:(raw?.["@graph"]||[raw]);
        for(const item of list){
          if(!item||typeof item!=="object")continue;
          const type=Array.isArray(item["@type"])?item["@type"].join(" "):String(item["@type"]||"");
          if(!/NewsArticle|Article/i.test(type))continue;
          for(const key of ["datePublished","dateCreated"]){
            const value=typeof item[key]==="string"?item[key]:"";
            const d=new Date(value);
            if(value&&!Number.isNaN(d.getTime()))return d.toISOString();
          }
        }
      }catch{}
    }
  }catch{}
  return undefined;
}

function parseNikkeiNews(parsed:any[],mailId:string,sourceIndex:number,publishedAt:string){
  return parsed.map((n:any,i:number)=>({
    id:`nikkei:${mailId}:${i}`, source:"日経", title:n.title||"無題", url:n.url||"", publishedAt:n.publishedAt||publishedAt,
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
  const parsedEmail=parseNikkeiEmail(html,text,full.internalDate ? new Date(Number(full.internalDate)).toISOString() : dateHeader);
  const htmlParseAndExtractionMs=Date.now()-parseStarted;
  const resolved=await Promise.all(parsedEmail.map(async(n:any)=>({n,publishedAt:n.url?await fetchArticlePublishedAt(n.url):undefined})));
  for(const item of resolved){if(item.publishedAt)item.n.publishedAt=item.publishedAt;}
  const parsedArticles=parseNikkeiNews(parsedEmail,id,0,publishedAt);
  console.log("[GMAIL] MESSAGE",{
    id,from,kind,subject:header(full,"Subject"),emailParserArticles:parsedEmail.length,validArticles:parsedArticles.length,
    hasHtml:Boolean(html),hasText:Boolean(text),mimeExtractMs,htmlParseAndExtractionMs,durationMs:Date.now()-messageStarted
  });
  return {
    email:{id:"nikkei:"+id,threadId:full.threadId,from,kind,subject:header(full,"Subject"),receivedAt:dateHeader,internalDate:full.internalDate||"",issueDate:edition.issueDate,snippet:full.snippet||"",newsCount:parsedArticles.length,news:parsedArticles},
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

export { editionInfo, parseNikkeiNews, processGmailMessage, getNikkeiNews };
