/**
 * Lightweight client-side analytics.
 * Writes directly to public.analytics_events via the supabase client (RLS-permitted).
 * - Best-effort, never throws, never blocks UI.
 * - Skipped on preview/dev hosts and inside the Lovable editor iframe.
 * - Batches via requestIdleCallback when available.
 */
import { supabase } from "@/integrations/supabase/client";

const SESSION_KEY = "pvia.analytics.sid";

function isTrackingAllowed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    // Skip the editor iframe and preview hosts to keep prod data clean.
    if (window.self !== window.top) return false;
    const host = window.location.hostname;
    if (host === "localhost" || host.endsWith(".lovableproject.com")) return false;
    if (host.includes("id-preview--") || host.includes("-dev.lovable.app")) return false;
    return true;
  } catch {
    return false;
  }
}

function getSessionId(): string {
  try {
    let sid = sessionStorage.getItem(SESSION_KEY);
    if (!sid) {
      sid = crypto.randomUUID();
      sessionStorage.setItem(SESSION_KEY, sid);
    }
    return sid;
  } catch {
    return "anon";
  }
}

function isPwa(): boolean {
  try {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      // @ts-expect-error iOS
      window.navigator.standalone === true
    );
  } catch {
    return false;
  }
}

export async function trackEvent(eventName: string, props?: Record<string, unknown>) {
  if (!isTrackingAllowed()) return;
  const run = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }) as any);
      await supabase.from("analytics_events").insert({
        event_name: eventName.slice(0, 80),
        path: window.location.pathname,
        referrer: document.referrer || null,
        user_agent: navigator.userAgent.slice(0, 255),
        is_pwa: isPwa(),
        session_id: getSessionId(),
        user_id: user?.id ?? null,
        props: props ?? null,
      });
    } catch {
      // swallow — analytics must never break the app
    }
  };
  if ("requestIdleCallback" in window) {
    (window as any).requestIdleCallback(run, { timeout: 2000 });
  } else {
    setTimeout(run, 0);
  }
}

export function trackPageview(path: string) {
  void trackEvent("pageview", { path });
}
