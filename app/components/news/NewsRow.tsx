"use client";
import type { Email, News } from "@/lib/news/types";
import { cleanNewsTitle, tinySummary, titleTag, timeOf, stars } from "@/lib/news/ui";
export function NewsRow({email,news,newsIndex,openReader}:{email:Email;news:News;newsIndex:number;openReader:(email:Email,newsIndex:number)=>void}) {
 const n=news.importanceStars||1; const tag=titleTag(news.title);
 return <article className={"timeline-item stars-"+n} key={(news.id||email.id)+":"+newsIndex}>
  <time>{timeOf(news.publishedAt||email.internalDate)}</time><div className="timeline-rail"><span /></div>
  <button className={"timeline-main stars-"+n} onClick={()=>openReader(email,newsIndex)}>
   <div className="timeline-title-row"><div className="timeline-title">{cleanNewsTitle(news.title)}</div>{tag&&<span className="title-tag">{tag}</span>}</div>
   {(news.trendBadges||[]).length>0&&<div className="trend-badges" aria-label="注目指標">{(news.trendBadges||[]).map(b=>b==="google"?<span className="signal-icon signal-google" title="Google上位" aria-label="Google上位" key={b}>G</span>:b==="yahoo"?<span className="signal-icon signal-yahoo" title="Yahoo!上位" aria-label="Yahoo!上位" key={b}>Y</span>:b==="coverage"?<span className="signal-icon signal-coverage" title="報道多数" aria-label="報道多数" key={b}>▤</span>:null)}</div>}
   {n>=3&&<div className="timeline-summary">{tinySummary(news.body,news.title)}</div>}
  </button>
  <div className="timeline-meta"><div className="timeline-source">{news.source||email.from}</div><div className={"timeline-stars stars-display-"+n} aria-label={"重要度 "+n+" / 5"}>{stars(n)}</div></div>
 </article>;
}
