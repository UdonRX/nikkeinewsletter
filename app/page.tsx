"use client";
import {useEffect,useState} from "react";
type Email={id:string;subject:string;receivedAt:string;newsCount:number;news:any[]};
export default function Home(){const [emails,setEmails]=useState<Email[]>([]);const [error,setError]=useState("");
useEffect(()=>{fetch("/api/emails").then(async r=>{if(r.status===401)return;const j=await r.json();if(!r.ok)throw new Error(j.error||"error");setEmails(j.emails||[])}).catch(e=>setError(e.message))},[]);
return <main className="wrap"><h1>日経ニュースメール</h1>{!emails.length&&!error&&<div className="card"><p>Gmailに届いた日経ニュースメールを読み込む。</p><a className="btn" href="/api/auth/google">Googleで接続</a></div>}{error&&<div className="card">{error}</div>}{emails.map(e=><section className="card" key={e.id}><div className="meta">{e.receivedAt}</div><h2>{e.subject}</h2><div className="meta">{e.newsCount}件</div>{e.news.map((n:any)=><article className="news" key={n.index}><h2>{n.title}</h2>{n.body&&<p>{n.body}</p>}{n.url&&<a className="btn" href={n.url} target="_blank" rel="noreferrer">日経電子版で読む</a>}</article>)}</section>)}</main>}
