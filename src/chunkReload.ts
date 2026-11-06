/**
 * デプロイ直後の「古いページ」対策。
 *
 * 各画面のスクリプトは開いたときに読み込む（遅延読み込み）。GitHub Pages はデプロイのたびに
 * サイト全体を入れ替えるため、デプロイ前に開いていたページ（またはブラウザにキャッシュされたページ）が
 * 参照する古いファイルは 404 になる。その場合はページを1回だけ再読み込みして最新版に切り替える。
 * 再読み込みしても直らない場合に無限ループしないよう、直前の再読み込み時刻を sessionStorage に記録する。
 */
const KEY = "earth-exploration-lab:chunk-reload-at";
/** この時間内に再読み込み済みなら、もう一度は再読み込みしない */
export const RELOAD_GUARD_MS = 30_000;

type Store = Pick<Storage, "getItem" | "setItem">;

function storage(): Store | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}

/** 再読み込みしてよいか判定し、してよければ時刻を記録する */
export function claimReload(now = Date.now(), st: Store | undefined = storage()): boolean {
  try {
    if (!st) return false;
    const last = Number(st.getItem(KEY) ?? 0);
    if (Number.isFinite(last) && now - last < RELOAD_GUARD_MS) return false;
    st.setItem(KEY, String(now));
    return true;
  } catch {
    return false;
  }
}

/** 動的 import（ページ用ファイル）の読み込み失敗らしいエラーか */
export function isChunkLoadError(e: unknown): boolean {
  const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|ChunkLoadError/i.test(msg);
}
