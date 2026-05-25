import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Save, Upload, Palette as PaletteIcon, FileText, Mail, Eye } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/hooks/use-company";
import { useServerFn } from "@tanstack/react-start";
import { updateCompanyBranding } from "@/lib/branding.functions";

export const Route = createFileRoute("/_authenticated/parametres/branding")({
  component: BrandingSettings,
  head: () => ({ meta: [{ title: "Branding — Paramètres PVIA" }] }),
});

type BrandingExtras = { brandColor: string; emailFooter: string; pdfFooter: string; watermark: string };
const DEFAULT_EXTRAS: BrandingExtras = {
  brandColor: "#3B82F6",
  emailFooter: "Cet email a été envoyé par PVIA.",
  pdfFooter: "Document généré par PVIA.",
  watermark: "",
};

function BrandingSettings() {
  const { activeCompanyId, can } = useCompany();
  const updateFn = useServerFn(updateCompanyBranding);
  const fileRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [logoUrl, setLogoUrl] = useState<string>("");
  const [extras, setExtras] = useState<BrandingExtras>(DEFAULT_EXTRAS);

  useEffect(() => {
    if (!activeCompanyId) return;
    (async () => {
      const [{ data: comp }, { data: settings }] = await Promise.all([
        supabase.from("companies").select("name,logo_url").eq("id", activeCompanyId).maybeSingle(),
        supabase
          .from("company_settings")
          .select("brand_color,email_footer,pdf_footer,pdf_watermark")
          .eq("company_id", activeCompanyId)
          .maybeSingle(),
      ]);
      if (comp) {
        setCompanyName(comp.name ?? "");
        setLogoUrl(comp.logo_url ?? "");
      }
      if (settings) {
        setExtras({
          brandColor: settings.brand_color ?? DEFAULT_EXTRAS.brandColor,
          emailFooter: settings.email_footer ?? DEFAULT_EXTRAS.emailFooter,
          pdfFooter: settings.pdf_footer ?? DEFAULT_EXTRAS.pdfFooter,
          watermark: settings.pdf_watermark ?? "",
        });
      }
      setLoading(false);
    })();
  }, [activeCompanyId]);

  async function uploadLogo(file: File) {
    if (!activeCompanyId) return;
    if (!can("admin")) return toast.error("Réservé aux administrateurs.");
    if (file.size > 2 * 1024 * 1024) return toast.error("Logo trop volumineux (max 2 Mo).");
    setUploading(true);
    try {
      const path = `${activeCompanyId}/logo-${Date.now()}-${file.name}`;
      const { error: upErr } = await supabase.storage.from("pv-assets").upload(path, file, { upsert: true });
      if (upErr) throw new Error(upErr.message);
      const { data: pub } = supabase.storage.from("pv-assets").getPublicUrl(path);
      setLogoUrl(pub.publicUrl);
      toast.success("Logo téléchargé. Cliquez sur Enregistrer pour confirmer.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    if (!activeCompanyId) return;
    setSaving(true);
    try {
      await updateFn({
        data: {
          companyId: activeCompanyId,
          name: companyName,
          logo_url: logoUrl,
        } as any,
      });
      const { error: sErr } = await supabase
        .from("company_settings")
        .upsert({
          company_id: activeCompanyId,
          brand_color: extras.brandColor,
          email_footer: extras.emailFooter,
          pdf_footer: extras.pdfFooter,
          pdf_watermark: extras.watermark,
        }, { onConflict: "company_id" });
      if (sErr) throw new Error(sErr.message);
      toast.success("Branding mis à jour.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="grid h-40 place-items-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="mb-4 flex items-center gap-2">
          <PaletteIcon className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">Identité visuelle</h2>
        </div>

        <div className="grid gap-6 sm:grid-cols-[180px_minmax(0,1fr)]">
          <div>
            <div className="grid h-32 w-full place-items-center overflow-hidden rounded-xl border border-dashed border-border bg-card/40">
              {logoUrl ? (
                <img src={logoUrl} alt="Logo entreprise" className="max-h-full max-w-full object-contain p-3" />
              ) : (
                <span className="text-xs text-muted-foreground">Pas de logo</span>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/svg+xml,image/webp"
              hidden
              onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])}
            />
            <Button
              size="sm"
              variant="outline"
              className="mt-3 w-full"
              onClick={() => fileRef.current?.click()}
              disabled={uploading || !can("admin")}
            >
              {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Changer le logo
            </Button>
          </div>

          <div className="space-y-4">
            <Field label="Nom commercial">
              <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} disabled={!can("admin")} />
            </Field>
            <Field label="Couleur principale (preview seulement)">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={extras.brandColor}
                  onChange={(e) => setExtras({ ...extras, brandColor: e.target.value })}
                  className="h-9 w-12 cursor-pointer rounded-md border border-input bg-transparent"
                />
                <Input value={extras.brandColor} onChange={(e) => setExtras({ ...extras, brandColor: e.target.value })} className="font-mono" />
              </div>
            </Field>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <div className="mb-4 flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">Pieds de page & mentions</h2>
        </div>
        <div className="grid gap-4">
          <Field label="Footer documents PDF">
            <Textarea rows={2} value={extras.pdfFooter} onChange={(e) => setExtras({ ...extras, pdfFooter: e.target.value })} />
          </Field>
          <Field label="Signature emails">
            <Textarea rows={3} value={extras.emailFooter} onChange={(e) => setExtras({ ...extras, emailFooter: e.target.value })} />
          </Field>
          <Field label="Watermark PDF (optionnel)">
            <Input placeholder="ex. CONFIDENTIEL" value={extras.watermark} onChange={(e) => setExtras({ ...extras, watermark: e.target.value })} />
          </Field>
        </div>
      </Card>

      <Card className="p-6">
        <div className="mb-4 flex items-center gap-2">
          <Eye className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">Aperçu</h2>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Preview title="Email transactionnel" icon={<Mail className="h-4 w-4" />} color={extras.brandColor}>
            <div className="rounded-lg border border-border bg-card p-4 text-sm">
              <div className="mb-3 flex items-center gap-2">
                {logoUrl ? <img src={logoUrl} alt="" className="h-6 object-contain" /> : <span className="font-bold">{companyName || "Votre entreprise"}</span>}
              </div>
              <p className="text-foreground">Bonjour, votre PV est prêt.</p>
              <div className="mt-3" style={{ background: extras.brandColor }}>
                <div className="px-3 py-1.5 text-center text-xs font-semibold text-white">Voir le document</div>
              </div>
              <p className="mt-4 text-xs text-muted-foreground">{extras.emailFooter}</p>
            </div>
          </Preview>
          <Preview title="Document PDF" icon={<FileText className="h-4 w-4" />} color={extras.brandColor}>
            <div className="aspect-[1/1.41] overflow-hidden rounded-lg border border-border bg-white p-4 text-xs text-black">
              <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: extras.brandColor }}>
                {logoUrl ? <img src={logoUrl} alt="" className="h-6 object-contain" /> : <span className="font-bold">{companyName}</span>}
                <span className="font-mono opacity-60">PV 2026-001</span>
              </div>
              <div className="relative mt-3 space-y-1 opacity-70">
                <div className="h-1.5 w-2/3 rounded bg-neutral-300" />
                <div className="h-1.5 w-1/2 rounded bg-neutral-300" />
                <div className="h-1.5 w-3/4 rounded bg-neutral-300" />
                {extras.watermark && (
                  <span className="pointer-events-none absolute inset-0 grid place-items-center text-3xl font-bold tracking-widest opacity-10 -rotate-12">{extras.watermark}</span>
                )}
              </div>
              <div className="mt-4 border-t pt-2 text-[10px] opacity-60">{extras.pdfFooter}</div>
            </div>
          </Preview>
        </div>
      </Card>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          L'identité légale (SIREN, SIRET, adresse) se modifie depuis <Link className="underline" to="/entreprise">Entreprise</Link>.
        </p>
        <Button onClick={save} disabled={saving || !can("admin")}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Enregistrer
        </Button>
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
