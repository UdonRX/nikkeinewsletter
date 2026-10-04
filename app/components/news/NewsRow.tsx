"use client";
import type { Email, News } from "@/lib/news/types";
import { cleanNewsTitle, tinySummary, titleTag, timeOf, stars } from "@/lib/news/ui";
export function NewsRow({email,news,newsIndex,openReader}:{email:Email;news:News;newsIndex:number;openReader:(email:Email,newsIndex:number)=>void}) {
 const n=news.importanceStars||1; const tag=titleTag(news.title);
 return <article className={"timeline-item stars-"+n} key={(news.id||email.id)+":"+newsIndex}>
  <time>{timeOf(news.publishedAt||email.internalDate)}</time><div className="timeline-rail"><span /></div>
  <button className={"timeline-main stars-"+n} onClick={()=>openReader(email,newsIndex)}>
   <div className="timeline-title-row"><div className="timeline-title">{cleanNewsTitle(news.title)}</div>{tag&&<span className="title-tag">{tag}</span>}</div>
   {n>=4&&<div className="trend-badges">{(news.trendBadges||[]).map(b=><span key={b}>{b}</span>)}</div>}
   {n>=3&&<div className="timeline-summary">{tinySummary(news.body,news.title)}</div>}
  </button>
  <div className="timeline-meta"><div className="timeline-source">{news.source||email.from}</div><div className={"timeline-stars stars-display-"+n} aria-label={"重要度 "+n+" / 5"}>{n>=4?stars(n):n===3?"★3":"★"+n}</div></div>
 </article>;
}
