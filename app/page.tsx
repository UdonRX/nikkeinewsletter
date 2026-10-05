"use client";

import { useEffect, useMemo, useState } from "react";

import type { Email, News, ReaderData } from "@/lib/news/types";
import { cleanNewsTitle, stars, tinySummary } from "@/lib/news/ui";
import { NewsRow } from "@/app/components/news/NewsRow";

const GMAIL_CACHE_KEY="nikkei-news-gmail-cache-v2";

function readGmailCache(): {historyId:string;emails:Email[]} {
  if(typeof window === "undefined") return {historyId:"",emails:[]};
  try {
    const raw=window.localStorage.getItem(GMAIL_CACHE_KEY);
    if(!raw) return {historyId:"",emails:[]};
    const parsed=JSON.parse(raw);
    return {
      historyId:typeof parsed?.historyId==="string"?parsed.historyId:"",
      emails:Array.isArray(parsed?.emails)?parsed.emails:[],
    };
  } catch {
    return {historyId:"",emails:[]};
  }
}

function writeGmailCache(historyId:string,emails:Email[]) {
  if(typeof window === "undefined") return;
  try { window.localStorage.setItem(GMAIL_CACHE_KEY,JSON.stringify({historyId,emails})); } catch {}
}

function mergeGmailEmails(cached:Email[],incoming:Email[],deletedIds:string[],fullSync:boolean): Email[] {
  if(fullSync) return incoming;
  const deleted=new Set(deletedIds);
  const byId=new Map<string,Email>();
  for(const email of cached) if(!deleted.has(email.id)) byId.set(email.id,email);
  for(const email of incoming) if(!deleted.has(email.id)) byId.set(email.id,email);
  return [...byId.values()];
}

export default function Home(){
  const [emails,setEmails]=useState<Email[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [query,setQuery]=useState("");
  const [importanceFilter,setImportanceFilter]=useState<"all"|"2plus"|"3"|"4plus">("all");
  const [gmailConnected,setGmailConnected]=useState(false);
  const [reader,setReader]=useState<{emailId:string;newsIndex:number;data?:ReaderData}|null>(null);
  const [fontScale,setFontScale]=useState(1);
  const [shorts,setShorts]=useState<{items:Array<{email:Email;news:News;newsIndex:number}>;index:number}|null>(null);

  useEffect(()=>{if(typeof window!=="undefined")setGmailConnected(new URLSearchParams(window.location.search).get("connected")==="1");},[]);

  useEffect(()=>{
    const started=performance.now(),debugId=crypto.randomUUID();
    const cache=readGmailCache();
    console.log("[NEWS_LOAD] START",{debugId,gmailCacheEmails:cache.emails.length,gmailHistoryId:Boolean(cache.historyId)});
    const headers:Record<string,string>={"x-news-debug-id":debugId};
    const hasUsableGmailCache=cache.emails.some(e=>Array.isArray(e.news)&&e.news.length>0);
    if(cache.historyId && hasUsableGmailCache)headers["x-gmail-history-id"]=cache.historyId;
    if(cache.emails.length)headers["x-gmail-cached-ids"]=JSON.stringify(cache.emails.map(e=>e.id));
    fetch("/api/emails",{cache:"no-store",headers})
      .then(async r=>{
        console.log("[NEWS_LOAD] HTTP",{debugId,status:r.status,ok:r.ok,elapsedMs:Math.round(performance.now()-started)});
        const jsonStarted=performance.now();
        const data=await r.json().catch(()=>({}));
        console.log("[NEWS_LOAD] JSON_PARSED",{debugId,elapsedMs:Math.round(performance.now()-jsonStarted),totalMs:Math.round(performance.now()-started),emailCount:Array.isArray(data.emails)?data.emails.length:0,articleCount:Array.isArray(data.emails)?data.emails.reduce((n:number,e:Email)=>n+(e.news?.length||0),0):0,gmailConnected:Boolean(data.gmailConnected),gmailFullSync:Boolean(data.gmailSync?.fullSync)});
        if(!r.ok)throw new Error(data.error||"ニュースを取得できませんでした");
        setGmailConnected(Boolean(data.gmailConnected));
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

  const timeline=useMemo(()=>{
    const rows:Array<{email:Email;news:News;newsIndex:number;order:number}>=[];
    for(const email of emails)email.news.forEach((news,newsIndex)=>rows.push({email,news,newsIndex,order:newsIndex}));
    rows.sort((a,b)=>{
      const at=new Date(a.news.publishedAt||a.email.internalDate).getTime();
      const bt=new Date(b.news.publishedAt||b.email.internalDate).getTime();
      return bt-at||b.order-a.order;
    });
    return rows;
  },[emails]);

  const filtered=useMemo(()=>{
    const q=query.trim().toLowerCase();
    return timeline.filter(x=>{
      const n=x.news.importanceStars||1;
      const mf=importanceFilter==="all"||(importanceFilter==="2plus"&&n>=2)||(importanceFilter==="3"&&n===3)||(importanceFilter==="4plus"&&n>=4);
      const mq=!q||[x.news.title,x.news.body,x.news.source,x.news.category].join(" ").toLowerCase().includes(q);
      return mf&&mq;
    });
  },[timeline,query,importanceFilter]);

  async function openReader(email:Email,newsIndex:number){
    const news=email.news[newsIndex];
    if(!news)return;
    setReader({emailId:email.id,newsIndex});
    setFontScale(1);
    try{
      const params=new URLSearchParams({url:news.url||"",title:news.title,body:news.body||""});
      const r=await fetch("/api/article?"+params.toString(),{cache:"no-store"});
      const data=await r.json();
      if(r.ok)setReader(current=>current?{...current,data}:current);
    }catch{}
  }

  function openShorts(){
    if(filtered.length)setShorts({items:filtered,index:0});
  }

  if(loading)return <main className="app-shell"><div className="loading">ニュースを読み込んでいます…</div></main>;

  if(error)return <main className="app-shell"><section className="error-panel"><div className="eyebrow">NEWS READER</div><h1>ニュース</h1><p>{error}</p></section></main>;

  if(reader){
    const email=emails.find(e=>e.id===reader.emailId);
    const news=email?.news[reader.newsIndex];
    return <main className="app-shell reader-shell">
      <div className="reader-overlay">
        <header className="reader-bar">
          <button onClick={()=>setReader(null)}>‹ 戻る</button>
          <span>NEWS READER</span>
          <div className="reader-font">
            <button onClick={()=>setFontScale(v=>Math.max(.9,v-.1))}>A−</button>
            <button onClick={()=>setFontScale(v=>Math.min(1.3,v+.1))}>A＋</button>
          </div>
        </header>
        <article className="reader-article">
          {reader.data?.imageUrl&&<img className="reader-hero" src={reader.data.imageUrl} alt="" />}
          <div className="reader-source">{reader.data?.source||news?.source||"ニュース"}</div>
          <h1>{reader.data?.title||news?.title}</h1>
          {reader.data?.contentHtml
            ?<div className="article-content" style={{fontSize:fontScale+"em"}} dangerouslySetInnerHTML={{__html:reader.data.contentHtml}}/>
            :<p className="reader-unavailable">{news?.body||"本文を取得できませんでした。"}</p>}
          {reader.data?.paywalled&&<div className="paywall-notice"><strong>ここから先は有料会員限定</strong><p>続きは日経の有料会員向けページで読むことができます。</p></div>}
        </article>
      </div>
    </main>;
  }

  if(shorts){
    const item=shorts.items[shorts.index];
    return <main className="app-shell shorts-shell">
      <header className="shorts-bar">
        <button onClick={()=>setShorts(null)}>‹</button>
        <strong>ニュース Shorts</strong>
        <span>{shorts.index+1} / {shorts.items.length}</span>
      </header>
      <div className="short-progress"><span style={{width:((shorts.index+1)/shorts.items.length)*100+"%"}}/></div>
      <article className="short-card">
        {item.news.imageUrl&&<img src={item.news.imageUrl} alt="" />}
        <div className="short-meta"><span>{item.news.source||item.email.from}</span><span>{stars(item.news.importanceStars)}</span></div>
        <h1>{cleanNewsTitle(item.news.title)}</h1>
        <p>{tinySummary(item.news.body,item.news.title)}</p>
        <button className="read-button" onClick={()=>openReader(item.email,item.newsIndex)}>記事を読む</button>
      </article>
      <div className="short-nav">
        <button disabled={shorts.index===0} onClick={()=>setShorts({...shorts,index:shorts.index-1})}>↑ 前へ</button>
        <button disabled={shorts.index===shorts.items.length-1} onClick={()=>setShorts({...shorts,index:shorts.index+1})}>次へ ↓</button>
      </div>
    </main>;
  }

  return <main className="app-shell timeline-shell">
    <header className="timeline-header">
      <div><div className="eyebrow">NEWS READER</div><h1>ニュース</h1></div>
      <button className="gmail-button" onClick={()=>{window.location.href="/api/auth/google"}}>{gmailConnected?"Gmail接続済み":"日経メールを接続"}</button>
    </header>

    <div className="timeline-tools">
      <div className="search-wrap"><span>⌕</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="ニュースを検索"/></div>
      <button className="shorts-tool" onClick={openShorts}>Shorts</button>
    </div>

    <div className="importance-filters" aria-label="重要度フィルター">
      {([["all","すべて"],["2plus","★2以上"],["3","★3のみ"],["4plus","★4以上"]] as const).map(([value,label])=>
        <button key={value} className={importanceFilter===value?"active":""} onClick={()=>setImportanceFilter(value)}>{label}</button>
      )}
    </div>

    <div className="timeline-count">
      <strong>{filtered.length.toLocaleString("ja-JP")}</strong> 件 · 新しい順
    </div>

    <section className="timeline-list" aria-label="ニュースタイムライン">
      <div className="timeline-rail-line" aria-hidden="true"/>
      {filtered.map(x=>
        <NewsRow key={(x.news.id||x.email.id)+":"+x.newsIndex} email={x.email} news={x.news} newsIndex={x.newsIndex} openReader={openReader}/>
      )}
      {!filtered.length&&<div className="empty-state">条件に一致するニュースがありません。</div>}
    </section>

    <footer className="timeline-footer">FNN · Yahoo!ニュース · ITmedia · GIGAZINE · 日経メール</footer>
  </main>;
}
