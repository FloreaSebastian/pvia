import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Loader2, Save, Upload, Palette as PaletteIcon, FileText, Mail, Eye, History, RotateCcw, Undo2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/hooks/use-company";
import { useServerFn } from "@tanstack/react-start";
import { updateCompanyBranding } from "@/lib/branding.functions";
import { publishBrandingSettings, listBrandingVersions, restoreBrandingVersion } from "@/lib/branding-settings.functions";
import { uploadCompanyLogo } from "@/lib/company-logo.functions";
import { fileToBase64, validateLogoFile } from "@/lib/file-upload";

export const Route = createFileRoute("/_authenticated/parametres/branding")({
  component: BrandingSettings,
  head: () => ({ meta: [{ title: "Branding — Paramètres PVIA" }] }),
});

type BrandingDraft = {
  brand_color: string;
  pdf_brand_color: string;
  email_brand_color: string;
  pdf_footer: string;
  pdf_watermark: string;
  email_footer: string;
  email_signature: string;
};

const DEFAULTS: BrandingDraft = {
  brand_color: "#3B82F6",
  pdf_brand_color: "#1E3A8A",
  email_brand_color: "#1E40AF",
  pdf_footer: "Document généré par PVIA.",
  pdf_watermark: "",
  email_footer: "Cet email a été envoyé par PVIA.",
  email_signature: "",
};

function BrandingSettings() {
  const { activeCompanyId, can } = useCompany();
  const updateBranding = useServerFn(updateCompanyBranding);
  const publish = useServerFn(publishBrandingSettings);
  const listVersions = useServerFn(listBrandingVersions);
  const restoreVersion = useServerFn(restoreBrandingVersion);
  const isAdmin = can("admin");
  const fileRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [logoUrl, setLogoUrl] = useState<string>("");

  const [published, setPublished] = useState<BrandingDraft>(DEFAULTS);
  const [draft, setDraft] = useState<BrandingDraft>(DEFAULTS);
  const [versions, setVersions] = useState<Array<{ id: string; label: string | null; created_at: string }>>([]);

  useEffect(() => {
    if (!activeCompanyId) return;
    (async () => {
      const [{ data: comp }, { data: s }] = await Promise.all([
        supabase.from("companies").select("name,logo_url").eq("id", activeCompanyId).maybeSingle(),
        supabase
          .from("company_settings")
          .select("brand_color,pdf_brand_color,email_brand_color,pdf_footer,pdf_watermark,email_footer,email_signature")
          .eq("company_id", activeCompanyId)
          .maybeSingle(),
      ]);
      if (comp) {
        setCompanyName(comp.name ?? "");
        setLogoUrl(comp.logo_url ?? "");
      }
      const next: BrandingDraft = s
        ? {
            brand_color: s.brand_color || DEFAULTS.brand_color,
            pdf_brand_color: s.pdf_brand_color || s.brand_color || DEFAULTS.pdf_brand_color,
            email_brand_color: s.email_brand_color || s.brand_color || DEFAULTS.email_brand_color,
            pdf_footer: s.pdf_footer || DEFAULTS.pdf_footer,
            pdf_watermark: s.pdf_watermark ?? "",
            email_footer: s.email_footer || DEFAULTS.email_footer,
            email_signature: (s as any).email_signature ?? "",
          }
        : DEFAULTS;
      setPublished(next);
      setDraft(next);
      refreshVersions();
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCompanyId]);

  async function refreshVersions() {
    if (!activeCompanyId) return;
    try {
      const r = await listVersions({ data: { companyId: activeCompanyId, limit: 20 } });
      setVersions((r.versions ?? []).map((v: any) => ({ id: v.id, label: v.label, created_at: v.created_at })));
    } catch { /* noop */ }
  }

  const isDirty = JSON.stringify(draft) !== JSON.stringify(published);

  async function uploadLogo(file: File) {
    if (!activeCompanyId) return;
    if (!isAdmin) return toast.error("Réservé aux administrateurs.");
    if (file.size > 2 * 1024 * 1024) return toast.error("Logo trop volumineux (max 2 Mo).");
    setUploading(true);
    try {
      const path = `${activeCompanyId}/logo-${Date.now()}-${file.name}`;
      const { error: upErr } = await supabase.storage.from("pv-assets").upload(path, file, { upsert: true });
      if (upErr) throw new Error(upErr.message);
      const { data: pub } = supabase.storage.from("pv-assets").getPublicUrl(path);
      setLogoUrl(pub.publicUrl);
      toast.success("Logo prêt — cliquez sur Publier pour confirmer.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function onPublish() {
    if (!activeCompanyId) return;
    setSaving(true);
    try {
      await updateBranding({
        data: { companyId: activeCompanyId, name: companyName, logo_url: logoUrl } as any,
      });
      await publish({ data: { companyId: activeCompanyId, ...draft } });
      setPublished(draft);
      await refreshVersions();
      toast.success("Branding publié.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function onCancel() {
    setDraft(published);
    toast("Modifications annulées.");
  }
  function onResetDefaults() {
    setDraft(DEFAULTS);
    toast("Valeurs par défaut restaurées (non publiées).");
  }

  async function onRestore(versionId: string) {
    if (!activeCompanyId) return;
    try {
      await restoreVersion({ data: { companyId: activeCompanyId, versionId } });
      toast.success("Version restaurée. Rechargement…");
      // Reload local state
      const { data: s } = await supabase
        .from("company_settings")
        .select("brand_color,pdf_brand_color,email_brand_color,pdf_footer,pdf_watermark,email_footer,email_signature")
        .eq("company_id", activeCompanyId)
        .maybeSingle();
      if (s) {
        const next: BrandingDraft = {
          brand_color: s.brand_color || DEFAULTS.brand_color,
          pdf_brand_color: s.pdf_brand_color || s.brand_color || DEFAULTS.pdf_brand_color,
          email_brand_color: s.email_brand_color || s.brand_color || DEFAULTS.email_brand_color,
          pdf_footer: s.pdf_footer || DEFAULTS.pdf_footer,
          pdf_watermark: s.pdf_watermark ?? "",
          email_footer: s.email_footer || DEFAULTS.email_footer,
          email_signature: (s as any).email_signature ?? "",
        };
        setPublished(next);
        setDraft(next);
      }
      await refreshVersions();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (loading) {
    return <div className="grid h-40 place-items-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-6 pb-24 lg:pb-0">
      {!isAdmin && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          Lecture seule — seuls les administrateurs peuvent modifier le branding.
        </div>
      )}

      <Card className="p-6">
        <div className="mb-4 flex items-center gap-2">
          <PaletteIcon className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">Identité visuelle</h2>
        </div>
        <div className="grid gap-6 sm:grid-cols-[180px_minmax(0,1fr)]">
          <div>
            <div className="grid h-32 w-full place-items-center overflow-hidden rounded-xl border border-dashed border-border bg-card/40">
              {logoUrl ? <img src={logoUrl} alt="Logo entreprise" className="max-h-full max-w-full object-contain p-3" /> : <span className="text-xs text-muted-foreground">Pas de logo</span>}
            </div>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" hidden
              onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])} />
            <Button size="sm" variant="outline" className="mt-3 w-full" onClick={() => fileRef.current?.click()} disabled={uploading || !isAdmin}>
              {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Changer le logo
            </Button>
          </div>
          <div className="space-y-4">
            <Field label="Nom commercial">
              <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} disabled={!isAdmin} />
            </Field>
            <fieldset disabled={!isAdmin} className="grid gap-4 sm:grid-cols-3">
              <ColorField label="Couleur principale" value={draft.brand_color} onChange={(v) => setDraft({ ...draft, brand_color: v })} />
              <ColorField label="Couleur PDF" value={draft.pdf_brand_color} onChange={(v) => setDraft({ ...draft, pdf_brand_color: v })} />
              <ColorField label="Couleur emails" value={draft.email_brand_color} onChange={(v) => setDraft({ ...draft, email_brand_color: v })} />
            </fieldset>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <div className="mb-4 flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">PDF & emails</h2>
        </div>
        <fieldset disabled={!isAdmin} className="grid gap-4 sm:grid-cols-2">
          <Field label="Footer documents PDF">
            <Textarea rows={2} value={draft.pdf_footer} onChange={(e) => setDraft({ ...draft, pdf_footer: e.target.value })} />
          </Field>
          <Field label="Watermark PDF (optionnel)">
            <Input placeholder="ex. CONFIDENTIEL" value={draft.pdf_watermark} onChange={(e) => setDraft({ ...draft, pdf_watermark: e.target.value.slice(0, 40) })} />
          </Field>
          <Field label="Footer email">
            <Textarea rows={2} value={draft.email_footer} onChange={(e) => setDraft({ ...draft, email_footer: e.target.value })} />
          </Field>
          <Field label="Signature email">
            <Textarea rows={4} placeholder="Cordialement,&#10;Jean Dupont&#10;Directeur travaux"
              value={draft.email_signature} onChange={(e) => setDraft({ ...draft, email_signature: e.target.value })} />
          </Field>
        </fieldset>
      </Card>

      <Card className="p-6">
        <div className="mb-4 flex items-center gap-2">
          <Eye className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">Aperçu avant publication</h2>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Preview title="Email transactionnel" icon={<Mail className="h-4 w-4" />} color={draft.email_brand_color}>
            <div className="overflow-hidden rounded-lg border border-border bg-white text-sm text-black">
              <div className="px-4 py-3 text-white" style={{ background: draft.email_brand_color }}>
                <div className="text-[10px] uppercase tracking-widest opacity-75">PVIA · Document signé</div>
                <div className="mt-1 text-base font-semibold">Votre procès-verbal signé est disponible</div>
              </div>
              <div className="p-4 text-xs leading-relaxed">
                <p>Bonjour, votre PV est prêt.</p>
                {draft.email_signature && (
                  <div className="mt-3 whitespace-pre-line border-t border-neutral-200 pt-2 text-[11px] text-neutral-600">{draft.email_signature}</div>
                )}
                <div className="mt-3 border-t border-neutral-200 pt-2 text-[10px] text-neutral-500">{draft.email_footer}</div>
              </div>
            </div>
          </Preview>
          <Preview title="Document PDF" icon={<FileText className="h-4 w-4" />} color={draft.pdf_brand_color}>
            <div className="aspect-[1/1.41] overflow-hidden rounded-lg border border-border bg-white p-4 text-xs text-black">
              <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: draft.pdf_brand_color }}>
                {logoUrl ? <img src={logoUrl} alt="" className="h-6 object-contain" /> : <span className="font-bold">{companyName}</span>}
                <span className="font-mono opacity-60">PV 2026-001</span>
              </div>
              <div className="relative mt-3 space-y-1 opacity-70">
                <div className="h-1.5 w-2/3 rounded bg-neutral-300" />
                <div className="h-1.5 w-1/2 rounded bg-neutral-300" />
                <div className="h-1.5 w-3/4 rounded bg-neutral-300" />
                {draft.pdf_watermark && (
                  <span className="pointer-events-none absolute inset-0 grid place-items-center text-3xl font-bold tracking-widest opacity-10 -rotate-12">{draft.pdf_watermark}</span>
                )}
              </div>
              <div className="mt-4 border-t pt-2 text-[10px] opacity-60">{draft.pdf_footer}</div>
            </div>
          </Preview>
        </div>
      </Card>

      <Card className="p-6">
        <div className="mb-4 flex items-center gap-2">
          <History className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">Historique des versions</h2>
        </div>
        {versions.length === 0 ? (
          <p className="text-xs text-muted-foreground">Aucune version archivée. Chaque publication crée un point de restauration.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {versions.map((v) => (
              <li key={v.id} className="flex items-center justify-between py-2">
                <div>
                  <div className="font-medium">{v.label ?? "Snapshot"}</div>
                  <div className="text-xs text-muted-foreground">{new Date(v.created_at).toLocaleString("fr-FR")}</div>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" variant="outline" disabled={!isAdmin}>
                      <Undo2 className="mr-1.5 h-3.5 w-3.5" /> Restaurer
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Restaurer cette version ?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Les paramètres branding actuels seront archivés puis remplacés. Vous pouvez revenir en arrière à tout moment.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Annuler</AlertDialogCancel>
                      <AlertDialogAction onClick={() => onRestore(v.id)}>Restaurer</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Identité légale (SIREN, SIRET, adresse) → <Link className="underline" to="/entreprise">Entreprise</Link>.
        </p>
        <div className="flex items-center gap-2">
          {isDirty ? (
            <span className="text-xs text-amber-600">Modifications non publiées</span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
              <CheckCircle2 className="h-3.5 w-3.5" /> À jour
            </span>
          )}
          <Button variant="ghost" size="sm" onClick={onResetDefaults} disabled={!isAdmin}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Défauts
          </Button>
          <Button variant="outline" size="sm" onClick={onCancel} disabled={!isDirty}>
            Annuler
          </Button>
          <Button onClick={onPublish} disabled={saving || !isDirty || !isAdmin}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Publier
          </Button>
        </div>
      </div>
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

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 cursor-pointer rounded-md border border-input bg-transparent" />
        <Input value={value} onChange={(e) => onChange(e.target.value)} className="font-mono text-xs" />
      </div>
    </Field>
  );
}

function Preview({ title, icon, color, children }: { title: string; icon: React.ReactNode; color: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <span style={{ color }}>{icon}</span>{title}
      </div>
      {children}
    </div>
  );
}
