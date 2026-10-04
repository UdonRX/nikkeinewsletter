import { JSDOM } from "jsdom";

export type NewsCategory = "politics"|"economy"|"business"|"international"|"market"|"technology"|"science"|"society"|"life"|"other";
export type NewsArticle = {
  id:string; source:"Yahoo!ニュース"|"FNN"|"マイナビニュース"|"ITmedia"|"GIGAZINE"|"AdverTimes."|"Googleニュース"|"日経"; title:string; url:string;
  publishedAt:string; updatedAt?:string; description?:string; content?:string; imageUrl?:string;
  category?:NewsCategory; primaryCategory?:NewsCategory; tags?:string[]; importanceScore?:number;
};
type FeedConfig={source:NewsArticle["source"];url:string;categoryHint?:NewsCategory;tags?:string[]};

export const RSS_FEEDS:FeedConfig[]=[
 {source:"FNN",url:"https://www.fnn.jp/list/feed/rss",categoryHint:"society",tags:["FNNプライムオンライン"]},
 {source:"Yahoo!ニュース",url:"https://news.yahoo.co.jp/rss/categories/world.xml",tags:["国際","外交","海外政治","世界経済","社会","科学","ライフ"]},
 {source:"GIGAZINE",url:"https://gigazine.net/news/rss_2.0/",categoryHint:"technology",tags:["テクノロジー","AI","セキュリティ"]},
 {source:"ITmedia",url:"https://rss.itmedia.co.jp/rss/2.0/itmedia_all.xml",tags:["ITmedia"]},
 {source:"ITmedia",url:"https://rss.itmedia.co.jp/rss/2.0/topstory.xml",tags:["ITmedia TOP STORIES"]},
 {source:"ITmedia",url:"https://rss.itmedia.co.jp/rss/2.0/news_bursts.xml",categoryHint:"technology",tags:["ITmedia NEWS"]},
 {source:"ITmedia",url:"https://rss.itmedia.co.jp/rss/2.0/aiplus.xml",categoryHint:"technology",tags:["AI"]},
 {source:"ITmedia",url:"https://rss.itmedia.co.jp/rss/2.0/business.xml",categoryHint:"business",tags:["ビジネス"]},
 {source:"ITmedia",url:"https://rss.itmedia.co.jp/rss/2.0/enterprise.xml",categoryHint:"business",tags:["エンタープライズ","セキュリティ","クラウド"]},
 {source:"AdverTimes.",url:"https://webtan.impress.co.jp/rss.xml",categoryHint:"business",tags:["マーケティング","広告","ブランド","SNS"]},
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
  [4,["首相","総理","政府","国会","内閣","日銀","金融政策","政策金利","戦争","停戦","国際紛争","米中関係"]],
  [3,["法案","選挙","外交","為替","日経平均","株式市場","GDP","物価","利上げ","利下げ","重大事故","大規模災害","大規模被害"]],
  [2,["決算","業績","買収","合併","M&A","半導体","サイバー","セキュリティ","宇宙","科学","経済","企業"]],
  [1,["クラウド","AI","人工知能","生成AI","DX","IT","ソフトウェア","データ"]],
  [-2,["芸能","エンタメ","ゲーム","スポーツ"]]
];

const EVENT_BOOST_RULES:Array<[number,string[]]>=[
  [5,["政策決定","政策を決定","法案成立","法案が成立","成立","承認","発動","施行","正式決定","決定した"]],
  [4,["重大発表","大規模被害","死者","負傷者","逮捕","攻撃","侵攻","停戦合意","過去最大","過去最高","過去最悪","史上最高"]],
  [3,["発表","決定","開始","終了","合意","提携","統合","再編","買収","合併","決算発表"]]
];

const EXPLANATORY_PENALTIES:Array<[number,string[]]>=[
  [-2,["解説","コラム","識者が解説","専門家が解説","対話人生","考える","考察"]],
  [-1,["とは？","なぜ？","どう向き合う","時代","読み解く","背景","ポイント"]]
];

function matchedKeywordScore(text:string,rules:Array<[number,string[]]>,cap:number){
  const matched=new Set<string>();
  const scores:number[]=[];
  for(const [points,words] of rules){
    for(const word of words){
      if(text.includes(word)&&!matched.has(word)){
        matched.add(word);
        scores.push(points);
      }
    }
  }
  scores.sort((a,b)=>b-a);
  return scores.slice(0,3).reduce((sum,points)=>sum+points,0)>cap?cap:scores.slice(0,3).reduce((sum,points)=>sum+points,0);
}

export function scoreArticle(title:string,description:string,category:NewsCategory){
  const text=(title+" "+description).trim();
  const categoryBase=category==="other"?0:1;
  const keywordScore=matchedKeywordScore(text,IMPORTANCE_RULES,7);
  const eventScore=matchedKeywordScore(text,EVENT_BOOST_RULES,7);
  const explanatoryPenalty=matchedKeywordScore(text,EXPLANATORY_PENALTIES,0);
  const isLiveSports=/速報|試合途中|試合開始前|試合結果|試合速報|プロ野球|サッカー速報|スコア速報/.test(title);
  const isMajorImpact=/政策決定|政策を決定|法案成立|重大発表|大規模被害|死者|攻撃|侵攻|停戦合意|過去最大|過去最高|過去最悪|史上最高/.test(text);
  let score=categoryBase+keywordScore+eventScore+explanatoryPenalty;
  if(isLiveSports)score=Math.min(score,2);
  if(!isMajorImpact)score=Math.min(score,11);
  return Math.max(-2,Math.min(15,score));
}

let activeParseMetrics:{decodeHtmlCalls:number;decodeHtmlMs:number;cleanTextCalls:number;cleanTextMs:number}|null=null;
const HTML_ENTITIES:Record<string,string>={amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:"\\u00a0",hellip:"…",ndash:"–",mdash:"—",laquo:"«",raquo:"»",copy:"©",reg:"®",trade:"™",yen:"¥",euro:"€"};
function decodeHtml(v:string){
  const started=Date.now();
  const value=(v||"").replace(/&(#(?:x[0-9a-f]+|\\d+)|[a-z][a-z0-9]+);/gi,(full,entity:string)=>{
    if(entity[0]==="#"){
      const hex=/^#x/i.test(entity);
      const code=Number.parseInt(entity.slice(hex?2:1),hex?16:10);
      return Number.isFinite(code)&&code>0&&code<=0x10ffff?String.fromCodePoint(code):full;
    }
    return HTML_ENTITIES[entity.toLowerCase()]??full;
  });
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

      return{id:`${config.source}:${url||title}:${i}`,source:config.source,title,url,publishedAt,updatedAt,description,content,imageUrl:imageUrl||undefined,category,primaryCategory:category,tags,importanceScore};
    });
    metrics.mapMs=Date.now()-mapStarted;
    const filterStarted=Date.now();
    const filtered=mapped.filter(a=>a.title!=="無題"&&/^https?:\/\//i.test(a.url));
    metrics.filterMs=Date.now()-filterStarted;
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
    const r=await fetch(fallbackUrl,{signal:controller.signal,headers:{"User-Agent":"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1","Accept":"text/html,application/xhtml+xml","Accept-Language":"ja-JP,ja;q=0.9,en;q=0.8"}});
    const html=await r.text();
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

    // fetch()ではDNS/TCP/TLSを個別には取得できないため、
    // responseHeadersMsに「DNS + TCP + TLS + 配信元サーバーの応答待ち」をまとめて記録する。
    const networkStarted=Date.now();
    const r=await fetch(config.url,{next:{revalidate:60},signal:controller.signal,headers:{"User-Agent":"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1","Accept":"application/rss+xml, application/xml, text/xml, */*","Accept-Language":"ja-JP,ja;q=0.9,en;q=0.8"}});
    const responseHeadersMs=Date.now()-networkStarted;
    const contentType=r.headers.get("content-type")||"";

    const bodyStarted=Date.now();
    const xml=await r.text();
    const bodyMs=Date.now()-bodyStarted;

    if(!r.ok)throw new Error("HTTP "+r.status);
    if(!/<(?:rss|feed|rdf:RDF)\b/i.test(xml))throw new Error("XML root not recognized");

    const parseStarted=Date.now();
    const articles=parseFeed(xml,config);
    const parseMs=Date.now()-parseStarted;
    const latestArticles=articles.slice().sort((a,b)=>new Date(b.publishedAt).getTime()-new Date(a.publishedAt).getTime());
    const latest=latestArticles[0];
    const oldest=latestArticles[latestArticles.length-1];
    console.log("[RSS] FEED_RESULT",JSON.stringify({source:config.source,url:config.url,status:r.status,contentType,bytes:xml.length,responseHeadersMs,bodyMs,parseMs,articleCount:articles.length,latestPublishedAt:latest?.publishedAt||null,latestTitle:latest?.title||null,oldestPublishedAt:oldest?.publishedAt||null,oldestTitle:oldest?.title||null}));
    return articles;
  }catch(error){
    if(error instanceof Error && error.name==="AbortError"){
    }
    if(config.source==="FNN"){
      try{
        return await fetchHtmlFallback(config,"https://www.fnn.jp/list/latest?device=smartphone");
      }catch(fallbackError){
      }
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}


export async function fetchGoogleTrendTerms(){
  const url="https://trends.google.com/trending/rss?geo=JP";
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),5000);
  try{
    const started=Date.now();
    const r=await fetch(url,{next:{revalidate:300},signal:controller.signal,headers:{"User-Agent":"Mozilla/5.0","Accept":"application/rss+xml,application/xml,text/xml,*/*","Accept-Language":"ja-JP,ja;q=0.9,en;q=0.8"}});
    const xml=await r.text();
    if(!r.ok)throw new Error("HTTP "+r.status);
    const doc=new JSDOM(xml).window.document;
    const terms=[...new Set(Array.from(doc.querySelectorAll("item > title, entry > title")).map(el=>cleanText(el.textContent||"")).filter(v=>v.length>=2))];
    console.log("[TRENDS] SUMMARY",{status:r.status,bytes:xml.length,terms:terms.length,topTerms:terms.slice(0,20),durationMs:Date.now()-started});
    return terms;
  }catch(error){
    console.warn("[TRENDS] FETCH_FAIL",{error:error instanceof Error?error.message:String(error)});
    return [];
  }finally{clearTimeout(timer);}
}
async function fetchGoogleNewsTrendFeeds(terms:string[]){
  const selected=terms.slice(0,10).filter(term=>term.trim().length>=2);
  const configs:FeedConfig[]=selected.map(term=>({source:"Googleニュース",url:`https://news.google.com/rss/search?hl=ja&gl=JP&ceid=JP:ja&q=${encodeURIComponent(term)}`,tags:["Google Trends"]}));
  const results=await Promise.allSettled(configs.map(fetchFeed));
  const articles=results.flatMap(r=>r.status==="fulfilled"?r.value:[]);
  console.log("[GOOGLE_NEWS_TRENDS] SUMMARY",JSON.stringify({terms:selected,feeds:configs.length,articles:articles.length}));
  return articles;
}
function trendBoost(article:NewsArticle,terms:string[]){
  if(!terms.length)return 0;
  const text=(article.title+" "+(article.description||"")+" "+(article.content||"")).toLowerCase();
  const isLiveSports=/速報|試合途中|試合開始前|試合結果|試合速報|プロ野球|サッカー速報|スコア速報/.test(article.title);
  const matches=terms.map((term,index)=>({term:term.toLowerCase().trim(),index})).filter(x=>x.term.length>=2&&text.includes(x.term));
  if(!matches.length)return 0;
  const scores=matches.map(({term,index})=>(index<5?6:index<15?5:index<30?3:2)+(term.replace(/\\s/g,"").length>=4?1:0)).sort((a,b)=>b-a);
  const raw=Math.min(8,scores[0]+(scores[1]?Math.min(2,scores[1]):0));
  return isLiveSports?Math.min(2,raw):Math.min(6,raw);
}
function importanceRankScore(article:NewsArticle,terms:string[]){
  return (article.importanceScore||0)+trendBoost(article,terms);
}
function newsRankScore(article:NewsArticle,terms:string[]){
  const ageHours=Math.max(0,(Date.now()-new Date(article.publishedAt).getTime())/3600000);
  const freshness=Math.max(0,8-Math.min(8,ageHours/6));
  return importanceRankScore(article,terms)+freshness;
}
export function applyImportanceStars(articles:NewsArticle[],terms:string[]){
  const scored=articles.map(article=>{
    const trendScore=trendBoost(article,terms);
    const baseImportance=article.importanceScore||0;
    const score=baseImportance+trendScore;
    const stars=score>=13?5:score>=10?4:score>=6?3:score>=2?2:1;
    return {...article,trendScore,importanceStars:stars,score,baseImportance};
  });
  const gates=[
    {stars:5,minBase:13,minScore:13},
    {stars:4,minBase:10,minScore:10},
    {stars:3,minBase:6,minScore:6},
    {stars:2,minBase:2,minScore:2},
    {stars:1,minBase:null,minScore:null}
  ];
  const counts=Object.fromEntries(gates.map(g=>[g.stars,scored.filter(a=>a.importanceStars===g.stars).length]));
  const violations=scored.filter(article=>{
    const expected=article.score>=13?5:article.score>=10?4:article.score>=6?3:article.score>=2?2:1;
    return article.importanceStars!==expected;
  }).length;
  const boundaryChecks=gates.map(g=>{
    const group=scored.filter(a=>a.importanceStars===g.stars);
    if(!group.length)return {stars:g.stars,count:0};
    const minScore=Math.min(...group.map(a=>a.score));
    const maxScore=Math.max(...group.map(a=>a.score));
    const minBase=Math.min(...group.map(a=>a.baseImportance));
    const maxBase=Math.max(...group.map(a=>a.baseImportance));
    const lowest=group.slice().sort((a,b)=>a.score-b.score||a.baseImportance-b.baseImportance)[0];
    return {
      stars:g.stars,
      count:group.length,
      scoreRange:[minScore,maxScore],
      baseRange:[minBase,maxBase],
      lowest:{score:lowest.score,baseImportance:lowest.baseImportance,source:lowest.source,title:lowest.title}
    };
  });
  const trendMatchedCount=scored.filter(a=>(a.trendScore||0)>0).length;
  console.log("[STARS] VALIDATION",JSON.stringify({
    total:scored.length,
    gates:{
      "5":"base>=13 && score>=13",
      "4":"base>=10 && score>=10",
      "3":"base>=6 && score>=6",
      "2":"base>=2 && score>=2",
      "1":"otherwise"
    },
    counts,
    violations,
    trendMatched:trendMatchedCount,
    boundaryChecks
  }));
  return scored;
}
function selectAllRssArticles(articles:NewsArticle[],terms:string[]){
  return articles.slice().sort((a,b)=>newsRankScore(b,terms)-newsRankScore(a,terms)||new Date(b.publishedAt).getTime()-new Date(a.publishedAt).getTime());
}
export async function fetchNewsArticles(trendTermsInput?:string[]){
  const results=await Promise.allSettled(RSS_FEEDS.map(fetchFeed));
  const articles=results.flatMap(r=>r.status==="fulfilled"?r.value:[]).sort((a,b)=>(b.importanceScore||0)-(a.importanceScore||0)||new Date(b.publishedAt).getTime()-new Date(a.publishedAt).getTime());
  return selectAllRssArticles(articles,trendTermsInput||[]);
}

export function daypart(iso:string){const h=Number(new Intl.DateTimeFormat("ja-JP",{timeZone:"Asia/Tokyo",hour:"2-digit",hour12:false}).format(new Date(iso)));return h>=5&&h<11?"朝刊" as const:h>=11&&h<17?"昼刊" as const:"夕刊" as const;}
export function issueDate(iso:string){const p=new Intl.DateTimeFormat("ja-JP",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(iso));return `${p.find(x=>x.type==="year")?.value||"1970"}-${p.find(x=>x.type==="month")?.value||"01"}-${p.find(x=>x.type==="day")?.value||"01"}`;}
export function toLegacyNews(a:NewsArticle,index:number){return{id:a.id,title:a.title,body:a.content||a.description||"",url:a.url,index,section:a.category,imageUrl:a.imageUrl,imageAlt:a.source,source:a.source,category:a.primaryCategory,tags:a.tags,importanceScore:a.importanceScore,publishedAt:a.publishedAt};}
