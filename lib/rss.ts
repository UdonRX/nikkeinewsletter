import { JSDOM } from "jsdom";

export type NewsCategory = "politics"|"economy"|"business"|"international"|"market"|"technology"|"science"|"society"|"life"|"other";
export type NewsArticle = {
  id:string; source:"AFPBB"|"FNN"|"マイナビニュース"|"ITmedia"|"日経"; title:string; url:string;
  publishedAt:string; updatedAt?:string; description?:string; content?:string; imageUrl?:string;
  category?:NewsCategory; primaryCategory?:NewsCategory; tags?:string[]; importanceScore?:number;
};
type FeedConfig={source:NewsArticle["source"];url:string;categoryHint?:NewsCategory;tags?:string[]};

export const RSS_FEEDS:FeedConfig[]=[
 {source:"FNN",url:"https://www.fnn.jp/list/feed/rss",categoryHint:"society",tags:["FNNプライムオンライン"]},
 {source:"AFPBB",url:"https://feeds.afpbb.com/rss/afpbb/afpbbnews",tags:["国際","外交","海外政治","世界経済","社会","科学","ライフ"]},
 {source:"マイナビニュース",url:"https://news.mynavi.jp/rss/index"},
 {source:"マイナビニュース",url:"https://news.mynavi.jp/rss/techplus/enterprise",categoryHint:"business",tags:["企業IT","企業","IT"]},
 {source:"マイナビニュース",url:"https://news.mynavi.jp/rss/techplus/technology",categoryHint:"technology",tags:["テクノロジー"]},
 {source:"マイナビニュース",url:"https://news.mynavi.jp/rss/techplus/technology/science",categoryHint:"science",tags:["サイエンス"]},
 {source:"マイナビニュース",url:"https://news.mynavi.jp/rss/techplus/technology/aerospace",categoryHint:"science",tags:["宇宙・航空"]},
 {source:"ITmedia",url:"https://rss.itmedia.co.jp/rss/2.0/itmedia_all.xml",tags:["ITmedia"]},
 {source:"ITmedia",url:"https://rss.itmedia.co.jp/rss/2.0/topstory.xml",tags:["ITmedia TOP STORIES"]},
 {source:"ITmedia",url:"https://rss.itmedia.co.jp/rss/2.0/news_bursts.xml",categoryHint:"technology",tags:["ITmedia NEWS"]},
 {source:"ITmedia",url:"https://rss.itmedia.co.jp/rss/2.0/aiplus.xml",categoryHint:"technology",tags:["AI"]},
 {source:"ITmedia",url:"https://rss.itmedia.co.jp/rss/2.0/business.xml",categoryHint:"business",tags:["ビジネス"]},
 {source:"ITmedia",url:"https://rss.itmedia.co.jp/rss/2.0/enterprise.xml",categoryHint:"business",tags:["エンタープライズ","セキュリティ","クラウド"]},
 {source:"ITmedia",url:"https://rss.itmedia.co.jp/rss/2.0/marketing.xml",categoryHint:"business",tags:["マーケティング"]},
];

// TBS NEWS DIGの現行公式サイトでは公式RSS URLを確認できないため、推測URLは登録しない。
export const TBS_RSS_STATUS={source:"TBS NEWS DIG",enabled:false,reason:"公式RSS未確認"};

const CATEGORY_RULES:Array<[NewsCategory,string[]]>=[
 ["politics",["首相","総理","政府","内閣","国会","政策","法案","選挙","与党","野党","大統領","議会","外交","閣議"]],
 ["economy",["日銀","金融政策","政策金利","物価","GDP","景気","インフレ","デフレ","経済指標","賃金","雇用","利上げ","利下げ"]],
 ["market",["株価","株式","日経平均","TOPIX","為替","ドル円","ユーロ","原油","金価格","債券","金利","市場"]],
 ["business",["決算","企業","業績","M&A","買収","合併","経営","事業","新サービス","業界","売上","利益","倒産"]],
 ["international",["米国","アメリカ","中国","欧州","EU","中東","ウクライナ","ロシア","イスラエル","イラン","米中","海外"]],
 ["technology",["AI","人工知能","半導体","クラウド","セキュリティ","DX","IT","ソフトウェア","データ","生成AI","サイバー"]],
 ["science",["宇宙","科学","研究","NASA","衛星","ロケット","量子","iPS","気候変動"]],
 ["society",["社会","事件","事故","災害","地震","台風","火災","警察","厚生","少子化"]],
 ["life",["暮らし","生活","ライフ","健康","文化","食","旅行","働き方","キャリア"]]
];
const IMPORTANCE_RULES:Array<[number,string[]]>=[
 [5,["首相","総理","政府","国会","重要政策","日銀","金融政策","政策金利","国際紛争","米中関係","戦争","停戦"]],
 [4,["為替","株式市場","日経平均","決算","大型M&A","買収","半導体","AI","重大事故","大規模災害","海外政治"]],
 [3,["企業","業績","経済","クラウド","セキュリティ","宇宙","科学","DX"]],
 [1,["ライフ","暮らし","文化","話題"]],
 [-2,["芸能","エンタメ","ゲーム","スポーツ"]]
];

function decodeHtml(v:string){const doc=new JSDOM("<body></body>").window.document;const e=doc.createElement("textarea");e.innerHTML=v||"";return e.value;}
function cleanText(v:string){return decodeHtml(v).replace(/<!\[CDATA\[|\]\]>/g,"").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();}
function field(block:string,names:string[]){for(const name of names){const escapedName=name.replace(":","\\:");const re=new RegExp("<"+escapedName+"(?:\\s[^>]*)?>([\\s\\S]*?)</"+escapedName+">","i");const m=block.match(re);if(m?.[1])return m[1].trim();}return "";}
function attr(block:string,tag:string,name:string){const re=new RegExp("<"+tag+"\\b[^>]*\\b"+name+"=[\"']([^\"']+)[\"'][^>]*>","i");return block.match(re)?.[1]||"";}
function parseDate(v:string){const d=new Date(cleanText(v));return Number.isNaN(d.getTime())?new Date().toISOString():d.toISOString();}
export function inferCategory(title:string,description:string,hint?:NewsCategory){const text=title+" "+description;let best:NewsCategory=hint||"other";let score=hint?1:0;for(const [cat,words] of CATEGORY_RULES){const hits=words.reduce((n,w)=>n+(text.includes(w)?1:0),0);if(hits>score){best=cat;score=hits;}}return best;}
export function scoreArticle(title:string,description:string,category:NewsCategory){const text=title+" "+description;let score=category==="other"?0:1;for(const [points,words] of IMPORTANCE_RULES)for(const w of words)if(text.includes(w))score+=points;return Math.max(-2,Math.min(15,score));}
function normalizeTitle(t:string){return t.toLowerCase().replace(/【[^】]*】|\[[^\]]*\]|「[^」]*」/g,"").replace(/\s+/g,"").replace(/[「」『』【】（）()［］\[\]・:：、,.，．!！?？"'”’]/g,"");}
function tokens(t:string){return new Set(t.toLowerCase().split(/[^0-9a-zA-Z一-龥ぁ-んァ-ヶー]+/).map(v=>v.trim()).filter(v=>v.length>=2));}
function isDuplicate(a:NewsArticle,b:NewsArticle){if(a.url===b.url)return true;const na=normalizeTitle(a.title),nb=normalizeTitle(b.title);if(na&&nb&&(na===nb||na.includes(nb)||nb.includes(na)))return true;const ta=tokens(a.title),tb=tokens(b.title);if(!ta.size||!tb.size)return false;const common=[...ta].filter(t=>tb.has(t)).length;return common/Math.min(ta.size,tb.size)>=.72&&Math.abs(new Date(a.publishedAt).getTime()-new Date(b.publishedAt).getTime())<=12*60*60*1000;}
function extractImage(block:string){const media=attr(block,"media:content","url")||attr(block,"media:thumbnail","url")||attr(block,"enclosure","url");if(media)return decodeHtml(media);const encoded=field(block,["content:encoded"]);return encoded.match(/<img[^>]+(?:src|data-src)=["']([^"']+)["']/i)?.[1]||"";}
function parseFeed(xml:string,config:FeedConfig):NewsArticle[]{const blocks=xml.match(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi)||[];return blocks.map((block,i)=>{const title=cleanText(field(block,["title"]))||"無題";const url=decodeHtml(field(block,["link"]))||attr(block,"link","href")||decodeHtml(field(block,["guid"]));const publishedAt=parseDate(field(block,["pubDate","dc:date","published","updated"]));const updated=field(block,["updated"]);const description=cleanText(field(block,["description","summary"]));const content=cleanText(field(block,["content:encoded","content"]));const category=inferCategory(title,description+" "+content,config.categoryHint);const tags=[...new Set([...(config.tags||[]),cleanText(field(block,["category"]))].filter(Boolean))];const imageUrl=extractImage(block);return{id:`${config.source}:${url||normalizeTitle(title)}:${i}`,source:config.source,title,url,publishedAt,updatedAt:updated?parseDate(updated):undefined,description,content,imageUrl:imageUrl||undefined,category,primaryCategory:category,tags,importanceScore:scoreArticle(title,description+" "+content,category)};}).filter(a=>a.title!=="無題"&&/^https?:\/\//i.test(a.url));}
async function fetchFeed(config:FeedConfig){
  const controller=new AbortController();
  const timeoutMs=15000;
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  const label=config.source+" "+config.url;
  try{
    console.log("[RSS] START",label);
    const r=await fetch(config.url,{next:{revalidate:60},signal:controller.signal,headers:{"User-Agent":"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1","Accept":"application/rss+xml, application/xml, text/xml, */*","Accept-Language":"ja-JP,ja;q=0.9,en;q=0.8"}});
    const contentType=r.headers.get("content-type")||"";
    const xml=await r.text();
    console.log("[RSS] HTTP",label,{status:r.status,ok:r.ok,contentType,bytes:xml.length});
    if(!r.ok)throw new Error("HTTP "+r.status);
    if(!/<(?:rss|feed|rdf:RDF)\b/i.test(xml))throw new Error("XML root not recognized");
    const articles=parseFeed(xml,config);
    console.log("[RSS] PARSE",label,{articles:articles.length});
    return articles;
  }catch(error){
    if(error instanceof Error && error.name==="AbortError"){
      console.error("[RSS] TIMEOUT",label,{timeoutMs});
    }
    console.error("[RSS] FAIL",label,{
      name:error instanceof Error?error.name:"unknown",
      message:error instanceof Error?error.message:String(error),
      cause:error instanceof Error&&error.cause?String(error.cause):undefined
    });
    throw error;
  } finally { clearTimeout(timer); }
}
export async function fetchNewsArticles(){
  const results=await Promise.allSettled(RSS_FEEDS.map(fetchFeed));
  const failed=results.filter(r=>r.status==="rejected").length;
  const fetched=results.filter(r=>r.status==="fulfilled").reduce((n,r)=>n+r.value.length,0);
  const articles=results.flatMap(r=>r.status==="fulfilled"?r.value:[]).sort((a,b)=>(b.importanceScore||0)-(a.importanceScore||0)||new Date(b.publishedAt).getTime()-new Date(a.publishedAt).getTime());
  const unique:NewsArticle[]=[];
  for(const a of articles){if(unique.some(b=>isDuplicate(b,a)))continue;unique.push(a);}
  const displayed=unique.slice(0,500);
  const sourceCounts=Object.fromEntries((["AFPBB","FNN","マイナビニュース","ITmedia"] as const).map(source=>[source,displayed.filter(a=>a.source===source).length]));
  console.log("[RSS] SUMMARY",{
    feeds:RSS_FEEDS.length,
    failed,
    succeeded:RSS_FEEDS.length-failed,
    parsedArticles:fetched,
    uniqueArticles:unique.length,
    displayedArticles:displayed.length,
    sourceCounts
  });
  return displayed;
}
export function daypart(iso:string){const h=Number(new Intl.DateTimeFormat("ja-JP",{timeZone:"Asia/Tokyo",hour:"2-digit",hour12:false}).format(new Date(iso)));return h>=5&&h<11?"朝刊" as const:h>=11&&h<17?"昼刊" as const:"夕刊" as const;}
export function issueDate(iso:string){const p=new Intl.DateTimeFormat("ja-JP",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(iso));return `${p.find(x=>x.type==="year")?.value||"1970"}-${p.find(x=>x.type==="month")?.value||"01"}-${p.find(x=>x.type==="day")?.value||"01"}`;}
export function toLegacyNews(a:NewsArticle,index:number){return{title:a.title,body:a.content||a.description||"",url:a.url,index,section:a.category,imageUrl:a.imageUrl,imageAlt:a.source,source:a.source,category:a.primaryCategory,tags:a.tags,importanceScore:a.importanceScore,publishedAt:a.publishedAt};}
