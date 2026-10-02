import { NextRequest, NextResponse } from "next/server";
import { listNikkeiMessages, getMessage, extractMimeBody, header } from "@/lib/gmail";
import { parseNikkeiEmail } from "@/lib/parser";
import { refreshAccessToken } from "@/lib/google";
import { getRefreshToken, setAccessToken } from "@/lib/session";
import { fetchNewsArticles, daypart, issueDate, toLegacyNews } from "@/lib/rss";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function token(req: NextRequest) {
  const current = req.cookies.get("nn_access_token")?.value;
  if (current) return current;
  const refresh = await getRefreshToken();
  if (!refresh) return null;
  const fresh = await refreshAccessToken(refresh);
  if (fresh) await setAccessToken(fresh);
  return fresh;
}

function editionInfo(internalDate: string | undefined, dateHeader: string, content = "") {
  const plain = content.slice(0, 12000)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ").trim();

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

function parseNikkeiNews(html:string,text:string,mailId:string,sourceIndex:number){
  return parseNikkeiEmail(html,text).map((n:any,i:number)=>({
    id:`nikkei:${mailId}:${i}`,
    source:"日経",
    title:n.title||"無題",
    url:n.url||"",
    publishedAt:new Date().toISOString(),
    description:n.body||"",
    content:n.body||"",
    imageUrl:n.imageUrl,
    category:"other",
    primaryCategory:"other",
    tags:["日経"],
    importanceScore:1,
    index:sourceIndex+i,
  })).filter((n:any)=>n.url&&/^https?:\/\//i.test(n.url));
}

async function getNikkeiNews(accessToken:string){
  const ids=await listNikkeiMessages(accessToken);
  const emails:any[]=[];
  const articles:any[]=[];
  for(const m of ids.slice(0,30)){
    const full=await getMessage(accessToken,m.id!);
    const from=header(full,"From");
    const sender=from.toLowerCase();
    const dateHeader=header(full,"Date")??"";
    const {html,text}=await extractMimeBody(accessToken,m.id!,full.payload);
    const contentForEdition=html||text||"";
    const edition=editionInfo(full.internalDate??undefined,dateHeader,contentForEdition);
    const kind=sender.includes("sokuho-news@mx.nikkei.com")?"速報":edition.kind;
    const news=parseNikkeiEmail(html,text);
    emails.push({
      id:m.id,threadId:m.threadId,from,kind,subject:header(full,"Subject"),
      receivedAt:dateHeader,internalDate:full.internalDate||"",issueDate:edition.issueDate,
      snippet:full.snippet||"",newsCount:news.length,news,
    });
    articles.push(...parseNikkeiNews(html,text,m.id!,articles.length));
  }
  return {emails,articles};
}

function dedupeArticles(articles:any[]){
  const normalize=(s:string)=>s.toLowerCase().replace(/\s+/g,"").replace(/[「」『』【】（）()［］\[\]・:：、,.，．!！?？]/g,"");
  const unique:any[]=[];
  for(const a of articles){
    const duplicate=unique.some(b=>{
      if(a.url&&b.url&&a.url===b.url)return true;
      const x=normalize(a.title),y=normalize(b.title);
      return x&&y&&(x===y||x.includes(y)||y.includes(x));
    });
    if(!duplicate)unique.push(a);
  }
  return unique;
}

export async function GET(req:NextRequest){
  try{
    const rssArticles=await fetchNewsArticles();
    let nikkei:any[]=[];
    let nikkeiEmails:any[]=[];
    const accessToken=await token(req);
    if(accessToken){
      const result=await getNikkeiNews(accessToken);
      nikkei=result.articles;
      nikkeiEmails=result.emails;
    }

    const all=dedupeArticles([...rssArticles,...nikkei]).sort((a,b)=>
      (b.importanceScore||0)-(a.importanceScore||0) ||
      new Date(b.publishedAt).getTime()-new Date(a.publishedAt).getTime()
    );

    const groups=new Map<string,any[]>();
    for(const article of all){
      const key=issueDate(article.publishedAt)+"|"+daypart(article.publishedAt);
      const list=groups.get(key)||[];
      list.push(article); groups.set(key,list);
    }

    const rssEmails=[...groups.entries()].map(([key,list])=>{
      const [date,kind]=key.split("|") as [string,"朝刊"|"昼刊"|"夕刊"];
      const sorted=list.slice(0,80);
      const internalDate=sorted[0]?.publishedAt||new Date().toISOString();
      return {
        id:`rss:${key}`,threadId:`rss:${key}`,from:[...new Set(sorted.map(a=>a.source))].join(" / "),
        subject:`ニュース ${date} ${kind}`,receivedAt:internalDate,internalDate:String(new Date(internalDate).getTime()),
        issueDate:date,kind,snippet:sorted.slice(0,3).map(a=>a.title).join(" / "),
        newsCount:sorted.length,news:sorted.map(toLegacyNews),
      };
    });

    const emails=[...nikkeiEmails,...rssEmails].sort((a,b)=>Number(b.internalDate||0)-Number(a.internalDate||0));
    return NextResponse.json({emails,sources:{enabled:["AFPBB","FNN","マイナビニュース","ITmedia","日経メール"]}},{headers:{"Cache-Control":"no-store"}});
  }catch(e){
    console.error("[api/emails]",e);
    return NextResponse.json({error:e instanceof Error?e.message:"news_error"},{status:502,headers:{"Cache-Control":"no-store"}});
  }
}
