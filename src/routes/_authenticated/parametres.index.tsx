import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Save, User as UserIcon, Building2, Globe2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCompany } from "@/hooks/use-company";
import { CollapsibleSection } from "@/components/app/CollapsibleSection";
import { SaveStatusBadge } from "@/components/app/SaveStatusBadge";
import { useAutosave } from "@/hooks/use-autosave";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { useServerFn } from "@tanstack/react-start";
import { logSettingsEvent } from "@/lib/settings-audit.functions";


export const Route = createFileRoute("/_authenticated/parametres/")({
  component: GeneralSettings,
  head: () => ({ meta: [{ title: "Général — Paramètres PVIA" }] }),
});

type Profile = { first_name: string; last_name: string; phone: string; job_title: string };
const PROFILE_EMPTY: Profile = { first_name: "", last_name: "", phone: "", job_title: "" };

type LocalePrefs = {
  language: "fr" | "en";
  timezone: string;
  currency: "EUR" | "USD" | "GBP";
  dateFormat: "fr" | "iso" | "us";
};
const DEFAULT_PREFS: LocalePrefs = { language: "fr", timezone: "Europe/Paris", currency: "EUR", dateFormat: "fr" };

function GeneralSettings() {
  const { user } = useAuth();
  const { activeCompanyId, memberships, can } = useCompany();
  const company = memberships.find((m) => m.company_id === activeCompanyId)?.company ?? null;
  const isAdmin = can("admin");

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile>(PROFILE_EMPTY);
  const [prefs, setPrefs] = useState<LocalePrefs>(DEFAULT_PREFS);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [{ data: p }, { data: cs }] = await Promise.all([
        supabase.from("profiles").select("first_name,last_name,phone,job_title").eq("id", user.id).maybeSingle(),
        activeCompanyId
          ? supabase.from("company_settings").select("locale,timezone,currency,date_format").eq("company_id", activeCompanyId).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      if (p) {
        const next: Profile = {
          first_name: p.first_name ?? "",
          last_name: p.last_name ?? "",
          phone: p.phone ?? "",
          job_title: p.job_title ?? "",
        };
        setProfile(next);
        profileSave.resetBaseline(next);
      }
      if (cs) {
        const next: LocalePrefs = {
          language: (cs.locale as LocalePrefs["language"]) ?? "fr",
          timezone: cs.timezone ?? "Europe/Paris",
          currency: (cs.currency as LocalePrefs["currency"]) ?? "EUR",
          dateFormat: (cs.date_format as LocalePrefs["dateFormat"]) ?? "fr",
        };
        setPrefs(next);
        prefsSave.resetBaseline(next);
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, activeCompanyId]);

  /* ---------- Autosave: profile ---------- */
  const profileSave = useAutosave<Profile>({
    value: profile,
    onSave: async (v) => {
      if (!user) throw new Error("Non authentifié");
      const { error } = await supabase
        .from("profiles")
        .update({
          first_name: v.first_name.trim() || null,
          last_name: v.last_name.trim() || null,
          phone: v.phone.trim() || null,
          job_title: v.job_title.trim() || null,
          full_name: `${v.first_name} ${v.last_name}`.trim() || null,
        })
        .eq("id", user.id);
      if (error) throw new Error(error.message);
    },
  });

  /* ---------- Autosave: company prefs ---------- */
  const prefsSave = useAutosave<LocalePrefs>({
    value: prefs,
    disabled: !activeCompanyId || !isAdmin,
    onSave: async (v) => {
      if (!activeCompanyId) throw new Error("Aucune entreprise active");
      if (!isAdmin) throw new Error("Réservé aux administrateurs.");
      const { error } = await supabase.from("company_settings").upsert(
        {
          company_id: activeCompanyId,
          locale: v.language,
          timezone: v.timezone,
          currency: v.currency,
          date_format: v.dateFormat,
          updated_by: user?.id,
        },
        { onConflict: "company_id" },
      );
      if (error) throw new Error(error.message);
    },
  });

  const anyDirty = profileSave.isDirty || prefsSave.isDirty;
  useUnsavedGuard(anyDirty);

  useKeyboardShortcut("mod+s", async (e) => {
    e.preventDefault();
    if (!anyDirty) return;
    await Promise.all([profileSave.saveNow(), prefsSave.saveNow()]);
    toast.success("Modifications enregistrées.");
  });

  function resetPrefs() {
    setPrefs(DEFAULT_PREFS);
    toast("Préférences restaurées. Sauvegarde automatique en cours…");
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-44 w-full rounded-2xl" />
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-24 lg:pb-0">
      <CollapsibleSection
        id="general.profile"
        title="Profil utilisateur"
        description="Vos informations personnelles, visibles par votre équipe."
        icon={<UserIcon className="h-4 w-4" />}
        actions={<SaveStatusBadge status={profileSave.status} lastSavedAt={profileSave.lastSavedAt} />}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Prénom">
            <Input value={profile.first_name} onChange={(e) => setProfile({ ...profile, first_name: e.target.value })} />
          </Field>
          <Field label="Nom">
            <Input value={profile.last_name} onChange={(e) => setProfile({ ...profile, last_name: e.target.value })} />
          </Field>
          <Field label="Téléphone">
            <Input value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} />
          </Field>
          <Field label="Fonction">
            <Input value={profile.job_title} onChange={(e) => setProfile({ ...profile, job_title: e.target.value })} />
          </Field>
          <Field label="Email">
            <Input value={user?.email ?? ""} disabled />
          </Field>
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Sauvegarde automatique après modification — ou <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">⌘S</kbd>.
          </p>
          <Button size="sm" onClick={() => profileSave.saveNow()} disabled={!profileSave.isDirty || profileSave.status === "saving"}>
            <Save className="mr-2 h-4 w-4" /> Enregistrer
          </Button>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        id="general.company"
        title="Entreprise active"
        description="Identité légale, SIREN/SIRET, TVA — gérés dans une page dédiée."
        icon={<Building2 className="h-4 w-4" />}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/entreprise">Gérer</Link>
          </Button>
        }
      >
        <div className="text-sm">
          <div className="font-medium">{company?.name ?? "—"}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            Vous pouvez modifier l'identité légale, l'adresse, le SIREN/SIRET et la TVA dans la page Entreprise.
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        id="general.locale"
        title="Langue & format"
        description="Préférences partagées par toute l'entreprise."
        icon={<Globe2 className="h-4 w-4" />}
        actions={
          <div className="flex items-center gap-3">
            <SaveStatusBadge status={prefsSave.status} lastSavedAt={prefsSave.lastSavedAt} />
            <ResetButton onConfirm={resetPrefs} disabled={!isAdmin} />
          </div>
        }
      >
        {!isAdmin && (
          <p className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            Lecture seule — seuls les administrateurs peuvent modifier ces préférences.
          </p>
        )}
        <fieldset disabled={!isAdmin} className="grid gap-4 sm:grid-cols-2">
          <Field label="Langue">
            <Select value={prefs.language} onValueChange={(v) => setPrefs({ ...prefs, language: v as LocalePrefs["language"] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="fr">Français</SelectItem>
                <SelectItem value="en">English (bientôt)</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Devise">
            <Select value={prefs.currency} onValueChange={(v) => setPrefs({ ...prefs, currency: v as LocalePrefs["currency"] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="EUR">EUR — €</SelectItem>
                <SelectItem value="USD">USD — $</SelectItem>
                <SelectItem value="GBP">GBP — £</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Fuseau horaire">
            <Select value={prefs.timezone} onValueChange={(v) => setPrefs({ ...prefs, timezone: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Europe/Paris">Europe / Paris</SelectItem>
                <SelectItem value="Europe/London">Europe / Londres</SelectItem>
                <SelectItem value="America/New_York">America / New York</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Format de date">
            <Select value={prefs.dateFormat} onValueChange={(v) => setPrefs({ ...prefs, dateFormat: v as LocalePrefs["dateFormat"] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="fr">31/12/2026</SelectItem>
                <SelectItem value="iso">2026-12-31</SelectItem>
                <SelectItem value="us">12/31/2026</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </fieldset>
      </CollapsibleSection>

      {/* Mobile sticky save bar */}
      {anyDirty && (
        <div
          className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-4 py-3 backdrop-blur lg:hidden"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)" }}
        >
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
            <SaveStatusBadge
              status={profileSave.status === "saving" || prefsSave.status === "saving" ? "saving" : "dirty"}
            />
            <Button
              size="sm"
              onClick={async () => {
                await Promise.all([profileSave.saveNow(), prefsSave.saveNow()]);
                toast.success("Tout est enregistré.");
              }}
            >
              <Save className="mr-2 h-4 w-4" />
              Enregistrer
            </Button>
          </div>
        </div>
      )}
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

function ResetButton({ onConfirm, disabled }: { onConfirm: () => void; disabled?: boolean }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="ghost" disabled={disabled} className="text-xs">
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
          Réinitialiser
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Restaurer les valeurs par défaut ?</AlertDialogTitle>
          <AlertDialogDescription>
            Les préférences de langue, devise, fuseau et format de date seront remises à leurs valeurs initiales et sauvegardées.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Annuler</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Restaurer</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
