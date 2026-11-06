export interface Page {
  title: string;
  /** ページを描画し、後片付け用の関数を返す */
  mount(root: HTMLElement): () => void;
}
