"use client";

import { useEffect, useMemo, useState } from "react";

type News = {
  title: string;
  body: string;
  url?: string;
  index: number;
  section?: string;
  imageUrl?: string;
  imageAlt?: string;
};

type Email = {
  id: string;
  subject: string;
  receivedAt: string;
  newsCount: number;
  news: News[];
};

export default function Home() {
  const [emails, setEmails] = useState<Email[]>([]);
  const [selected, setSelected] = useState<{ emailIndex: number; newsIndex: number } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/emails")
      .then(async (r) => {
        if (r.status === 401) return;
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "メールを取得できませんでした");
        setEmails(j.emails || []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "メールを取得できませんでした"))
      .finally(() => setLoading(false));
  }, []);

  const articles = useMemo(
    () =>
      emails.flatMap((email, emailIndex) =>
        email.news.map((news, newsIndex) => ({
          ...news,
          emailIndex,
          newsIndex,
          receivedAt: email.receivedAt,
        }))
      ),
    [emails]
  );

  const selectedArticle =
    selected === null
      ? null
      : articles.find(
          (a) => a.emailIndex === selected.emailIndex && a.newsIndex === selected.newsIndex
        ) || null;

  function openArticle(emailIndex: number, newsIndex: number) {
    setSelected({ emailIndex, newsIndex });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function closeReader() {
    setSelected(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (loading) {
    return (
      <main className="app-shell">
        <div className="loading">日経ニュースを読み込んでいます…</div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="app-shell">
        <div className="empty card">
          <h1>日経ニュースメール</h1>
          <p>{error}</p>
          <a className="btn" href="/api/auth/google">Googleで接続</a>
        </div>
      </main>
    );
  }

  if (!articles.length) {
    return (
      <main className="app-shell">
        <div className="empty card">
          <h1>日経ニュースメール</h1>
          <p>Gmailに届いた日経ニュースメールが見つかりません。</p>
          <a className="btn" href="/api/auth/google">Googleで接続</a>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">NIKKEI NEWS MAIL</div>
          <h1>日経ニュース</h1>
        </div>
        <div className="count">{articles.length}件</div>
      </header>

      <div className={selectedArticle ? "reader-layout has-reader" : "reader-layout"}>
        <section className="article-list" aria-label="ニュース一覧">
          <div className="list-header">
            <strong>最新ニュース</strong>
            <span>タップして読む</span>
          </div>

          {articles.map((article) => (
            <button
              type="button"
              className={
                selectedArticle &&
                selectedArticle.emailIndex === article.emailIndex &&
                selectedArticle.newsIndex === article.newsIndex
                  ? "article-row active"
                  : "article-row"
              }
              key={`${article.emailIndex}-${article.newsIndex}-${article.url || article.title}`}
              onClick={() => openArticle(article.emailIndex, article.newsIndex)}
            >
              <div className="thumb">
                {article.imageUrl ? (
                  <img src={article.imageUrl} alt="" loading="lazy" />
                ) : (
                  <div className="thumb-placeholder">N</div>
                )}
              </div>
              <div className="row-content">
                {article.section && <div className="section-label">{article.section}</div>}
                <h2>{article.title}</h2>
                <div className="row-meta">{formatDate(article.receivedAt)}</div>
              </div>
              <div className="chevron">›</div>
            </button>
          ))}
        </section>

        <section className={selectedArticle ? "reader open" : "reader"} aria-label="ニュース本文">
          {selectedArticle ? (
            <>
              <div className="reader-toolbar">
                <button type="button" className="back-button" onClick={closeReader}>
                  ‹ <span>一覧</span>
                </button>
                <span className="reader-label">NEWS READER</span>
              </div>

              {selectedArticle.imageUrl && (
                <div className="hero-image">
                  <img src={selectedArticle.imageUrl} alt={selectedArticle.imageAlt || ""} />
                </div>
              )}

              <article className="reader-article">
                {selectedArticle.section && (
                  <div className="reader-section">{selectedArticle.section}</div>
                )}
                <h2>{selectedArticle.title}</h2>
                <div className="reader-meta">{formatDate(selectedArticle.receivedAt)}</div>

                {selectedArticle.body ? (
                  <p className="reader-body">{selectedArticle.body}</p>
                ) : (
                  <p className="reader-body muted">
                    このニュースの概要はメールから取得できませんでした。
                  </p>
                )}

                {selectedArticle.url && (
                  <a
                    className="read-original"
                    href={selectedArticle.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    日経電子版で読む <span>↗</span>
                  </a>
                )}
              </article>
            </>
          ) : (
            <div className="reader-empty">
              <div className="reader-empty-icon">N</div>
              <h2>ニュースを選択</h2>
              <p>左の一覧から読みたいニュースをタップ。</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function formatDate(value: string) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}
