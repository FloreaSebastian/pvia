import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  listLaunchChecklist,
  updateLaunchChecklistItem,
  resetLaunchChecklist,
  exportLaunchChecklistCsv,
  type LaunchChecklistItem,
} from "@/lib/launch-checklist.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/app/PageHeader";
import { CheckCircle2, XCircle, Circle, Download, RotateCcw, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/launch-checklist")({
  component: LaunchChecklistPage,
  head: () => ({ meta: [{ title: "Checklist de lancement — PVIA" }] }),
  beforeLoad: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw redirect({ to: "/login" });
    const { isPlatformAdminEmail } = await import("@/lib/platform-admin");
    if (!isPlatformAdminEmail(user.email)) throw redirect({ to: "/admin/forbidden" });
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!data) throw redirect({ to: "/admin/forbidden" });
  },
});

const STATUS_TONE: Record<LaunchChecklistItem["status"], { label: string; cls: string; icon: typeof Circle }> = {
  todo:    { label: "À tester", cls: "bg-muted text-muted-foreground", icon: Circle },
  passed:  { label: "Réussi",   cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", icon: CheckCircle2 },
  failed:  { label: "Échec",    cls: "bg-destructive/15 text-destructive", icon: XCircle },
  skipped: { label: "Ignoré",   cls: "bg-muted text-muted-foreground", icon: Circle },
};

function LaunchChecklistPage() {
  const listFn = useServerFn(listLaunchChecklist);
  const updateFn = useServerFn(updateLaunchChecklistItem);
  const resetFn = useServerFn(resetLaunchChecklist);
  const csvFn = useServerFn(exportLaunchChecklistCsv);

  const [items, setItems] = useState<LaunchChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    try {
      const rows = await listFn();
      setItems(rows);
      setNotes(Object.fromEntries(rows.map((r) => [r.id, r.notes ?? ""])));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, LaunchChecklistItem[]>();
    for (const it of items) {
      const arr = map.get(it.category) ?? [];
      arr.push(it);
      map.set(it.category, arr);
    }
    return Array.from(map.entries());
  }, [items]);

  const stats = useMemo(() => {
    const total = items.length;
    const passed = items.filter((i) => i.status === "passed").length;
    const failed = items.filter((i) => i.status === "failed").length;
    const todo = items.filter((i) => i.status === "todo").length;
    return { total, passed, failed, todo, pct: total ? Math.round((passed / total) * 100) : 0 };
  }, [items]);

  const setStatus = async (item: LaunchChecklistItem, status: LaunchChecklistItem["status"]) => {
    setSavingId(item.id);
    try {
      const updated = await updateFn({ data: { id: item.id, status, notes: notes[item.id] ?? null } });
      setItems((prev) => prev.map((p) => (p.id === item.id ? updated : p)));
      toast.success("Statut mis à jour");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSavingId(null);
    }
  };

  const saveNotes = async (item: LaunchChecklistItem) => {
    setSavingId(item.id);
    try {
      const updated = await updateFn({ data: { id: item.id, notes: notes[item.id] ?? null } });
      setItems((prev) => prev.map((p) => (p.id === item.id ? updated : p)));
      toast.success("Notes enregistrées");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSavingId(null);
    }
  };

  const onReset = async () => {
    if (!confirm("Réinitialiser toute la checklist ?")) return;
    try {
      await resetFn();
      await load();
      toast.success("Checklist réinitialisée");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  const onExport = async () => {
    try {
      const { filename, csv } = await csvFn();
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur d'export");
    }
  };

  return (
    <div className="container mx-auto py-8 space-y-6">
      <PageHeader
        title="Checklist de lancement"
        description="Vérifications finales avant publication PVIA."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={onExport}>
              <Download className="size-4 mr-2" /> Exporter CSV
            </Button>
            <Button variant="outline" onClick={onReset}>
              <RotateCcw className="size-4 mr-2" /> Réinitialiser
            </Button>
          </div>
        }
      />

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <div><span className="font-semibold">{stats.passed}</span> / {stats.total} réussis ({stats.pct}%)</div>
          <Badge className="bg-destructive/15 text-destructive">{stats.failed} échecs</Badge>
          <Badge variant="outline">{stats.todo} à tester</Badge>
        </div>
        <div className="mt-3 h-2 bg-muted rounded overflow-hidden">
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${stats.pct}%` }} />
        </div>
      </Card>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Chargement…</div>
      ) : (
        grouped.map(([cat, rows]) => (
          <Card key={cat} className="p-4">
            <h2 className="font-semibold capitalize mb-4">{cat}</h2>
            <ul className="space-y-3">
              {rows.map((it) => {
                const tone = STATUS_TONE[it.status];
                const Icon = tone.icon;
                return (
                  <li key={it.id} className="rounded-lg border p-3 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Icon className="size-4" />
                        <span className="font-medium">{it.label}</span>
                        <Badge className={tone.cls}>{tone.label}</Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {it.tested_at && (
                          <span className="text-xs text-muted-foreground">
                            {new Date(it.tested_at).toLocaleString("fr-FR")}
                          </span>
                        )}
                        <Button size="sm" variant="outline" disabled={savingId === it.id}
                          onClick={() => setStatus(it, "passed")}>
                          <CheckCircle2 className="size-4 mr-1" /> Réussi
                        </Button>
                        <Button size="sm" variant="outline" disabled={savingId === it.id}
                          onClick={() => setStatus(it, "failed")}>
                          <XCircle className="size-4 mr-1" /> Échec
                        </Button>
                        <Button size="sm" variant="ghost" disabled={savingId === it.id}
                          onClick={() => setStatus(it, "todo")}>
                          Reset
                        </Button>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Textarea
                        rows={2}
                        placeholder="Notes de test…"
                        value={notes[it.id] ?? ""}
                        onChange={(e) => setNotes((n) => ({ ...n, [it.id]: e.target.value }))}
                      />
                      <Button size="sm" variant="outline" disabled={savingId === it.id}
                        onClick={() => saveNotes(it)}>
                        Sauver
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        ))
      )}
    </div>
  );
}
