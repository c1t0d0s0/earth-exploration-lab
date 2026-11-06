/** クイズのクリア履歴（このブラウザの中だけに保存） */
export interface MissionProgress {
  cleared: boolean;
  stars: number;
  attempts: number;
  hintsUsed: number;
  /** ISO 日時 */
  clearedAt?: string;
}

const KEY = "earth-exploration-lab:quiz-progress:v1";

export function loadProgress(storage: Pick<Storage, "getItem"> | undefined = safeStorage()): Record<string, MissionProgress> {
  try {
    const raw = storage?.getItem(KEY);
    const v = raw ? JSON.parse(raw) : {};
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

export function saveProgress(id: string, p: MissionProgress, storage: Pick<Storage, "getItem" | "setItem"> | undefined = safeStorage()): void {
  try {
    const all = loadProgress(storage);
    const prev = all[id];
    // 一度クリアした記録は、よりよい星のほうを残す
    all[id] = prev?.cleared && (!p.cleared || prev.stars >= p.stars) ? { ...prev, attempts: prev.attempts } : p;
    storage?.setItem(KEY, JSON.stringify(all));
  } catch {
    /* 保存できない環境では記録しない */
  }
}

export function resetProgress(storage: Pick<Storage, "removeItem"> | undefined = safeStorage()): void {
  try {
    storage?.removeItem(KEY);
  } catch {
    /* noop */
  }
}

function safeStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}
