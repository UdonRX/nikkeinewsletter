"use client";
import { useEffect, useMemo, useState } from "react";

type News={title:string;body:string;url?:string;index:number;section?:string;imageUrl?:string;imageAlt?:string};
type Email={id:string;subject:string;receivedAt:string;internalDate:string;kind:"朝刊"|"昼刊"|"夕刊"|"速報";from:string;newsCount:number;news:News[]};
type ReaderData={title:string;imageUrl:string;contentHtml:string;url:string;available:boolean;source?:string;fetchError?:string};

export default function Home(){
  const [emails,setEmails]=useState<Email[]>([]);
  const [reader,setReader]=useState<{emailIndex:number;newsIndex:number;data?:ReaderData}|null>(null);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(true);
  const [readerLoading,setReaderLoading]=useState(false);
  const [fontScale,setFontScale]=useState(1);

  useEffect(()=>{
    fetch("/api/emails",{cache:"no-store"}).then(async r=>{
      const j=await r.json().catch(()=>({}));
      if(r.status===401) throw new Error("Googleアカウントを接続してください。");
      if(!r.ok) throw new Error(j.error||"メールを取得できませんでした");
      setEmails(j.emails||[]);
    }).catch(e=>setError(e instanceof Error?e.message:"メールを取得できませんでした")).finally(()=>setLoading(false));
  },[]);

  const totalNews=useMemo(()=>emails.reduce((n,e)=>n+e.newsCount,0),[emails]);

  async function openReader(emailIndex:number,newsIndex:number){
    const news=emails[emailIndex]?.news[newsIndex];
    if(!news)return;
    setReader({emailIndex,newsIndex});
    setReaderLoading(true);
    setFontScale(1);
    try{
      const params=new URLSearchParams({url:news.url||"",title:news.title,body:news.body||""});
      const r=await fetch("/api/article?"+params.toString(),{cache:"no-store"});
      const data=await r.json();
      if(r.ok)setReader(current=>current?{...current,data}:current);
    }catch{}finally{setReaderLoading(false);}
  }

  function moveReader(delta:number){
    if(!reader)return;
    const email=emails[reader.emailIndex];
    const next=reader.newsIndex+delta;
    if(!email||next<0||next>=email.news.length)return;
    openReader(reader.emailIndex,next);
  }

  if(loading)return <main className="app-shell"><div className="loading">日経ニュースを読み込んでいます…</div></main>;

  if(error)return <main className="app-shell"><div className="connect-card"><div className="eyebrow">NIKKEI NEWS MAIL</div><h1>日経ニュース</h1><p>{error}</p><a className="btn" href="/api/auth/google">Googleで接続</a></div></main>;

  return <main className="app-shell">
    <header className="topbar"><div><div className="eyebrow">NIKKEI NEWS MAIL</div><h1>日経ニュース</h1></div><div className="count">{emails.length}通 / {totalNews}件</div></header>
    {!emails.length?<div className="empty card"><h2>ニュースメールがありません</h2><p>nikkei-news@mx.nikkei.com または sokuho-news@mx.nikkei.com のメールを待っています。</p></div>:
    <div className="mail-stack">{emails.map((email,emailIndex)=>
      <section className={"mail-card "+(email.kind==="速報"?"breaking":"regular")} key={email.id}>
        <header className="mail-header"><div className="mail-type"><span className="type-dot"/><strong>{email.kind}</strong><span className="mail-date">{formatDate(email.receivedAt)}</span></div><span className="mail-count">{email.newsCount}件</span></header>
        <div className="mail-subject">{email.subject}</div>
        <div className="bento-viewport"><div className="bento-track">
          {email.news.map((news,newsIndex)=>
            <button type="button" className={"bento-news bento-"+(newsIndex%5)} key={news.url||news.title+newsIndex} onClick={()=>openReader(emailIndex,newsIndex)}>
              <div className="bento-image"><img src={"/api/news-image?url="+encodeURIComponent(news.url||"")} alt={news.imageAlt||""} loading="lazy" onError={(e)=>{e.currentTarget.style.display="none";const p=e.currentTarget.nextElementSibling as HTMLElement|null;if(p)p.hidden=false}}/><div className="image-placeholder" hidden><span>N</span></div></div>
              <div className="bento-copy">{news.section&&<div className="section-label">{news.section}</div>}<h2>{news.title}</h2>{news.body&&<p>{news.body}</p>}</div>
              <div className="bento-open">読む <span>›</span></div>
            </button>
          )}
        </div></div>
        <div className="swipe-hint">← 横にスワイプ →</div>
      </section>
    )}</div>}

    {reader&&<div className="reader-overlay" role="dialog" aria-modal="true">
      <header className="safari-reader-bar"><button type="button" className="reader-back" onClick={()=>setReader(null)}>‹ <span>一覧</span></button><div className="reader-controls"><button type="button" onClick={()=>setFontScale(v=>Math.max(.9,v-.1))}>A−</button><span>NEWS READER</span><button type="button" onClick={()=>setFontScale(v=>Math.min(1.3,v+.1))}>A＋</button></div></header>
      <div className="reader-nav"><button type="button" onClick={()=>moveReader(-1)} disabled={reader.newsIndex===0}>‹ 前の記事</button><span>{reader.newsIndex+1} / {emails[reader.emailIndex]?.news.length||0}</span><button type="button" onClick={()=>moveReader(1)} disabled={reader.newsIndex===(emails[reader.emailIndex]?.news.length||1)-1}>次の記事 ›</button></div>
      <article className="safari-reader">
        <div className="reader-source">{emails[reader.emailIndex]?.kind} · {formatDate(emails[reader.emailIndex]?.receivedAt||"")}</div>
        {reader.data?.imageUrl&&<img className="reader-hero" src={reader.data.imageUrl} alt=""/>}
        <h1>{reader.data?.title||emails[reader.emailIndex]?.news[reader.newsIndex]?.title}</h1>
        {readerLoading?<div className="reader-loading">記事を読み込んでいます…</div>:reader.data?.contentHtml?<div className="article-content" style={{fontSize:fontScale+"em"}} dangerouslySetInnerHTML={{__html:reader.data.contentHtml}}/>:<div className="reader-unavailable"><p>このニュースのメール本文を表示しています。</p><p>{emails[reader.emailIndex]?.news[reader.newsIndex]?.body||"本文を取得できませんでした。"}</p></div>}
        {emails[reader.emailIndex]?.news[reader.newsIndex]?.url&&<a className="original-link" href={emails[reader.emailIndex].news[reader.newsIndex].url} target="_blank" rel="noreferrer">日経電子版で読む ↗</a>}
      </article>
    </div>}
  </main>;
}

function formatDate(value:string){
  if(!value)return "";
  const d=new Date(value);
  if(Number.isNaN(d.getTime()))return value;
  return new Intl.DateTimeFormat("ja-JP",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"}).format(d);
}
