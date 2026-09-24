# nikkeinewsletter

Google OAuth → Gmail API → Vercel/Next.js → 日経ニュースメール解析 → PWA。

## 現在実装済み

- Google OAuth 2.0 Authorization Code flow
- Gmail API `gmail.readonly`
- `from:(@mx.nikkei.com)` で最新30通を取得
- MIME multipartからHTMLを優先、text/plainをフォールバック
- URL・タイトル・周辺本文を抽出する保険型パーサー
- Gmailのメールを既読化しない
- iPhone向けの最小ニュース一覧画面

## OAuth環境変数

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `SESSION_SECRET`

Scope:

`https://www.googleapis.com/auth/gmail.readonly`

Redirect URI:

`https://<Vercelドメイン>/api/auth/google/callback`

## 日経メール解析について

日経公式の公開情報から、ニュースメールの配信元ドメインが `mx.nikkei.com` であること、日経ニュースメールが主要ニュースをまとめて配信するサービスであることは確認できる。

ただし、**ユーザー個人のGmailに届いている「日経ニュースメール1通」の生HTMLは、このGitHub実装環境から直接取得できない**。そのため現時点では、DOMセレクタを特定のHTML構造に固定せず、

1. HTMLメールを取得
2. script/style/form等を除去
3. nikkei.comへのリンクを候補化
4. リンク文字列をタイトル候補にする
5. その親要素の周辺テキストを本文候補にする
6. 重複・フッター・解除リンク等を除外
7. HTMLが無ければtext/plainからURL前後を解析

という方式を実装している。

**実物1通のHTMLを確認できた時点で、記事ブロックの境界・タイトル・本文・URLのセレクタを固定し、テストfixtureを追加する。**

## Google Cloud側

1. Google Cloud Projectを作成
2. Gmail APIを有効化
3. OAuth consent screenを設定
4. Externalの場合、TestingのTest Userに自分のGmailを追加
5. Gmail readonly scopeを追加
6. Web applicationのOAuth Client IDを作成
7. Authorized redirect URIに上記Redirect URIを登録

`gmail.readonly` はGoogleのRestricted scopeなので、公開運用ではGoogleのOAuth verification/security assessment要件を確認する。

## 注意

- Google Client SecretをGitHubに入れない
- OAuth tokenをGitHubに入れない
- raw email HTMLをそのままdangerouslySetInnerHTMLで表示しない
- Gmail側の既読状態は変更しない


## 9/24昼版サンプルで確定した解析ルール

添付された「9/24 昼版」の実物サンプルを基準に、メールを次の単位で扱う。

- 「注目ニュース」「特報」「マーケット」「ニュース解説」「連載・コラム」「Visual & Podcast」「セクション」以下の各カテゴリ名は記事ではない。
- HTMLでは `nikkei.com` の記事リンク1本を1ニュースとして扱う。
- リンク文字列をタイトルにする。
- リンクの近くにある同一ブロックの文章を本文候補にする。
- 「特報」などのラベルは本文から除外する。
- 同じURL＋タイトルは1件にまとめる。
- URLが取れないtext/plainではタイトルだけを保持し、本文・URLは無理に捏造しない。

添付サンプルでは、先頭の「ホンダが米国にHV新工場…」に続いて本文があり、その後の「習氏に3つの対米カード…」「メタ、眼鏡に独自AI…」などは見出しだけが連続している構造が確認できる。\n
そのため、**本文が存在しないニュースに別ニュースの文章を本文として誤結合しない**ことを優先する。
