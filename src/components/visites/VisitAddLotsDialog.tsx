import { useState } from "react";
import { Check, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { addVisitLots } from "@/lib/visites.functions";
import { BTP_LOT_OPTIONS } from "@/lib/visites/templates";
import type { VisitLot } from "@/lib/visites/types";
import { useBillingGate } from "@/components/billing/BillingGate";

interface Props {
  companyId: string;
  visitId: string;
  currentLots: string[];
  onAdded: () => void | Promise<void>;
}

/** Ajout de lots à une visite BTP en cours : aucune réponse ni photo n'est retirée. */
export function VisitAddLotsDialog({ companyId, visitId, currentLots, onAdded }: Props) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<VisitLot[]>([]);
  const [busy, setBusy] = useState(false);
  const addFn = useServerFn(addVisitLots);
  const { requireWrite } = useBillingGate();
  const available = BTP_LOT_OPTIONS.filter((o) => !currentLots.includes(o.value));
  if (available.length === 0) return null;

  async function submit() {
    if (!picked.length || !requireWrite("ajouter un lot")) return;
    setBusy(true);
    try {
      await addFn({ data: { companyId, visitId, lots: picked } });
      toast.success(picked.length > 1 ? "Lots ajoutés" : "Lot ajouté");
      setOpen(false);
      setPicked([]);
      await onAdded();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Ajout impossible");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button type="button" variant="outline" className="h-11" onClick={() => setOpen(true)}>
        <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
        Ajouter un lot
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] max-w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Ajouter des lots</DialogTitle>
            <DialogDescription>
              Les relevés des lots ajoutés apparaissent à l'étape « Relevés métier ». Les réponses et photos déjà saisies sont conservées. Un lot ne peut pas être retiré ensuite.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 sm:grid-cols-2">
            {available.map((o) => {
              const on = picked.includes(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setPicked((p) => (on ? p.filter((x) => x !== o.value) : [...p, o.value]))}
                  className={`flex min-h-12 items-center gap-3 rounded-lg border p-3 text-left text-sm ${on ? "border-primary bg-primary/5 ring-1 ring-primary" : ""}`}
                >
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded border ${on ? "border-primary bg-primary text-primary-foreground" : ""}`}>
                    {on ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
                  </span>
                  <span className="min-w-0 break-words">{o.label}</span>
                </button>
              );
            })}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" className="h-11" onClick={() => setOpen(false)}>Annuler</Button>
            <Button type="button" className="h-11" onClick={submit} disabled={busy || picked.length === 0}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Ajouter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
