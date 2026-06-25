/**
 * Lot 2 / Refonte mobile — Dossier chantier unifié.
 * Onglet "Dossier" qui regroupe : résumé, PV, réserves, levées,
 * photos, documents, emails et historique chronologique.
 *
 * UX mobile :
 * - KPI cards compactes (2 colonnes).
 * - Onglets scrollables horizontalement.
 * - Réserves groupées par PV (Collapsible) avec actions "Détail" + "Lever".
 * - ReserveDetailDialog + ReserveLiftWorkflowDialog ouverts en bottom-sheet.
 * - PhotoLightboxDialog pour toutes les photos (jamais d'ouverture d'onglet).
 * - Levées : actions PDF client / PDF interne / export expertise.
 */
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  FileText, AlertTriangle, CheckCircle2, Image as ImageIcon,
  Paperclip, Mail, History, ExternalLink, ChevronRight, Clock,
  FileCheck2, FileLock2, Package, ChevronDown,
} from "lucide-react";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { deriveDisplayStatus, STATUS_LABELS, STATUS_TONES } from "@/lib/reserve-lift-status";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getChantierDossier } from "@/lib/chantier-dossier.functions";
import { listChantierPhotos } from "@/lib/chantier-photos.functions";
import type { getChantierDetail } from "@/lib/chantier-detail.functions";
import { ReserveDetailDialog, type ReserveDetail } from "@/components/pv/ReserveDetailDialog";
import { ReserveLiftWorkflowDialog } from "@/components/pv/ReserveLiftWorkflowDialog";
import { PhotoLightboxDialog, type LightboxPhoto } from "@/components/pv/PhotoLightboxDialog";
import {
  getReserveLiftPdfUrl,
} from "@/lib/reserve-lift.functions";
import { exportReserveLiftExpertise } from "@/lib/reserve-lift-expertise.functions";
import { exportChantierDossier } from "@/lib/chantier-dossier-export.functions";

import { reserveStatusTone, reserveStatusLabel } from "@/lib/reserve-status";
import { getReserveCounters } from "@/lib/reserve-counters";

type Detail = Awaited<ReturnType<typeof getChantierDetail>>;
type Dossier = Awaited<ReturnType<typeof getChantierDossier>>;
type ChantierPhotosResult = Awaited<ReturnType<typeof listChantierPhotos>>;
type ChantierPhoto = ChantierPhotosResult["photos"][number];

type SectionKey = "pv" | "reserves" | "levees" | "photos" | "documents" | "emails" | "historique";

type SectionMeta = {
  key: SectionKey;
  label: string;
  title: string;
  subtitle: string;
  emoji: string;
  Icon: React.ComponentType<{ className?: string }>;
  /** Tailwind tokens (no hardcoded hex). Each tone maps to one métier color. */
  iconClass: string;
  bgClass: string;
  ringClass: string;
  activeBgClass: string;
  activeBorderClass: string;
};

const SECTIONS: Record<SectionKey, SectionMeta> = {
  pv:         { key: "pv",         label: "PV",         title: "Procès-verbaux",  subtitle: "Liste des PV du chantier",       emoji: "📄", Icon: FileText,      iconClass: "text-blue-600 dark:text-blue-400",       bgClass: "bg-blue-50 dark:bg-blue-950/30",      ringClass: "ring-blue-200/60 dark:ring-blue-900/40",       activeBgClass: "bg-blue-50/60 dark:bg-blue-950/40",      activeBorderClass: "border-blue-500" },
  reserves:   { key: "reserves",   label: "Réserves",   title: "Réserves",        subtitle: "Réserves ouvertes et validées",  emoji: "⚠️", Icon: AlertTriangle, iconClass: "text-amber-600 dark:text-amber-400",     bgClass: "bg-amber-50 dark:bg-amber-950/30",    ringClass: "ring-amber-200/60 dark:ring-amber-900/40",     activeBgClass: "bg-amber-50/60 dark:bg-amber-950/40",    activeBorderClass: "border-amber-500" },
  levees:     { key: "levees",     label: "Levées",     title: "Levées",          subtitle: "Levées de réserves émises",       emoji: "✅", Icon: CheckCircle2,  iconClass: "text-emerald-600 dark:text-emerald-400", bgClass: "bg-emerald-50 dark:bg-emerald-950/30", ringClass: "ring-emerald-200/60 dark:ring-emerald-900/40", activeBgClass: "bg-emerald-50/60 dark:bg-emerald-950/40", activeBorderClass: "border-emerald-500" },
  photos:     { key: "photos",     label: "Photos",     title: "Photos chantier", subtitle: "Galerie photos du chantier",      emoji: "📷", Icon: ImageIcon,     iconClass: "text-violet-600 dark:text-violet-400",   bgClass: "bg-violet-50 dark:bg-violet-950/30",  ringClass: "ring-violet-200/60 dark:ring-violet-900/40",   activeBgClass: "bg-violet-50/60 dark:bg-violet-950/40",  activeBorderClass: "border-violet-500" },
  documents:  { key: "documents",  label: "Documents",  title: "Documents",       subtitle: "Fichiers du dossier chantier",    emoji: "📎", Icon: Paperclip,     iconClass: "text-slate-600 dark:text-slate-300",     bgClass: "bg-slate-100 dark:bg-slate-800/40",   ringClass: "ring-slate-200/60 dark:ring-slate-700/50",     activeBgClass: "bg-slate-100/70 dark:bg-slate-800/50",   activeBorderClass: "border-slate-500" },
  emails:     { key: "emails",     label: "Emails",     title: "Emails",          subtitle: "Emails envoyés",                  emoji: "✉️", Icon: Mail,          iconClass: "text-sky-600 dark:text-sky-400",         bgClass: "bg-sky-50 dark:bg-sky-950/30",        ringClass: "ring-sky-200/60 dark:ring-sky-900/40",         activeBgClass: "bg-sky-50/60 dark:bg-sky-950/40",        activeBorderClass: "border-sky-500" },
  historique: { key: "historique", label: "Historique", title: "Historique",      subtitle: "Journal d'activité",              emoji: "🕓", Icon: History,       iconClass: "text-zinc-700 dark:text-zinc-300",       bgClass: "bg-zinc-100 dark:bg-zinc-800/40",     ringClass: "ring-zinc-200/60 dark:ring-zinc-700/50",       activeBgClass: "bg-zinc-100/70 dark:bg-zinc-800/50",     activeBorderClass: "border-zinc-500" },
};

const SECTION_ORDER: SectionKey[] = ["pv", "reserves", "levees", "photos", "documents", "emails", "historique"];


function fmt(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("fr-FR", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}
function fmtDay(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

const PV_STATUS_TONE: Record<string, "success" | "info" | "warning" | "neutral" | "destructive"> = {
  signe: "success", envoye: "info", brouillon: "neutral", a_signer: "warning",
};

export function DossierTab({
  companyId, chantierId, detail, onReload,
}: { companyId: string; chantierId: string; detail: Detail; onReload?: () => void }) {
  const fetchDossier = useServerFn(getChantierDossier);
  const fetchChantierPhotos = useServerFn(listChantierPhotos);
  const getLiftPdfFn = useServerFn(getReserveLiftPdfUrl);
  const exportExpertiseFn = useServerFn(exportReserveLiftExpertise);
  const exportDossierFn = useServerFn(exportChantierDossier);
  const [busyDossier, setBusyDossier] = useState(false);

  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [chantierPhotos, setChantierPhotos] = useState<ChantierPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyLiftId, setBusyLiftId] = useState<string | null>(null);

  // Sub-tab memorized in localStorage (default PV now that the Résumé tab is removed)
  const subTabKey = `chantier-dossier-tab:${chantierId}`;
  const [subTab, setSubTab] = useState<string>(() => {
    if (typeof window === "undefined") return "pv";
    try { return localStorage.getItem(subTabKey) ?? "pv"; } catch { return "pv"; }
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    try { localStorage.setItem(subTabKey, subTab); } catch { /* noop */ }
  }, [subTab, subTabKey]);
  // Re-read on remount (KPI deep-link sets the key before switching tab)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => {
      try {
        let v = localStorage.getItem(subTabKey);
        if (v === "resume") v = "pv";
        if (v && v !== subTab) setSubTab(v);
      } catch { /* noop */ }
    };
    window.addEventListener("storage", handler);
    window.addEventListener("chantier-dossier-subtab", handler);
    return () => {
      window.removeEventListener("storage", handler);
      window.removeEventListener("chantier-dossier-subtab", handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTabKey]);

  // Dialogs
  const [activeReserve, setActiveReserve] = useState<ReserveDetail | null>(null);
  const [liftCtx, setLiftCtx] = useState<{ pvId: string; pvNumero: string; preselectedReserveId: string | null } | null>(null);
  const [lightbox, setLightbox] = useState<{ photos: LightboxPhoto[]; idx: number } | null>(null);

  const loadDossier = useCallback(() => {
    setLoading(true);
    return Promise.all([
      fetchDossier({ data: { companyId, chantierId } }).then((r) => setDossier(r)),
      fetchChantierPhotos({ data: { companyId, chantierId } })
        .then((r) => setChantierPhotos(r.photos as ChantierPhoto[]))
        .catch(() => setChantierPhotos([])),
    ])
      .catch((e) => toast.error(e instanceof Error ? e.message : "Dossier indisponible"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, chantierId]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([
      fetchDossier({ data: { companyId, chantierId } }).then((r) => { if (alive) setDossier(r); }),
      fetchChantierPhotos({ data: { companyId, chantierId } })
        .then((r) => { if (alive) setChantierPhotos(r.photos as ChantierPhoto[]); })
        .catch(() => { if (alive) setChantierPhotos([]); }),
    ])
      .catch((e) => toast.error(e instanceof Error ? e.message : "Dossier indisponible"))
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, chantierId]);

  const reservesByPv = useMemo(() => {
    const m = new Map<string, typeof detail.reserves>();
    for (const r of detail.reserves) {
      const arr = m.get(r.pv_id) ?? [];
      arr.push(r);
      m.set(r.pv_id, arr);
    }
    return m;
  }, [detail.reserves]);

  const pvNumeroById = useMemo(
    () => new Map(detail.pvs.map((p) => [p.id, p.numero ?? p.id.slice(0, 6)])),
    [detail.pvs],
  );

  const reserveCounts = useMemo(() => {
    const c = getReserveCounters(detail.reserves);
    // Mapping vers les anciens noms (rétro-compatibilité du JSX existant).
    return {
      total: c.total,
      open: c.ouvertes,
      lifted: c.levees + c.enAttenteValidation,
      validated: c.validees,
      rejected: c.rejetees,
    };
  }, [detail.reserves]);

  // Combined lightbox photos (chantier + initial + after lift)
  const allLightboxPhotos: LightboxPhoto[] = useMemo(() => {
    const out: LightboxPhoto[] = [];
    for (const p of chantierPhotos) {
      if (!p.signed_url) continue;
      out.push({
        id: `chantier-${p.id}`,
        url: p.signed_url,
        label: p.label ?? p.caption ?? null,
        takenAt: p.taken_at ?? p.created_at,
        photoType: "initial",
      });
    }
    for (const p of dossier?.photos ?? []) {
      out.push({
        id: `pv-${p.id}`,
        url: p.url,
        label: p.caption ?? p.photo_label ?? null,
        takenAt: p.taken_at ?? p.created_at,
        photoType: "initial",
      });
    }
    for (const p of dossier?.liftPhotos ?? []) {
      out.push({
        id: `lift-${p.id}`,
        url: p.photo_url,
        label: p.photo_type ?? null,
        takenAt: p.taken_at ?? p.created_at,
        photoType: (p.photo_type as "after") ?? "after",
      });
    }
    return out;
  }, [dossier, chantierPhotos]);

  function openLightbox(photoId: string) {
    const idx = allLightboxPhotos.findIndex((p) => p.id === photoId);
    if (idx >= 0) setLightbox({ photos: allLightboxPhotos, idx });
  }

  function openReserveDetail(r: typeof detail.reserves[number]) {
    setActiveReserve({
      id: r.id,
      description: r.description,
      severity: r.severity,
      status: r.status,
      priority: r.priority,
      nature: r.nature,
      work_to_execute: r.work_to_execute,
      due_date: r.due_date,
      assigned_to: r.assigned_to,
      assigned_name: (r as any).assigned_name ?? null,
      lifted_at: r.lifted_at,
      validated_at: r.validated_at,
      created_at: r.created_at,
      pv_id: r.pv_id,
      company_id: companyId,
    });
  }

  function openLiftWorkflow(reserveId: string, pvId: string) {
    setLiftCtx({
      pvId,
      pvNumero: pvNumeroById.get(pvId) ?? pvId.slice(0, 6),
      preselectedReserveId: reserveId,
    });
  }

  async function openLiftPdf(reportId: string, variant: "client" | "internal") {
    setBusyLiftId(reportId);
    try {
      const res = await getLiftPdfFn({ data: { reportId, variant } });
      if (res?.url) window.open(res.url, "_blank", "noopener");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "PDF indisponible");
    } finally { setBusyLiftId(null); }
  }

  async function exportExpertise(reportId: string) {
    setBusyLiftId(reportId);
    try {
      const res = await exportExpertiseFn({ data: { reportId } });
      const bin = atob(res.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = res.fileName; a.click();
      URL.revokeObjectURL(url);
      toast.success("Export prêt");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export impossible");
    } finally { setBusyLiftId(null); }
  }

  async function downloadDossierZip(variant: "internal" | "client" = "internal") {
    setBusyDossier(true);
    try {
      const res = await exportDossierFn({ data: { companyId, chantierId, variant } });
      const bin = atob(res.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = res.fileName; a.click();
      URL.revokeObjectURL(url);
      toast.success(variant === "client" ? "Dossier client exporté" : "Dossier interne exporté");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export impossible");
    } finally { setBusyDossier(false); }
  }



  // Build reserves list for the workflow dialog (filtered to current PV)
  const liftDialogReserves = useMemo(() => {
    if (!liftCtx) return [];
    return detail.reserves
      .filter((r) => r.pv_id === liftCtx.pvId)
      .map((r) => ({
        id: r.id,
        description: r.description,
        severity: r.severity,
        status: r.status,
        priority: r.priority ?? null,
        due_date: r.due_date ?? null,
        work_to_execute: r.work_to_execute ?? null,
      }));
  }, [liftCtx, detail.reserves]);

  const sectionRef = useRef<HTMLDivElement | null>(null);
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    if (typeof window === "undefined") return;
    sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [subTab]);

  const goTo = useCallback((k: SectionKey) => setSubTab(k), []);

  const active = SECTIONS[(subTab as SectionKey) in SECTIONS ? (subTab as SectionKey) : "pv"];

  // KPI values
  const kpiValues: Record<SectionKey, { value: number; sub: string }> = {
    pv:         { value: detail.pvs.length,                 sub: "PV créés" },
    reserves:   { value: reserveCounts.total,               sub: `${reserveCounts.open} ouvertes` },
    levees:     { value: dossier?.liftReports.length ?? 0,  sub: "Levées émises" },
    photos:     { value: allLightboxPhotos.length,          sub: "Photos chantier" },
    documents:  { value: detail.documents.length,           sub: "Fichiers" },
    emails:     { value: dossier?.emails.length ?? 0,       sub: "Envoyés" },
    historique: { value: detail.auditLogs?.length ?? 0,     sub: "Entrées" },
  };

  return (
    <div className="w-full max-w-full overflow-x-hidden">
      {/* ====== EXPORT (single button) ====== */}
      <div className="mb-3 flex items-center justify-end">
        <Sheet>
          <SheetTrigger asChild>
            <Button size="sm" variant="outline" disabled={busyDossier} className="h-9 gap-1.5 text-xs">
              <Package className="h-4 w-4" />
              {busyDossier ? "Préparation…" : "Exporter"}
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="rounded-t-2xl">
            <SheetHeader>
              <SheetTitle>Exporter le dossier</SheetTitle>
            </SheetHeader>
            <div className="mt-4 grid gap-2">
              <button
                type="button"
                disabled={busyDossier}
                onClick={() => downloadDossierZip("client")}
                className="flex w-full items-center gap-3 rounded-xl border border-border bg-card p-3 text-left transition hover:border-primary/40 hover:shadow-sm active:scale-[0.98] disabled:opacity-60"
              >
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400">📄</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">Export Client</span>
                  <span className="block text-xs text-muted-foreground">PDF et pièces destinées au client (GPS masqué)</span>
                </span>
              </button>
              <button
                type="button"
                disabled={busyDossier}
                onClick={() => downloadDossierZip("internal")}
                className="flex w-full items-center gap-3 rounded-xl border border-border bg-card p-3 text-left transition hover:border-primary/40 hover:shadow-sm active:scale-[0.98] disabled:opacity-60"
              >
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-200">🏢</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">Export Interne</span>
                  <span className="block text-xs text-muted-foreground">Dossier complet avec données techniques et GPS exact</span>
                </span>
              </button>
              <button
                type="button"
                disabled={busyDossier}
                onClick={() => downloadDossierZip("internal")}
                className="flex w-full items-center gap-3 rounded-xl border border-border bg-card p-3 text-left transition hover:border-primary/40 hover:shadow-sm active:scale-[0.98] disabled:opacity-60"
              >
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400">📦</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">Export ZIP complet</span>
                  <span className="block text-xs text-muted-foreground">Toutes les pièces et photos en archive</span>
                </span>
              </button>
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* ====== KPI NAVIGATION GRID ====== */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {SECTION_ORDER.map((k) => {
          const meta = SECTIONS[k];
          const isActive = subTab === k;
          const { value, sub } = kpiValues[k];
          return (
            <button
              key={k}
              type="button"
              onClick={() => goTo(k)}
              aria-pressed={isActive}
              className={cn(
                "group flex h-[104px] flex-col items-start justify-between gap-1 rounded-xl border-2 bg-card p-2.5 text-left transition-all duration-200 active:scale-[0.97]",
                isActive
                  ? cn(meta.activeBorderClass, meta.activeBgClass, "shadow-sm ring-2", meta.ringClass)
                  : "border-border hover:border-primary/30 hover:shadow-sm",
              )}
            >
              <div className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-md", meta.bgClass)}>
                <meta.Icon className={cn("h-4 w-4", meta.iconClass)} />
              </div>
              <p className="text-2xl font-bold leading-none tabular-nums">{value}</p>
              <div className="min-w-0">
                <p className="truncate text-[11px] font-medium">{meta.label}</p>
                <p className="truncate text-[10px] text-muted-foreground">{sub}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* ====== DYNAMIC SECTION TITLE ====== */}
      <div ref={sectionRef} className="mt-5 scroll-mt-20">
        <div key={`title-${subTab}`} className="animate-fade-in">
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <span aria-hidden>{active.emoji}</span>
            <span className="truncate">{active.title}</span>
          </h3>
          <p className="text-xs text-muted-foreground">{active.subtitle}</p>
        </div>

        {/* ====== LAZY SECTION (only the active section is mounted) ====== */}
        <div key={`section-${subTab}`} className="mt-3 animate-fade-in">
          {subTab === "pv" && (
            detail.pvs.length === 0 ? <EmptyHint label="Aucun PV pour ce chantier." /> : (
              <ul className="space-y-2">
                {detail.pvs.map((p) => {
                  const rs = reservesByPv.get(p.id) ?? [];
                  return (
                    <li key={p.id} className="rounded-lg border border-border bg-card p-3">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{p.numero ?? "PV"} <span className="text-xs text-muted-foreground">· {p.type}</span></p>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                            <StatusPill tone={PV_STATUS_TONE[p.status] ?? "neutral"} size="sm">{p.status}</StatusPill>
                            {p.signed_at && <span>Signé {fmtDay(p.signed_at)}</span>}
                            {rs.length > 0 && <span>· {rs.length} réserve{rs.length > 1 ? "s" : ""}</span>}
                          </div>
                        </div>
                        <Button asChild size="sm" variant="outline" className="h-8 shrink-0">
                          <Link to="/pv/$id" params={{ id: p.id }}>Ouvrir <ChevronRight className="h-3.5 w-3.5" /></Link>
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )
          )}

          {subTab === "reserves" && (
            detail.reserves.length === 0 ? <EmptyHint label="Aucune réserve déclarée." /> : (
              <div className="space-y-2">
                {detail.pvs
                  .filter((p) => (reservesByPv.get(p.id)?.length ?? 0) > 0)
                  .map((p) => {
                    const rs = reservesByPv.get(p.id) ?? [];
                    return (
                      <Collapsible key={p.id} defaultOpen className="rounded-lg border border-border bg-card">
                        <CollapsibleTrigger className="flex w-full items-center gap-2 p-3 text-left">
                          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform [&[data-state=closed]]:-rotate-90" />
                          <span className="truncate text-sm font-medium">{p.numero ?? "PV"}</span>
                          <span className="ml-auto text-xs text-muted-foreground">{rs.length} réserve{rs.length > 1 ? "s" : ""}</span>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="space-y-2 px-3 pb-3">
                          {rs.map((r) => (
                            <ReserveRow
                              key={r.id}
                              r={r}
                              onDetail={() => openReserveDetail(r)}
                              onLever={() => openLiftWorkflow(r.id, r.pv_id)}
                            />
                          ))}
                        </CollapsibleContent>
                      </Collapsible>
                    );
                  })}
              </div>
            )
          )}

          {subTab === "levees" && (
            loading ? <LoadingHint /> : !dossier?.liftReports.length ? <EmptyHint label="Aucune levée enregistrée." /> : (
              <ul className="space-y-2">
                {dossier.liftReports.map((rep) => {
                  const items = dossier.liftItems.filter((it) => it.report_id === rep.id);
                  const ds = deriveDisplayStatus(rep as any);
                  return (
                    <li key={rep.id} className="rounded-lg border border-border bg-card p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-semibold">{rep.numero ?? "Levée"}</span>
                        <StatusPill tone={STATUS_TONES[ds]} size="sm">
                          {STATUS_LABELS[ds]}
                        </StatusPill>
                        <span className="text-[11px] text-muted-foreground">PV {pvNumeroById.get(rep.pv_id) ?? "—"}</span>
                        <span className="ml-auto text-[11px] text-muted-foreground">{fmt(rep.signed_at ?? rep.created_at)}</span>
                      </div>
                      {items.length > 0 && (
                        <p className="mt-1.5 text-[11px] text-muted-foreground">{items.length} réserve{items.length > 1 ? "s" : ""} traitée{items.length > 1 ? "s" : ""}</p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {(rep.pdf_client_url || rep.pdf_url) && (
                          <Button size="sm" variant="outline" disabled={busyLiftId === rep.id} onClick={() => openLiftPdf(rep.id, "client")} className="h-7 gap-1 text-[11px]">
                            <FileCheck2 className="h-3 w-3" /> PDF client
                          </Button>
                        )}
                        {rep.pdf_internal_url && (
                          <Button size="sm" variant="outline" disabled={busyLiftId === rep.id} onClick={() => openLiftPdf(rep.id, "internal")} className="h-7 gap-1 text-[11px]" title="Réservé directeur / responsable / conducteur / assistant admin">
                            <FileLock2 className="h-3 w-3" /> PDF interne
                          </Button>
                        )}
                        <Button size="sm" variant="outline" disabled={busyLiftId === rep.id} onClick={() => exportExpertise(rep.id)} className="h-7 gap-1 text-[11px]">
                          <Package className="h-3 w-3" /> Export expertise
                        </Button>
                        <Button asChild size="sm" variant="ghost" className="h-7 gap-1 text-[11px]">
                          <Link to="/pv/$id/levee-reserves" params={{ id: rep.pv_id }}>
                            <ExternalLink className="h-3 w-3" /> Ouvrir
                          </Link>
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )
          )}

          {subTab === "photos" && (
            loading ? <LoadingHint /> : allLightboxPhotos.length === 0 ? <EmptyHint label="Aucune photo." /> : (
              <div className="space-y-4">
                {chantierPhotos.length > 0 && (
                  <section>
                    <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Photos chantier</p>
                    <PhotoGrid
                      items={chantierPhotos
                        .filter((p) => !!p.signed_url)
                        .map((p) => ({
                          id: `chantier-${p.id}`,
                          url: p.signed_url as string,
                          caption: p.label ?? p.caption ?? null,
                          date: p.taken_at ?? p.created_at,
                        }))}
                      onOpen={openLightbox}
                    />
                  </section>
                )}
                {(dossier?.photos.length ?? 0) > 0 && (
                  <section>
                    <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Constat initial</p>
                    <PhotoGrid
                      items={(dossier?.photos ?? []).map((p) => ({
                        id: `pv-${p.id}`, url: p.url, caption: p.caption ?? p.photo_label ?? null,
                        date: p.taken_at ?? p.created_at,
                      }))}
                      onOpen={openLightbox}
                    />
                  </section>
                )}
                {(dossier?.liftPhotos.length ?? 0) > 0 && (
                  <section>
                    <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Après intervention</p>
                    <PhotoGrid
                      items={(dossier?.liftPhotos ?? []).map((p) => ({
                        id: `lift-${p.id}`, url: p.photo_url, caption: p.photo_type ?? null,
                        date: p.taken_at ?? p.created_at,
                      }))}
                      onOpen={openLightbox}
                    />
                  </section>
                )}
              </div>
            )
          )}

          {subTab === "documents" && (
            detail.documents.length === 0 ? <EmptyHint label="Aucun document." /> : (
              <ul className="space-y-2">
                {detail.documents.map((doc) => (
                  <li key={doc.id} className="flex items-center gap-2 rounded-lg border border-border bg-card p-2 text-sm">
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{doc.name}</p>
                      <p className="text-xs text-muted-foreground">{doc.category ?? "autre"} · {fmtDay(doc.created_at)}</p>
                    </div>
                    <Button asChild size="sm" variant="ghost">
                      <a href={doc.file_url} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /></a>
                    </Button>
                  </li>
                ))}
              </ul>
            )
          )}

          {subTab === "emails" && (
            loading ? <LoadingHint /> : !dossier?.emails.length ? <EmptyHint label="Aucun email envoyé pour ce chantier." /> : (
              <ul className="space-y-2">
                {dossier.emails.map((e) => (
                  <li key={e.id} className="rounded-lg border border-border bg-card p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="truncate font-medium">{e.recipient_email}</span>
                      <StatusPill tone={e.status === "sent" ? "success" : e.status === "failed" || e.status === "dlq" ? "destructive" : "neutral"} size="sm">
                        {e.status}
                      </StatusPill>
                      <span className="text-[11px] text-muted-foreground">{e.email_type}</span>
                      <span className="ml-auto text-[11px] text-muted-foreground">{fmt(e.sent_at ?? e.created_at)}</span>
                    </div>
                    {e.subject && <p className="mt-1 truncate text-sm">{e.subject}</p>}
                    {e.error_message && <p className="mt-1 text-xs text-destructive">{e.error_message}</p>}
                  </li>
                ))}
              </ul>
            )
          )}

          {subTab === "historique" && (
            detail.auditLogs.length === 0 ? <EmptyHint label="Aucune entrée d'historique." /> : (
              <ol className="space-y-2">
                {detail.auditLogs.slice(0, 100).map((a) => (
                  <li key={a.id} className="flex items-start gap-2 rounded-lg border border-border bg-card p-2 text-xs">
                    <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{a.action}</p>
                      <p className="text-muted-foreground">{fmt(a.created_at)}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )
          )}
        </div>
      </div>


      <ReserveDetailDialog
        open={!!activeReserve}
        onOpenChange={(o) => { if (!o) setActiveReserve(null); }}
        reserve={activeReserve}
        onChanged={() => { onReload?.(); void loadDossier(); }}
        onLever={(r) => {
          setActiveReserve(null);
          openLiftWorkflow(r.id, r.pv_id);
        }}
      />

      {liftCtx && (
        <ReserveLiftWorkflowDialog
          open={!!liftCtx}
          onOpenChange={(o) => { if (!o) setLiftCtx(null); }}
          pvId={liftCtx.pvId}
          pvNumero={liftCtx.pvNumero}
          reserves={liftDialogReserves}
          preselectedReserveId={liftCtx.preselectedReserveId}
          chantierLabel={detail.chantier.name}
          clientLabel={detail.chantier.client?.name ?? null}
          clientEmail={detail.chantier.client?.email ?? null}
          onCompleted={() => {
            toast.success("Levée finalisée");
            setLiftCtx(null);
            onReload?.();
            void loadDossier();
          }}
        />
      )}

      {lightbox && (
        <PhotoLightboxDialog
          open={!!lightbox}
          onOpenChange={(o) => { if (!o) setLightbox(null); }}
          photos={lightbox.photos}
          startIndex={lightbox.idx}
          context={{ showExactGps: true }}
        />
      )}
    </>
  );
}

function ReserveRow({
  r, onDetail, onLever,
}: {
  r: { id: string; description: string; severity: string; status: string; due_date: string | null; lifted_at: string | null; validated_at: string | null; created_at: string };
  onDetail: () => void;
  onLever: () => void;
}) {
  const canLift = r.status !== "validee" && r.status !== "levee" && r.status !== "en_attente_validation";
  return (
    <div className="rounded-md border border-border/70 bg-background p-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusPill tone={reserveStatusTone(r.status) as any} size="sm" dot>{reserveStatusLabel(r.status)}</StatusPill>
        <StatusPill tone={r.severity === "majeure" ? "destructive" : "warning"} size="sm">{r.severity}</StatusPill>
        {r.due_date && <span className="text-[10px] text-muted-foreground">📅 {fmtDay(r.due_date)}</span>}
        <span className="ml-auto text-[10px] text-muted-foreground">{fmtDay(r.created_at)}</span>
      </div>
      <p className="mt-1.5 line-clamp-2 text-[13px] leading-snug">{r.description}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={onDetail}>
          Détail
        </Button>
        {canLift && (
          <Button size="sm" className="h-7 shadow-brand text-[11px]" onClick={onLever}>
            <FileCheck2 className="h-3 w-3" /> Lever
          </Button>
        )}
      </div>
    </div>
  );
}

function PhotoGrid({
  items, onOpen,
}: {
  items: Array<{ id: string; url: string; caption: string | null; date: string }>;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onOpen(p.id)}
          className="group block overflow-hidden rounded-lg border border-border bg-muted text-left"
        >
          <div className="aspect-square overflow-hidden">
            <img src={p.url} alt={p.caption ?? ""} loading="lazy" className="h-full w-full object-cover transition-transform group-hover:scale-105" />
          </div>
          {(p.caption || p.date) && (
            <div className="p-1.5 text-[10px] text-muted-foreground">
              {p.caption && <p className="truncate">{p.caption}</p>}
              {p.date && <p className="truncate">{fmtDay(p.date)}</p>}
            </div>
          )}
        </button>
      ))}
    </div>
  );
}

function EmptyHint({ label }: { label: string }) {
  return <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{label}</p>;
}
function LoadingHint() {
  return <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Chargement…</p>;
}

function VueKpiGrid({
  detail, dossier, chantierPhotosCount, reserveCounts, onGoToSubTab,
}: {
  detail: Detail;
  dossier: Dossier | null;
  chantierPhotosCount: number;
  reserveCounts: { total: number; open: number; lifted: number; validated: number; rejected: number };
  onGoToSubTab: (v: string) => void;
}) {
  const kpis: Array<{
    key: string;
    icon: React.ReactNode;
    value: number;
    label: string;
    sub: string;
    onClick: () => void;
  }> = [
    { key: "pv", icon: <FileText className="h-5 w-5 text-primary" />, value: detail.pvs.length, label: "PV", sub: "PV créés", onClick: () => onGoToSubTab("pv") },
    { key: "res", icon: <AlertTriangle className="h-5 w-5 text-amber-600" />, value: reserveCounts.total, label: "Réserves", sub: `${reserveCounts.open} ouvertes`, onClick: () => onGoToSubTab("reserves") },
    { key: "lev", icon: <CheckCircle2 className="h-5 w-5 text-emerald-600" />, value: dossier?.liftReports.length ?? 0, label: "Levées", sub: "Levées émises", onClick: () => onGoToSubTab("levees") },
    { key: "ph", icon: <ImageIcon className="h-5 w-5 text-blue-600" />, value: chantierPhotosCount, label: "Photos", sub: "Photos chantier", onClick: () => onGoToSubTab("photos") },
    { key: "doc", icon: <Paperclip className="h-5 w-5 text-slate-600" />, value: detail.documents.length, label: "Documents", sub: "Fichiers", onClick: () => onGoToSubTab("documents") },
    { key: "em", icon: <Mail className="h-5 w-5 text-indigo-600" />, value: dossier?.emails.length ?? 0, label: "Emails", sub: "Envoyés", onClick: () => onGoToSubTab("emails") },
    { key: "ev", icon: <Clock className="h-5 w-5 text-fuchsia-600" />, value: (detail.events ?? []).length, label: "Évènements", sub: "Planifiés", onClick: () => onGoToSubTab("historique") },
    { key: "hist", icon: <History className="h-5 w-5 text-muted-foreground" />, value: detail.auditLogs?.length ?? 0, label: "Historique", sub: "Entrées", onClick: () => onGoToSubTab("historique") },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {kpis.map((k) => (
        <button
          key={k.key}
          type="button"
          onClick={k.onClick}
          className="group flex flex-col items-start gap-1.5 rounded-xl border border-border bg-card p-3 text-left transition hover:border-primary/40 hover:shadow-sm active:scale-[0.98]"
        >
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-muted">{k.icon}</div>
          <p className="text-2xl font-semibold leading-none tabular-nums">{k.value}</p>
          <p className="text-[11px] font-medium">{k.label}</p>
          <p className="text-[10px] text-muted-foreground">{k.sub}</p>
        </button>
      ))}
    </div>
  );
}


