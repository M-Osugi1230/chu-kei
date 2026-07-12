# GitHub Actions 復旧手順 v1

## 現象

Chu-keiのpull requestで、すべてのworkflowが次の状態で終了している。

- jobは作成される
- `status=completed`
- `conclusion=failure`
- step一覧が存在しない
- job logが存在しない
- `if: always()`のartifactも生成されない
- failed jobを再実行しても同じ

これはNodeスクリプトや個別workflowのstepが実行されて失敗した状態ではない。

## 確認済み

- リポジトリはprivate
- 接続ユーザーはadmin / maintain / push権限を持つ
- 個別workflowだけでなく15本前後が同時に失敗
- 新規の最小validatorでもstep開始前に失敗

証跡は `operations/ci/actions-blocker-v1.json` とIssue #45に保存する。

## 最優先確認: Billing

privateリポジトリのGitHub-hosted runnerはアカウントのActions利用枠を消費する。無料枠を使い切り、有効な支払方法がない場合は利用がブロックされる。支払方法があっても、予算・spending limitで停止する場合がある。

1. GitHub右上のプロフィール画像を開く
2. **Settings** を開く
3. **Billing and licensing** を開く
4. **Usage** または **Metered usage** でGitHub Actionsの利用状況を確認
5. **Budgets and alerts** でActionsの予算が0または上限到達になっていないか確認
6. **Payment information** で有効な支払方法を確認
7. 必要な場合のみ、低額のActions予算を設定する

## Repository Actions設定

1. `M-Osugi1230/chu-kei`を開く
2. **Settings**
3. **Actions**
4. **General**
5. Actions permissionsがworkflow実行を許可していることを確認
6. Workflow permissionsは原則 **Read repository contents permission** を維持し、書込が必要なworkflowだけ明示的な`permissions`を使用

## 復旧確認

設定変更後、次の順で確認する。

1. Issue #45に変更内容を記録
2. PR #50等の軽量な`Chu-kei Research Platform v2`のfailed jobsを再実行
3. jobに`Checkout`などのstepが表示されることを確認
4. logが取得できることを確認
5. `Chu-kei Research Platform v2`が完走することを確認
6. PR #42の3workflowを再実行
7. Apply Structured Expansion Batch 04が正本bundleをbranchへcommitすることを確認
8. 最新head SHAですべての品質ゲートを再実行

## Actions停止中のローカル検証

Node.js 20以上を使用する。

```bash
npm run quality:local:quick
```

quickでは次を実行する。

- Research Platform v2契約
- 品質負債予算
- 品質ダッシュボード
- 主要JavaScript構文

完全検証は次を使用する。

```bash
npm run quality:local
```

結果は `artifacts/local-quality-gate-v1.json` に保存される。

## 復旧後

- Actionsを品質の正本へ戻す
- ローカル検証は開発前・commit前の早期検知として残す
- Issue #45をcloseする
- 公開同期Issue #49を進める
