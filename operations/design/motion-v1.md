# UIモーション設計 v1（2026-11-20）

コンセプト：「情報は静かに、操作は確かに動く。」

ディズニーアニメーション12原則のうち、企業情報 UI に適した7原則を採用する。Squash & Stretch や Exaggeration のような大きな変形は、情報の信頼性と視認性を優先して採用しない。

| 原則 | 適用要素 | 動き |
|---|---|---|
| Slow In & Slow Out | 全体 | 開始と停止をイージングで制御 |
| Staging | .hero | 見出し→説明→操作→統計の順に視線誘導 |
| Anticipation | ボタン | 押下時にわずかに沈み、入力受理を伝える |
| Follow Through | .compare-tray | 比較対象追加後にトレイが穏やかに着地 |
| Timing | 全体 | 操作種別で duration を使い分ける |
| Secondary Action | カード群 | 近接カードに短い時間差（stagger） |
| Appeal | 全体 | 統一した運動特性、抑制された移動距離 |

## トークン（site/assets/motion.css）

- duration: --motion-instant 110ms（押下）/ --motion-fast 170ms（ホバー）/ --motion-standard 300ms（出現）/ --motion-slow 380ms（トレイ・ダイアログ）/ --motion-hero 520ms（ヒーロー）
- easing: --motion-ease-out cubic-bezier(0.22, 1, 0.36, 1) / --motion-ease-in-out cubic-bezier(0.65, 0, 0.35, 1) / --motion-ease-press cubic-bezier(0.2, 0, 0, 1)
- 移動量は最大 12px、ホバーの浮き上がりは 2px まで。アニメーションは transform と opacity のみ。

## 実装

- `site/assets/motion.css`：トークンと各要素の動き。既存スタイルの後に読み込む。
- `site/assets/motion.js`：IntersectionObserver で .reveal に .is-inview を付与し、グリッド内順序を --i に設定。動的追加要素が表示領域内にある場合は出現アニメーションを再生しない（検索の再描画でちらつかせないため）。数値カウントアップは data-countup 属性がある要素のみの任意機能で、v1 では使用しない（数値の読みやすさ優先）。
- 適用範囲：index（アプリ本体）、テーマページ（生成器 `scripts/build_theme_pages_v1.mjs` 経由）、静的ページ群。企業ページは無装飾の文書ページのため対象外。
- prefers-reduced-motion では全て無効化。JS が無効でもコンテンツは通常表示される（非表示状態は html.motion-ready の下でのみ有効）。
- 外部ライブラリは使わない（静的予算 CSS 45KB / JS 110KB と CSP のため）。

## 変更時の注意

- 新しいページ生成器を作る場合は、他の生成器と同様に motion.css / motion.js のタグを含めること。
- 数値・表・進捗率など「情報が更新されるだけの場面」は原則として動かさない。
