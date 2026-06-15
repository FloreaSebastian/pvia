import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  getComplianceChecklist,
  updateComplianceItem,
  listComplianceCompanies,
} from "@/lib/compliance.functions";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ShieldCheck, FileDown, ArrowLeft, AlertTriangle } from "lucide-react";

type Item = Awaited<ReturnType<typeof getComplianceChecklist>>[number];
type Company = Awaited<ReturnType<typeof listComplianceCompanies>>[number];

export const Route = createFileRoute("/_authenticated/admin/compliance")({
  component: Page,
  head: () => ({ meta: [{ title: "Admin · Conformité CNIL — PVIA" }] }),
  beforeLoad: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw redirect({ to: "/login" });
    const { isPlatformAdminEmail } = await import("@/lib/platform-admin");
    if (!isPlatformAdminEmail(user.email)) throw redirect({ to: "/admin/forbidden" });
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "platform_admin").maybeSingle();
    if (!data) throw redirect({ to: "/admin/forbidden" });
  },
});

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    todo: { label: "À faire", cls: "bg-amber-100 text-amber-800 border-amber-300" },
    in_progress: { label: "En cours", cls: "bg-blue-100 text-blue-800 border-blue-300" },
    done: { label: "Validé", cls: "bg-emerald-100 text-emerald-800 border-emerald-300" },
    na: { label: "N/A", cls: "bg-slate-100 text-slate-700 border-slate-300" },
  };
  const s = map[status] ?? map.todo;
  return <Badge variant="outline" className={s.cls}>{s.label}</Badge>;
}

function Page() {
  const listCompanies = useServerFn(listComplianceCompanies);
  const getList = useServerFn(getComplianceChecklist);
  const updateItem = useServerFn(updateComplianceItem);

  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [items, setItems] = useState<Item[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load companies list once
  useEffect(() => {
    (async () => {
      try {
        const list = await listCompanies();
        setCompanies(list);
      } catch (e: any) { setError(e?.message ?? "Erreur"); }
    })();
  }, [listCompanies]);

  // Load checklist when company explicitly selected
  useEffect(() => {
    if (!companyId) { setItems(null); return; }
    setLoading(true);
    getList({ data: { companyId } })
      .then(setItems)
      .catch((e) => setError(e?.message ?? "Erreur"))
      .finally(() => setLoading(false));
  }, [companyId, getList]);

  const grouped = useMemo(() => {
    if (!items) return [];
    const byCat = new Map<string, Item[]>();
    for (const it of items) {
      const arr = byCat.get(it.category) ?? [];
      arr.push(it);
      byCat.set(it.category, arr);
    }
    return Array.from(byCat.entries());
  }, [items]);

  const counts = useMemo(() => {
    const c = { todo: 0, in_progress: 0, done: 0, na: 0 };
    for (const it of items ?? []) (c as any)[it.status]++;
    return c;
  }, [items]);

  async function setStatus(item: Item, status: Item["status"]) {
    if (!companyId) return;
    setSaving(item.item_key);
    try {
      await updateItem({ data: { companyId, item_key: item.item_key, status, value: item.value ?? undefined, notes: item.notes ?? undefined } });
      setItems((prev) => prev?.map((p) => p.item_key === item.item_key ? { ...p, status } : p) ?? null);
    } catch (e: any) { setError(e?.message ?? "Erreur"); }
    finally { setSaving(null); }
  }

  function setNotes(item: Item, notes: string) {
    setItems((prev) => prev?.map((p) => p.item_key === item.item_key ? { ...p, notes } : p) ?? null);
  }
  async function persistNotes(item: Item) {
    if (!companyId) return;
    setSaving(item.item_key);
    try {
      await updateItem({ data: { companyId, item_key: item.item_key, status: item.status as any, value: item.value ?? undefined, notes: item.notes ?? undefined } });
    } catch (e: any) { setError(e?.message ?? "Erreur"); }
    finally { setSaving(null); }
  }

  function exportPdf() { window.print(); }

  if (error) {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <Card className="p-6 border-destructive bg-destructive/5">
          <div className="flex items-center gap-2 text-destructive font-semibold"><AlertTriangle className="h-4 w-4"/> {error}</div>
          <Link to="/admin/dashboard" className="text-sm underline mt-3 inline-block">Retour</Link>
        </Card>
      </div>
    );
  }

  const total = items?.length ?? 0;
  const progress = total > 0 ? Math.round(((counts.done + counts.na) / total) * 100) : 0;

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto print:p-0 print:max-w-none">
      <div className="flex items-center justify-between mb-6 print:hidden">
        <Link to="/admin/dashboard" className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:text-foreground">
          <ArrowLeft className="h-4 w-4"/> Admin
        </Link>
        {items && (
          <Button onClick={exportPdf} variant="outline" size="sm"><FileDown className="h-4 w-4 mr-2"/> Exporter PDF</Button>
        )}
      </div>

      <div className="mb-6">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5"/> Conformité CNIL / RGPD
        </div>
        <h1 className="text-2xl md:text-3xl font-bold mt-1">Checklist AIPD</h1>
        <p className="text-muted-foreground text-sm mt-2 max-w-3xl">
          Outil plateforme PVIA. Sélectionnez explicitement l'entreprise à auditer ;
          la checklist n'utilise jamais silencieusement l'entreprise active de votre compte admin.
          Les valeurs juridiques doivent être validées par le DPO.
        </p>
      </div>

      <Card className="p-4 mb-6 print:hidden">
        <label className="block text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
          Entreprise à auditer
        </label>
        {companies === null ? (
          <div className="text-sm text-muted-foreground inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin"/> Chargement des entreprises…
          </div>
        ) : (
          <Select value={companyId ?? ""} onValueChange={(v) => setCompanyId(v || null)}>
            <SelectTrigger className="max-w-md">
              <SelectValue placeholder="— Choisir une entreprise —" />
            </SelectTrigger>
            <SelectContent>
              {companies.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}{c.email ? ` · ${c.email}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Card>

      {!companyId && (
        <Card className="p-6 text-sm text-muted-foreground">
          Sélectionnez une entreprise ci-dessus pour afficher sa checklist de conformité.
        </Card>
      )}

      {companyId && loading && (
        <div className="p-8 flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin"/> Chargement…
        </div>
      )}

      {companyId && items && (
        <>
          <Card className="p-4 mb-6">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-center">
              <div><div className="text-2xl font-bold">{total}</div><div className="text-xs text-muted-foreground">Total</div></div>
              <div><div className="text-2xl font-bold text-amber-700">{counts.todo}</div><div className="text-xs text-muted-foreground">À faire</div></div>
              <div><div className="text-2xl font-bold text-blue-700">{counts.in_progress}</div><div className="text-xs text-muted-foreground">En cours</div></div>
              <div><div className="text-2xl font-bold text-emerald-700">{counts.done}</div><div className="text-xs text-muted-foreground">Validés</div></div>
              <div><div className="text-2xl font-bold">{progress}%</div><div className="text-xs text-muted-foreground">Avancement</div></div>
            </div>
          </Card>

          {grouped.map(([cat, list]) => (
            <div key={cat} className="mb-8">
              <h2 className="text-lg font-semibold mb-3 border-b pb-1">{cat}</h2>
              <div className="space-y-3">
                {list.map((item) => (
                  <Card key={item.item_key} className="p-4">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="flex-1 min-w-[260px]">
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium">{item.title}</h3>
                          <StatusBadge status={item.status}/>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">{item.description}</p>
                      </div>
                      <div className="flex gap-1 print:hidden">
                        {(["todo","in_progress","done","na"] as const).map((s) => (
                          <Button key={s}
                            variant={item.status === s ? "default" : "outline"}
                            size="sm"
                            disabled={saving === item.item_key}
                            onClick={() => setStatus(item, s)}>
                            {s === "todo" ? "À faire" : s === "in_progress" ? "En cours" : s === "done" ? "Validé" : "N/A"}
                          </Button>
                        ))}
                      </div>
                    </div>
                    <Textarea
                      className="mt-3 text-sm"
                      placeholder="Notes / valeur / décision DPO…"
                      value={item.notes ?? ""}
                      onChange={(e) => setNotes(item, e.target.value)}
                      onBlur={() => persistNotes(item)}
                      rows={2}
                    />
                  </Card>
                ))}
              </div>
            </div>
          ))}

          <p className="text-xs text-muted-foreground mt-8 print:mt-4">
            Document généré depuis PVIA. Ne remplace pas une AIPD formelle validée par le DPO.
          </p>
        </>
      )}
    </div>
  );
}
