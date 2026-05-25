import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export type UserPrefs = {
  dark_mode_enabled: boolean;
  ui_density: "comfortable" | "compact";
  animations_enabled: boolean;
  sounds_enabled: boolean;
  onboarding_tips_enabled: boolean;
};

const DEFAULTS: UserPrefs = {
  dark_mode_enabled: false,
  ui_density: "comfortable",
  animations_enabled: true,
  sounds_enabled: true,
  onboarding_tips_enabled: true,
};

const LS_KEY = "pvia.user_prefs.v1";

type Ctx = {
  prefs: UserPrefs;
  setPref: <K extends keyof UserPrefs>(k: K, v: UserPrefs[K]) => Promise<void>;
  loading: boolean;
};

const PrefsContext = createContext<Ctx | null>(null);

function applyToDom(p: UserPrefs) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", p.dark_mode_enabled);
  root.dataset.density = p.ui_density;
  root.dataset.animations = p.animations_enabled ? "on" : "off";
  if (!p.animations_enabled) {
    root.style.setProperty("--pvia-motion", "0");
  } else {
    root.style.removeProperty("--pvia-motion");
  }
}

function readLocal(): UserPrefs | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : null;
  } catch {
    return null;
  }
}

function writeLocal(p: UserPrefs) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(p));
  } catch { /* noop */ }
}

export function UserPreferencesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<UserPrefs>(() => readLocal() ?? DEFAULTS);
  const [loading, setLoading] = useState(true);

  // Apply on first mount immediately (from cache)
  useEffect(() => {
    applyToDom(prefs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync from DB when user is known
  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("user_preferences")
        .select("dark_mode_enabled,ui_density,animations_enabled,sounds_enabled,onboarding_tips_enabled")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        const next: UserPrefs = {
          dark_mode_enabled: !!data.dark_mode_enabled,
          ui_density: (data.ui_density as UserPrefs["ui_density"]) ?? "comfortable",
          animations_enabled: !!data.animations_enabled,
          sounds_enabled: !!data.sounds_enabled,
          onboarding_tips_enabled: !!data.onboarding_tips_enabled,
        };
        setPrefs(next);
        writeLocal(next);
        applyToDom(next);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user]);

  // Re-apply whenever prefs change
  useEffect(() => { applyToDom(prefs); }, [prefs]);

  const setPref = useCallback(async <K extends keyof UserPrefs>(k: K, v: UserPrefs[K]) => {
    const next = { ...prefs, [k]: v };
    setPrefs(next);
    writeLocal(next);
    if (user) {
      await supabase
        .from("user_preferences")
        .upsert({ user_id: user.id, ...next }, { onConflict: "user_id" });
    }
  }, [prefs, user]);

  return (
    <PrefsContext.Provider value={{ prefs, setPref, loading }}>
      {children}
    </PrefsContext.Provider>
  );
}

export function useUserPrefs(): Ctx {
  const ctx = useContext(PrefsContext);
  if (!ctx) {
    // Safe fallback so non-wrapped trees don't crash
    return {
      prefs: DEFAULTS,
      setPref: async () => { /* noop */ },
      loading: false,
    };
  }
  return ctx;
}
