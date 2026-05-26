import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Loader2, Save, Hash } from "lucide-react";
import { useCompany } from "@/hooks/use-company";
import { getPvNumberingSettings, savePvNumberingSettings } from "@/lib/pv-numbering.functions";

export const Route = createFileRoute("/_authenticated/parametres/numerotation")({
  component: NumerotationSettings,
  head: () => ({ meta: [{ title: "Numérotation PV — PVIA" }] }),
});

function NumerotationSettings() {
  const { activeCompanyId } = useCompany();
  const getFn = useServerFn(getPvNumberingSettings);
  const saveFn = useServerFn(savePvNumberingSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    pv_number_prefix: "PV",
    pv_number_include_year: true,
    pv_number_next: 1,
    pv_number_digits: 5,
    pv_number_separator: "-",
  });

  useEffect(() => {
    if (!activeCompanyId) return;
    setLoading(true);
    getFn({ data: { companyId: activeCompanyId } })
      .then((r) => setForm(r))
      .catch((e) => toast.error(e?.message || "Chargement impossible"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCompanyId]);

  const preview = useMemo(() => {
    const year = new Date().getFullYear();
    const num = String(form.pv_number_next).padStart(Math.max(1, form.pv_number_digits), "0");
    return form.pv_number_include_year
      ? `${form.pv_number_prefix}${form.pv_number_separator}${year}${form.pv_number_separator}${num}`
      : `${form.pv_number_prefix}${form.pv_number_separator}${num}`;
  }, [form]);

  async function onSave() {
    if (!activeCompanyId) return;
    setSaving(true);
    try {
      await saveFn({ data: { companyId: activeCompanyId, ...form } });
      toast.success("Paramètres de numérotation enregistrés.");
    } catch (e: any) {
      toast.error(e?.message || "Échec de l'enregistrement");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="grid h-64 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-semibold"><Hash className="h-5 w-5 text-primary" /> Numérotation des PV</h2>
        <p className="mt-1 text-sm text-muted-foreground">Définissez le format du numéro attribué automatiquement à chaque procès-verbal.</p>
      </div>

      <Card className="space-y-5 p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>Préfixe</Label>
            <Input value={form.pv_number_prefix} onChange={(e) => setForm({ ...form, pv_number_prefix: e.target.value })} maxLength={20} />
          </div>
          <div>
            <Label>Séparateur</Label>
            <Input value={form.pv_number_separator} onChange={(e) => setForm({ ...form, pv_number_separator: e.target.value })} maxLength={3} />
          </div>
          <div>
            <Label>Prochain numéro</Label>
            <Input type="number" min={1} value={form.pv_number_next} onChange={(e) => setForm({ ...form, pv_number_next: Math.max(1, Number(e.target.value) || 1) })} />
          </div>
          <div>
            <Label>Nombre de chiffres</Label>
            <Input type="number" min={1} max={8} value={form.pv_number_digits} onChange={(e) => setForm({ ...form, pv_number_digits: Math.min(8, Math.max(1, Number(e.target.value) || 5)) })} />
          </div>
          <div className="flex items-center gap-3 sm:col-span-2">
            <Switch checked={form.pv_number_include_year} onCheckedChange={(v) => setForm({ ...form, pv_number_include_year: v })} />
            <Label className="!mt-0">Inclure l'année</Label>
          </div>
        </div>

        <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Prochain numéro</div>
          <div className="mt-1 font-mono text-2xl font-bold text-primary">{preview}</div>
        </div>

        <div className="flex justify-end">
          <Button onClick={onSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Enregistrer
          </Button>
        </div>
      </Card>
    </div>
  );
}
