"use client";

import { useEffect, useMemo, useState } from "react";

type News = {
  id?: string; title: string; body: string; url?: string; index: number;
  imageUrl?: string; imageAlt?: string; source?: string; category?: string;
  tags?: string[]; importanceScore?: number; trendScore?: number;
  importanceStars?: number; publishedAt?: string; trendBadges?: string[]; topicId?: string;
};
type Email = {
  id: string; subject: string; receivedAt: string; internalDate: string;
  issueDate?: string; kind: "朝刊"|"昼刊"|"夕刊"|"速報"; from: string;
  newsCount: number; news: News[];
};
type ReaderData = {title:string; imageUrl?:string; contentHtml:string; url:string; available:boolean; paywalled?:boolean; source?:string};

const GMAIL_CACHE_KEY="nikkei-news-gmail-cache-v1";
function readGmailCache():{historyId:string;emails:Email[]}{
  try{const raw=localStorage.getItem(GMAIL_CACHE_KEY);if(!raw)return{historyId:"",emails:[]};const v=JSON.parse(raw);return{historyId:typeof v.historyId==="string"?v.historyId:"",emails:Array.isArray(v.emails)?v.emails:[]};}catch{return{historyId:"",emails:[]};}
}
function writeGmailCache(historyId:string,emails:Email[]){try{localStorage.setItem(GMAIL_CACHE_KEY,JSON.stringify({historyId,emails}));}catch(e){console.warn("[GMAIL_CACHE] SAVE_FAILED",e);}}
function mergeGmailEmails(cached:Email[],incoming:Email[],deletedIds:string[],fullSync:boolean){
  if(fullSync)return incoming.slice().sort((a,b)=>Number(b.internalDate||0)-Number(a.internalDate||0)).slice(0,30);
  const map=new Map(cached.map(e=>[e.id,e]));
  for(const id of deletedIds)map.delete(id);
  for(const email of incoming)map.set(email.id,email);
  return [...map.values()].sort((a,b)=>Number(b.internalDate||0)-Number(a.internalDate||0)).slice(0,30);
}
function dateKey(value:string){const d=new Date(value);if(Number.isNaN(d.getTime()))return "";const p=new Intl.DateTimeFormat("ja-JP",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(d);return `${p.find(x=>x.type==="year")?.value}-${p.find(x=>x.type==="month")?.value}-${p.find(x=>x.type==="day")?.value}`;}
function heatKey(value:string){const d=new Date(value);if(Number.isNaN(d.getTime()))return "";return new Intl.DateTimeFormat("ja-JP",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",hour12:false}).format(d);}
function hourLabel(value:string){const d=new Date(value);if(Number.isNaN(d.getTime()))return "";const h=Number(new Intl.DateTimeFormat("ja-JP",{timeZone:"Asia/Tokyo",hour:"2-digit",hour12:false}).format(d));return String(h).padStart(2,"0")+":00 - "+String((h+1)%24).padStart(2,"0")+":00";}
function displayDate(value:string){const d=new Date(value);if(Number.isNaN(d.getTime()))return value;return new Intl.DateTimeFormat("ja-JP",{timeZone:"Asia/Tokyo",month:"long",day:"numeric",weekday:"short"}).format(d);}
function timeOf(value?:string){if(!value)return "--:--";const d=new Date(value);if(Number.isNaN(d.getTime()))return "--:--";return new Intl.DateTimeFormat("ja-JP",{timeZone:"Asia/Tokyo",hour:"2-digit",minute:"2-digit",hour12:false}).format(d);}
function stars(count=1){const n=Math.max(1,Math.min(5,count));return "★".repeat(n);}
function tinySummary(body:string,title:string){const text=(body||"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();if(!text)return "";return text.length>52?text.slice(0,52)+"…":text;}
function cleanNewsTitle(title:string){return title.replace(/\s*[（(][^()（）]{1,30}[)）]\s*$/,"").replace(/^\s*[【\[][^】\]]{1,24}[】\]]\s*/,"").replace(/\s*[【\[](?:プロ野球|試合開始前|試合結果|速報)[^】\]]*[】\]]\s*/g,"").trim();}
function titleTag(title:string){const m=title.match(/[（(]([^()（）]{1,30})[)）]$/);if(m)return m[1];const b=title.match(/^[【\[]([^】\]]{1,24})[】\]]/);return b?b[1]:"";}
function isSportsTitle(title:string){return /プロ野球|野球|サッカー|試合|対戦|スコア|アジア大会|Jリーグ|NPB|DeNA|阪神|ロッテ|楽天|巨人|広島|中日|ヤクルト|ソフトバンク|日本ハム|オリックス|西武/.test(title);}
function relatedGroupKey(news:News){if(isSportsTitle(news.title))return "sports";const text=(cleanNewsTitle(news.title)+" "+(news.category||"")).replace(/[、。！？・：:]/g," ").toLowerCase();const words=text.split(/\s+/).filter(w=>w.length>=2).slice(0,6);return words.length>=2?((news.category||"other")+":"+words.slice(0,2).join("|")):"";}
function renderNewsRow(email:Email,news:News,newsIndex:number,openReader:(email:Email,newsIndex:number)=>void){const n=news.importanceStars||1;return <article className={"timeline-item stars-"+n} key={(news.id||email.id)+":"+newsIndex}><time>{timeOf(news.publishedAt||email.internalDate)}</time><div className="timeline-rail"><span/></div><button className={"timeline-main stars-"+n} onClick={()=>openReader(email,newsIndex)}><div className="timeline-title-row"><div className="timeline-title">{cleanNewsTitle(news.title)}</div>{titleTag(news.title)&&<span className="title-tag">{titleTag(news.title)}</span>}</div>{n>=4&&<div className="trend-badges">{(news.trendBadges||[]).map(b=><span key={b}>{b}</span>)}</div>}{n>=3&&<div className="timeline-summary">{tinySummary(news.body,news.title)}</div>}</button><div className="timeline-meta"><div className="timeline-source">{news.source||email.from}</div><div className={"timeline-stars stars-display-"+n} aria-label={"重要度 "+n+" / 5"}>{n>=4?stars(n):n===3?"★3":"★"+n}</div></div></article>);}


export default function Home(){
  const [emails,setEmails]=useState<Email[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [query,setQuery]=useState("");
  const [importanceFilter,setImportanceFilter]=useState<"all"|"2plus"|"3"|"4plus">("all");
  const [gmailConnected,setGmailConnected]=useState(false);
  const [heatByHour,setHeatByHour]=useState<Record<string,{count:number;heat:number}>>({});
  const [reader,setReader]=useState<{emailId:string;newsIndex:number;data?:ReaderData}|null>(null);
  const [fontScale,setFontScale]=useState(1);
  const [shorts,setShorts]=useState<{items:Array<{email:Email;news:News;newsIndex:number}>;index:number}|null>(null);

  useEffect(()=>{if(typeof window!=="undefined")setGmailConnected(new URLSearchParams(window.location.search).get("connected")==="1");},[]);

  useEffect(()=>{
    const started=performance.now(),debugId=crypto.randomUUID();
    const cache=readGmailCache();
    console.log("[NEWS_LOAD] START",{debugId,gmailCacheEmails:cache.emails.length,gmailHistoryId:Boolean(cache.historyId)});
    const headers:Record<string,string>={"x-news-debug-id":debugId};
    if(cache.historyId)headers["x-gmail-history-id"]=cache.historyId;
    if(cache.emails.length)headers["x-gmail-cached-ids"]=JSON.stringify(cache.emails.map(e=>e.id));
    fetch("/api/emails",{cache:"no-store",headers})
      .then(async r=>{
        console.log("[NEWS_LOAD] HTTP",{debugId,status:r.status,ok:r.ok,elapsedMs:Math.round(performance.now()-started)});
        const jsonStarted=performance.now();const data=await r.json().catch(()=>({}));
        console.log("[NEWS_LOAD] JSON_PARSED",{debugId,elapsedMs:Math.round(performance.now()-jsonStarted),totalMs:Math.round(performance.now()-started),emailCount:Array.isArray(data.emails)?data.emails.length:0,articleCount:Array.isArray(data.emails)?data.emails.reduce((n:number,e:Email)=>n+(e.news?.length||0),0):0,gmailConnected:Boolean(data.gmailConnected),gmailFullSync:Boolean(data.gmailSync?.fullSync)});
        if(!r.ok)throw new Error(data.error||"ニュースを取得できませんでした");
        setGmailConnected(Boolean(data.gmailConnected));
        setHeatByHour(data.heatByHour&&typeof data.heatByHour==="object"?data.heatByHour:{});
        const sync=data.gmailSync;
        const incomingGmail:Array<Email>=Array.isArray(data.emails)?data.emails.filter((e:Email)=>e.from?.includes("日経")||e.id?.startsWith("nikkei:")):[];
        let mergedGmail=cache.emails;
        if(data.gmailConnected&&sync)mergedGmail=mergeGmailEmails(cache.emails,incomingGmail,Array.isArray(sync.deletedIds)?sync.deletedIds:[],Boolean(sync.fullSync));
        if(data.gmailConnected&&sync?.historyId)writeGmailCache(sync.historyId,mergedGmail);
        const rssEmails:Array<Email>=Array.isArray(data.emails)?data.emails.filter((e:Email)=>!e.id?.startsWith("nikkei:")):[];
        setEmails([...mergedGmail,...rssEmails].sort((a,b)=>Number(b.internalDate||0)-Number(a.internalDate||0)));
      })
      .catch(e=>{console.error("[NEWS_LOAD] ERROR",{debugId,error:e instanceof Error?e.message:String(e),elapsedMs:Math.round(performance.now()-started)});setError(e instanceof Error?e.message:"ニュースを取得できませんでした");})
      .finally(()=>{console.log("[NEWS_LOAD] FINISH",{debugId,totalMs:Math.round(performance.now()-started)});setLoading(false);});
  },[]);

  const timeline=useMemo(()=>{const rows:Array<{email:Email;news:News;newsIndex:number;order:number}>=[];for(const email of emails)email.news.forEach((news,newsIndex)=>rows.push({email,news,newsIndex,order:newsIndex}));rows.sort((a,b)=>{const at=new Date(a.news.publishedAt||a.email.internalDate).getTime(),bt=new Date(b.news.publishedAt||b.email.internalDate).getTime();return bt-at||b.order-a.order;});return rows;},[emails]);
  const filtered=useMemo(()=>{const q=query.trim().toLowerCase();return timeline.filter(x=>{const n=x.news.importanceStars||1;const mf=importanceFilter==="all"||(importanceFilter==="2plus"&&n>=2)||(importanceFilter==="3"&&n===3)||(importanceFilter==="4plus"&&n>=4);const mq=!q||[x.news.title,x.news.body,x.news.source,x.news.category].join(" ").toLowerCase().includes(q);return mf&&mq;});},[timeline,query,importanceFilter]);
  const hourGroups=useMemo(()=>{const map=new Map<string,typeof filtered>();for(const item of filtered){const key=heatKey(item.news.publishedAt||item.email.internalDate);const list=map.get(key)||[];list.push(item);map.set(key,list);}return [...map.entries()];},[filtered]);

  async function openReader(email:Email,newsIndex:number){const news=email.news[newsIndex];if(!news)return;setReader({emailId:email.id,newsIndex});setFontScale(1);try{const params=new URLSearchParams({url:news.url||"",title:news.title,body:news.body||""});const r=await fetch("/api/article?"+params.toString(),{cache:"no-store"});const data=await r.json();if(r.ok)setReader(current=>current?{...current,data}:current);}catch{}}
  function openShorts(){if(filtered.length)setShorts({items:filtered,index:0});}

  if(loading)return <main className="app-shell"><div className="loading">ニュースを読み込んでいます…</div></main>;
  if(error)return <main className="app-shell"><section className="error-panel"><div className="eyebrow">NEWS READER</div><h1>ニュース</h1><p>{error}</p></section></main>;
  if(reader){const email=emails.find(e=>e.id===reader.emailId);const news=email?.news[reader.newsIndex];return <main className="app-shell reader-shell"><div className="reader-overlay"><header className="reader-bar"><button onClick={()=>setReader(null)}>‹ 戻る</button><span>NEWS READER</span><div className="reader-font"><button onClick={()=>setFontScale(v=>Math.max(.9,v-.1))}>A−</button><button onClick={()=>setFontScale(v=>Math.min(1.3,v+.1))}>A＋</button></div></header><article className="reader-article">{reader.data?.imageUrl&&<img className="reader-hero" src={reader.data.imageUrl} alt="" />}<div className="reader-source">{reader.data?.source||news?.source||"ニュース"}</div><h1>{reader.data?.title||news?.title}</h1>{reader.data?.contentHtml?<div className="article-content" style={{fontSize:fontScale+"em"}} dangerouslySetInnerHTML={{__html:reader.data.contentHtml}}/>:<p className="reader-unavailable">{news?.body||"本文を取得できませんでした。"}</p>}{reader.data?.paywalled&&<div className="paywall-notice"><strong>ここから先は有料会員限定</strong><p>続きは日経の有料会員向けページで読むことができます。</p></div>}</article></div></main>;}
  if(shorts){const item=shorts.items[shorts.index];return <main className="app-shell shorts-shell"><header className="shorts-bar"><button onClick={()=>setShorts(null)}>‹</button><strong>ニュース Shorts</strong><span>{shorts.index+1} / {shorts.items.length}</span></header><div className="short-progress"><span style={{width:((shorts.index+1)/shorts.items.length)*100+"%"}}/></div><article className="short-card">{item.news.imageUrl&&<img src={item.news.imageUrl} alt="" />}<div className="short-meta">{item.news.source||item.email.from}<span>{stars(item.news.importanceStars)}</span></div><h1>{item.news.title}</h1><p>{tinySummary(item.news.body,item.news.title)}</p><button className="read-button" onClick={()=>openReader(item.email,item.newsIndex)}>記事を読む</button></article><div className="short-nav"><button disabled={shorts.index===0} onClick={()=>setShorts({...shorts,index:shorts.index-1})}>↑ 前へ</button><button disabled={shorts.index===shorts.items.length-1} onClick={()=>setShorts({...shorts,index:shorts.index+1})}>次へ ↓</button></div></main>;}

<style jsx global>{".importance-filters{display:flex;gap:6px;overflow-x:auto;padding:9px 0 3px;scrollbar-width:none}.importance-filters::-webkit-scrollbar{display:none}.importance-filters button{border:1px solid var(--line);background:transparent;color:#7f8994;border-radius:999px;padding:6px 11px;font-size:10px;font-weight:800;white-space:nowrap}.importance-filters button.active{background:#e7ebef;color:#101317;border-color:#e7ebef}.timeline-title-row{display:flex;align-items:baseline;gap:7px;min-width:0}.title-tag{flex:0 0 auto;color:#69737d;font-size:8px;font-weight:700;border:1px solid #303740;border-radius:5px;padding:2px 4px;white-space:nowrap}.timeline-item{padding-bottom:14px}.timeline-main{border-radius:10px;padding:4px 6px;margin:-4px -6px;transition:background .15s,border-color .15s}.timeline-title{font-size:14px;line-height:1.42;font-weight:700}.timeline-summary{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin-top:5px;font-size:10px;line-height:1.45}.timeline-item.stars-3 .timeline-main{background:#171d24;border:1px solid #343e48;padding:8px 9px;margin:-8px -9px}.timeline-item.stars-3 .timeline-title{font-size:18px;line-height:1.34;font-weight:850;letter-spacing:-.035em}.timeline-item.stars-4 .timeline-main,.timeline-item.stars-5 .timeline-main{background:#151a20;border-left:2px solid var(--star);padding:7px 9px;margin:-7px -9px}.timeline-item.stars-4 .timeline-title,.timeline-item.stars-5 .timeline-title{font-size:16px;line-height:1.38;font-weight:850}.timeline-item.stars-5 .timeline-main{border-left-width:3px}.stars-display-1,.stars-display-2{color:#6f7882;font-size:9px!important;letter-spacing:0}.stars-display-3{color:var(--star);font-weight:900}.stars-display-4,.stars-display-5{color:var(--star);font-size:11px!important;font-weight:900}.related-group{margin:0 0 10px 69px;border:1px solid var(--line);border-radius:11px;background:#0d1115;overflow:hidden}.related-group summary{display:flex;justify-content:space-between;align-items:center;padding:10px 11px;cursor:pointer;list-style:none;color:#aeb6bf;font-size:10px;font-weight:800}.related-group summary::-webkit-details-marker{display:none}.related-group summary small{color:#626c76;font-size:8px;font-weight:600}.related-group>div{padding:5px 8px 0}.related-group .timeline-item{grid-template-columns:44px 9px minmax(0,1fr) 76px}.related-group .timeline-item:before{left:53px}.related-group .timeline-title{font-size:13px}.related-group .timeline-summary{display:none}@media(max-width:430px){.timeline-item.stars-3 .timeline-title{font-size:16px}.timeline-item.stars-4 .timeline-title,.timeline-item.stars-5 .timeline-title{font-size:15px}.related-group{margin-left:61px}}"}</style>
  return <main className="app-shell timeline-shell">
    <header className="timeline-header"><div><div className="eyebrow">NEWS READER</div><h1>ニュース</h1></div><button className="gmail-button" onClick={()=>{window.location.href="/api/auth/google"}}>{gmailConnected?"Gmail接続済み":"日経メールを接続"}</button></header>
    <div className="timeline-tools"><div className="search-wrap"><span>⌕</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="ニュースを検索"/></div><button className="shorts-tool" onClick={openShorts}>Shorts</button></div>
    <div className="importance-filters" aria-label="重要度フィルター">{([["all","すべて"],["2plus","★2以上"],["3","★3のみ"],["4plus","★4以上"]] as const).map(([value,label])=><button key={value} className={importanceFilter===value?"active":""} onClick={()=>setImportanceFilter(value)}>{label}</button>)}</div>
    <div className="timeline-count">{filtered.length.toLocaleString("ja-JP")} 件</div>
    <section className="timeline-list">{hourGroups.map(([key,items])=>{const byTopic=new Map<string,typeof items>();for(const item of items){const topicKey=item.news.topicId||item.news.id||item.email.id;const list=byTopic.get(topicKey)||[];list.push(item);byTopic.set(topicKey,list);}const heat=heatByHour[key];return <div className="timeline-hour" key={key}><div className="timeline-hour-heading"><span>{hourLabel(items[0].news.publishedAt||items[0].email.internalDate)}</span><span className="heat-meter"><i style={{width:Math.max(6,Math.min(100,heat?.heat||0))+"%"}}/></span><small>{heat?.count||items.length}件</small></div>{[...byTopic.values()].map((topicItems,i)=>topicItems.length>1?<details className="trend-topic-group" key={topicItems[0].news.topicId||i}><summary><span>{topicItems[0].news.importanceStars&&topicItems[0].news.importanceStars>=4?"🔥 ":""}関連記事 {topicItems.length}件</span><small>タップで展開</small></summary><div>{topicItems.map(x=>renderNewsRow(x.email,x.news,x.newsIndex,openReader))}</div></details>:renderNewsRow(topicItems[0].email,topicItems[0].news,topicItems[0].newsIndex,openReader))}</div>;})}{!filtered.length&&<div className="empty-state">該当するニュースがありません。</div>}</section>
    <footer className="timeline-footer">FNN · Yahoo!ニュース · ITmedia · GIGAZINE · 日経メール</footer>
  </main>;
}
