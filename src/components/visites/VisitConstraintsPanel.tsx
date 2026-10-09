import { useState } from "react";
import { Plus, Pencil, Trash2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { saveVisitConstraint, deleteVisitConstraint } from "@/lib/visites.functions";
import { ConstraintLevelBadge } from "@/components/visites/VisitStatusBadge";
import { useBillingGate } from "@/components/billing/BillingGate";
import {
  CONSTRAINT_CATEGORY_LABEL, CONSTRAINT_LEVEL_META,
  type ConstraintCategory, type ConstraintLevel, type VisitLot,
} from "@/lib/visites/types";
import { LOT_META } from "@/lib/visites/templates";
import { cn } from "@/lib/utils";

export interface VisitConstraintRow {
  id: string;
  section_key: string | null;
  category: string;
  level: string;
  title: string;
  description: string | null;
  recommendation: string | null;
  location?: string | null;
  responsible?: string | null;
  lot?: string | null;
  photo_paths?: string[] | null;
  created_at?: string | null;
}

export interface LinkablePhoto {
  storage_path: string;
  signed_url?: string | null;
  caption?: string | null;
}

interface Props {
  companyId: string;
  visitId: string;
  sectionKey: string;
  constraints: VisitConstraintRow[];
  canEdit: boolean;
  onChanged: () => void | Promise<void>;
  /** Photos déjà prises dans la visite, liables à un point d'attention. */
  photos?: LinkablePhoto[];
  /** Lots de la visite (BTP). */
  lots?: VisitLot[];
}

const EMPTY = {
  id: undefined as string | undefined,
  category: "acces" as ConstraintCategory,
  level: "a_verifier" as ConstraintLevel,
  title: "",
  description: "",
  recommendation: "",
  location: "",
  responsible: "",
  lot: null as VisitLot | null,
  photo_paths: [] as string[],
};

/** Étape « Contraintes & points de vigilance ». */
export function VisitConstraintsPanel({ companyId, visitId, sectionKey, constraints, canEdit, onChanged, photos = [], lots = [] }: Props) {
  const photoUrl = new Map(photos.map((p) => [p.storage_path, p.signed_url ?? null]));
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const { requireWrite } = useBillingGate();
  const saveFn = useServerFn(saveVisitConstraint);
  const delFn = useServerFn(deleteVisitConstraint);

  function openNew() {
    setForm(EMPTY);
    setOpen(true);
  }
  function openEdit(c: VisitConstraintRow) {
    setForm({
      id: c.id,
      category: c.category as ConstraintCategory,
      level: c.level as ConstraintLevel,
      title: c.title,
      description: c.description ?? "",
      recommendation: c.recommendation ?? "",
      location: c.location ?? "",
      responsible: c.responsible ?? "",
      lot: (c.lot as VisitLot | null) ?? null,
      photo_paths: c.photo_paths ?? [],
    });
    setOpen(true);
  }

  async function submit() {
    if (!requireWrite("enregistrer une contrainte")) return;
    if (!form.title.trim()) {
      toast.error("Le titre est requis.");
      return;
    }
    setBusy(true);
    try {
      await saveFn({
        data: {
          companyId, visitId,
          constraint: {
            id: form.id,
            section_key: sectionKey,
            category: form.category,
            level: form.level,
            title: form.title.trim(),
            description: form.description.trim(),
            recommendation: form.recommendation.trim(),
            location: form.location.trim(),
            responsible: form.responsible.trim(),
            lot: form.lot,
            photo_paths: form.photo_paths,
          },
        },
      });
      setOpen(false);
      toast.success(form.id ? "Point d'attention mis à jour" : "Point d'attention ajouté");
      await onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Enregistrement impossible");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!requireWrite("supprimer une contrainte")) return;
    setBusy(true);
    try {
      await delFn({ data: { companyId, visitId, constraintId: id } });
      setPendingDelete(null);
      await onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Suppression impossible");
    } finally {
      setBusy(false);
    }
  }

  const blocking = constraints.filter((c) => c.level === "bloquant").length;

  return (
    <div className="min-w-0 space-y-3">
      {blocking > 0 ? (
        <p className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950/40 dark:text-red-200">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0">
            {blocking} point{blocking > 1 ? "s" : ""} bloquant{blocking > 1 ? "s" : ""} : l'installation ne peut pas être
            lancée sans lever ces contraintes.
          </span>
        </p>
      ) : null}

      {constraints.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          Aucun point d'attention signalé. Ajoutez tout constat nécessitant une action (constat de visite, distinct des réserves de fin de travaux).
        </p>
      ) : (
        <ul className="space-y-2">
          {constraints.map((c) => (
            <li key={c.id} className="min-w-0 rounded-xl border p-3">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <ConstraintLevelBadge level={c.level} />
                <span className="text-xs text-muted-foreground">
                  {CONSTRAINT_CATEGORY_LABEL[c.category as ConstraintCategory] ?? c.category}
                </span>
              </div>
              <p className="mt-1.5 break-words text-sm font-medium">{c.title}</p>
              {c.description ? <p className="mt-1 break-words text-sm text-muted-foreground">{c.description}</p> : null}
              {c.lot && LOT_META[c.lot as VisitLot] ? (
                <p className="mt-1 text-xs text-muted-foreground">Lot : {LOT_META[c.lot as VisitLot].label}</p>
              ) : null}
              {c.location ? (
                <p className="mt-1 break-words text-sm"><span className="font-medium">Emplacement : </span>{c.location}</p>
              ) : null}
              {c.recommendation ? (
                <p className="mt-1 break-words text-sm">
                  <span className="font-medium">Action : </span>
                  {c.recommendation}
                </p>
              ) : null}
              {c.responsible ? (
                <p className="mt-1 break-words text-sm"><span className="font-medium">Responsable : </span>{c.responsible}</p>
              ) : null}
              {(c.photo_paths ?? []).length ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {(c.photo_paths ?? []).map((path) =>
                    photoUrl.get(path) ? (
                      <img key={path} src={photoUrl.get(path)!} alt="Photo liée" className="h-16 w-16 rounded-md border object-cover" />
                    ) : (
                      <span key={path} className="rounded-md border px-2 py-1 text-xs text-muted-foreground">Photo non disponible</span>
                    ),
                  )}
                </div>
              ) : null}
              {canEdit ? (
                <div className="mt-2 flex gap-2">
                  <Button type="button" size="sm" variant="outline" className="h-11" onClick={() => openEdit(c)}>
                    <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />
                    Modifier
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-11 text-destructive"
                    onClick={() => setPendingDelete(c.id)}
                    aria-label={`Supprimer la contrainte ${c.title}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canEdit ? (
        <Button type="button" variant="outline" className="h-11 w-full" onClick={openNew}>
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          Ajouter un point d'attention
        </Button>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] max-w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{form.id ? "Modifier le point d'attention" : "Nouveau point d'attention"}</DialogTitle>
            <DialogDescription>Emplacement, gravité, action et responsable apparaissent dans le rapport.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="c-cat">Catégorie</Label>
                <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v as ConstraintCategory }))}>
                  <SelectTrigger id="c-cat" className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(CONSTRAINT_CATEGORY_LABEL).map(([v, l]) => (
                      <SelectItem key={v} value={v} className="min-h-11">
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="c-level">Gravité</Label>
                <Select value={form.level} onValueChange={(v) => setForm((f) => ({ ...f, level: v as ConstraintLevel }))}>
                  <SelectTrigger id="c-level" className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(CONSTRAINT_LEVEL_META).map(([v, m]) => (
                      <SelectItem key={v} value={v} className="min-h-11">
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-title">Titre</Label>
              <Input
                id="c-title"
                className="h-11"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Ex. Tableau électrique saturé"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="c-loc">Emplacement</Label>
                <Input id="c-loc" className="h-11" value={form.location} placeholder="Ex. Façade nord, combles"
                  onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} />
              </div>
              {lots.length > 0 ? (
                <div className="space-y-2">
                  <Label htmlFor="c-lot">Lot concerné</Label>
                  <Select value={form.lot ?? "none"} onValueChange={(v) => setForm((f) => ({ ...f, lot: v === "none" ? null : (v as VisitLot) }))}>
                    <SelectTrigger id="c-lot" className="h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none" className="min-h-11">Tous / général</SelectItem>
                      {lots.map((l) => (
                        <SelectItem key={l} value={l} className="min-h-11">{LOT_META[l].label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-desc">Description</Label>
              <Textarea
                id="c-desc"
                rows={3}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-reco">Action à mener</Label>
              <Textarea
                id="c-reco"
                rows={2}
                value={form.recommendation}
                onChange={(e) => setForm((f) => ({ ...f, recommendation: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-resp">Responsable</Label>
              <Input id="c-resp" className="h-11" value={form.responsible} placeholder="Ex. Client, conducteur de travaux, électricien"
                onChange={(e) => setForm((f) => ({ ...f, responsible: e.target.value }))} />
            </div>
            {photos.length > 0 ? (
              <div className="space-y-2">
                <Label>Photos liées ({form.photo_paths.length}/10)</Label>
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                  {photos.map((ph) => {
                    const on = form.photo_paths.includes(ph.storage_path);
                    return (
                      <button
                        key={ph.storage_path}
                        type="button"
                        aria-pressed={on}
                        aria-label={on ? "Retirer cette photo" : "Lier cette photo"}
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            photo_paths: on
                              ? f.photo_paths.filter((x) => x !== ph.storage_path)
                              : f.photo_paths.length >= 10 ? f.photo_paths : [...f.photo_paths, ph.storage_path],
                          }))
                        }
                        className={cn("aspect-square overflow-hidden rounded-md border-2", on ? "border-primary" : "border-transparent")}
                      >
                        {ph.signed_url ? (
                          <img src={ph.signed_url} alt={ph.caption ?? "Photo de la visite"} className="h-full w-full object-cover" />
                        ) : (
                          <span className="text-[10px] text-muted-foreground">Indisponible</span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">Prenez d'abord la photo dans l'étape concernée, puis liez-la ici.</p>
              </div>
            ) : null}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" className="h-11" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button type="button" className="h-11" onClick={submit} disabled={busy}>
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Supprimer ce point d'attention ?</DialogTitle>
            <DialogDescription>Cette action est définitive.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" className="h-11" onClick={() => setPendingDelete(null)}>
              Annuler
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="h-11"
              onClick={() => pendingDelete && remove(pendingDelete)}
              disabled={busy}
            >
              Supprimer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
