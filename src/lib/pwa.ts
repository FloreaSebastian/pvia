/** Public VAPID key — safe to expose in client bundle.
 *  The matching private key is stored as the VAPID_PRIVATE_KEY server secret.
 *  Generated once via `web-push generate-vapid-keys`.
 */
export const VAPID_PUBLIC_KEY =
  "BAczQz368GZgxPudINGT-UU40na1xlSnSGEY6B9hZGUfFrWMW__HHcILPIH-QQalh2QUQ_DMneFaS-9HMYaoZ50";

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
  return out;
}

/** Detect Lovable preview / iframe hosts where SW must NOT register. */
export function isPwaUnsafeHost(): boolean {
  if (typeof window === "undefined") return true;
  try {
    if (window.self !== window.top) return true; // iframe
  } catch {
    return true; // cross-origin iframe
  }
  const h = window.location.hostname;
  return (
    h.includes("id-preview--") ||
    h.includes("preview--") ||
    h.endsWith(".lovableproject.com") ||
    h.endsWith(".lovableproject-dev.com") ||
    h === "localhost" ||
    h === "127.0.0.1"
  );
}

/** Detect iOS Safari for install-prompt UX. */
export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) && !("MSStream" in window);
}

/** Detect if app is already installed (standalone display mode). */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS legacy
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}
