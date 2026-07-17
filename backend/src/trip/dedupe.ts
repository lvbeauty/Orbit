/**
 * Vocal Bridge's background model sometimes fires several identical tool calls within the
 * same turn (observed 2026-07-17: 6x search_flights, same params, within one response) —
 * a platform-level quirk we can't control from here. This just stops each duplicate from
 * re-hitting Sabre: identical calls within the window return the first call's in-flight/
 * recent result instead.
 */
const DEDUPE_WINDOW_MS = 8000;
const recent = new Map<string, { timestamp: number; promise: Promise<unknown> }>();

export function dedupe<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = recent.get(key);
  if (existing && Date.now() - existing.timestamp < DEDUPE_WINDOW_MS) {
    return existing.promise as Promise<T>;
  }
  const promise = run();
  recent.set(key, { timestamp: Date.now(), promise });
  return promise;
}
