# Phase 2 Full 450 Rollout 実行手順

## 現在の状態

新規・変更されたGitHub ActionsはPR上で `action_required` となっており、ジョブが生成されていません。これはテスト失敗ではなく、ワークフロー実行前の外部承認待ちです。

## GitHub Actionsで実行する場合

1. PR #172 の Checks または Actions 画面を開く。
2. `Phase 2 Full 450 Rollout` の実行を承認する。
3. `validate-request` が成功することを確認する。
4. Batch 2〜10の9ジョブが最大3並列で実行されることを確認する。
5. 各バッチが50社・5ウェーブを出力することを確認する。
6. `aggregate-rollout` が450社の統合結果とレビューキューを1回だけコミットすることを確認する。
7. `automaticApprovalAllowed=false`、`deepVerificationApproved=0` を確認する。

## ローカルで実行する場合

Python 3.12を使用し、次を実行する。

```bash
python3 -m pip install requests beautifulsoup4 pypdf
bash scripts/run_phase2_full_rollout_local_v1.sh
```

途中から再開する場合は環境変数を指定する。

```bash
START_BATCH=4 START_WAVE=3 bash scripts/run_phase2_full_rollout_local_v1.sh
```

各ウェーブ完了後に `operations/quality-rebase/phase2/local-checkpoints/` へチェックポイントが作られる。失敗した企業があってもウェーブ全体を止めず、失敗理由を個別パケットへ保存する。

## 実行後の確認

- `operations/quality-rebase/phase2/bulk-collection/full-rollout-summary.json`
- `operations/quality-rebase/phase2/review-queue-v1.json`
- `operations/quality-rebase/phase2/review-work-items/`
- `operations/quality-rebase/phase2/local-full-rollout-summary-v1.json`（ローカル実行時）

一次レビュー、独立再確認、公開後リンク・表示検査が完了するまで最高品質承認を付与しない。
