# Chu-kei 公開同期監査と本番判定（2026-11-14）

## 問題と確認できる範囲

GitHub 正本は 2026-11-13 取得の JPX 国内 Prime / Standard / Growth **3,686 社**で、正式中計判定は **374 社**、未判定は **3,312 社**である（最新値は必ず機械検証で読み直す）。`README.md` と `site/index.html` の `chu-kei.com` 表記、および `docs/LIVE_SITE_ALIGNMENT.md` の ChatGPT Sites URL は一致していない。

ChatGPT Sites 候補 URL は `https://chukei-insight.osugimurata.chatgpt.site/`。公開済み HTML と GitHub `site/index.html` の構造も異なる。**GitHub Actions の品質ゲートが成功しても公開反映済みとは判断しない。** `chu-kei.com` は所有権・ドメイン連携が未確認であり、公開先として自動利用しない。

## 自動検査

- 正本: `operations/universe/current-universe-v1.json`、`operations/plan-detection/registry-v1.json`、`site/data/plan-detection-summary-v1.json`
- 公開用: `site/data/frontend/manifest.json`、`site/data/frontend/company-index.json.gz`、`site/index.html`
- 候補URL・権限境界: `operations/site-sync/deployment-targets-v1.json`
- チェッカー: `scripts/audit_live_deployment_parity_v1.mjs`
- GitHub Actions: `.github/workflows/live-deployment-parity.yml`

`npm run quality:live-parity:offline` は**ローカル整合性のみ**。`npm run quality:live-parity` は公開 HTML、マニフェスト、原本ハッシュ、Plan Detection 公開集計を比較し、一致しなければ非ゼロで終了する。機械的な公開判定は `PUBLIC_PARITY_VERIFIED` だけを成功とする。検査結果は `artifacts/live-deployment-parity-v1.json` に記録し、GitHub Actions のログと保存アーティファクトで確認する。

毎日07:35 JST相当の scheduled audit を設ける。未同期期間の失敗は公開作業が残っていることを示し、単なる監査失敗を隠すためにチェックを緩めない。

## 公開作業の安全な手順

1. 公開先の所有者が ChatGPT Sites の管理画面で **対象サイトと公開URL、編集権限、現行バージョン**を確認する。GitHub 正本と別のプロジェクトであれば、別物として扱う。
2. GitHub `main` のサイトファイルと最新データ（`site/` ディレクトリ全体）を対象の Sites プロジェクトに取り込めるか、互換性を検証する。必要に応じて Work／Sites の編集・サイト読み込み機能を利用する。別途ホスティングを選ぶ場合はドメインと接続を事前に確定する。
3. **公開前**に最新 GitHub の `npm run quality:v43`、Browser E2E、全社シャード監査を成功させ、閲覧可能なプレビューを作る。
4. プレビューで3,686社（または公開時点の最新母集団）検索、Prime/Standard/Growth、銘柄コード英数字、詳細、モバイル表示、比較、出典リンク、未確認ラベルを検証する。
5. 権限を持つ公開管理者が既存の公開先へ更新版をデプロイする。GitHub `main` にコミットしただけでは ChatGPT Sites は更新されない。
6. デプロイ後に live parity audit とブラウザ手動確認を実行。**公開 URL・公開時刻・対象 SHA・manifest SHA・検査結果**を残す。公開サイトが構造上異なる場合は統一方法を確定し、検査を回避しない。
7. `chu-kei.com` の所有権が確認されるまで、現在のURL表記・canonicalタグ・ドメイン転送を独断で変更しない。

## ADE停止の扱い

`autonomous-development-engine` の `ade-chu-kei` ブランチでは `ckprod93-003` が `HUMAN_WAIT`、Jules session `4250658701944137917` の入力待ち。Jules 上の要求内容を正規の権限で確認し、必要なレビューや入力を行う。状態ファイルだけを書き換えて `HUMAN_WAIT` を強制解除しない。

## 完成の条件

- 主要3市場の現行上場企業が全て検索／詳細閲覧できる。
- 公開版の正本一致が監査成功で証明できる。
- 中計の確認状態、出典、未確認値、独立レビューが正しく分離されている。
- 自動更新後も同じ公開監査を継続できる。
- 中計判定率10%台であることを、「全社中計完了」と表示しない。すべての企業にDeep Verificationを一律に要求するのではなく、Universe Firstの完成基準と高品質企業レビューの進捗を分ける。
