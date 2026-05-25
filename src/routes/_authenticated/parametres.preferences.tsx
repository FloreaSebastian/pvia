import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Sliders, Moon, Sparkles, Volume2, Sparkle } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/parametres/preferences")({
  component: PreferencesSettings,
  head: () => ({ meta: [{ title: "Préférences — Paramètres PVIA" }] }),
});

const KEY = "pvia:ui-prefs";
type Prefs = { darkMode: boolean; density: "comfortable" | "compact"; animations: boolean; sounds: boolean; tips: boolean };
const DEFAULTS: Prefs = { darkMode: false, density: "comfortable", animations: true, sounds: true, tips: true };

function PreferencesSettings() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setPrefs({ ...DEFAULTS, ...JSON.parse(raw) });
    } catch { /* ignore */ }
  }, []);

  function update<K extends keyof Prefs>(k: K, v: Prefs[K]) {
    const next = { ...prefs, [k]: v };
    setPrefs(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
    toast.success("Préférence enregistrée.");
  }

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="mb-4 flex items-center gap-2">
          <Sliders className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">Apparence & confort</h2>
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          Stockées sur cet appareil. La synchronisation cloud arrive prochainement.
        </p>
        <div className="divide-y divide-border">
          <Row
            icon={<Moon className="h-4 w-4" />}
            title="Mode sombre"
            desc="Active une interface plus reposante pour les yeux."
            badge="Bientôt"
          >
            <Switch checked={prefs.darkMode} disabled />
          </Row>
          <Row
            icon={<Sparkle className="h-4 w-4" />}
            title="Densité d'affichage"
            desc="Compact = plus d'informations à l'écran."
          >
            <div className="flex items-center gap-2 text-xs">
              <button
                className={`rounded-md border px-2 py-1 ${prefs.density === "comfortable" ? "border-primary text-primary" : "border-border text-muted-foreground"}`}
                onClick={() => update("density", "comfortable")}
              >
                Confort
              </button>
              <button
                className={`rounded-md border px-2 py-1 ${prefs.density === "compact" ? "border-primary text-primary" : "border-border text-muted-foreground"}`}
                onClick={() => update("density", "compact")}
              >
                Compact
              </button>
            </div>
          </Row>
          <Row
            icon={<Sparkles className="h-4 w-4" />}
            title="Animations"
            desc="Désactivez pour réduire les mouvements à l'écran."
          >
            <Switch checked={prefs.animations} onCheckedChange={(v) => update("animations", v)} />
          </Row>
          <Row
            icon={<Volume2 className="h-4 w-4" />}
            title="Sons & retours haptiques"
            desc="Feedback sur les actions sur mobile."
          >
            <Switch checked={prefs.sounds} onCheckedChange={(v) => update("sounds", v)} />
          </Row>
          <Row
            icon={<Sparkles className="h-4 w-4" />}
            title="Conseils d'onboarding"
            desc="Bulles d'aide contextuelles."
          >
            <Switch checked={prefs.tips} onCheckedChange={(v) => update("tips", v)} />
          </Row>
        </div>
      </Card>
    </div>
  );
}

function Row({ icon, title, desc, badge, children }: { icon: React.ReactNode; title: string; desc: string; badge?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary">{icon}</div>
        <div>
          <div className="flex items-center gap-2">
            <Label className="text-sm font-medium">{title}</Label>
            {badge && <Badge variant="secondary">{badge}</Badge>}
          </div>
          <p className="text-xs text-muted-foreground">{desc}</p>
        </div>
      </div>
      {children}
    </div>
  );
}
