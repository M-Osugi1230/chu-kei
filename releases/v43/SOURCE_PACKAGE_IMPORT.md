# v43 Source Package Import

この文書は、Chu-kei v43の静的サイト本体と運用データを、生成済みZIPからリポジトリへ安全に取り込む手順を定める。

## 対象パッケージ

```text
chukei_570_company_quality_hardened_v43.zip
chukei_570_company_quality_operations_v43.zip
```

## 期待するSHA-256

```text
ce7662cd84b992379949e7cb5da7215cec862fd57794b9cc162a21e226efc129  chukei_570_company_quality_hardened_v43.zip
111745b17c1972d347710f948c1e2233cef8b9b1923e13a3bc21e3ef2c1d7d1a  chukei_570_company_quality_operations_v43.zip
```

## 取り込み方針

- 公開用静的サイトはリポジトリ直下へ配置する。
- 品質監査・運用資料は `operations/` または既存の `data/`・`reports/` 配下へ整理する。
- ZIPファイルそのものは原則としてGit管理せず、展開したテキスト資産を管理する。
- 一時ファイル、ブラウザキャッシュ、OSメタデータは含めない。
- APIキー、メール認証情報、Netlifyトークンなどの秘密情報は絶対にコミットしない。

## ローカル手順

```bash
set -euo pipefail

PUBLIC_ZIP="chukei_570_company_quality_hardened_v43.zip"
OPS_ZIP="chukei_570_company_quality_operations_v43.zip"

printf '%s  %s\n' \
  'ce7662cd84b992379949e7cb5da7215cec862fd57794b9cc162a21e226efc129' \
  "$PUBLIC_ZIP" | shasum -a 256 -c -

printf '%s  %s\n' \
  '111745b17c1972d347710f948c1e2233cef8b9b1923e13a3bc21e3ef2c1d7d1a' \
  "$OPS_ZIP" | shasum -a 256 -c -

rm -rf .import-v43
mkdir -p .import-v43/public .import-v43/operations
unzip -q "$PUBLIC_ZIP" -d .import-v43/public
unzip -q "$OPS_ZIP" -d .import-v43/operations

find .import-v43 -name '.DS_Store' -delete
find .import-v43 -type f | sort
```

## 取り込み前の確認

1. `index.html`、CSS、JavaScript、manifest、robots、404、Netlify設定が存在する。
2. JSONがすべて構文エラーなく読み込める。
3. 会社総数が570社である。
4. 本番30社、詳細抽出済みβ70社、一次確認β100社、カバレッジβ370社である。
5. 資料公表日とソース確認日が別フィールドである。
6. 秘密情報・個人情報が含まれていない。
7. `reports/v43/` のQA結果と矛盾しない。

## コミット例

```bash
git checkout -b release/import-v43-source

rsync -a --delete \
  --exclude '.git' \
  --exclude '.DS_Store' \
  .import-v43/public/ ./

mkdir -p operations/v43
rsync -a --delete \
  --exclude '.DS_Store' \
  .import-v43/operations/ operations/v43/

git add .
git status --short
git commit -m 'release: import Chu-kei v43 site and operations artifacts'
git push -u origin release/import-v43-source
```

## 完了条件

- 静的サイト本体がGitHub上で復元可能である。
- v43の全QAを再実行し、失敗がない。
- Netlifyの公開ディレクトリがリポジトリ構成と一致する。
- READMEとリリースマニフェストの記載が実体と一致する。
