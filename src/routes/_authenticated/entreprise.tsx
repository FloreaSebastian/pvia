import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Building2, Save, Loader2, Lock, RefreshCw, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useCompany } from "@/hooks/use-company";
import { updateCompanyBranding, syncCompanyFromSiren } from "@/lib/branding.functions";
import { uploadCompanyLogo } from "@/lib/company-logo.functions";

import { fileToBase64, validateLogoFile } from "@/lib/file-upload";

import { RouteRoleGuard } from "@/components/auth/RouteRoleGuard";
import { ADMIN_ROLES } from "@/lib/roles";

function GuardedCompanyPage() {
  return (
    <RouteRoleGuard allow={ADMIN_ROLES}>
      <CompanyPage />
    </RouteRoleGuard>
  );
}

export const Route = createFileRoute("/_authenticated/entreprise")({
  component: GuardedCompanyPage,
  head: () => ({ meta: [{ title: "Entreprise — PVIA" }] }),
});

type CompanyForm = {
  name: string;
  legal_form: string;
  siren: string;
  siret: string;
  vat_number: string;
  address_line1: string;
  address_line2: string;
  postal_code: string;
  city: string;
  country: string;
  phone: string;
  email: string;
  website: string;
  logo_url: string;
};

const empty: CompanyForm = {
  name: "", legal_form: "", siren: "", siret: "", vat_number: "",
  address_line1: "", address_line2: "", postal_code: "", city: "", country: "FR",
  phone: "", email: "", website: "", logo_url: "",
};

function LockedField({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <Label className="text-xs">{label}</Label>
        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"><Lock className="h-3 w-3" /> Verrouillé</span>
      </div>
      <div className="mt-1 flex h-9 items-center rounded-md border border-dashed border-border bg-muted/40 px-3 text-sm">
        {value ? <span className="truncate">{value}</span> : <span className="italic text-muted-foreground">Non renseigné</span>}
      </div>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function CompanyPage() {
  const { activeCompanyId, can, refresh } = useCompany();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<CompanyForm>(empty);
  const editable = can("admin");
  const save = useServerFn(updateCompanyBranding);
  const uploadLogoFn = useServerFn(uploadCompanyLogo);
  const lookupFn = useServerFn(lookupCompanyBySirenOrSiret);

  // SIRET sync dialog
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncQuery, setSyncQuery] = useState("");
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncResult, setSyncResult] = useState<SirenLookupResult | null>(null);

  useEffect(() => {
    (async () => {
      if (!activeCompanyId) return;
      setLoading(true);
      const { data } = await supabase
        .from("companies")
        .select("name,legal_form,siren,siret,vat_number,address_line1,address_line2,postal_code,city,country,phone,email,website,logo_url")
        .eq("id", activeCompanyId)
        .single();
      if (data) {
        setForm({
          name: data.name ?? "",
          legal_form: data.legal_form ?? "",
          siren: data.siren ?? "",
          siret: data.siret ?? "",
          vat_number: data.vat_number ?? "",
          address_line1: data.address_line1 ?? "",
          address_line2: data.address_line2 ?? "",
          postal_code: data.postal_code ?? "",
          city: data.city ?? "",
          country: data.country ?? "FR",
          phone: data.phone ?? "",
          email: data.email ?? "",
          website: data.website ?? "",
          logo_url: data.logo_url ?? "",
        });
      }
      setLoading(false);
    })();
  }, [activeCompanyId]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeCompanyId) return;
    setSaving(true);
    try {
      await save({ data: { companyId: activeCompanyId, ...form } as any });
      toast.success("Entreprise mise à jour");
      refresh();
    } catch (err: any) {
      toast.error(err?.message || "Échec de la mise à jour");
    } finally {
      setSaving(false);
    }
  }

  async function uploadLogo(file: File) {
    if (!activeCompanyId) return;
    const err = validateLogoFile(file);
    if (err) return toast.error(err);
    try {
      const base64 = await fileToBase64(file);
      const res = await uploadLogoFn({
        data: {
          companyId: activeCompanyId,
          fileName: file.name,
          mimeType: file.type,
          base64,
        },
      });
      setForm((f) => ({ ...f, logo_url: res.url }));
      toast.success("Logo téléversé et enregistré.");
      refresh();
    } catch (e: any) {
      toast.error(e?.message || "Échec de l'upload du logo.");
    }
  }

  async function runSync() {
    const q = syncQuery.replace(/\s+/g, "");
    if (!/^\d{9}$|^\d{14}$/.test(q)) {
      toast.error("Saisissez un SIREN (9 chiffres) ou SIRET (14 chiffres).");
      return;
    }
    setSyncBusy(true);
    setSyncResult(null);
    try {
      const res = await lookupFn({ data: { query: q } });
      setSyncResult(res);
      if (!res.found) toast.error(res.error);
    } catch (e: any) {
      toast.error(e?.message || "Recherche impossible.");
    } finally {
      setSyncBusy(false);
    }
  }

  async function confirmSync() {
    if (!activeCompanyId || !syncResult || !syncResult.found) return;
    const r = syncResult;
    const next: CompanyForm = {
      ...form,
      name: r.name || form.name,
      legal_form: r.legal_form || form.legal_form,
      siren: r.siren || form.siren,
      siret: r.siret || form.siret,
      address_line1: r.address_line1 || form.address_line1,
      postal_code: r.postal_code || form.postal_code,
      city: r.city || form.city,
    };
    setSaving(true);
    try {
      await save({ data: { companyId: activeCompanyId, ...next } as any });
      setForm(next);
      toast.success("Informations officielles synchronisées.");
      setSyncOpen(false);
      setSyncQuery("");
      setSyncResult(null);
      refresh();
    } catch (e: any) {
      toast.error(e?.message || "Mise à jour impossible.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="grid h-64 place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-primary">Paramètres</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Entreprise</h1>
        <p className="text-sm text-muted-foreground">
          Informations utilisées sur tous les PV, emails et exports.
        </p>
      </div>

      <Card className="p-4 sm:p-6">
        <form onSubmit={onSubmit} className="space-y-6">
          {/* Logo */}
          <div className="flex items-center gap-4">
            <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-muted">
              {form.logo_url ? (
                <img src={form.logo_url} alt="logo" className="h-full w-full object-contain" />
              ) : (
                <Building2 className="h-8 w-8 text-muted-foreground" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <Label className="text-xs">Logo de l'entreprise</Label>
              <Input
                type="file"
                accept="image/*"
                disabled={!editable}
                onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])}
                className="mt-1"
              />
            </div>
          </div>

          {/* Identité — verrouillée */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                <ShieldCheck className="h-4 w-4 text-emerald-600" /> Informations officielles synchronisées
              </h2>
              {editable && (
                <Button type="button" size="sm" variant="outline" onClick={() => setSyncOpen(true)}>
                  <RefreshCw className="h-3.5 w-3.5" /> Synchroniser depuis SIRET
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Ces champs proviennent du registre officiel et ne sont pas modifiables manuellement.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <LockedField label="Raison sociale" value={form.name} />
              </div>
              <LockedField label="Forme juridique" value={form.legal_form} />
              <LockedField label="TVA intracommunautaire" value={form.vat_number} />
              <LockedField label="SIREN" value={form.siren} />
              <LockedField label="SIRET" value={form.siret} />
              <div className="sm:col-span-2">
                <LockedField
                  label="Adresse du siège"
                  value={[form.address_line1, [form.postal_code, form.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")}
                />
              </div>
            </div>
          </section>

          {/* Adresse complémentaire */}
          <section className="space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Adresse complémentaire</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label>Complément d'adresse</Label>
                <Input disabled={!editable} value={form.address_line2} onChange={(e) => setForm({ ...form, address_line2: e.target.value })} placeholder="Bâtiment, étage, BP…" />
              </div>
              <div>
                <Label>Pays</Label>
                <Input disabled={!editable} value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />
              </div>
            </div>
          </section>

          {/* Contact */}
          <section className="space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Contact</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Téléphone</Label>
                <Input disabled={!editable} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div>
                <Label>Email</Label>
                <Input type="email" disabled={!editable} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <Label>Site web</Label>
                <Input placeholder="https://…" disabled={!editable} value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
              </div>
            </div>
          </section>

          {editable ? (
            <div className="flex justify-end">
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Enregistrer
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Seuls les administrateurs peuvent modifier ces informations.
            </p>
          )}
        </form>
      </Card>

      {/* SIRET sync dialog */}
      <Dialog open={syncOpen} onOpenChange={(o) => { setSyncOpen(o); if (!o) { setSyncResult(null); setSyncQuery(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Synchroniser depuis le registre officiel</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Label>SIREN (9 chiffres) ou SIRET (14 chiffres)</Label>
            <div className="flex gap-2">
              <Input
                value={syncQuery}
                onChange={(e) => setSyncQuery(e.target.value.replace(/\D/g, "").slice(0, 14))}
                inputMode="numeric"
                placeholder="89249214100015"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); runSync(); } }}
              />
              <Button type="button" onClick={runSync} disabled={syncBusy}>
                {syncBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Chercher"}
              </Button>
            </div>

            {syncResult && syncResult.found && (
              <Card className="space-y-2 border-emerald-500/40 bg-emerald-50/40 p-3 dark:bg-emerald-950/20">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold">{syncResult.name || "—"}</p>
                  <Badge variant="outline" className="font-mono text-[10px]">{syncResult.siret || syncResult.siren}</Badge>
                </div>
                <div className="space-y-0.5 text-xs text-muted-foreground">
                  {syncResult.legal_form && <p>Forme juridique : {syncResult.legal_form}</p>}
                  {syncResult.address_line1 && <p>{syncResult.address_line1}</p>}
                  {(syncResult.postal_code || syncResult.city) && <p>{[syncResult.postal_code, syncResult.city].filter(Boolean).join(" ")}</p>}
                </div>
              </Card>
            )}

            {syncResult && !syncResult.found && (
              <p className="text-xs text-destructive">{syncResult.error}</p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setSyncOpen(false)}>Annuler</Button>
            <Button type="button" onClick={confirmSync} disabled={!syncResult?.found || saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
              Confirmer et synchroniser
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
