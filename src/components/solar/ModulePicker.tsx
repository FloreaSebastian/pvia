/**
 * PVIA Module Database — sélecteur de panneau.
 *
 * Deux entrées : « Mes panneaux » (favoris + récents) et « Catalogue complet »
 * (recherche serveur paginée). Les dimensions affichées sont celles publiées
 * par la source ; une référence sans dimensions ne peut pas être choisie.
 */
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Search, Star, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  createCustomModule,
  getModuleShortlist,
  listModuleManufacturers,
  searchModules,
  setModuleFavorite,
} from "@/lib/solar-catalog.functions";
import {
  CONFIDENCE_LABELS,
  formatModuleDimensions,
  formatModuleMeters,
  hasUsableDimensions,
  MISSING_DIMENSIONS_MESSAGE,
  STATUS_LABELS,
  type ModuleListItem,
} from "@/lib/solar/module-catalog";

export function ModulePicker({
  companyId,
  value,
  onChange,
  disabled,
}: {
  companyId: string | null;
  value: ModuleListItem | null;
  onChange: (item: ModuleListItem) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-1.5">
      <Label>Panneau photovoltaïque</Label>
      <Button
        type="button"
        variant="outline"
        className="min-h-11 w-full justify-start text-left"
        disabled={disabled || !companyId}
        onClick={() => setOpen(true)}
      >
        {value ? (
          <span className="truncate">
            {value.manufacturer} {value.model} — {value.power_wc} Wc · {formatModuleDimensions(value)}
          </span>
        ) : (
          <span className="text-muted-foreground">Choisir une référence du catalogue</span>
        )}
      </Button>
      {value && (
        <p className="text-xs text-muted-foreground">
          {formatModuleMeters(value)} · {CONFIDENCE_LABELS[value.confidence]}
          {value.source ? ` · ${value.source}` : ""}
        </p>
      )}
      {companyId && (
        <ModuleDialog
          companyId={companyId}
          open={open}
          onOpenChange={setOpen}
          onPick={(item) => {
            onChange(item);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function ModuleDialog({
  companyId,
  open,
  onOpenChange,
  onPick,
}: {
  companyId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPick: (item: ModuleListItem) => void;
}) {
  const searchFn = useServerFn(searchModules);
  const shortlistFn = useServerFn(getModuleShortlist);
  const makersFn = useServerFn(listModuleManufacturers);
  const favoriteFn = useServerFn(setModuleFavorite);

  const [tab, setTab] = useState("mine");
  const [query, setQuery] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [makers, setMakers] = useState<{ id: string; name: string }[]>([]);
  const [items, setItems] = useState<ModuleListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [shortlist, setShortlist] = useState<{ favorites: ModuleListItem[]; recents: ModuleListItem[] }>({
    favorites: [],
    recents: [],
  });
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const refreshShortlist = useCallback(() => {
    shortlistFn({ data: { companyId } })
      .then((s) => setShortlist({ favorites: s.favorites, recents: s.recents }))
      .catch(() => undefined);
  }, [companyId, shortlistFn]);

  useEffect(() => {
    if (!open) return;
    refreshShortlist();
    makersFn({ data: { companyId } })
      .then((m) => setMakers(m as { id: string; name: string }[]))
      .catch(() => undefined);
  }, [companyId, makersFn, open, refreshShortlist]);

  const runSearch = useCallback(
    async (nextPage = 0) => {
      setBusy(true);
      try {
        const maker = makers.find((m) => m.name === manufacturer);
        const res = await searchFn({
          data: {
            companyId,
            query,
            manufacturerId: maker?.id ?? null,
            withDimensionsOnly: true,
            page: nextPage,
            pageSize: 20,
          },
        });
        setItems(res.items as ModuleListItem[]);
        setTotal(res.total);
        setPage(nextPage);
      } catch {
        toast.error("Recherche du catalogue impossible.");
      } finally {
        setBusy(false);
      }
    },
    [companyId, makers, manufacturer, query, searchFn],
  );

  useEffect(() => {
    if (open && tab === "all" && !items.length) void runSearch(0);
  }, [items.length, open, runSearch, tab]);

  const toggleFavorite = async (item: ModuleListItem) => {
    try {
      await favoriteFn({ data: { companyId, variantId: item.variant_id, favorite: !item.is_favorite } });
      setItems((prev) =>
        prev.map((i) => (i.variant_id === item.variant_id ? { ...i, is_favorite: !i.is_favorite } : i)),
      );
      refreshShortlist();
    } catch {
      toast.error("Modification des favoris impossible.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Catalogue de panneaux</DialogTitle>
          <DialogDescription>
            Les dimensions affichées sont celles publiées par la source. Aucune valeur n'est estimée.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="mine">Mes panneaux</TabsTrigger>
            <TabsTrigger value="all">Catalogue complet</TabsTrigger>
          </TabsList>

          <TabsContent value="mine" className="space-y-4 pt-3">
            <ModuleGroup
              title="Favoris"
              items={shortlist.favorites}
              onPick={onPick}
              onToggleFavorite={toggleFavorite}
              empty="Aucun panneau en favori pour l'instant."
            />
            <ModuleGroup
              title="Utilisés récemment"
              items={shortlist.recents}
              onPick={onPick}
              onToggleFavorite={toggleFavorite}
              empty="Aucun panneau utilisé récemment."
            />
            <Button type="button" variant="outline" className="min-h-11" onClick={() => setAddOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Ajouter un panneau
            </Button>
          </TabsContent>

          <TabsContent value="all" className="space-y-3 pt-3">
            <div className="grid gap-2 sm:grid-cols-[1fr_200px_auto]">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void runSearch(0);
                }}
                placeholder="Fabricant, modèle ou puissance"
                aria-label="Rechercher un panneau"
                className="min-h-11"
              />
              <Input
                list="pvia-makers"
                value={manufacturer}
                onChange={(e) => setManufacturer(e.target.value)}
                placeholder="Tous les fabricants"
                aria-label="Filtrer par fabricant"
                className="min-h-11"
              />
              <datalist id="pvia-makers">
                {makers.map((m) => (
                  <option key={m.id} value={m.name} />
                ))}
              </datalist>
              <Button type="button" className="min-h-11" disabled={busy} onClick={() => runSearch(0)}>
                <Search className="mr-2 h-4 w-4" /> Rechercher
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              {busy ? "Recherche en cours…" : `${total} références avec dimensions publiées`}
            </p>

            <ModuleGroup
              title=""
              items={items}
              onPick={onPick}
              onToggleFavorite={toggleFavorite}
              empty="Aucune référence ne correspond à cette recherche."
            />

            <div className="flex items-center justify-between">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11"
                disabled={busy || page === 0}
                onClick={() => runSearch(page - 1)}
              >
                Précédent
              </Button>
              <span className="text-xs text-muted-foreground">Page {page + 1}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11"
                disabled={busy || items.length < 20}
                onClick={() => runSearch(page + 1)}
              >
                Suivant
              </Button>
            </div>
          </TabsContent>
        </Tabs>

        <AddModuleDialog
          companyId={companyId}
          open={addOpen}
          onOpenChange={setAddOpen}
          onCreated={() => {
            setAddOpen(false);
            refreshShortlist();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function ModuleGroup({
  title,
  items,
  empty,
  onPick,
  onToggleFavorite,
}: {
  title: string;
  items: ModuleListItem[];
  empty: string;
  onPick: (item: ModuleListItem) => void;
  onToggleFavorite: (item: ModuleListItem) => void;
}) {
  return (
    <div className="space-y-2">
      {title && <h3 className="text-sm font-medium">{title}</h3>}
      {!items.length && <p className="text-xs text-muted-foreground">{empty}</p>}
      <ul className="grid gap-2 sm:grid-cols-2">
        {items.map((m) => {
          const usable = hasUsableDimensions(m);
          return (
            <li key={m.variant_id}>
              <Card className="flex h-full flex-col gap-2 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{m.manufacturer}</p>
                    <p className="truncate text-sm">{m.model}</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11 shrink-0"
                    aria-label={m.is_favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
                    onClick={() => onToggleFavorite(m)}
                  >
                    <Star className={m.is_favorite ? "h-4 w-4 fill-current" : "h-4 w-4"} />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="secondary">{m.power_wc} Wc</Badge>
                  <Badge variant="outline">{formatModuleDimensions(m)}</Badge>
                  {m.is_company && <Badge variant="outline">Entreprise</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">
                  {CONFIDENCE_LABELS[m.confidence]} · {STATUS_LABELS[m.status]}
                </p>
                {usable ? (
                  <Button type="button" size="sm" className="mt-auto min-h-11" onClick={() => onPick(m)}>
                    Utiliser ce panneau
                  </Button>
                ) : (
                  <p className="mt-auto text-xs text-destructive">{MISSING_DIMENSIONS_MESSAGE}</p>
                )}
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function AddModuleDialog({
  companyId,
  open,
  onOpenChange,
  onCreated,
}: {
  companyId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const createFn = useServerFn(createCustomModule);
  const [form, setForm] = useState({
    manufacturer: "",
    model: "",
    power_wc: "",
    width_mm: "",
    height_mm: "",
    depth_mm: "",
  });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await createFn({
        data: {
          companyId,
          manufacturer: form.manufacturer.trim(),
          model: form.model.trim(),
          power_wc: Math.round(Number(form.power_wc)),
          width_mm: Math.round(Number(form.width_mm)),
          height_mm: Math.round(Number(form.height_mm)),
          depth_mm: form.depth_mm ? Math.round(Number(form.depth_mm)) : null,
        },
      });
      toast.success("Panneau ajouté au catalogue de l'entreprise.");
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ajout impossible.");
    } finally {
      setBusy(false);
    }
  };

  const field = (key: keyof typeof form, label: string, type = "text") => (
    <div className="space-y-1.5">
      <Label htmlFor={`mod-${key}`}>{label}</Label>
      <Input
        id={`mod-${key}`}
        type={type}
        value={form[key]}
        className="min-h-11"
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
      />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Ajouter un panneau</DialogTitle>
          <DialogDescription>
            Reportez les valeurs exactes de la fiche technique du fabricant.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {field("manufacturer", "Fabricant")}
          {field("model", "Modèle")}
          {field("power_wc", "Puissance (Wc)", "number")}
          {field("width_mm", "Largeur (mm)", "number")}
          {field("height_mm", "Hauteur (mm)", "number")}
          {field("depth_mm", "Épaisseur (mm)", "number")}
        </div>
        <DialogFooter>
          <Button type="button" className="min-h-11" disabled={busy} onClick={submit}>
            {busy ? "Enregistrement…" : "Ajouter au catalogue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
