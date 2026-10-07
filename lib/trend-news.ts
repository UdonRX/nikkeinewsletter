import { JSDOM } from "jsdom";

export type TrendSource="google_trends"|"yahoo_realtime"|"newsdata"|"x";
export type TrendSignal={id:string;source:TrendSource;keyword:string;observedAt:string;rank?:number;searchIncrease?:number;postCount?:number;trendScore?:number;category?:string;relatedQueries?:string[];sourceUrl?:string};
export type TrendKeyword={term:string;googleRank?:number;yahooRank?:number;xRank?:number;sources:string[];observedAt?:string;searchIncrease?:number;postCount?:number;sourceUrl?:string};
export type TrendNewsArticle={id:string;source:string;title:string;description:string;url:string;imageUrl?:string;publishedAt:string;category:string;trendTerms:string[];googleRank?:number;yahooRank?:number;coverageCount:number;impactScore:number;importanceStars:1|2|3|4|5};
export type NewsTopic={id:string;title:string;summary:string;publishedAt:string;impactScore:number;importanceStars:1|2|3|4|5;trendBadges:string[];heat:number;articles:TrendNewsArticle[]};
const clean=(v:string)=>(v||"").replace(/\s+/g," ").replace(/[「」『』【】]/g,"").trim();
const norm=(v:string)=>clean(v).toLowerCase().replace(/[^ぁ-んァ-ヶ一-龠a-z0-9]+/gi,"");
const uniq=<T,>(a:T[])=>[...new Set(a)];
const dateOf=(v:string)=>{const d=new Date(v);return Number.isNaN(d.getTime())?new Date().toISOString():d.toISOString();};
async function getText(url:string,timeout=8000){const c=new AbortController();const timer=setTimeout(()=>c.abort(),timeout);try{const r=await fetch(url,{signal:c.signal,cache:"no-store",headers:{"User-Agent":"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)","Accept":"text/html,application/xml,text/xml,*/*","Accept-Language":"ja-JP,ja;q=0.9"}});if(!r.ok)throw new Error("HTTP "+r.status);return await r.text();}finally{clearTimeout(timer);}}
const TWITTREND_JAPAN_URL="https://twittrend.jp/trend/";
const TWITTREND_CACHE_TTL=10*60*1000;
let xTrendCache:{at:number;data:TrendKeyword[]}|null=null;

function twittrendObservedAt(updateText:string,now=new Date()){
  const m=updateText.match(/更新\s*[:：]\s*(\d{1,2})時(\d{2})分/);
  if(!m)return null;
  const hour=Number(m[1]),minute=Number(m[2]);
  if(hour>23||minute>59)return null;
  const jstParts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(now);
  const year=Number(jstParts.find(p=>p.type==="year")?.value);
  const month=Number(jstParts.find(p=>p.type==="month")?.value);
  const day=Number(jstParts.find(p=>p.type==="day")?.value);
  if(!year||!month||!day)return null;
  const candidates=[-1,0,1].map(offset=>{
    const utc=Date.UTC(year,month-1,day+offset,hour-9,minute,0);
    return new Date(utc);
  });
  const past=candidates.filter(d=>d.getTime()<=now.getTime()).sort((a,b)=>b.getTime()-a.getTime());
  return (past[0]||candidates.sort((a,b)=>a.getTime()-b.getTime())[0])?.toISOString()||null;
}

function parseTwittrendJapan(html:string,now=new Date()):TrendKeyword[]{
  const doc=new JSDOM(html).window.document;
  const headings=Array.from(doc.querySelectorAll("h1,h2,h3,h4,h5,h6")).filter(h=>clean(h.textContent||"")==="日本");
  const heading=headings[0];
  if(!heading)throw new Error("日本セクションが見つかりません");
  let container:Element|null=heading.parentElement;
  let best:Element|null=null;
  for(let depth=0;container&&depth<6;depth++,container=container.parentElement){
    const text=clean(container.textContent||"");
    const ranked=Array.from(container.querySelectorAll("li")).filter(li=>/^\s*\d+\s*\./.test(clean(li.textContent||"")));
    if(/更新\s*[:：]\s*\d{1,2}時\d{2}分/.test(text)&&ranked.length>=10){
      best=container;
      if(ranked.length>=40)break;
    }
  }
  if(!best)throw new Error("日本セクションのトレンド一覧が見つかりません");
  const updateMatch=clean(best.textContent||"").match(/更新\s*[:：]\s*\d{1,2}時\d{2}分/);
  const observedAt=updateMatch?twittrendObservedAt(updateMatch[0],now):null;
  if(!observedAt)throw new Error("日本セクションの更新時刻を解析できません");
  const rows=Array.from(best.querySelectorAll("li"));
  const seen=new Set<number>();
  const out:TrendKeyword[]=[];
  for(const li of rows){
    const text=clean(li.textContent||"");
    const rankMatch=text.match(/^\s*(\d+)\s*\./);
    if(!rankMatch)continue;
    const rank=Number(rankMatch[1]);
    if(rank<1||rank>50||seen.has(rank))continue;
    const link=li.querySelector("a");
    const keyword=clean(link?.textContent||text.replace(/^\\s*\\d+\\s*\\.\\s*/,""));
    if(!keyword)continue;
    seen.add(rank);
    out.push({term:keyword,xRank:rank,sources:["X"],observedAt,sourceUrl:TWITTREND_JAPAN_URL});
  }
  out.sort((a,b)=>(a.xRank||99)-(b.xRank||99));
  if(out.length<10)throw new Error("日本トレンドの取得件数が少なすぎます: "+out.length);
  return out;
}

export async function fetchXTrends():Promise<TrendKeyword[]>{
  const now=Date.now();
  if(xTrendCache&&now-xTrendCache.at<TWITTREND_CACHE_TTL){
    const observedAt=xTrendCache.data[0]?.observedAt;
    
    return xTrendCache.data;
  }
  const startedAt=new Date().toISOString();
  
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),8000);
  try{
    const response=await fetch(TWITTREND_JAPAN_URL,{
      signal:controller.signal,
      cache:"no-store",
      headers:{
        "User-Agent":"nikkeinewsletter-personal/1.0",
        "Accept":"text/html,application/xhtml+xml",
      },
    });
    if(!response.ok)throw new Error("HTTP "+response.status);
    const html=await response.text();
    const data=parseTwittrendJapan(html,new Date());
    xTrendCache={at:Date.now(),data};
    
    return data;
  }catch(e){
    
    return [];
  }finally{
    clearTimeout(timer);
  }
}

export async function fetchGoogleTrends():Promise<TrendKeyword[]>{try{const observedAt=new Date().toISOString();const doc=new JSDOM(await getText("https://trends.google.com/trending/rss?geo=JP")).window.document;const out:TrendKeyword[]=[];for(const item of Array.from(doc.querySelectorAll("item"))){const term=clean(item.querySelector("title")?.textContent||"");if(term.length<2)continue;const rank=out.length+1;const pub=item.querySelector("pubDate")?.textContent||"";const approx=item.querySelector("approx_traffic,ht\\:approx_traffic")?.textContent||"";const started=pub?new Date(pub):new Date(observedAt);const traffic=Number((approx.match(/[0-9,.]+/)||[])[0]?.replace(/,/g,"")||0);out.push({term,googleRank:rank,sources:["Google Trends"],observedAt:Number.isNaN(started.getTime())?observedAt:started.toISOString(),searchIncrease:traffic||undefined} as TrendKeyword)}const result=uniq(out.map(x=>norm(x.term))).map(k=>out.find(x=>norm(x.term)===k)!).slice(0,30);return result}catch(e){return[];}}
function yahooTerm(raw:string){let s=clean(raw).replace(/^\d+\s*/,"").replace(/^[0-9]+位/,"").split(/急上昇|https?:\/\//i)[0].split(/[／/]/)[0].trim();const hash=s.match(/#([^\s#]+)/);if(hash)return clean(hash[1]).replace(/[！!、。,:：]+$/,"").slice(0,24);s=s.split(/(?:返信数|リポスト数|いいね数|こいつ|誰よりも|これは|なんだこれ|繰り返します|本日)/i)[0];s=s.split(/[！!。！？]/)[0];s=s.replace(/^[^\p{L}\p{N}ぁ-んァ-ヶ一-龠]+/u,"");return clean(s).slice(0,24);}
function isMeaningfulYahooTerm(term:string){const s=clean(term);if(s.length<2||s.length>24)return false;if(/[\u{1F300}-\u{1FAFF}]/u.test(s))return false;if(/(?:えっち|セックス|裸|ポルノ|アダルト|殺す|死ね)/i.test(s))return false;const letters=(s.match(/[ぁ-んァ-ヶ一-龠A-Za-z0-9]/g)||[]).length;return letters>=3;}
export async function fetchYahooRealtimeTrends():Promise<TrendKeyword[]>{try{const doc=new JSDOM(await getText("https://search.yahoo.co.jp/realtime/")).window.document;const out:Array<{term:string;rank:number}>=[];for(const a of Array.from(doc.querySelectorAll("a[href]"))){const raw=clean(a.textContent||"");const href=a.getAttribute("href")||"";if(!/realtime/i.test(href)||/検索|ログイン|一覧|画像|動画|ニュース|設定|ヘルプ|Yahoo!/i.test(raw))continue;const rankMatch=raw.match(/^(?:\s*)?(\d+)\s*(?:位)?/);if(!rankMatch)continue;const term=yahooTerm(raw.slice(rankMatch[0].length));if(term.length<2||term.length>40)continue;out.push({term,rank:Number(rankMatch[1])});}const map=new Map<string,{term:string;rank:number}>();for(const x of out){const k=norm(x.term);if(k&&!map.has(k))map.set(k,x);}const terms=[...map.values()].sort((a,b)=>a.rank-b.rank).slice(0,30);return terms.map(x=>({term:x.term,yahooRank:x.rank,sources:["Yahoo!リアルタイム検索"],observedAt:new Date().toISOString()}));}catch(e){return[];}}
function merge(a:TrendKeyword[],b:TrendKeyword[],c:TrendKeyword[]=[]){const m=new Map<string,TrendKeyword>();for(const x of [...a,...b,...c]){const k=norm(x.term);if(!k)continue;const y=m.get(k);if(!y){m.set(k,{...x,sources:[...(x.sources||[])]});continue;}m.set(k,{...y,googleRank:y.googleRank??x.googleRank,yahooRank:y.yahooRank??x.yahooRank,xRank:y.xRank??x.xRank,searchIncrease:y.searchIncrease??x.searchIncrease,postCount:y.postCount??x.postCount,observedAt:y.observedAt??x.observedAt,sourceUrl:y.sourceUrl??x.sourceUrl,sources:uniq([...(y.sources||[]),...(x.sources||[])])});}return[...m.values()].filter(x=>x.term).sort((x,y)=>Math.min(x.googleRank||99,x.yahooRank||99,x.xRank||99)-Math.min(y.googleRank||99,y.yahooRank||99,y.xRank||99));}
function diversifyTrendArticles(articles:TrendNewsArticle[]){
  const ranked=[...articles].sort((a,b)=>b.impactScore-a.impactScore||new Date(b.publishedAt).getTime()-new Date(a.publishedAt).getTime());
  const topicOf=(a:TrendNewsArticle)=>a.trendTerms.map(norm).filter(Boolean).sort().join("|")||norm(a.title).slice(0,24);
  const groups=new Map<string,TrendNewsArticle[]>();
  for(const a of ranked){const key=topicOf(a);const list=groups.get(key)||[];list.push(a);groups.set(key,list);}
  const selected:TrendNewsArticle[]=[];
  const usedSources=new Set<string>();
  const usedCategories=new Set<string>();
  const topicQueues=[...groups.values()].map(list=>list.slice(0,2));
  while(topicQueues.some(q=>q.length)){
    let bestIndex=-1;
    let bestScore=-Infinity;
    for(let i=0;i<topicQueues.length;i++){
      const a=topicQueues[i][0];if(!a)continue;
      const diversity=(usedCategories.has(a.category)?0:1.5)+(usedSources.has(a.source)?0:0.5);
      const score=a.impactScore*3+diversity;
      if(score>bestScore){bestScore=score;bestIndex=i;}
    }
    if(bestIndex<0)break;
    const a=topicQueues[bestIndex].shift()!;
    selected.push(a);
    usedSources.add(a.source);usedCategories.add(a.category);
    if(selected.length>=18)break;
  }
  return selected;
}
function sim(a:string,b:string){const x=norm(a),y=norm(b);if(!x||!y)return 0;if(x.includes(y)||y.includes(x))return 1;const grams=(s:string)=>new Set(Array.from({length:Math.max(0,s.length-1)},(_,i)=>s.slice(i,i+2)));const ax=grams(x),by=grams(y);let n=0;for(const g of ax)if(by.has(g))n++;return n/Math.max(1,ax.size+by.size-n);}
function topicsOf(articles:TrendNewsArticle[]):NewsTopic[]{const topics:NewsTopic[]=[];for(const a of articles){const t=topics.find(t=>sim(t.title,a.title)>=0.38||a.trendTerms.some(k=>t.articles.some(x=>x.trendTerms.includes(k))));if(t)t.articles.push(a);else topics.push({id:"topic:"+a.id,title:a.title,summary:a.description,publishedAt:a.publishedAt,impactScore:a.impactScore,importanceStars:a.importanceStars,trendBadges:[],heat:0,articles:[a]});}for(const t of topics){const all=t.articles;const g=all.filter(a=>a.googleRank).sort((a,b)=>(a.googleRank||99)-(b.googleRank||99))[0];const y=all.filter(a=>a.yahooRank).sort((a,b)=>(a.yahooRank||99)-(b.yahooRank||99))[0];const relatedBonus=Math.min(3,Math.floor((all.length-1)/2));const baseImpact=Math.max(...all.map(a=>a.impactScore));t.impactScore=Math.min(15,baseImpact+relatedBonus);t.importanceStars=t.impactScore>=13?5:t.impactScore>=9?4:t.impactScore>=5?3:t.impactScore>=2?2:1;t.trendBadges=[];if(g?.googleRank&&g.googleRank<=5)t.trendBadges.push("google");if(y?.yahooRank&&y.yahooRank<=5)t.trendBadges.push("yahoo");const sourceCount=new Set(all.map(a=>a.source).filter(Boolean)).size;if(sourceCount>=3)t.trendBadges.push("coverage");t.heat=Math.min(100,t.impactScore*6+Math.min(40,all.length*8));}return topics.sort((a,b)=>new Date(b.publishedAt).getTime()-new Date(a.publishedAt).getTime());}
function newsSearchTerm(term:string){let s=clean(term).replace("急上昇","").trim();const hashIndex=s.indexOf("#");if(hashIndex>=0)s=s.slice(hashIndex+1).split(" ")[0];s=s.replace(/^\d+/,"").trim();return clean(s).slice(0,24);}

async function googleNewsQuery(q:string){const url="https://news.google.com/rss/search?"+new URLSearchParams({q,hl:"ja",gl:"JP",ceid:"JP:ja"}).toString();try{const xml=await getText(url,10000);const doc=new JSDOM(xml,{contentType:"text/xml"}).window.document;const items=Array.from(doc.querySelectorAll("item"));const results=items.map((item:any)=>{const title=clean(item.querySelector("title")?.textContent||"");const link=clean(item.querySelector("link")?.textContent||"");const description=clean(item.querySelector("description")?.textContent||"");const pubDate=clean(item.querySelector("pubDate")?.textContent||"");const source=clean(item.querySelector("source")?.textContent||"Google News");return{title,link,description,pubDate,source};}).filter(x=>x.title&&x.link&&(x.link.startsWith("http://")||x.link.startsWith("https://")));return results;}catch(e){return [];}}
function classifyCategory(t:string){if(/首相|総理|政府|国会|選挙|法案|外交|大統領|議会/.test(t))return"politics";if(/日銀|金利|物価|GDP|為替|円相場|景気|賃金/.test(t))return"economy";if(/株|日経平均|TOPIX|市場|債券/.test(t))return"market";if(/AI|半導体|IT|クラウド|サイバー|ソフトウェア/.test(t))return"technology";if(/事件|事故|地震|台風|火災|逮捕|死者|負傷/.test(t))return"society";return"other";}
async function fetchNewsData(trends:TrendKeyword[]){
  const googleTerms=trends.filter(t=>t.googleRank&&t.googleRank<=10).map(t=>({...t,searchTerm:newsSearchTerm(t.term)})).filter(t=>t.searchTerm.length>=2);
  const yahooTerms=trends.filter(t=>t.yahooRank&&t.yahooRank<=10).map(t=>({...t,searchTerm:newsSearchTerm(t.term)})).filter(t=>t.searchTerm.length>=2&&isMeaningfulYahooTerm(t.searchTerm));
  const xTerms=trends.filter(t=>t.xRank&&t.xRank<=10).map(t=>({...t,searchTerm:newsSearchTerm(t.term)})).filter(t=>t.searchTerm.length>=2);
  const selectedMap=new Map<string,TrendKeyword & {searchTerm:string}>();
  for(const t of [...googleTerms,...yahooTerms,...xTerms]){const k=norm(t.searchTerm);const prev=selectedMap.get(k);if(!prev)selectedMap.set(k,t);else selectedMap.set(k,{...prev,googleRank:t.googleRank??prev.googleRank,yahooRank:t.yahooRank??prev.yahooRank,xRank:t.xRank??prev.xRank,sources:uniq([...prev.sources,...t.sources])});}
  const selected=[...selectedMap.values()].sort((a,b)=>Math.min(a.googleRank??99,a.yahooRank??99,a.xRank??99)-Math.min(b.googleRank??99,b.yahooRank??99,b.xRank??99));
    const batches=await Promise.all(selected.map(async t=>({term:t,articles:await googleNewsQuery(t.searchTerm.includes(" ") ? '"' + t.searchTerm + '"' : t.searchTerm)})));
  const raw=batches.flatMap(x=>x.articles.map(article=>({article,term:x.term})));
    const seen=new Set<string>();const out:TrendNewsArticle[]=[];
  for(const item of raw){const x=item.article;const url=String(x.link||"");const title=clean(String(x.title||""));if(!url||!title||seen.has(url)||!(url.startsWith("http://")||url.startsWith("https://")))continue;const desc=clean(String(x.description||"")).replace(/<[^>]+>/g," ");const haystack=norm(title+" "+desc);const hit=selected.filter(t=>haystack.includes(norm(t.searchTerm))).slice(0,5);if(!hit.length)continue;seen.add(url);
    const googleHits=hit.filter(t=>t.googleRank);const yahooHits=hit.filter(t=>t.yahooRank);const g=googleHits.length?Math.min(...googleHits.map(t=>t.googleRank!)):99;const y=yahooHits.length?Math.min(...yahooHits.map(t=>t.yahooRank!)):99;const both=g<99&&y<99;
    const best=Math.min(g,y);const rankBonus=best<=1?4:best<=3?3:best<=5?2:best<=10?1:0;const impact=Math.min(15,(both?8:3)+rankBonus+Math.min(2,hit.length-1));
    const stars:1|2|3|4|5=both&&g<=3&&y<=3?5:both&&g<=5&&y<=5?4:(both||best<=3)?3:2;
    out.push({id:"googlenews:"+url,title,description:desc,url,source:clean(String(x.source||"Google News")),imageUrl:undefined,publishedAt:dateOf(String(x.pubDate||"")),category: classifyCategory(title+" "+desc),trendTerms:hit.map(t=>t.term),googleRank:g<99?g:undefined,yahooRank:y<99?y:undefined,coverageCount:hit.length,impactScore:impact,importanceStars:stars});
  }
  const diversified=diversifyTrendArticles(out);
  
    return diversified;
}


export async function collectTrendNews(){const started=Date.now();const[google,yahoo,x]=await Promise.all([fetchGoogleTrends(),fetchYahooRealtimeTrends(),fetchXTrends()]);const trends=merge(google,yahoo,x);const articles=await fetchNewsData(trends);const topics=topicsOf(articles);const heatByHour:Record<string,{count:number;heat:number}>={};for(const t of topics){const key=new Intl.DateTimeFormat("ja-JP",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",hour12:false}).format(new Date(t.publishedAt));heatByHour[key]??={count:0,heat:0};heatByHour[key].count+=t.articles.length;heatByHour[key].heat+=t.heat;}return{google,yahoo,x,trends,articles,topics,heatByHour};}


export type TimelineArticle = {
  id:string; title:string; summary?:string; description?:string; url?:string; source?:string; category?:string;
  publishedAt:string; updatedAt?:string; imageUrl?:string; importanceScore?:number; trendScore?:number; keywords?:string[];
};
export type TimelineItem = {
  id:string; type:"article"|"topic"|"event"; title:string; summary?:string; category?:string;
  publishedAt?:string; detectedAt?:string; updatedAt?:string; trendScore:number; importanceScore:number;
  source?:string; sourceUrl?:string; imageUrl?:string; keywords?:string[];
  relatedArticles?:TimelineArticle[]; relatedTopics?:string[]; eventId?:string; rank?:number; searchIncrease?:number; sources?:string[];
};
type NewsDataRow={article_id?:string;title?:string;description?:string;content?:string;link?:string;pubDate?:string;source_name?:string;image_url?:string;keywords?:string[];category?:string[]};

async function fetchNewsDataTimeline(terms:TrendKeyword[]){
  const key=process.env.NEWSDATA_API_KEY||process.env.NEWS_DATA_API_KEY;
  if(!key){return{articles:[] as TimelineArticle[],signals:[] as TrendKeyword[]};}
  const selected=terms.slice().sort((a,b)=>(a.googleRank||99)-(b.googleRank||99)||(a.yahooRank||99)-(b.yahooRank||99)).slice(0,8);
  const rows:NewsDataRow[]=[];let ok=0;
  for(const t of selected){try{
    const q=new URLSearchParams({apikey:key,q:t.term,country:"jp",language:"jp",removeduplicate:"1"});
    const r=await fetch("https://newsdata.io/api/1/latest?"+q,{cache:"no-store"});const j=await r.json().catch(()=>({}));
    if(!r.ok||j?.status==="error")throw new Error(j?.results?.message||"HTTP "+r.status);
    if(Array.isArray(j?.results))rows.push(...j.results);ok++;
  }catch(e){}}
  const seen=new Set<string>(),articles:TimelineArticle[]=[];
  for(const x of rows){const title=clean(x.title||"");if(!title||!x.link||seen.has(x.article_id||x.link))continue;seen.add(x.article_id||x.link);articles.push({id:"newsdata:"+String(x.article_id||articles.length),title,summary:clean(x.description||x.content||""),description:clean(x.description||x.content||""),url:x.link,source:clean(x.source_name||"NewsData.io"),category: classifyCategory(title+" "+(x.description||"")),publishedAt:dateOf(x.pubDate||""),imageUrl:x.image_url,keywords:Array.isArray(x.keywords)?x.keywords.slice(0,8):[]})}
  const signals=selected.filter(t=>articles.some(a=>sim(a.title,t.term)>=.5)).map(t=>({...t,sources:uniq([...(t.sources||[]),"NewsData.io"])}));
  
  return{articles,signals};
}

function timelineTrend(term:TrendKeyword,all:TrendKeyword[]){const same=all.filter(x=>sim(x.term,term.term)>=.72);const sources=new Set(same.flatMap(x=>x.sources||[]));const rank=term.googleRank||term.yahooRank||term.xRank||99;const hasX=!!term.xRank;const nonXRank=Math.min(term.googleRank||99,term.yahooRank||99);const base=hasX&&!term.googleRank&&!term.yahooRank?Math.max(0,32-(rank-1)*1.4):Math.max(0,58-nonXRank*3);const multi=Math.min(36,Math.max(0,sources.size-1)*14);const traffic=term.searchIncrease?Math.min(20,Math.log10(Math.max(1,term.searchIncrease))*6):0;return Math.round(Math.min(100,(base+multi+traffic+Math.min(10,same.length*2))*Math.pow(.5,Math.max(0,(Date.now()-new Date(term.observedAt||new Date().toISOString()).getTime())/14400000))))}
function articleTrend(a:TimelineArticle,terms:TrendKeyword[]){const hits=terms.filter(t=>sim(a.title,t.term)>=.48||(a.keywords||[]).some(k=>sim(k,t.term)>=.7));if(!hits.length)return 0;const best=Math.max(...hits.map(t=>timelineTrend(t,terms)));return Math.min(100,Math.round(best+Math.min(20,(hits.length-1)*5)))}
function articleImportance(a:TimelineArticle,count:number,sources:number){let s=22;const text=a.title+" "+(a.description||"");if(/首相|総理|政府|国会|内閣|日銀|政策金利|地震|台風|戦争|停戦|侵攻|大規模被害|死者|重大事故/.test(text))s+=45;if(/決定|成立|発表|合意|攻撃|逮捕|買収|合併|決算/.test(text))s+=15;if(/スポーツ|芸能|エンタメ|ゲーム/.test(text))s-=10;s+=Math.min(15,(count-1)*4)+Math.min(10,Math.max(0,sources-1)*5);return Math.max(0,Math.min(100,s))}
function dedupeTimelineArticles(input:TimelineArticle[]){const out:TimelineArticle[]=[];for(const a of input){const dup=out.find(x=>(x.url&&a.url&&x.url===a.url)||(sim(x.title,a.title)>=.86&&Math.abs(new Date(x.publishedAt).getTime()-new Date(a.publishedAt).getTime())<21600000));if(!dup)out.push(a);else{dup.keywords=uniq([...(dup.keywords||[]),...(a.keywords||[])]);if(!dup.imageUrl)dup.imageUrl=a.imageUrl}}return out}
function buildTimelineEvents(articles:TimelineArticle[],terms:TrendKeyword[]){
 const groups:TimelineArticle[][]=[];
 for(const a of articles){const g=groups.find(xs=>xs.some(x=>sim(x.title,a.title)>=.52||(x.keywords||[]).some(k=>(a.keywords||[]).some(q=>sim(k,q)>=.72))));if(g)g.push(a);else groups.push([a])}
 const events:TimelineItem[]=[];const consumed=new Set<string>();
 for(const g of groups){const sources=new Set<string>(g.map(x=>x.source).filter((x):x is string=>Boolean(x))),hits=terms.filter(t=>g.some(a=>sim(a.title,t.term)>=.5||(a.keywords||[]).some(k=>sim(k,t.term)>=.72)));const trend=Math.max(0,...hits.map(t=>timelineTrend(t,terms)),...g.map(a=>articleTrend(a,terms))),importance=Math.max(...g.map(a=>articleImportance(a,g.length,sources.size)));if(g.length<2&&!(sources.size>=2&&trend>=60)&&!(trend>=78&&importance>=55))continue;const sorted=g.slice().sort((a,b)=>articleImportance(b,g.length,sources.size)-articleImportance(a,g.length,sources.size));const first=g.slice().sort((a,b)=>new Date(a.publishedAt).getTime()-new Date(b.publishedAt).getTime())[0];const title=hits[0]?.term||sorted[0].title;events.push({id:"event:"+norm(title)+":"+new Date(first.publishedAt).getTime(),type:"event",title,summary:sorted[0].summary||"複数のニュースとトレンドが同じ話題として検出されています。",category:sorted[0].category,publishedAt:first.publishedAt,detectedAt:first.publishedAt,updatedAt:g.slice().sort((a,b)=>new Date(b.updatedAt||b.publishedAt).getTime()-new Date(a.updatedAt||a.publishedAt).getTime())[0].updatedAt||g.slice().sort((a,b)=>new Date(b.publishedAt).getTime()-new Date(a.publishedAt).getTime())[0].publishedAt,trendScore:trend,importanceScore:importance,source:[...sources].join(" / "),sourceUrl:sorted[0].url,imageUrl:sorted[0].imageUrl,keywords:uniq([...hits.map(x=>x.term),...g.flatMap(x=>x.keywords||[])]).slice(0,10),relatedArticles:sorted.slice(0,12),sources:[...sources]});g.forEach(a=>consumed.add(a.id))}
 return{events,consumed}
}

export async function collectTimelineData(nikkeiArticles:TimelineArticle[]=[]){
 const base=await collectTrendNews();const merged=base.trends;const nd=await fetchNewsDataTimeline(merged);const terms=merge(merged,nd.signals);
 const rssMod=await import("@/lib/rss");const rss=await rssMod.fetchNewsArticles(terms.map(x=>x.term));
 const rssArticles:TimelineArticle[]=rss.map((a:any)=>({id:"rss:"+a.id,title:a.title,summary:a.description||a.content||"",description:a.description||a.content||"",url:a.url,source:a.source,category:a.primaryCategory||a.category||"other",publishedAt:a.publishedAt,updatedAt:a.updatedAt,imageUrl:a.imageUrl,importanceScore:a.importanceScore,keywords:a.tags||[]}));
 const articles=dedupeTimelineArticles([...nikkeiArticles,...nd.articles,...rssArticles]).map(a=>({...a,trendScore:articleTrend(a,terms),importanceScore:Math.max(a.importanceScore||0,articleImportance(a,1,1))}));
 const {events,consumed}=buildTimelineEvents(articles,terms);
 const topics=terms.map(t=>{const related=articles.filter(a=>!consumed.has(a.id)&&(sim(a.title,t.term)>=.48||(a.keywords||[]).some(k=>sim(k,t.term)>=.72))).slice(0,8);const reason=related[0]?.summary||related[0]?.description||"関連ニュースを確認中です。";return{id:"topic:"+norm(t.term)+":"+new Date(t.observedAt||new Date().toISOString()).getTime(),type:"topic" as const,title:t.term,summary:reason,category: classifyCategory(t.term),publishedAt:t.observedAt||new Date().toISOString(),detectedAt:t.observedAt||new Date().toISOString(),trendScore:timelineTrend(t,terms),importanceScore:related.length?Math.round(Math.max(...related.map(a=>a.importanceScore||0))*.65):15,source:(t.sources||[]).join(" / ")||"トレンド",sourceUrl:t.sourceUrl||related[0]?.url,keywords:[t.term],relatedArticles:related,rank:Math.min(t.googleRank||99,t.yahooRank||99,t.xRank||99),searchIncrease:t.searchIncrease,postCount:t.postCount}}).filter(x=>x.trendScore>=8).sort((a,b)=>b.trendScore-a.trendScore).slice(0,28);
 const eventArticleIds=new Set(events.flatMap(e=>(e.relatedArticles||[]).map(a=>a.id)));
 const articleItems=articles.filter(a=>!eventArticleIds.has(a.id)).map(a=>({id:a.id,type:"article" as const,title:a.title,summary:a.summary,category:a.category,publishedAt:a.publishedAt,detectedAt:a.publishedAt,updatedAt:a.updatedAt,trendScore:a.trendScore||0,importanceScore:a.importanceScore||0,source:a.source,sourceUrl:a.url,imageUrl:a.imageUrl,keywords:a.keywords,relatedArticles:[a]}));
 const timeline=[...articleItems,...topics,...events].sort((a,b)=>new Date(b.detectedAt||b.publishedAt||0).getTime()-new Date(a.detectedAt||a.publishedAt||0).getTime());
 
 return{google:base.google,yahoo:base.yahoo,x:base.x,newsdata:nd.signals,signals:terms,articles,timeline};
}
