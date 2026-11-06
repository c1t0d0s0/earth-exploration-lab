export type PageLayout = "app" | "doc";

export interface Page {
  title: string;
  /**
   * "app": PC では画面の高さに収める（地図中心の画面）
   * "doc": 普通に縦スクロールする（一覧・読み物の画面）。省略時は "app"
   */
  layout?: PageLayout | (() => PageLayout);
  /** ページを描画し、後片付け用の関数を返す */
  mount(root: HTMLElement): () => void;
}
