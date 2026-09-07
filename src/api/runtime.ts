/**
 * Runtime detection — always available, never bundled away (WS-08).
 *
 * Lives here (not in `mock.ts`) so production modules can detect the Tauri shell
 * WITHOUT statically importing the ~4,600-line dev mock core (B18-7: no mock data
 * in a production path). `mock.ts` re-exports it for test compatibility.
 */
export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
