import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Loader2, Sliders, Moon, Sparkles, Volume2, Sparkle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated/parametres/preferences")({
  component: PreferencesSettings,
  head: () => ({ meta: [{ title: "Préférences — Paramètres PVIA" }] }),
});

type Prefs = {
  dark_mode_enabled: boolean;
  ui_density: "comfortable" | "compact";
  animations_enabled: boolean;
  sounds_enabled: boolean;
  onboarding_tips_enabled: boolean;
};
const DEFAULTS: Prefs = {
  dark_mode_enabled: false,
  ui_density: "comfortable",
  animations_enabled: true,
  sounds_enabled: true,
  onboarding_tips_enabled: true,
};

function PreferencesSettings() {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("user_preferences")
        .select("dark_mode_enabled,ui_density,animations_enabled,sounds_enabled,onboarding_tips_enabled")
        .eq("user_id", user.id)
        .maybeSingle();
      if (data) {
        setPrefs({
          dark_mode_enabled: !!data.dark_mode_enabled,
          ui_density: (data.ui_density as Prefs["ui_density"]) ?? "comfortable",
          animations_enabled: !!data.animations_enabled,
          sounds_enabled: !!data.sounds_enabled,
          onboarding_tips_enabled: !!data.onboarding_tips_enabled,
        });
      }
      setLoading(false);
    })();
  }, [user]);

  async function update<K extends keyof Prefs>(k: K, v: Prefs[K]) {
    if (!user) return;
    const next = { ...prefs, [k]: v };
    setPrefs(next);
    const { error } = await supabase
      .from("user_preferences")
      .upsert({ user_id: user.id, ...next }, { onConflict: "user_id" });
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Préférence enregistrée.");
    }
  }

  if (loading) {
    return <div className="grid h-40 place-items-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="mb-4 flex items-center gap-2">
          <Sliders className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">Apparence & confort</h2>
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          Synchronisées sur votre compte, retrouvées sur tous vos appareils.
        </p>
        <div className="divide-y divide-border">
          <Row icon={<Moon className="h-4 w-4" />} title="Mode sombre" desc="Active une interface plus reposante pour les yeux.">
            <Switch checked={prefs.dark_mode_enabled} onCheckedChange={(v) => update("dark_mode_enabled", v)} />
          </Row>
          <Row icon={<Sparkle className="h-4 w-4" />} title="Densité d'affichage" desc="Compact = plus d'informations à l'écran.">
            <div className="flex items-center gap-2 text-xs">
              <button
                className={`rounded-md border px-2 py-1 ${prefs.ui_density === "comfortable" ? "border-primary text-primary" : "border-border text-muted-foreground"}`}
                onClick={() => update("ui_density", "comfortable")}
              >Confort</button>
              <button
                className={`rounded-md border px-2 py-1 ${prefs.ui_density === "compact" ? "border-primary text-primary" : "border-border text-muted-foreground"}`}
                onClick={() => update("ui_density", "compact")}
              >Compact</button>
            </div>
          </Row>
          <Row icon={<Sparkles className="h-4 w-4" />} title="Animations" desc="Désactivez pour réduire les mouvements à l'écran.">
            <Switch checked={prefs.animations_enabled} onCheckedChange={(v) => update("animations_enabled", v)} />
          </Row>
          <Row icon={<Volume2 className="h-4 w-4" />} title="Sons & retours haptiques" desc="Feedback sur les actions sur mobile.">
            <Switch checked={prefs.sounds_enabled} onCheckedChange={(v) => update("sounds_enabled", v)} />
          </Row>
          <Row icon={<Sparkles className="h-4 w-4" />} title="Conseils d'onboarding" desc="Bulles d'aide contextuelles.">
            <Switch checked={prefs.onboarding_tips_enabled} onCheckedChange={(v) => update("onboarding_tips_enabled", v)} />
          </Row>
        </div>
      </Card>
    </div>
  );
}

function Row({ icon, title, desc, children }: { icon: React.ReactNode; title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary">{icon}</div>
        <div>
          <Label className="text-sm font-medium">{title}</Label>
          <p className="text-xs text-muted-foreground">{desc}</p>
        </div>
      </div>
      {children}
    </div>
  );
}
