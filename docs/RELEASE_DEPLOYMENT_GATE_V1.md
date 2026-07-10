# リリース・公開ゲート v1

## 目的

GitHub上のデータとNetlifyで公開される静的サイトが同一であり、必須ファイル・データ件数・ハッシュ・バージョンを再現できる状態を保証する。

## リリースマニフェスト

`scripts/build_release_manifest_v1.mjs` は `site/` 以下の全ファイルについて次を記録する。

- 相対パス
- バイト数
- SHA-256
- 公開ディレクトリ
- 会社数・進捗件数
- 圧縮データのSHA-256・サイズ・分割数

生成物は `artifacts/release-manifest-v1.json` とし、CI Artifactとして保存する。

## 必須検査

- Netlifyのpublish directoryが`site`
- `index.html`、`quality.html`、`404.html`、manifest、robots、headersが存在
- JavaScript・CSS・検索コアが存在
- データチャンクの件数・サイズ・SHAがmanifestと一致
- 570社・149進捗行
- 品質スコアv2のバージョン
- 公開ファイルに旧v42ラベルが残っていない
- localhost依存がない
- APIキー・パスワード等の明白な秘密情報がない
- リリースマニフェストのファイルパスが一意

## 公開フロー

1. データ・UIを変更
2. strict品質、Schema、検索、ブラウザ、アクセシビリティを実行
3. リリースマニフェストを生成
4. 公開ゲートを実行
5. PRをマージ
6. mainの品質ゲートとNetlifyビルドを確認

公開後に不具合が見つかった場合は、修正台帳へ記録し、同じゲートを通して再公開する。
