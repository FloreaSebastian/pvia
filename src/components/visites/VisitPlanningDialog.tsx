import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { listVisitAssignees, updateTechnicalVisit } from "@/lib/visites.functions";
import { localInputToIso, isoToLocalInputs } from "@/lib/visites/planning";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  companyId: string;
  visit: {
    id: string;
    scheduled_at: string | null;
    assigned_to: string | null;
    site_contact_name: string | null;
    site_contact_phone: string | null;
    prep_notes: string | null;
  };
  onSaved: () => void | Promise<void>;
}

const NONE = "__none__";

/** Modification de la planification (date, technicien, contact) — calendrier synchronisé côté serveur. */
export function VisitPlanningDialog({ open, onOpenChange, companyId, visit, onSaved }: Props) {
  const listFn = useServerFn(listVisitAssignees);
  const saveFn = useServerFn(updateTechnicalVisit);
  const [assignees, setAssignees] = useState<{ id: string; name: string }[]>([]);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [assigned, setAssigned] = useState<string>(NONE);
  const [contact, setContact] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const { date: d, time: t } = isoToLocalInputs(visit.scheduled_at);
    setDate(d);
    setTime(t);
    setAssigned(visit.assigned_to ?? NONE);
    setContact(visit.site_contact_name ?? "");
    setPhone(visit.site_contact_phone ?? "");
    setNotes(visit.prep_notes ?? "");
    setError(null);
    listFn({ data: { companyId } })
      .then((r) => setAssignees(r.assignees))
      .catch(() => setAssignees([]));
  }, [open, visit, companyId, listFn]);

  async function save() {
    setError(null);
    if (time && !date) return setError("Indiquez la date de la visite.");
    if (phone && !/^\+?[0-9 .-]{6,20}$/.test(phone.trim())) return setError("Téléphone du contact invalide.");
    const scheduled = date ? localInputToIso(date, time || "09:00") : null;
    if (date && !scheduled) return setError("Date ou heure invalide.");
    setBusy(true);
    try {
      const res = await saveFn({
        data: {
          companyId,
          visitId: visit.id,
          planning: {
            scheduled_at: scheduled,
            assigned_to: assigned === NONE ? null : assigned,
            site_contact_name: contact.trim(),
            site_contact_phone: phone.trim(),
            prep_notes: notes.trim(),
          },
        },
      });
      toast.success(
        res.calendar === "created"
          ? "Planification enregistrée et ajoutée au calendrier."
          : res.calendar === "cancelled"
            ? "Date retirée : le rendez-vous du calendrier est annulé."
            : "Planification enregistrée.",
      );
      onOpenChange(false);
      await onSaved();
    } catch (e: any) {
      setError(e?.message ?? "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Planification</DialogTitle>
          <DialogDescription>Date et heure de Paris, technicien et contact sur site. Le calendrier est mis à jour automatiquement.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pl-date">Date</Label>
              <Input id="pl-date" type="date" className="h-11" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pl-time">Heure</Label>
              <Input id="pl-time" type="time" className="h-11" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>
          {date ? (
            <Button type="button" variant="ghost" size="sm" className="h-9 px-2" onClick={() => { setDate(""); setTime(""); }}>
              Retirer la date
            </Button>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="pl-assignee">Technicien</Label>
            <Select value={assigned} onValueChange={setAssigned}>
              <SelectTrigger id="pl-assignee" className="h-11">
                <SelectValue placeholder="Non assignée" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE} className="min-h-11">Non assignée</SelectItem>
                {assignees.map((a) => (
                  <SelectItem key={a.id} value={a.id} className="min-h-11">{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pl-contact">Contact sur site</Label>
            <Input id="pl-contact" className="h-11" maxLength={150} value={contact} onChange={(e) => setContact(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pl-phone">Téléphone du contact</Label>
            <Input id="pl-phone" type="tel" inputMode="tel" className="h-11" maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pl-notes">Notes de préparation</Label>
            <Textarea id="pl-notes" rows={3} maxLength={5000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" className="h-11" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button type="button" className="h-11" onClick={() => void save()} disabled={busy}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
