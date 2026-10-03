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
 {source:"AFPBB",url:"https://news.yahoo.co.jp/rss/categories/world.xml",tags:["国際","外交","海外政治","世界経済","社会","科学","ライフ"]},
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

let activeParseMetrics:{decodeHtmlCalls:number;decodeHtmlMs:number;cleanTextCalls:number;cleanTextMs:number}|null=null;
function decodeHtml(v:string){
  const started=Date.now();
  const doc=new JSDOM("<body></body>").window.document;
  const e=doc.createElement("textarea");
  e.innerHTML=v||"";
  const value=e.value;
  if(activeParseMetrics){activeParseMetrics.decodeHtmlCalls++;activeParseMetrics.decodeHtmlMs+=Date.now()-started;}
  return value;
}
function cleanText(v:string){
  const started=Date.now();
  const value=decodeHtml(v).replace(/<!\[CDATA\[|\]\]>/g,"").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
  if(activeParseMetrics){activeParseMetrics.cleanTextCalls++;activeParseMetrics.cleanTextMs+=Date.now()-started;}
  return value;
}
function field(block:string,names:string[]){for(const name of names){const escapedName=name.replace(":","\\:");const re=new RegExp("<"+escapedName+"(?:\\s[^>]*)?>([\\s\\S]*?)</"+escapedName+">","i");const m=block.match(re);if(m?.[1])return m[1].trim();}return "";}
function attr(block:string,tag:string,name:string){const re=new RegExp("<"+tag+"\\b[^>]*\\b"+name+"=[\"']([^\"']+)[\"'][^>]*>","i");return block.match(re)?.[1]||"";}
function parseDate(v:string){const d=new Date(cleanText(v));return Number.isNaN(d.getTime())?new Date().toISOString():d.toISOString();}
export function inferCategory(title:string,description:string,hint?:NewsCategory){const text=title+" "+description;let best:NewsCategory=hint||"other";let score=hint?1:0;for(const [cat,words] of CATEGORY_RULES){const hits=words.reduce((n,w)=>n+(text.includes(w)?1:0),0);if(hits>score){best=cat;score=hits;}}return best;}
export function scoreArticle(title:string,description:string,category:NewsCategory){const text=title+" "+description;let score=category==="other"?0:1;for(const [points,words] of IMPORTANCE_RULES)for(const w of words)if(text.includes(w))score+=points;return Math.max(-2,Math.min(15,score));}
function normalizeTitle(t:string){return t.toLowerCase().replace(/【[^】]*】|\[[^\]]*\]|「[^」]*」/g,"").replace(/\s+/g,"").replace(/[「」『』【】（）()［］\[\]・:：、,.，．!！?？"'”’]/g,"");}
function tokens(t:string){return new Set(t.toLowerCase().split(/[^0-9a-zA-Z一-龥ぁ-んァ-ヶー]+/).map(v=>v.trim()).filter(v=>v.length>=2));}
function isDuplicate(a:NewsArticle,b:NewsArticle){if(a.url===b.url)return true;const na=normalizeTitle(a.title),nb=normalizeTitle(b.title);if(na&&nb&&(na===nb||na.includes(nb)||nb.includes(na)))return true;const ta=tokens(a.title),tb=tokens(b.title);if(!ta.size||!tb.size)return false;const common=[...ta].filter(t=>tb.has(t)).length;return common/Math.min(ta.size,tb.size)>=.72&&Math.abs(new Date(a.publishedAt).getTime()-new Date(b.publishedAt).getTime())<=12*60*60*1000;}
function extractImage(block:string){const media=attr(block,"media:content","url")||attr(block,"media:thumbnail","url")||attr(block,"enclosure","url");if(media)return decodeHtml(media);const encoded=field(block,["content:encoded"]);return encoded.match(/<img[^>]+(?:src|data-src)=["']([^"']+)["']/i)?.[1]||"";}
function parseFeed(xml:string,config:FeedConfig):NewsArticle[]{
  const metrics={
    blockExtractionMs:0,
    mapMs:0,
    filterMs:0,
    fieldRegexMs:0,
    attrRegexMs:0,
    dateParseMs:0,
    categoryMs:0,
    scoreMs:0,
    imageMs:0,
    decodeHtmlCalls:0,
    decodeHtmlMs:0,
    cleanTextCalls:0,
    cleanTextMs:0
  };
  activeParseMetrics=metrics;
  const blockStarted=Date.now();
  const blocks=xml.match(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi)||[];
  metrics.blockExtractionMs=Date.now()-blockStarted;
  try{
    const mapStarted=Date.now();
    const mapped=blocks.map((block,i)=>{
      const fieldStarted=Date.now();
      const title=cleanText(field(block,["title"]))||"無題";
      const fieldTitleMs=Date.now()-fieldStarted;

      const urlStarted=Date.now();
      const url=decodeHtml(field(block,["link"]))||attr(block,"link","href")||decodeHtml(field(block,["guid"]));
      const urlMs=Date.now()-urlStarted;

      const dateStarted=Date.now();
      const publishedAt=parseDate(field(block,["pubDate","dc:date","published","updated"]));
      const updated=field(block,["updated"]);
      const updatedAt=updated?parseDate(updated):undefined;
      metrics.dateParseMs+=Date.now()-dateStarted;

      const descriptionStarted=Date.now();
      const description=cleanText(field(block,["description","summary"]));
      const descriptionMs=Date.now()-descriptionStarted;

      const contentStarted=Date.now();
      const content=cleanText(field(block,["content:encoded","content"]));
      const contentMs=Date.now()-contentStarted;

      const categoryStarted=Date.now();
      const category=inferCategory(title,description+" "+content,config.categoryHint);
      metrics.categoryMs+=Date.now()-categoryStarted;

      const tagsStarted=Date.now();
      const tags=[...new Set([...(config.tags||[]),cleanText(field(block,["category"]))].filter(Boolean))];
      const tagsMs=Date.now()-tagsStarted;

      const imageStarted=Date.now();
      const imageUrl=extractImage(block);
      metrics.imageMs+=Date.now()-imageStarted;

      const scoreStarted=Date.now();
      const importanceScore=scoreArticle(title,description+" "+content,category);
      metrics.scoreMs+=Date.now()-scoreStarted;

      metrics.fieldRegexMs+=fieldTitleMs+descriptionMs+contentMs+tagsMs+dateStarted-dateStarted;
      metrics.attrRegexMs+=urlMs;
      void updatedAt;

      return{id:`${config.source}:${url||normalizeTitle(title)}:${i}`,source:config.source,title,url,publishedAt,updatedAt,description,content,imageUrl:imageUrl||undefined,category,primaryCategory:category,tags,importanceScore};
    });
    metrics.mapMs=Date.now()-mapStarted;
    const filterStarted=Date.now();
    const filtered=mapped.filter(a=>a.title!=="無題"&&/^https?:\/\//i.test(a.url));
    metrics.filterMs=Date.now()-filterStarted;
    console.log("[RSS] PARSE_DETAIL",config.source,{
      blocks:blocks.length,
      articles:filtered.length,
      blockExtractionMs:metrics.blockExtractionMs,
      mapMs:metrics.mapMs,
      filterMs:metrics.filterMs,
      fieldRegexMs:metrics.fieldRegexMs,
      attrRegexMs:metrics.attrRegexMs,
      dateParseMs:metrics.dateParseMs,
      categoryMs:metrics.categoryMs,
      scoreMs:metrics.scoreMs,
      imageMs:metrics.imageMs,
      decodeHtmlCalls:metrics.decodeHtmlCalls,
      decodeHtmlMs:metrics.decodeHtmlMs,
      cleanTextCalls:metrics.cleanTextCalls,
      cleanTextMs:metrics.cleanTextMs
    });
    return filtered;
  }finally{
    activeParseMetrics=null;
  }
}
async function fetchHtmlFallback(config:FeedConfig,fallbackUrl:string){
  const controller=new AbortController();
  const timeoutMs=15000;
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    console.log("[RSS] FALLBACK_START",config.source,fallbackUrl);
    const r=await fetch(fallbackUrl,{signal:controller.signal,headers:{"User-Agent":"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1","Accept":"text/html,application/xhtml+xml","Accept-Language":"ja-JP,ja;q=0.9,en;q=0.8"}});
    const html=await r.text();
    console.log("[RSS] FALLBACK_HTTP",config.source,{status:r.status,ok:r.ok,contentType:r.headers.get("content-type")||"",bytes:html.length});
    if(!r.ok)throw new Error("HTTP "+r.status);
    const doc=new JSDOM(html).window.document;
    const articles:NewsArticle[]=[];
    const seen=new Set<string>();
    for(const a of Array.from(doc.querySelectorAll("a[href]"))){
      const href=(a.getAttribute("href")||"").trim();
      const title=cleanText(a.textContent||"");
      if(!title||title.length<8||!href)continue;
      const url=new URL(href,fallbackUrl).toString();
      if(!/^https?:\/\//i.test(url)||seen.has(url))continue;
      if(config.source==="FNN"&&!/\/articles\//i.test(url))continue;
      if(config.source==="AFPBB"&&!/\/articles\/-\//i.test(url))continue;
      seen.add(url);
      const category=inferCategory(title,"",config.categoryHint);
      articles.push({
        id:config.source+":"+url,
        source:config.source,
        title,
        url,
        publishedAt:new Date().toISOString(),
        description:"",
        content:"",
        category,
        primaryCategory:category,
        tags:config.tags,
        importanceScore:scoreArticle(title,"",category)
      });
      if(articles.length>=80)break;
    }
    console.log("[RSS] FALLBACK_PARSE",config.source,{articles:articles.length});
    return articles;
  }finally{
    clearTimeout(timer);
  }
}
async function fetchFeed(config:FeedConfig){
  const started=Date.now();
  const controller=new AbortController();
  const timeoutMs=15000;
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  const label=config.source+" "+config.url;
  try{
    console.log("[RSS] START",label,{startedAt:new Date().toISOString()});

    // fetch()ではDNS/TCP/TLSを個別には取得できないため、
    // responseHeadersMsに「DNS + TCP + TLS + 配信元サーバーの応答待ち」をまとめて記録する。
    const networkStarted=Date.now();
    const r=await fetch(config.url,{next:{revalidate:60},signal:controller.signal,headers:{"User-Agent":"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1","Accept":"application/rss+xml, application/xml, text/xml, */*","Accept-Language":"ja-JP,ja;q=0.9,en;q=0.8"}});
    const responseHeadersMs=Date.now()-networkStarted;
    const contentType=r.headers.get("content-type")||"";
    console.log("[RSS] RESPONSE",label,{
      status:r.status,
      ok:r.ok,
      contentType,
      responseHeadersMs,
      note:"responseHeadersMs = DNS/TCP/TLS + server response wait"
    });

    const bodyStarted=Date.now();
    const xml=await r.text();
    const bodyMs=Date.now()-bodyStarted;
    console.log("[RSS] BODY",label,{
      bytes:xml.length,
      bodyMs,
      networkMs:responseHeadersMs+bodyMs
    });

    if(!r.ok)throw new Error("HTTP "+r.status);
    if(!/<(?:rss|feed|rdf:RDF)\b/i.test(xml))throw new Error("XML root not recognized");

    const parseStarted=Date.now();
    const articles=parseFeed(xml,config);
    const parseMs=Date.now()-parseStarted;
    console.log("[RSS] PARSE",label,{
      articles:articles.length,
      parseMs,
      totalMs:Date.now()-started
    });
    return articles;
  }catch(error){
    if(error instanceof Error && error.name==="AbortError"){
      console.error("[RSS] TIMEOUT",label,{
        timeoutMs,
        elapsedMs:Date.now()-started
      });
    }
    console.error("[RSS] FAIL",label,{
      name:error instanceof Error?error.name:"unknown",
      message:error instanceof Error?error.message:String(error),
      cause:error instanceof Error&&error.cause?String(error.cause):undefined,
      elapsedMs:Date.now()-started
    });
    if(config.source==="AFPBB"){
      try{
        return await fetchHtmlFallback(config,"https://www.afpbb.com/list/latest");
      }catch(fallbackError){
        console.error("[RSS] FALLBACK_FAIL",config.source,{message:fallbackError instanceof Error?fallbackError.message:String(fallbackError)});
      }
    }
    if(config.source==="FNN"){
      try{
        return await fetchHtmlFallback(config,"https://www.fnn.jp/list/latest?device=smartphone");
      }catch(fallbackError){
        console.error("[RSS] FALLBACK_FAIL",config.source,{message:fallbackError instanceof Error?fallbackError.message:String(fallbackError)});
      }
    }
    throw error;
  } finally {
    clearTimeout(timer);
    console.log("[RSS] DONE",label,{durationMs:Date.now()-started});
  }
}

export async function fetchGoogleTrendTerms(){
  const url="https://trends.google.com/trending/rss?geo=JP";
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),10000);
  try{
    const r=await fetch(url,{signal:controller.signal,headers:{"User-Agent":"Mozilla/5.0","Accept":"application/rss+xml,application/xml,text/xml,*/*","Accept-Language":"ja-JP,ja;q=0.9"}});
    const xml=await r.text();
    if(!r.ok)throw new Error("HTTP "+r.status);
    const doc=new JSDOM(xml).window.document;
    const terms=Array.from(doc.querySelectorAll("item > title, entry > title")).map(el=>cleanText(el.textContent||"")).filter(v=>v.length>=2);
    console.log("[TRENDS] SUMMARY",{status:r.status,bytes:xml.length,terms:terms.length,topTerms:terms.slice(0,20)});
    return terms;
  }catch(error){
    console.warn("[TRENDS] FAIL",{message:error instanceof Error?error.message:String(error)});
    return [];
  }finally{ clearTimeout(timer); }
}
function trendBoost(article:NewsArticle,terms:string[]){
  if(!terms.length)return 0;
  const text=(article.title+" "+(article.description||"")).toLowerCase();
  let hits=0;
  for(const term of terms){const t=term.toLowerCase().trim();if(t&&text.includes(t))hits++;}
  return Math.min(12,hits*6);
}
function newsRankScore(article:NewsArticle,terms:string[]){
  const ageHours=Math.max(0,(Date.now()-new Date(article.publishedAt).getTime())/3600000);
  const freshness=Math.max(0,8-Math.min(8,ageHours/6));
  return (article.importanceScore||0)+trendBoost(article,terms)+freshness;
}
export function applyImportanceStars(articles:NewsArticle[],terms:string[]){
  const ranked=articles.map(article=>({article,score:newsRankScore(article,terms),trendScore:trendBoost(article,terms)})).sort((a,b)=>b.score-a.score);
  const n=ranked.length;
  return ranked.map((entry,i)=>({...entry.article,trendScore:entry.trendScore,importanceStars:n<=1?5:i<Math.ceil(n*.10)?5:i<Math.ceil(n*.25)?4:i<Math.ceil(n*.50)?3:i<Math.ceil(n*.75)?2:1}));
}
function selectAllRssArticles(articles:NewsArticle[],terms:string[]){
  const selected=articles.slice().sort((a,b)=>newsRankScore(b,terms)-newsRankScore(a,terms)||new Date(b.publishedAt).getTime()-new Date(a.publishedAt).getTime());
  console.log("[RSS] ALL_SELECTION",{total:selected.length,trendMatched:selected.filter(a=>trendBoost(a,terms)>0).length});
  return selected;
}

export async function fetchNewsArticles(trendTermsInput?:string[]){
  const started=Date.now();
  console.log("[RSS] FETCH_ALL_START",{feeds:RSS_FEEDS.length});
  const results=await Promise.allSettled(RSS_FEEDS.map(fetchFeed));
  const failed=results.filter(r=>r.status==="rejected").length;
  const fetched=results.filter(r=>r.status==="fulfilled").reduce((n,r)=>n+r.value.length,0);
  const articles=results.flatMap(r=>r.status==="fulfilled"?r.value:[]).sort((a,b)=>(b.importanceScore||0)-(a.importanceScore||0)||new Date(b.publishedAt).getTime()-new Date(a.publishedAt).getTime());
  const uniqueStarted=Date.now();
  const unique:NewsArticle[]=[];
  for(const a of articles){if(unique.some(b=>isDuplicate(b,a)))continue;unique.push(a);}
  console.log("[RSS] DEDUPE_DONE",{durationMs:Date.now()-uniqueStarted,inputArticles:articles.length,uniqueArticles:unique.length});
  const trendTerms=trendTermsInput??await fetchGoogleTrendTerms();
  const displayed=selectAllRssArticles(unique,trendTerms);
  const sourceCounts=Object.fromEntries((["AFPBB","FNN","マイナビニュース","ITmedia"] as const).map(source=>[source,displayed.filter(a=>a.source===source).length]));
  console.log("[RSS] SUMMARY",{
    totalDurationMs:Date.now()-started,
    feeds:RSS_FEEDS.length,
    failed,
    succeeded:RSS_FEEDS.length-failed,
    parsedArticles:fetched,
    uniqueArticles:unique.length,
    displayedArticles:displayed.length,
    sourceCounts,
    trendTerms:trendTerms.length
  });
  return displayed;
}
export function daypart(iso:string){const h=Number(new Intl.DateTimeFormat("ja-JP",{timeZone:"Asia/Tokyo",hour:"2-digit",hour12:false}).format(new Date(iso)));return h>=5&&h<11?"朝刊" as const:h>=11&&h<17?"昼刊" as const:"夕刊" as const;}
export function issueDate(iso:string){const p=new Intl.DateTimeFormat("ja-JP",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(iso));return `${p.find(x=>x.type==="year")?.value||"1970"}-${p.find(x=>x.type==="month")?.value||"01"}-${p.find(x=>x.type==="day")?.value||"01"}`;}
export function toLegacyNews(a:NewsArticle,index:number){return{id:a.id,title:a.title,body:a.content||a.description||"",url:a.url,index,section:a.category,imageUrl:a.imageUrl,imageAlt:a.source,source:a.source,category:a.primaryCategory,tags:a.tags,importanceScore:a.importanceScore,publishedAt:a.publishedAt};}
