import { create } from "zustand";

/**
 * In-session error aggregation (ERROR-HANDLING §3 rule 7): 5+ identical errors in
 * 1 minute → the app shell shows a collapsed banner with a link to this log.
 *
 * Fed from the API bridge — the single choke point every command error crosses —
 * so no screen has to remember to log. Keeps only what §3 rule 6 allows a UI-side
 * log to hold: the typed `code` and the catalog `userMessage` (which is spec copy,
 * not raw `message`). No money values, no secrets, no user paths (B18 redaction);
 * the persistent redacted Local Diagnostics export is the native
 * `app.diagnostics.export` (S-075 native gate).
 */

/** §3 rule 7 constants — identical means same code AND same userMessage. */
export const ERROR_AGGREGATION_THRESHOLD = 5;
export const ERROR_AGGREGATION_WINDOW_MS = 60_000;

export interface ErrorLogGroup {
  /** `${code}\u0000${userMessage}` — the identity of "identical errors". */
  key: string;
  code: string;
  userMessage: string;
  count: number;
  firstAt: number;
  lastAt: number;
}

interface ErrorLogState {
  groups: Record<string, ErrorLogGroup>;
  /** Record one error occurrence (bridge calls this on every typed error). */
  record: (err: { code: string; userMessage: string }, now?: number) => void;
  /** Drop one group (banner/log "Dismiss" — the occurrences stay gone). */
  dismiss: (key: string) => void;
  /** Drop everything (tests / explicit clear). */
  clear: () => void;
}

/** Prunes groups whose last occurrence fell outside the window. */
function prune(groups: Record<string, ErrorLogGroup>, now: number) {
  const out: Record<string, ErrorLogGroup> = {};
  for (const g of Object.values(groups)) {
    if (now - g.lastAt < ERROR_AGGREGATION_WINDOW_MS) out[g.key] = g;
  }
  return out;
}

export const useErrorLogStore = create<ErrorLogState>()((set) => ({
  groups: {},

  record: (err, now = Date.now()) =>
    set((s) => {
      const groups = prune(s.groups, now);
      const key = `${err.code}\u0000${err.userMessage}`;
      const prev = groups[key];
      groups[key] = prev
        ? { ...prev, count: prev.count + 1, lastAt: now }
        : {
            key,
            code: err.code,
            userMessage: err.userMessage,
            count: 1,
            firstAt: now,
            lastAt: now,
          };
      return { groups };
    }),

  dismiss: (key) =>
    set((s) => {
      if (!(key in s.groups)) return s;
      const groups = { ...s.groups };
      delete groups[key];
      return { groups };
    }),

  clear: () => set({ groups: {} }),
}));

/** Groups at/above the §3.7 threshold, most frequent first — the banner's source. */
export function selectAggregated(groups: Record<string, ErrorLogGroup>): ErrorLogGroup[] {
  return Object.values(groups)
    .filter((g) => g.count >= ERROR_AGGREGATION_THRESHOLD)
    .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);
}
