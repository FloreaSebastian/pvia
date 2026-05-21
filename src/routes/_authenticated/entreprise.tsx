import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Building2, Save, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useCompany } from "@/hooks/use-company";

export const Route = createFileRoute("/_authenticated/entreprise")({
  component: CompanyPage,
  head: () => ({ meta: [{ title: "Entreprise — PVIA" }] }),
});

type CompanyForm = {
  name: string;
  siret: string;
  address: string;
  phone: string;
  email: string;
  logo_url: string;
};

function CompanyPage() {
  const { activeCompanyId, can, refresh } = useCompany();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<CompanyForm>({
    name: "",
    siret: "",
    address: "",
    phone: "",
    email: "",
    logo_url: "",
  });
  const editable = can("admin");

  useEffect(() => {
    (async () => {
      if (!activeCompanyId) return;
      setLoading(true);
      const { data } = await supabase
        .from("companies")
        .select("name,siret,address,phone,email,logo_url")
        .eq("id", activeCompanyId)
        .single();
      if (data) {
        setForm({
          name: data.name ?? "",
          siret: data.siret ?? "",
          address: data.address ?? "",
          phone: data.phone ?? "",
          email: data.email ?? "",
          logo_url: data.logo_url ?? "",
        });
      }
      setLoading(false);
    })();
  }, [activeCompanyId]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!activeCompanyId) return;
    setSaving(true);
    const { error } = await supabase
      .from("companies")
      .update({
        name: form.name,
        siret: form.siret || null,
        address: form.address || null,
        phone: form.phone || null,
        email: form.email || null,
        logo_url: form.logo_url || null,
      })
      .eq("id", activeCompanyId);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Entreprise mise à jour");
    refresh();
  }

  async function uploadLogo(file: File) {
    if (!activeCompanyId) return;
    const path = `${activeCompanyId}/logo-${Date.now()}-${file.name}`;
    const up = await supabase.storage.from("pv-assets").upload(path, file, { upsert: true });
    if (up.error) return toast.error(up.error.message);
    const { data } = await supabase.storage.from("pv-assets").createSignedUrl(path, 60 * 60 * 24 * 365);
    if (data?.signedUrl) {
      setForm((f) => ({ ...f, logo_url: data.signedUrl }));
      toast.success("Logo téléversé");
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
          Informations utilisées sur tous les PV générés.
        </p>
      </div>

      <Card className="p-6">
        <form onSubmit={save} className="space-y-5">
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

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>Nom de l'entreprise *</Label>
              <Input
                required
                disabled={!editable}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <Label>SIRET</Label>
              <Input
                disabled={!editable}
                value={form.siret}
                onChange={(e) => setForm({ ...form, siret: e.target.value })}
              />
            </div>
            <div>
              <Label>Téléphone</Label>
              <Input
                disabled={!editable}
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <Label>Email</Label>
              <Input
                type="email"
                disabled={!editable}
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <Label>Adresse</Label>
              <Textarea
                disabled={!editable}
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </div>
          </div>

          {editable ? (
            <div className="flex justify-end">
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
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
