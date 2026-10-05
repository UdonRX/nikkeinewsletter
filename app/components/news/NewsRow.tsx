"use client";

import { useMemo, useState } from "react";
import type { Email, News } from "@/lib/news/types";
import { cleanNewsTitle, tinySummary } from "@/lib/news/ui";

function dateTimeOf(value?:string){
  if(!value)return "--/-- --:--";
  const d=new Date(value);
  if(Number.isNaN(d.getTime()))return "--/-- --:--";
  return new Intl.DateTimeFormat("ja-JP",{
    timeZone:"Asia/Tokyo",
    year:"numeric",
    month:"2-digit",
    day:"2-digit",
    hour:"2-digit",
    minute:"2-digit",
    hour12:false
  }).format(d).replace(/-/g,"/");
}

function importanceValue(news:News){
  return Math.max(1,Math.min(5,news.importanceStars||1));
}

export function NewsRow({
  email,
  news,
  newsIndex,
  openReader
}:{
  email:Email;
  news:News;
  newsIndex:number;
  openReader:(email:Email,newsIndex:number)=>void;
}){
  const [expanded,setExpanded]=useState(false);
  const [article,setArticle]=useState<{imageUrl?:string;contentHtml?:string;source?:string}|null>(null);
  const [articleLoading,setArticleLoading]=useState(false);
  const n=importanceValue(news);
  const title=cleanNewsTitle(news.title);
  const publishedAt=news.publishedAt||email.internalDate;
  const dateLabel=useMemo(()=>dateTimeOf(publishedAt),[publishedAt]);
  const source=news.source||email.from||"ニュース";
  const summary=tinySummary(article?.contentHtml ? article.contentHtml.replace(/<[^>]+>/g," ") : news.body,news.title);

  async function toggleExpanded(){
    const next=!expanded;
    setExpanded(next);
    if(!next || article || !news.url || articleLoading)return;
    setArticleLoading(true);
    try{
      const params=new URLSearchParams({url:news.url,title:news.title,body:news.body||""});
      const response=await fetch("/api/article?"+params.toString(),{cache:"no-store"});
      const data=await response.json().catch(()=>null);
      if(response.ok&&data)setArticle(data);
    }catch{}finally{setArticleLoading(false);}
  }

  return <article className={"timeline-item importance-"+n+(expanded?" is-expanded":"")}>
    <div className="timeline-node" aria-hidden="true"><span/></div>

    <div className="timeline-card-wrap">
      <button
        type="button"
        className="timeline-card-trigger"
        aria-expanded={expanded}
        onClick={toggleExpanded}
      >
        <span className="timeline-card-top">
          <span className="timeline-card-title">{title}</span>
          <span className="timeline-card-chevron" aria-hidden="true">{expanded?"−":"＋"}</span>
        </span>
        <span className="timeline-card-meta">
          <time dateTime={publishedAt}>{dateLabel}</time>
          <span className="timeline-card-source">{source}</span>
        </span>
        <span className="importance-bar" aria-label={"重要度 "+n+" / 5"}>
          <span style={{width:(n/5)*100+"%"}}/>
        </span>
      </button>

      <div className="timeline-card-expand">
        <div className="timeline-card-expand-inner">
          <div className="timeline-expanded-body">
            {news.imageUrl&&
              <img
                className="timeline-thumbnail"
                src={news.imageUrl}
                alt={news.imageAlt||""}
                loading="lazy"
              />
            }
            <div className="timeline-expanded-copy">
              <div className="timeline-expanded-source">{article?.source||source}</div>
              {articleLoading?<p>記事を読み込んでいます…</p>:summary&&<p>{summary}</p>}
              {news.body&&news.body.trim().length>summary.length&&
                <p className="timeline-expanded-detail">{news.body}</p>
              }
            </div>
          </div>

          <div className="timeline-expanded-actions">
            <button type="button" className="timeline-read-button" onClick={()=>openReader(email,newsIndex)}>
              記事を読む
            </button>
            {news.url&&<a href={news.url} target="_blank" rel="noreferrer" onClick={event=>event.stopPropagation()}>元記事 ↗</a>}
          </div>
        </div>
      </div>
    </div>
  </article>;
}
