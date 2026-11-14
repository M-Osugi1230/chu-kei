# Chu-kei 公開前フォーム受信ゲート（2026-11-14）

## 背景

GitHubの静的サイト `site/` には Netlify Forms 形式の3フォームが存在する。

- `general-inquiry`（問い合わせ）
- `spot-report-request`（スポット調査）
- `product-waitlist`（先行登録）

現時点の公開候補 `https://chukei-insight.osugimurata.chatgpt.site/` は ChatGPT Sites であり、Netlify Forms が受信処理を行う証拠はない。静的な `action="/thanks.html"` は受信を保証しない。フォームが表示されたままでは、利用者が個人情報を入力した後、運営側へ届かないリスクがある。

## 安全仕様

- 3フォームは HTML の `hidden` 属性で**最初から非表示**にする（JavaScript無効時も送信不可）。
- 未検証時は「受付環境の確認中につき、フォームからの送信は一時停止しています」と表示する。
- `site/assets/forms-availability.js` が、サイトと同じOriginから `site/data/forms-availability-v1.json` を取得する。
- `status=verified`、`provider=netlify-forms`、`verifiedOrigin=location.origin`、有効な `verifiedAt`、非空の `verificationEvidence`、各フォーム名が `verifiedFormNames` に含まれる場合に限り当該フォームを表示する。
- 設定ファイル不在、HTTP失敗、Origin不一致、未確認フォームは**非表示を維持**する。
- フォームの有効化をGitHubのCI成功だけで判断しない。運営者が実際の受信・通知を検証する。

## 有効化までの作業

1. 本番公開先の所有者・管理者・公開URLを確認する。
2. Netlify Formsを使用する場合、本番ドメインに配信される `site/` を確認する。ChatGPT Sitesなど、Netlifyの受信基盤が使えない環境で有効化しない。
3. Netlify管理画面で上記3フォームの検出と通知設定を確認する。
4. ダミーのテスト内容を各フォームへ送信し、受信記録・通知・送信後画面を実測する。**実在顧客情報は使用しない。**
5. 公開Origin（末尾スラッシュなし）、確認日時（ISO 8601）、受信証明の非機微な概要、受信できたフォーム名を `forms-availability-v1.json` に記録する。受信内容やメールアドレスはコミットしない。
6. GitHub PRの品質ゲート、Browser E2E、フォーム受信ゲートを確認する。
7. 公開後に各フォームを再テストし、最後に公開サイトの同一性監査を成功させる。
8. フォーム基盤が使えないホストで先行公開する場合、**フォームは停止したまま**情報閲覧・検索のみを公開し、外部受付への切り替えは別途実装・検証する。

## 公開の判定

- 3,686社（その時点のJPX正本件数）の企業検索、詳細、比較の動作と出典表示は別途検証する。
- `PUBLIC_PARITY_VERIFIED` が得られない場合、GitHubへのマージだけで既存公開サイトが更新されたとは記録しない。
- フォーム未検証は、**フォーム受付機能の公開ブロッカー**であり、フォームを停止した無料検索サイトの公開そのもののブロッカーとは分ける。
- Netlify以外でフォーム受付を提供する場合は、実際のバックエンドに合わせて実装を変更し、受信テストと安全ゲートを更新する。

関連：`docs/LIVE_DEPLOYMENT_PARITY_RUNBOOK.md`、`docs/COMMERCIAL_RELEASE_CHECKLIST_V1.md`、Issue #284。
