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
import {
  CONSTRAINT_CATEGORY_LABEL, CONSTRAINT_LEVEL_META,
  type ConstraintCategory, type ConstraintLevel,
} from "@/lib/visites/types";

export interface VisitConstraintRow {
  id: string;
  section_key: string | null;
  category: string;
  level: string;
  title: string;
  description: string | null;
  recommendation: string | null;
  created_at?: string | null;
}

interface Props {
  companyId: string;
  visitId: string;
  sectionKey: string;
  constraints: VisitConstraintRow[];
  canEdit: boolean;
  onChanged: () => void | Promise<void>;
}

const EMPTY = {
  id: undefined as string | undefined,
  category: "acces" as ConstraintCategory,
  level: "a_verifier" as ConstraintLevel,
  title: "",
  description: "",
  recommendation: "",
};

/** Étape « Contraintes & points de vigilance ». */
export function VisitConstraintsPanel({ companyId, visitId, sectionKey, constraints, canEdit, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

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
    });
    setOpen(true);
  }

  async function submit() {
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
          },
        },
      });
      setOpen(false);
      toast.success(form.id ? "Contrainte mise à jour" : "Contrainte ajoutée");
      await onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Enregistrement impossible");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
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
          Aucune contrainte signalée. Ajoutez tout point de vigilance repéré sur place.
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
              {c.recommendation ? (
                <p className="mt-1 break-words text-sm">
                  <span className="font-medium">Préconisation : </span>
                  {c.recommendation}
                </p>
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
          Ajouter une contrainte
        </Button>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] max-w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{form.id ? "Modifier la contrainte" : "Nouvelle contrainte"}</DialogTitle>
            <DialogDescription>Ces points apparaissent en tête du rapport de visite.</DialogDescription>
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
                <Label htmlFor="c-level">Niveau</Label>
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
              <Label htmlFor="c-reco">Préconisation</Label>
              <Textarea
                id="c-reco"
                rows={2}
                value={form.recommendation}
                onChange={(e) => setForm((f) => ({ ...f, recommendation: e.target.value }))}
              />
            </div>
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
            <DialogTitle>Supprimer cette contrainte ?</DialogTitle>
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
