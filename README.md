# 地球探検ラボ（EARTH EXPLORATION LAB）

JAXA Earth API の衛星観測データを、誰でも地図で見て・比べて・分析できる Web サイト（MVP）。
要件は [REQUIREMENTS.md](REQUIREMENTS.md) を参照。

## 機能（MVP）

| 画面 | URL | 内容 |
|---|---|---|
| トップ | `#/` | 今日の地球（最新の全球画像）、今週の発見、各機能・探究テーマへの入口 |
| 地球探検マップ | `#/map?ds=precip&date=2026-10` | データセット切替、日時・期間指定、時系列アニメーション、凡例、3段階の説明、地点の値 |
| 地球タイムマシン | `#/timemachine?preset=aral` | 2時点のスワイプ／並列／アニメ比較、範囲の平均・分類割合の変化、観測条件の注意 |
| 地球データ実験室 | `#/lab?preset=precip-ndvi` | 最大3レイヤー重ね合わせ、地点選択（最大6）、地点別の値表、時系列グラフ、散布図と相関係数 |

クイズ・ランキング・衛星シミュレーターはトップに「準備中」として表示（Phase 4/5）。

## 開発

```bash
npm install
npm run dev        # 開発サーバー
npm test           # ユニットテスト (Vitest)
npm run build      # 型チェック + 本番ビルド (dist/ を静的ホスティングへ配置)
```

`vite.config.ts` は `base: "./"` のため、GitHub Pages などのサブパスでもそのまま動きます。

## 構成

- `src/data/datasets.json` … データセット定義（ID・期間・解像度・単位・カラースケール・説明・出典）。**新しいデータセットはここに追加するだけ**で地図・凡例・説明に反映されます。
- `src/data/themes.json` … タイムマシンのプリセット、実験室の探究テーマ、今週の発見（コンテンツはデータと分離）。
- `src/core/` … JAXA API クライアント（ImageCollection/Image/TileGenerator の再利用・キャッシュ）、IndexedDB キャッシュ、統計、極域投影。
- `src/map/` … MapLibre GL JS、`jaxa://` カスタムプロトコルによるタイル配信、ちらつかない日時切替（ダブルバッファ）。
- `src/pages/`, `src/ui/` … 画面と UI 部品（フレームワークなしの TypeScript）。

## JAXA Earth API について

- ライブラリ本体は再配布せず、実行時に公式 URL（`https://data.earth.jaxa.jp/api/javascript/v2.0.1/jaxa.earth.esm.js`）から読み込みます。型定義のみ `src/vendor/` に同梱（`npm run fetch-jaxa` で再取得）。
- 実装上の注意（調査で判明したもの）:
  - `Image#getDataObject` は width/height が 10 以上必須。
  - 同じ `Image` に対して `getDataObject` を同時に呼ぶと先の呼び出しが `null` になるため、`imageDataObject()` で直列化しています。
  - `TileGenerator` は EPSG:4326 のみ対応。北極の海氷 (EPSG:3995) は全体を取得し、`src/core/polar.ts` で Web メルカトルへ再投影しています（bbox は投影座標 m で指定）。
- 出典・クレジットは各データセットの「データ」タブとフッターに表示。データの利用条件は [JAXA の利用規約](https://earth.jaxa.jp/en/data/policy/) と各データセットの条件を確認してください。
