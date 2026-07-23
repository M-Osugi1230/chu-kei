# Chu-kei 公開ランブック 2026-07-24

## 目的

3,000社の本番品質データ、公開ページ、問い合わせ受付、検索エンジン向け設定を一つの公開リリースとして反映し、公開後の確認結果を正本へ記録する。

## 公開対象

- 公開URL: `https://chukei-insight.osugimurata.chatgpt.site/`
- GitHub正本: `M-Osugi1230/chu-kei`
- 公開ディレクトリ: `site/`
- 掲載企業: 3,000社
- 本番品質: 3,000社
- Coverageβ: 0社
- 受付フォーム:
  - `general-inquiry`
  - `spot-report-request`
  - `product-waitlist`

## コード側で完了する項目

1. `site/sitemap.xml`を追加する。
2. `site/robots.txt`からサイトマップを案内する。
3. `site/contact.html`へ一般問い合わせフォームを追加する。
4. 運営者を「Chu-kei事務局」と表示する。
5. 個人名と個人メールアドレスを公開しない。
6. 問い合わせ、調査依頼、先行登録を別フォームとして収集する。
7. ハニーポットを各フォームへ設定する。
8. 公開同期台帳を3,000社の現状へ更新する。
9. クリーンURL用のNetlify redirectを追加する。
10. 品質、検索、ブラウザ、アクセシビリティ、性能、リリースゲートを通す。

## Production deploy後の確認

### 表示とデータ

- [ ] 公開URLがHTTP 200で表示される。
- [ ] トップに3,000社が表示される。
- [ ] 企業検索、詳細表示、保存、比較が動作する。
- [ ] 390px幅で横スクロールや操作不能がない。
- [ ] `quality.html`、`history.html`、`release.html`、`reports.html`、`pricing.html`、`contact.html`、`privacy.html`へ遷移できる。
- [ ] `robots.txt`と`sitemap.xml`がHTTP 200で取得できる。

### フォーム

- [ ] Netlify Formsに3フォームが検出される。
- [ ] 通知先を運営者メールアドレスへ設定する。
- [ ] フォームごとのメール通知を有効化する。
- [ ] スパムフィルターとハニーポットが有効である。
- [ ] 3フォームを1件ずつテスト送信する。
- [ ] Netlify管理画面に記録される。
- [ ] 運営者メールへ通知される。
- [ ] 送信後に`thanks.html`へ遷移する。

### 検索エンジン

- [ ] Google Search ConsoleにURLプレフィックスまたはドメインプロパティを登録する。
- [ ] `sitemap.xml`を送信する。
- [ ] トップページをURL検査し、インデックス登録をリクエストする。
- [ ] `robots.txt`がクロールを拒否していないことを確認する。
- [ ] 必要に応じてBing Webmaster Toolsにもサイトマップを送信する。

## 公開完了の記録

公開確認後、次を更新する。

- `operations/site-sync/current.json`
- `site/data/release-status.json`
- `verifiedAt`
- Production deployが配信するmain SHA
- `verificationStatus: verified`
- `sync.status: synced`
- `sync.label: 公開同期済み`
- 未完了項目がなければ`sync.pending: []`

## 公開中止条件

次のいずれかがあれば同期済みと記録しない。

- 3,000社データを読み込めない。
- 主要ページが404になる。
- 企業検索または詳細表示が動作しない。
- フォーム送信が保存されない。
- 通知先が設定されていない。
- 個人名または個人メールアドレスが公開されている。
- robots.txtがクロールを拒否している。
- 品質ゲート、Browser E2E、アクセシビリティ・性能ゲートが失敗している。
