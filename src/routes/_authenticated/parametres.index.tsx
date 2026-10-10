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
import { RoleBadge } from "@/components/app/RoleBadge";
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

type Loaded<T> =
  | { scope: string; status: "loading" }
  | { scope: string; status: "error" }
  | { scope: string; status: "ready"; data: T };

function GeneralSettings() {
  const { user } = useAuth();
  const { activeCompanyId, memberships, can, activeRole, status: companyStatus } = useCompany();
  const company = memberships.find((m) => m.company_id === activeCompanyId)?.company ?? null;
  const isAdmin = can("admin");
  const userId = user?.id ?? null;
  const profileScope = userId ? `profile:${userId}` : null;
  const prefsScope = userId && activeCompanyId && companyStatus === "ready" ? `prefs:${userId}:${activeCompanyId}` : null;

  const [profileLoad, setProfileLoad] = useState<Loaded<Profile> | null>(null);
  const [prefsLoad, setPrefsLoad] = useState<Loaded<LocalePrefs> | null>(null);
  const [profileEdit, setProfileEdit] = useState<{ scope: string; v: Profile } | null>(null);
  const [prefsEdit, setPrefsEdit] = useState<{ scope: string; v: LocalePrefs } | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  // Profil personnel : borné à l'utilisateur (modifiable aussi en lecture seule).
  useEffect(() => {
    if (!profileScope || !userId) return;
    let alive = true;
    setProfileLoad({ scope: profileScope, status: "loading" });
    setProfileEdit(null);
    supabase
      .from("profiles")
      .select("first_name,last_name,phone,job_title")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data: p, error }) => {
        if (!alive) return;
        if (error) return setProfileLoad({ scope: profileScope, status: "error" });
        const next: Profile = {
          first_name: p?.first_name ?? "",
          last_name: p?.last_name ?? "",
          phone: p?.phone ?? "",
          job_title: p?.job_title ?? "",
        };
        setProfileLoad({ scope: profileScope, status: "ready", data: next });
        setProfileEdit({ scope: profileScope, v: next });
      });
    return () => {
      alive = false;
    };
  }, [profileScope, userId, reloadTick]);

  // Préférences entreprise : bornées à utilisateur + entreprise.
  useEffect(() => {
    setPrefsEdit(null);
    if (!prefsScope || !activeCompanyId) {
      setPrefsLoad(null);
      return;
    }
    let alive = true;
    setPrefsLoad({ scope: prefsScope, status: "loading" });
    supabase
      .from("company_settings")
      .select("locale,timezone,currency,date_format")
      .eq("company_id", activeCompanyId)
      .maybeSingle()
      .then(({ data: cs, error }) => {
        if (!alive) return;
        if (error) return setPrefsLoad({ scope: prefsScope, status: "error" });
        const next: LocalePrefs = cs
          ? {
              language: (cs.locale as LocalePrefs["language"]) ?? "fr",
              timezone: cs.timezone ?? "Europe/Paris",
              currency: (cs.currency as LocalePrefs["currency"]) ?? "EUR",
              dateFormat: (cs.date_format as LocalePrefs["dateFormat"]) ?? "fr",
            }
          : DEFAULT_PREFS;
        setPrefsLoad({ scope: prefsScope, status: "ready", data: next });
        setPrefsEdit({ scope: prefsScope, v: next });
      });
    return () => {
      alive = false;
    };
  }, [prefsScope, activeCompanyId, reloadTick]);

  const profileReady = profileLoad && profileLoad.scope === profileScope && profileLoad.status === "ready" ? profileLoad : null;
  const prefsReady = prefsLoad && prefsLoad.scope === prefsScope && prefsLoad.status === "ready" ? prefsLoad : null;
  const profile = profileEdit && profileEdit.scope === profileScope ? profileEdit.v : profileReady?.data ?? PROFILE_EMPTY;
  const prefs = prefsEdit && prefsEdit.scope === prefsScope ? prefsEdit.v : prefsReady?.data ?? DEFAULT_PREFS;
  const setProfile = (v: Profile) => profileScope && profileReady && setProfileEdit({ scope: profileScope, v });
  const setPrefs = (v: LocalePrefs) => prefsScope && prefsReady && isAdmin && setPrefsEdit({ scope: prefsScope, v });

  /* ---------- Autosave: profile ---------- */
  const profileSave = useAutosave<Profile>({
    scope: profileReady ? profileScope : null,
    loaded: profileReady?.data,
    value: profile,
    valueScope: profileEdit?.scope ?? null,
    onSave: async (scope, v) => {
      const uid = scope.slice("profile:".length);
      const { data: rows, error } = await supabase
        .from("profiles")
        .update({
          first_name: v.first_name.trim() || null,
          last_name: v.last_name.trim() || null,
          phone: v.phone.trim() || null,
          job_title: v.job_title.trim() || null,
          full_name: `${v.first_name} ${v.last_name}`.trim() || null,
        })
        .eq("id", uid)
        .select("id");
      if (error) throw new Error(error.message);
      if (!rows || rows.length !== 1) throw new Error("Profil non enregistré.");
    },
  });

  /* ---------- Autosave: company prefs ---------- */
  const prefsSave = useAutosave<LocalePrefs>({
    scope: prefsReady ? prefsScope : null,
    loaded: prefsReady?.data,
    value: prefs,
    valueScope: prefsEdit?.scope ?? null,
    disabled: !isAdmin,
    onSave: async (scope, v) => {
      const [, uid, companyId] = scope.split(":");
      const { error } = await supabase.from("company_settings").upsert(
        {
          company_id: companyId,
          locale: v.language,
          timezone: v.timezone,
          currency: v.currency,
          date_format: v.dateFormat,
          updated_by: uid,
        },
        { onConflict: "company_id" },
      );
      if (error) throw new Error(error.message);
    },
  });

  const anyDirty = profileSave.isDirty || prefsSave.isDirty;
  useUnsavedGuard(anyDirty);

  async function saveAll() {
    const results = await Promise.all([
      profileSave.isDirty ? profileSave.saveNow() : Promise.resolve(true),
      prefsSave.isDirty ? prefsSave.saveNow() : Promise.resolve(true),
    ]);
    if (results.every(Boolean)) toast.success("Modifications enregistrées.");
    else toast.error("Certaines modifications n'ont pas été enregistrées. Réessayez.");
  }

  useKeyboardShortcut("mod+s", async (e) => {
    e.preventDefault();
    if (!anyDirty) return;
    await saveAll();
  });

  function resetPrefs() {
    if (!prefsReady || !isAdmin) return;
    setPrefs(DEFAULT_PREFS);
    toast("Préférences restaurées. Sauvegarde automatique en cours…");
  }

  const profileFailed = profileLoad?.scope === profileScope && profileLoad?.status === "error";
  const prefsFailed = prefsLoad?.scope === prefsScope && prefsLoad?.status === "error";
  const loading = !profileReady && !profileFailed;

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
        {profileFailed && (
          <LoadError message="Impossible de charger votre profil." onRetry={() => setReloadTick((t) => t + 1)} />
        )}
        <fieldset disabled={!profileReady} className="grid gap-4 sm:grid-cols-2">
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
        </fieldset>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Sauvegarde automatique après modification — ou <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-xs">⌘S</kbd>.
          </p>
          <Button
            size="sm"
            className="h-11"
            onClick={async () => {
              const ok = await profileSave.saveNow();
              if (!ok) toast.error("Profil non enregistré. Réessayez.");
            }}
            disabled={!profileReady || !profileSave.isDirty || profileSave.status === "saving"}
          >
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
          isAdmin ? (
            <Button asChild variant="outline" size="sm" className="h-11">
              <Link to="/entreprise">Gérer</Link>
            </Button>
          ) : undefined
        }
      >
        <div className="min-w-0 text-sm">
          <div className="break-words font-medium">{company?.name ?? "—"}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>Votre rôle :</span>
            <RoleBadge role={activeRole} long self />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {isAdmin
              ? "Vous pouvez modifier l'identité légale, l'adresse, le SIREN/SIRET et la TVA dans la page Entreprise."
              : "L'identité de l'entreprise est gérée par la direction ou le responsable d'exploitation."}
          </p>
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
            <ResetButton onConfirm={resetPrefs} disabled={!isAdmin || !prefsReady} />
          </div>
        }
      >
        {prefsFailed && (
          <LoadError message="Impossible de charger les préférences de l'entreprise." onRetry={() => setReloadTick((t) => t + 1)} />
        )}
        {!isAdmin && (
          <p className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            Lecture seule — seuls les administrateurs peuvent modifier ces préférences.
          </p>
        )}
        <fieldset disabled={!isAdmin || !prefsReady} className="grid gap-4 sm:grid-cols-2">
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
              className="h-11"
              onClick={saveAll}
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

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
      <span className="min-w-0 flex-1">{message}</span>
      <Button size="sm" variant="outline" className="h-11" onClick={onRetry}>
        Réessayer
      </Button>
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
