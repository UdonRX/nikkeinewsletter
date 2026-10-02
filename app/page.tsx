"use client";

import { useEffect, useMemo, useState } from "react";

type News = {
  id?: string;
  title: string;
  body: string;
  url?: string;
  index: number;
  imageUrl?: string;
  imageAlt?: string;
  source?: string;
  category?: string;
  tags?: string[];
  importanceScore?: number;
  trendScore?: number;
  importanceStars?: number;
  publishedAt?: string;
};

type Email = {
  id: string;
  subject: string;
  receivedAt: string;
  internalDate: string;
  issueDate?: string;
  kind: "朝刊" | "昼刊" | "夕刊" | "速報";
  from: string;
  newsCount: number;
  news: News[];
};

type ReaderData = {
  title: string;
  imageUrl?: string;
  contentHtml: string;
  url: string;
  available: boolean;
  paywalled?: boolean;
  source?: string;
};

function dateKey(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const p = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  return `${p.find(x => x.type === "year")?.value}-${p.find(x => x.type === "month")?.value}-${p.find(x => x.type === "day")?.value}`;
}

function displayDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "long", day: "numeric", weekday: "short" }).format(d);
}

function timeOf(value?: string) {
  if (!value) return "--:--";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "--:--";
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}

function stars(count = 1) {
  const n = Math.max(1, Math.min(5, count));
  return "★".repeat(n) + "☆".repeat(5 - n);
}

function shortSummary(body: string, title: string) {
  const text = (body || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return title.length > 28 ? title.slice(0, 28) + "…" : title;
  return text.length > 30 ? text.slice(0, 30) + "…" : text;
}

export default function Home() {
  const [emails, setEmails] = useState<Email[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [saved, setSaved] = useState<Array<{ emailId: string; newsIndex: number }>>([]);
  const [savedOnly, setSavedOnly] = useState(false);
  const [gmailConnected, setGmailConnected] = useState(false);
  const [reader, setReader] = useState<{ emailId: string; newsIndex: number; data?: ReaderData } | null>(null);
  const [fontScale, setFontScale] = useState(1);
  const [shorts, setShorts] = useState<{ items: Array<{ email: Email; news: News; newsIndex: number }>; index: number } | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("nn_saved_news");
      if (raw) setSaved(JSON.parse(raw));
    } catch {}
    if (typeof window !== "undefined") setGmailConnected(new URLSearchParams(window.location.search).get("connected") === "1");
  }, []);

  useEffect(() => { localStorage.setItem("nn_saved_news", JSON.stringify(saved)); }, [saved]);

  useEffect(() => {
    fetch("/api/emails", { cache: "no-store" })
      .then(async r => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || "ニュースを取得できませんでした");
        setEmails(data.emails || []);
      })
      .catch(e => setError(e instanceof Error ? e.message : "ニュースを取得できませんでした"))
      .finally(() => setLoading(false));
  }, []);

  const timeline = useMemo(() => {
    const rows: Array<{ email: Email; news: News; newsIndex: number }> = [];
    for (const email of emails) email.news.forEach((news, newsIndex) => rows.push({ email, news, newsIndex }));
    rows.sort((a, b) => new Date(b.news.publishedAt || b.email.internalDate).getTime() - new Date(a.news.publishedAt || a.email.internalDate).getTime());
    return rows;
  }, [emails]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return timeline.filter(item => {
      if (savedOnly && !saved.some(s => s.emailId === item.email.id && s.newsIndex === item.newsIndex)) return false;
      if (!q) return true;
      return [item.news.title, item.news.body, item.news.source, item.news.category].join(" ").toLowerCase().includes(q);
    });
  }, [timeline, query, savedOnly, saved]);

  const groups = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const item of filtered) {
      const key = dateKey(item.news.publishedAt || item.email.internalDate);
      const list = map.get(key) || [];
      list.push(item);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [filtered]);

  function isSaved(emailId: string, newsIndex: number) {
    return saved.some(s => s.emailId === emailId && s.newsIndex === newsIndex);
  }

  function toggleSaved(email: Email, newsIndex: number) {
    setSaved(current => isSaved(email.id, newsIndex)
      ? current.filter(s => !(s.emailId === email.id && s.newsIndex === newsIndex))
      : [...current, { emailId: email.id, newsIndex }]);
  }

  async function openReader(email: Email, newsIndex: number) {
    const news = email.news[newsIndex];
    if (!news) return;
    setReader({ emailId: email.id, newsIndex });
    setFontScale(1);
    try {
      const params = new URLSearchParams({ url: news.url || "", title: news.title, body: news.body || "" });
      const r = await fetch("/api/article?" + params.toString(), { cache: "no-store" });
      const data = await r.json();
      if (r.ok) setReader(current => current ? { ...current, data } : current);
    } catch {}
  }

  function openShorts() {
    if (filtered.length) setShorts({ items: filtered, index: 0 });
  }

  if (loading) return <main className="app-shell"><div className="loading">ニュースを読み込んでいます…</div></main>;

  if (error) return <main className="app-shell"><section className="error-panel"><div className="eyebrow">NEWS READER</div><h1>ニュース</h1><p>{error}</p></section></main>;

  if (reader) {
    const email = emails.find(e => e.id === reader.emailId);
    const news = email?.news[reader.newsIndex];
    return (
      <main className="app-shell reader-shell">
        <div className="reader-overlay">
          <header className="reader-bar">
            <button onClick={() => setReader(null)}>‹ 戻る</button>
            <span>NEWS READER</span>
            <div className="reader-font"><button onClick={() => setFontScale(v => Math.max(.9, v - .1))}>A−</button><button onClick={() => setFontScale(v => Math.min(1.3, v + .1))}>A＋</button></div>
          </header>
          <article className="reader-article">
            {reader.data?.imageUrl && <img className="reader-hero" src={reader.data.imageUrl} alt="" />}
            <div className="reader-source">{reader.data?.source || news?.source || "ニュース"}</div>
            <h1>{reader.data?.title || news?.title}</h1>
            {reader.data?.contentHtml ? <div className="article-content" style={{ fontSize: fontScale + "em" }} dangerouslySetInnerHTML={{ __html: reader.data.contentHtml }} /> : <p className="reader-unavailable">{news?.body || "本文を取得できませんでした。"}</p>}
            {reader.data?.paywalled && <div className="paywall-notice"><strong>ここから先は有料会員限定</strong><p>続きは日経の有料会員向けページで読むことができます。</p></div>}
          </article>
        </div>
      </main>
    );
  }

  if (shorts) {
    const item = shorts.items[shorts.index];
    return (
      <main className="app-shell shorts-shell">
        <header className="shorts-bar">
          <button onClick={() => setShorts(null)}>‹</button>
          <strong>ニュース Shorts</strong>
          <span>{shorts.index + 1} / {shorts.items.length}</span>
        </header>
        <div className="short-progress"><span style={{ width: ((shorts.index + 1) / shorts.items.length) * 100 + "%" }} /></div>
        <article className="short-card">
          {item.news.imageUrl && <img src={item.news.imageUrl} alt="" />}
          <div className="short-meta">{item.news.source || item.email.from}<span>{stars(item.news.importanceStars)}</span></div>
          <h1>{item.news.title}</h1>
          <p>{shortSummary(item.news.body, item.news.title)}</p>
          <button className="read-button" onClick={() => openReader(item.email, item.newsIndex)}>記事を読む</button>
        </article>
        <div className="short-nav"><button disabled={shorts.index === 0} onClick={() => setShorts({ ...shorts, index: shorts.index - 1 })}>↑ 前へ</button><button disabled={shorts.index === shorts.items.length - 1} onClick={() => setShorts({ ...shorts, index: shorts.index + 1 })}>次へ ↓</button></div>
      </main>
    );
  }

  return (
    <main className="app-shell timeline-shell">
      <header className="timeline-header">
        <div><div className="eyebrow">NEWS READER</div><h1>ニュース</h1></div>
        <button className="gmail-button" onClick={() => { window.location.href = "/api/auth/google"; }}>{gmailConnected ? "Gmail接続済み" : "日経メールを接続"}</button>
      </header>

      <div className="timeline-tools">
        <div className="search-wrap"><span>⌕</span><input value={query} onChange={e => setQuery(e.target.value)} placeholder="ニュースを検索" /></div>
        <div className="tool-actions">
          <button className={savedOnly ? "active" : ""} onClick={() => setSavedOnly(v => !v)}>保存 {saved.length}</button>
          <button onClick={openShorts}>Shorts</button>
        </div>
      </div>

      <div className="timeline-count">{filtered.length.toLocaleString("ja-JP")} 件</div>

      <section className="timeline-list">
        {groups.map(([key, items]) => (
          <div className="timeline-day" key={key}>
            <div className="timeline-date-heading">{displayDate(items[0].news.publishedAt || items[0].email.internalDate)}</div>
            {items.map(({ email, news, newsIndex }) => {
              const starCount = news.importanceStars || 1;
              return (
                <article className={"timeline-item stars-" + starCount} key={(news.id || email.id) + ":" + newsIndex}>
                  <time>{timeOf(news.publishedAt || email.internalDate)}</time>
                  <div className="timeline-rail"><span /></div>
                  <button className="timeline-title" onClick={() => openReader(email, newsIndex)}>{news.title}</button>
                  <div className="timeline-detail">
                    <div className="timeline-summary">{shortSummary(news.body, news.title)}</div>
                    <div className="timeline-source">{news.source || email.from}</div>
                    <div className="timeline-stars" aria-label={"重要度 " + starCount + " / 5"}>{stars(starCount)}</div>
                  </div>
                  <button className={"save-button " + (isSaved(email.id, newsIndex) ? "saved" : "")} aria-label="保存" onClick={() => toggleSaved(email, newsIndex)}>{isSaved(email.id, newsIndex) ? "♥" : "♡"}</button>
                </article>
              );
            })}
          </div>
        ))}
        {!filtered.length && <div className="empty-state">該当するニュースがありません。</div>}
      </section>

      <footer className="timeline-footer">AFPBB · FNN · マイナビニュース · ITmedia · 日経メール</footer>
    </main>
  );
}
