/**
 * Ajout d'une référence onduleur manuelle (entreprise), provenance obligatoire.
 * Champ laissé vide = donnée non publiée (null), jamais une valeur par défaut.
 */
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createManualInverter } from "@/lib/solar-electrical.functions";

const NUMERIC: { key: string; label: string; micro?: boolean; string?: boolean }[] = [
  { key: "ac_power_w", label: "Puissance AC (W)" },
  { key: "mppt_count", label: "Nombre de MPPT", string: true },
  { key: "inputs_per_mppt", label: "Entrées par MPPT", string: true },
  { key: "vdc_max_v", label: "Vdc max (V)", string: true },
  { key: "mppt_vmin_v", label: "MPPT min (V)" },
  { key: "mppt_vmax_v", label: "MPPT max (V)" },
  { key: "start_voltage_v", label: "Tension de démarrage (V)", string: true },
  { key: "imax_mppt_a", label: "Courant max par MPPT (A)", string: true },
  { key: "imax_input_a", label: "Courant max par entrée (A)", string: true },
  { key: "isc_max_mppt_a", label: "Isc max par MPPT (A)", string: true },
  { key: "dc_power_max_w", label: "Puissance DC max (W)", string: true },
  { key: "dc_ac_ratio_max", label: "Ratio DC/AC max constructeur" },
  { key: "micro_inputs", label: "Entrées par micro-onduleur", micro: true },
  { key: "micro_input_vmax_v", label: "Tension max par entrée (V)", micro: true },
  { key: "micro_input_imax_a", label: "Courant max par entrée (A)", micro: true },
  { key: "micro_input_isc_max_a", label: "Isc max par entrée (A)", micro: true },
  { key: "micro_input_power_max_w", label: "Puissance max par entrée (W)", micro: true },
];

export function ManualInverterDialog(props: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  companyId: string;
  onCreated: (id: string) => void | Promise<void>;
}) {
  const create = useServerFn(createManualInverter);
  const [kind, setKind] = useState<"string" | "hybride" | "micro">("string");
  const [phase, setPhase] = useState<"" | "mono" | "tri">("");
  const [f, setF] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: string, v: string) => setF((cur) => ({ ...cur, [k]: v }));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const spec: Record<string, unknown> = {
        provenance: f.provenance ?? "",
        datasheet_url: f.datasheet_url?.trim() || null,
        datasheet_version: f.datasheet_version?.trim() || null,
        phase: phase || null,
      };
      for (const n of NUMERIC) {
        const raw = f[n.key]?.replace(",", ".").trim();
        if (!raw) {
          spec[n.key] = null;
          continue;
        }
        const v = Number(raw);
        if (!Number.isFinite(v)) throw new Error(`${n.label} : valeur invalide.`);
        spec[n.key] = v;
      }
      const res = await create({
        data: {
          companyId: props.companyId,
          inverter: {
            manufacturer: f.manufacturer ?? "",
            series: f.series || null,
            model: f.model ?? "",
            kind,
          },
          spec: spec as never,
        },
      });
      props.onOpenChange(false);
      setF({});
      await props.onCreated(res.id);
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^\[.*?\]\s*/, "") : "Création impossible.");
    } finally {
      setBusy(false);
    }
  };

  const fields = NUMERIC.filter((n) => (kind === "micro" ? !n.string : !n.micro));
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Référence onduleur manuelle</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Recopiez uniquement les valeurs publiées sur la fiche technique. Laissez vide ce qui n'est
          pas publié : le contrôle correspondant sera « non vérifiable ».
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Fabricant *</Label>
            <Input
              className="min-h-11"
              value={f.manufacturer ?? ""}
              onChange={(e) => set("manufacturer", e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">Modèle *</Label>
            <Input
              className="min-h-11"
              value={f.model ?? ""}
              onChange={(e) => set("model", e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">Série</Label>
            <Input
              className="min-h-11"
              value={f.series ?? ""}
              onChange={(e) => set("series", e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">Type *</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
              <SelectTrigger className="min-h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="string">String</SelectItem>
                <SelectItem value="hybride">Hybride</SelectItem>
                <SelectItem value="micro">Micro-onduleur</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Phase</Label>
            <Select
              value={phase || "none"}
              onValueChange={(v) => setPhase(v === "none" ? "" : (v as "mono" | "tri"))}
            >
              <SelectTrigger className="min-h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Non renseignée</SelectItem>
                <SelectItem value="mono">Monophasé</SelectItem>
                <SelectItem value="tri">Triphasé</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {fields.map((n) => (
            <div key={n.key}>
              <Label className="text-xs">{n.label}</Label>
              <Input
                inputMode="decimal"
                className="min-h-11"
                value={f[n.key] ?? ""}
                onChange={(e) => set(n.key, e.target.value)}
              />
            </div>
          ))}
          <div className="col-span-2">
            <Label className="text-xs">Provenance * (fiche, version, date)</Label>
            <Input
              className="min-h-11"
              value={f.provenance ?? ""}
              onChange={(e) => set("provenance", e.target.value)}
            />
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Lien fiche technique</Label>
            <Input
              className="min-h-11"
              value={f.datasheet_url ?? ""}
              onChange={(e) => set("datasheet_url", e.target.value)}
            />
          </div>
        </div>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" className="min-h-11" onClick={() => props.onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            className="min-h-11"
            disabled={busy || !f.manufacturer || !f.model || !f.provenance}
            onClick={() => void submit()}
          >
            {busy ? "Création…" : "Ajouter"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
