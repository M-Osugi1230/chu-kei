# SNS 自動投稿（Threads）

Chu-kei Insight の告知投稿を、GitHub Actions から Threads 公式 API で自動投稿する仕組み。
実行経路に Muse を入れない構成（Notion リマインダーと同じ方針）。

## 対象と方針

- **Threads**: 公式 API（無料）で自動投稿する。本書の対象。
- **Instagram**: 将来、同じ Meta アプリから Graph API で追加可能（未実装）。
- **X**: 無料の公式投稿手段がない（API は従量課金のみ、2026-11-19 調査）ため自動化しない。手動投稿を続ける。

## 仕組み

1. 投稿は `operations/social/queue.json` に予約として登録する（下記フォーマット）。
2. GitHub Actions（`.github/workflows/social-post-threads.yml`）が30分ごとに起動し、
   期限が来た `pending` エントリを `scripts/social/post_due_threads.mjs` で投稿する。
3. 結果（成功/失敗、投稿ID）はスクリプトが queue.json に書き戻し、ワークフローがコミットする。
4. 認証情報は GitHub Secrets にのみ置く（リポジトリに書かない）:
   - `THREADS_USER_ID` — Threads のユーザーID（数値）
   - `THREADS_ACCESS_TOKEN` — 長期トークン（60日有効）

## queue.json フォーマット

```json
{
  "version": 1,
  "posts": [
    {
      "id": "2026-11-25-theme-human-capital",
      "scheduledAt": "2026-11-25T12:00:00+09:00",
      "text": "投稿文（500文字以内）",
      "targets": ["threads"],
      "status": "pending",
      "threadsPostId": null,
      "postedAt": null,
      "error": null
    }
  ]
}
```

- `status`: `pending` → `posted` / `failed`（自動で書き換わる。手で戻さない）
- 失敗した投稿は自動リトライしない（重複投稿防止）。再送したい場合は新しいエントリを作る。

## 初期設定（オーナーが1回だけ実施）

1. https://developers.facebook.com で Meta アプリを作成し、ユースケース「Threads」を追加する。
2. アプリのダッシュボード → ロール で、対象の Threads アカウントを「Threads テスター」に追加し、
   Threads 側（設定 → ウェブサイトの権限）で招待を承認する。
3. Threads 用のアクセストークンを発行し、長期トークン（60日）に交換する。
4. Threads ユーザーIDと長期トークンを GitHub Secrets に登録する
   （リポジトリ Settings → Secrets and variables → Actions）。
5. テスト: queue.json にテスト投稿を1件入れ、Actions の「social-post-threads」を
   手動実行（workflow_dispatch）して投稿されることを確認する。

## トークンの更新

- 長期トークンは60日で失効する。失効前に Threads API の refresh エンドポイントで
  更新でき、更新のたびに新しい60日が始まる。
- 失効が近い場合は Muse がリマインドする。更新したら Secrets の値を差し替える。

## 運用ルール

- 文案は Muse が下書きし、オーナーの承認後に queue へ登録する。
- ほぼ同一文の繰り返し投稿はしない（各プラットフォームの自動化ポリシー配慮）。
- 投稿頻度は週1〜2本程度を目安にする。
