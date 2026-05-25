import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Save, User as UserIcon, Building2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCompany } from "@/hooks/use-company";

export const Route = createFileRoute("/_authenticated/parametres/")({
  component: GeneralSettings,
  head: () => ({ meta: [{ title: "Général — Paramètres PVIA" }] }),
});

const PREF_KEY = "pvia:locale-prefs";
type LocalePrefs = { language: "fr" | "en"; timezone: string; currency: "EUR" | "USD" | "GBP"; dateFormat: "fr" | "iso" | "us" };
const DEFAULT_PREFS: LocalePrefs = { language: "fr", timezone: "Europe/Paris", currency: "EUR", dateFormat: "fr" };

function GeneralSettings() {
  const { user } = useAuth();
  const { activeCompanyId, memberships } = useCompany();
  const company = memberships.find((m) => m.company_id === activeCompanyId)?.company ?? null;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ first_name: "", last_name: "", phone: "", job_title: "" });
  const [prefs, setPrefs] = useState<LocalePrefs>(DEFAULT_PREFS);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("first_name,last_name,phone,job_title")
        .eq("id", user.id)
        .maybeSingle();
      if (data) setForm({
        first_name: data.first_name ?? "",
        last_name: data.last_name ?? "",
        phone: data.phone ?? "",
        job_title: data.job_title ?? "",
      });
      try {
        const raw = localStorage.getItem(PREF_KEY);
        if (raw) setPrefs({ ...DEFAULT_PREFS, ...JSON.parse(raw) });
      } catch { /* ignore */ }
      setLoading(false);
    })();
  }, [user]);

  async function saveProfile() {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        first_name: form.first_name.trim() || null,
        last_name: form.last_name.trim() || null,
        phone: form.phone.trim() || null,
        job_title: form.job_title.trim() || null,
        full_name: `${form.first_name} ${form.last_name}`.trim() || null,
      })
      .eq("id", user.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Profil enregistré.");
  }

  function savePrefs(next: LocalePrefs) {
    setPrefs(next);
    try { localStorage.setItem(PREF_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    toast.success("Préférences enregistrées sur cet appareil.");
  }

  if (loading) {
    return <div className="grid h-40 place-items-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="mb-4 flex items-center gap-2">
          <UserIcon className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">Profil utilisateur</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Prénom"><Input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} /></Field>
          <Field label="Nom"><Input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} /></Field>
          <Field label="Téléphone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          <Field label="Fonction"><Input value={form.job_title} onChange={(e) => setForm({ ...form, job_title: e.target.value })} /></Field>
          <Field label="Email"><Input value={user?.email ?? ""} disabled /></Field>
        </div>
        <div className="mt-5 flex justify-end">
          <Button onClick={saveProfile} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Enregistrer
          </Button>
        </div>
      </Card>

      <Card className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary" />
            <h2 className="font-semibold">Entreprise active</h2>
          </div>
          <Button asChild variant="outline" size="sm"><Link to="/entreprise">Gérer</Link></Button>
        </div>
        <div className="text-sm">
          <div className="font-medium">{company?.name ?? "—"}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            Modifiez l'identité légale, l'adresse, le SIREN/SIRET et la TVA dans la page Entreprise.
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="mb-1 font-semibold">Langue & format</h2>
        <p className="mb-4 text-xs text-muted-foreground">
          Préférences locales. Stockées sur cet appareil — la synchronisation cloud arrive bientôt.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Langue">
            <Select value={prefs.language} onValueChange={(v) => savePrefs({ ...prefs, language: v as any })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="fr">Français</SelectItem>
                <SelectItem value="en">English (bientôt)</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Devise">
            <Select value={prefs.currency} onValueChange={(v) => savePrefs({ ...prefs, currency: v as any })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="EUR">EUR — €</SelectItem>
                <SelectItem value="USD">USD — $</SelectItem>
                <SelectItem value="GBP">GBP — £</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Fuseau horaire">
            <Select value={prefs.timezone} onValueChange={(v) => savePrefs({ ...prefs, timezone: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Europe/Paris">Europe / Paris</SelectItem>
                <SelectItem value="Europe/London">Europe / Londres</SelectItem>
                <SelectItem value="America/New_York">America / New York</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Format de date">
            <Select value={prefs.dateFormat} onValueChange={(v) => savePrefs({ ...prefs, dateFormat: v as any })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="fr">31/12/2026</SelectItem>
                <SelectItem value="iso">2026-12-31</SelectItem>
                <SelectItem value="us">12/31/2026</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
