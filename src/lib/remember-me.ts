/**
 * Client-side helper for the "Remember me 30 days" checkbox.
 *
 * Supabase persists its session in localStorage by default, which already
 * survives browser restarts and lasts as long as the refresh token (~30d).
 * When the user does NOT want to be remembered, we move the session token
 * from localStorage to sessionStorage so it is cleared when the browser
 * (or tab) closes.
 */

const REMEMBER_KEY = "pvia:remember";

export function setRememberMePreference(remember: boolean) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(REMEMBER_KEY, remember ? "1" : "0");
  } catch {}
}

export function getRememberMePreference(): boolean {
  try {
    if (typeof window === "undefined") return true;
    const v = window.localStorage.getItem(REMEMBER_KEY);
    // default: remember
    return v === null ? true : v === "1";
  } catch {
    return true;
  }
}

/**
 * Call AFTER a successful supabase.auth sign-in.
 * If `remember` is false, copy the `sb-*-auth-token` entries to
 * sessionStorage and remove them from localStorage so the session
 * does not survive a browser close.
 */
export function applyRememberMePreference(remember: boolean) {
  try {
    if (typeof window === "undefined") return;
    if (remember) return;
    const ls = window.localStorage;
    const ss = window.sessionStorage;
    const keysToMove: string[] = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (!k) continue;
      if (k.startsWith("sb-") && k.endsWith("-auth-token")) keysToMove.push(k);
    }
    for (const k of keysToMove) {
      const v = ls.getItem(k);
      if (v != null) ss.setItem(k, v);
      ls.removeItem(k);
    }
  } catch {}
}
