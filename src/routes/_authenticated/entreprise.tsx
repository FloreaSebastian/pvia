import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Building2, Save, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useCompany } from "@/hooks/use-company";
import { updateCompanyBranding } from "@/lib/branding.functions";

export const Route = createFileRoute("/_authenticated/entreprise")({
  component: CompanyPage,
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

function CompanyPage() {
  const { activeCompanyId, can, refresh } = useCompany();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<CompanyForm>(empty);
  const editable = can("admin");
  const save = useServerFn(updateCompanyBranding);

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
    if (form.siren && !/^\d{9}$/.test(form.siren)) return toast.error("SIREN : 9 chiffres requis");
    if (form.siret && !/^\d{14}$/.test(form.siret)) return toast.error("SIRET : 14 chiffres requis");
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

      <Card className="p-6">
        <form onSubmit={onSubmit} className="space-y-6">
          {/* Logo */}
          <div className="flex items-center gap-4">
            <div className="grid h-20 w-20 place-items-center overflow-hidden rounded-xl border border-border bg-muted">
              {form.logo_url ? (
                <img src={form.logo_url} alt="logo" className="h-full w-full object-contain" />
              ) : (
                <Building2 className="h-8 w-8 text-muted-foreground" />
              )}
            </div>
            <div>
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

          {/* Identité */}
          <section className="space-y-4">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Identité légale</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label>Raison sociale *</Label>
                <Input required disabled={!editable} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <Label>Forme juridique</Label>
                <Input placeholder="SARL, SAS…" disabled={!editable} value={form.legal_form} onChange={(e) => setForm({ ...form, legal_form: e.target.value })} />
              </div>
              <div>
                <Label>TVA intracommunautaire</Label>
                <Input placeholder="FRXX999999999" disabled={!editable} value={form.vat_number} onChange={(e) => setForm({ ...form, vat_number: e.target.value.toUpperCase() })} />
              </div>
              <div>
                <Label>SIREN</Label>
                <Input maxLength={9} inputMode="numeric" disabled={!editable} value={form.siren} onChange={(e) => setForm({ ...form, siren: e.target.value.replace(/\D/g, "") })} />
              </div>
              <div>
                <Label>SIRET</Label>
                <Input maxLength={14} inputMode="numeric" disabled={!editable} value={form.siret} onChange={(e) => setForm({ ...form, siret: e.target.value.replace(/\D/g, "") })} />
              </div>
            </div>
          </section>

          {/* Adresse */}
          <section className="space-y-4">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Adresse</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label>Adresse ligne 1</Label>
                <Input disabled={!editable} value={form.address_line1} onChange={(e) => setForm({ ...form, address_line1: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <Label>Adresse ligne 2</Label>
                <Input disabled={!editable} value={form.address_line2} onChange={(e) => setForm({ ...form, address_line2: e.target.value })} />
              </div>
              <div>
                <Label>Code postal</Label>
                <Input disabled={!editable} value={form.postal_code} onChange={(e) => setForm({ ...form, postal_code: e.target.value })} />
              </div>
              <div>
                <Label>Ville</Label>
                <Input disabled={!editable} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
              </div>
              <div>
                <Label>Pays</Label>
                <Input disabled={!editable} value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />
              </div>
            </div>
          </section>

          {/* Contact */}
          <section className="space-y-4">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Contact</h2>
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
    </div>
  );
}
