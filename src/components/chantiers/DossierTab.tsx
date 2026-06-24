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
import { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  FileText, AlertTriangle, CheckCircle2, Image as ImageIcon,
  Paperclip, Mail, History, ExternalLink, ChevronRight, Clock,
  FileCheck2, FileLock2, Package, ChevronDown,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { deriveDisplayStatus, STATUS_LABELS, STATUS_TONES } from "@/lib/reserve-lift-status";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";
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
import { reserveStatusTone, reserveStatusLabel } from "@/lib/reserve-status";
import { getReserveCounters } from "@/lib/reserve-counters";

type Detail = Awaited<ReturnType<typeof getChantierDetail>>;
type Dossier = Awaited<ReturnType<typeof getChantierDossier>>;
type ChantierPhotosResult = Awaited<ReturnType<typeof listChantierPhotos>>;
type ChantierPhoto = ChantierPhotosResult["photos"][number];

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
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [chantierPhotos, setChantierPhotos] = useState<ChantierPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyLiftId, setBusyLiftId] = useState<string | null>(null);

  // Sub-tab memorized in localStorage
  const subTabKey = `chantier-dossier-tab:${chantierId}`;
  const [subTab, setSubTab] = useState<string>(() => {
    if (typeof window === "undefined") return "resume";
    try { return localStorage.getItem(subTabKey) ?? "resume"; } catch { return "resume"; }
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
        const v = localStorage.getItem(subTabKey);
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

  return (
    <>
      <Tabs value={subTab} onValueChange={setSubTab} className="w-full">
        <TabsList className="grid h-auto w-full grid-cols-4 gap-1 bg-muted/50 p-1 sm:grid-cols-8">
          <TabsTrigger value="resume" className="text-[11px] sm:text-xs">Résumé</TabsTrigger>
          <TabsTrigger value="pv" className="text-[11px] sm:text-xs">PV ({detail.pvs.length})</TabsTrigger>
          <TabsTrigger value="reserves" className="text-[11px] sm:text-xs">Rés. ({reserveCounts.total})</TabsTrigger>
          <TabsTrigger value="levees" className="text-[11px] sm:text-xs">Lev. ({dossier?.liftReports.length ?? 0})</TabsTrigger>
          <TabsTrigger value="photos" className="text-[11px] sm:text-xs">Photos ({allLightboxPhotos.length})</TabsTrigger>
          <TabsTrigger value="documents" className="text-[11px] sm:text-xs">Docs ({detail.documents.length})</TabsTrigger>
          <TabsTrigger value="emails" className="text-[11px] sm:text-xs">Emails ({dossier?.emails.length ?? 0})</TabsTrigger>
          <TabsTrigger value="historique" className="text-[11px] sm:text-xs">Hist.</TabsTrigger>
        </TabsList>

        {/* Résumé — synthèse métier (pas de doublons avec onglets) */}
        <TabsContent value="resume" className="mt-3">
          <ResumeSynthese
            detail={detail}
            dossier={dossier}
            chantierPhotosCount={chantierPhotos.length}
            reserveCounts={reserveCounts}
            onGoToSubTab={setSubTab}
          />
        </TabsContent>


        {/* PV */}
        <TabsContent value="pv" className="mt-3">
          {detail.pvs.length === 0 ? <EmptyHint label="Aucun PV pour ce chantier." /> : (
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
          )}
        </TabsContent>

        {/* Réserves — groupées par PV, repliables */}
        <TabsContent value="reserves" className="mt-3">
          {detail.reserves.length === 0 ? <EmptyHint label="Aucune réserve déclarée." /> : (
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
          )}
        </TabsContent>

        {/* Levées */}
        <TabsContent value="levees" className="mt-3">
          {loading ? <LoadingHint /> : !dossier?.liftReports.length ? <EmptyHint label="Aucune levée enregistrée." /> : (
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
          )}
        </TabsContent>

        {/* Photos */}
        <TabsContent value="photos" className="mt-3">
          {loading ? <LoadingHint /> : allLightboxPhotos.length === 0 ? <EmptyHint label="Aucune photo." /> : (
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
          )}
        </TabsContent>

        {/* Documents */}
        <TabsContent value="documents" className="mt-3">
          {detail.documents.length === 0 ? <EmptyHint label="Aucun document." /> : (
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
          )}
        </TabsContent>

        {/* Emails */}
        <TabsContent value="emails" className="mt-3">
          {loading ? <LoadingHint /> : !dossier?.emails.length ? <EmptyHint label="Aucun email envoyé pour ce chantier." /> : (
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
          )}
        </TabsContent>

        {/* Historique */}
        <TabsContent value="historique" className="mt-3">
          {detail.auditLogs.length === 0 ? <EmptyHint label="Aucune entrée d'historique." /> : (
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
          )}
        </TabsContent>
      </Tabs>

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

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <Card className="flex items-center gap-2 p-2.5 sm:gap-3 sm:p-3">
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted sm:h-9 sm:w-9">{icon}</div>
      <div className="min-w-0">
        <p className="truncate text-[10px] uppercase tracking-wider text-muted-foreground sm:text-xs">{label}</p>
        <p className="text-base font-semibold tabular-nums sm:text-lg">{value}</p>
      </div>
    </Card>
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
