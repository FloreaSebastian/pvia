/**
 * Lot 2 — Dossier chantier unifié.
 * Onglet "Dossier" qui regroupe : résumé, PV, réserves, levées,
 * photos, documents, emails et historique chronologique.
 * Charge des données complémentaires (pv_photos, reserve_lift_reports,
 * email_logs) via getChantierDossier.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  FileText, AlertTriangle, CheckCircle2, Image as ImageIcon,
  Paperclip, Mail, History, ExternalLink, ChevronRight, Clock,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { getChantierDossier } from "@/lib/chantier-dossier.functions";
import type { getChantierDetail } from "@/lib/chantier-detail.functions";

type Detail = Awaited<ReturnType<typeof getChantierDetail>>;
type Dossier = Awaited<ReturnType<typeof getChantierDossier>>;

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

const PV_STATUS_TONE: Record<string, "success" | "info" | "warning" | "neutral" | "danger"> = {
  signe: "success", envoye: "info", brouillon: "neutral", a_signer: "warning",
};
const RESERVE_STATUS_TONE: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  ouverte: "warning", levee: "info", en_attente_validation: "info",
  validee: "success", rejetee: "danger",
};
const RESERVE_STATUS_LABEL: Record<string, string> = {
  ouverte: "Ouverte", levee: "Levée", en_attente_validation: "À valider",
  validee: "Validée", rejetee: "Rejetée",
};

export function DossierTab({
  companyId, chantierId, detail,
}: { companyId: string; chantierId: string; detail: Detail }) {
  const fetchDossier = useServerFn(getChantierDossier);
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchDossier({ data: { companyId, chantierId } })
      .then((r) => { if (alive) setDossier(r); })
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
    const c = { total: 0, open: 0, lifted: 0, validated: 0, rejected: 0 };
    for (const r of detail.reserves) {
      c.total++;
      if (r.status === "ouverte") c.open++;
      else if (r.status === "levee" || r.status === "en_attente_validation") c.lifted++;
      else if (r.status === "validee") c.validated++;
      else if (r.status === "rejetee") c.rejected++;
    }
    return c;
  }, [detail.reserves]);

  return (
    <Tabs defaultValue="resume" className="w-full">
      <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-muted/50 p-1">
        <TabsTrigger value="resume">Résumé</TabsTrigger>
        <TabsTrigger value="pv">PV ({detail.pvs.length})</TabsTrigger>
        <TabsTrigger value="reserves">Réserves ({reserveCounts.total})</TabsTrigger>
        <TabsTrigger value="levees">Levées ({dossier?.liftReports.length ?? 0})</TabsTrigger>
        <TabsTrigger value="photos">Photos ({dossier?.photos.length ?? 0})</TabsTrigger>
        <TabsTrigger value="documents">Documents ({detail.documents.length})</TabsTrigger>
        <TabsTrigger value="emails">Emails ({dossier?.emails.length ?? 0})</TabsTrigger>
        <TabsTrigger value="historique">Historique</TabsTrigger>
      </TabsList>

      {/* Résumé */}
      <TabsContent value="resume" className="mt-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={<FileText className="h-4 w-4" />} label="PV" value={detail.pvs.length} />
          <StatCard icon={<AlertTriangle className="h-4 w-4 text-warning" />} label="Réserves ouvertes" value={reserveCounts.open} />
          <StatCard icon={<CheckCircle2 className="h-4 w-4 text-success" />} label="Réserves validées" value={reserveCounts.validated} />
          <StatCard icon={<ImageIcon className="h-4 w-4" />} label="Photos" value={dossier?.photos.length ?? 0} />
          <StatCard icon={<Paperclip className="h-4 w-4" />} label="Documents" value={detail.documents.length} />
          <StatCard icon={<History className="h-4 w-4" />} label="Levées" value={dossier?.liftReports.length ?? 0} />
          <StatCard icon={<Mail className="h-4 w-4" />} label="Emails envoyés" value={(dossier?.emails ?? []).filter((e) => e.status === "sent").length} />
          <StatCard icon={<AlertTriangle className="h-4 w-4 text-destructive" />} label="Réserves rejetées" value={reserveCounts.rejected} />
        </div>
      </TabsContent>

      {/* PV */}
      <TabsContent value="pv" className="mt-4">
        {detail.pvs.length === 0 ? (
          <EmptyHint label="Aucun PV pour ce chantier." />
        ) : (
          <ul className="space-y-2">
            {detail.pvs.map((p) => {
              const rs = reservesByPv.get(p.id) ?? [];
              return (
                <li key={p.id}>
                  <Link
                    to="/pv/$id"
                    params={{ id: p.id }}
                    className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 hover:bg-muted/50"
                  >
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{p.numero ?? "PV"} <span className="text-xs text-muted-foreground">· {p.type}</span></p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <StatusPill tone={PV_STATUS_TONE[p.status] ?? "neutral"}>{p.status}</StatusPill>
                        {p.signed_at && <span>Signé {fmtDay(p.signed_at)}</span>}
                        {p.sent_to_client_at && <span>· Envoyé {fmtDay(p.sent_to_client_at)}</span>}
                        {rs.length > 0 && <span>· {rs.length} réserve{rs.length > 1 ? "s" : ""}</span>}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </TabsContent>

      {/* Réserves */}
      <TabsContent value="reserves" className="mt-4">
        {detail.reserves.length === 0 ? (
          <EmptyHint label="Aucune réserve déclarée." />
        ) : (
          <ul className="space-y-2">
            {detail.reserves.map((r) => (
              <li key={r.id} className="rounded-lg border border-border bg-card p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill tone={RESERVE_STATUS_TONE[r.status] ?? "neutral"}>
                    {RESERVE_STATUS_LABEL[r.status] ?? r.status}
                  </StatusPill>
                  <StatusPill tone={r.severity === "majeure" ? "danger" : "warning"}>{r.severity}</StatusPill>
                  <Link to="/pv/$id" params={{ id: r.pv_id }} className="text-xs text-primary hover:underline">
                    PV {pvNumeroById.get(r.pv_id) ?? "—"}
                  </Link>
                  <span className="ml-auto text-xs text-muted-foreground">{fmtDay(r.created_at)}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm">{r.description}</p>
                {(r.lifted_at || r.validated_at) && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {r.lifted_at && <>Levée : {fmt(r.lifted_at)}</>}
                    {r.lifted_at && r.validated_at && " · "}
                    {r.validated_at && <>Validée : {fmt(r.validated_at)}</>}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </TabsContent>

      {/* Levées */}
      <TabsContent value="levees" className="mt-4">
        {loading ? <LoadingHint /> : !dossier?.liftReports.length ? (
          <EmptyHint label="Aucune levée enregistrée." />
        ) : (
          <ul className="space-y-2">
            {dossier.liftReports.map((rep) => {
              const items = dossier.liftItems.filter((it) => it.report_id === rep.id);
              return (
                <li key={rep.id} className="rounded-lg border border-border bg-card p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{rep.numero ?? "Levée"}</span>
                    <StatusPill tone={rep.status === "signe" || rep.status === "client_validated" ? "success" : rep.status === "client_rejected" ? "danger" : "info"}>
                      {rep.status}
                    </StatusPill>
                    <span className="text-xs text-muted-foreground">PV {pvNumeroById.get(rep.pv_id) ?? "—"}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{fmt(rep.signed_at ?? rep.created_at)}</span>
                  </div>
                  {items.length > 0 && (
                    <p className="mt-2 text-xs text-muted-foreground">{items.length} réserve{items.length > 1 ? "s" : ""} traitée{items.length > 1 ? "s" : ""}</p>
                  )}
                  {rep.pdf_url && (
                    <a href={rep.pdf_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline">
                      <ExternalLink className="h-3 w-3" /> Ouvrir le PDF
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </TabsContent>

      {/* Photos */}
      <TabsContent value="photos" className="mt-4">
        {loading ? <LoadingHint /> : (dossier?.photos.length ?? 0) + (dossier?.liftPhotos.length ?? 0) === 0 ? (
          <EmptyHint label="Aucune photo." />
        ) : (
          <>
            {(dossier?.photos.length ?? 0) > 0 && (
              <>
                <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Constat initial</p>
                <PhotoGrid
                  items={(dossier?.photos ?? []).map((p) => ({
                    id: p.id, url: p.url, caption: p.caption ?? p.photo_label ?? null,
                    date: p.taken_at ?? p.created_at,
                  }))}
                />
              </>
            )}
            {(dossier?.liftPhotos.length ?? 0) > 0 && (
              <>
                <p className="mb-2 mt-4 text-xs font-semibold uppercase text-muted-foreground">Après intervention</p>
                <PhotoGrid
                  items={(dossier?.liftPhotos ?? []).map((p) => ({
                    id: p.id, url: p.photo_url, caption: p.photo_type ?? null,
                    date: p.taken_at ?? p.created_at,
                  }))}
                />
              </>
            )}
          </>
        )}
      </TabsContent>

      {/* Documents */}
      <TabsContent value="documents" className="mt-4">
        {detail.documents.length === 0 ? (
          <EmptyHint label="Aucun document." />
        ) : (
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
      <TabsContent value="emails" className="mt-4">
        {loading ? <LoadingHint /> : !dossier?.emails.length ? (
          <EmptyHint label="Aucun email envoyé pour ce chantier." />
        ) : (
          <ul className="space-y-2">
            {dossier.emails.map((e) => (
              <li key={e.id} className="rounded-lg border border-border bg-card p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="font-medium">{e.recipient_email}</span>
                  <StatusPill tone={e.status === "sent" ? "success" : e.status === "failed" || e.status === "dlq" ? "danger" : "neutral"}>
                    {e.status}
                  </StatusPill>
                  <span className="text-xs text-muted-foreground">{e.email_type}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{fmt(e.sent_at ?? e.created_at)}</span>
                </div>
                {e.subject && <p className="mt-1 truncate text-sm">{e.subject}</p>}
                {e.error_message && <p className="mt-1 text-xs text-destructive">{e.error_message}</p>}
              </li>
            ))}
          </ul>
        )}
      </TabsContent>

      {/* Historique */}
      <TabsContent value="historique" className="mt-4">
        {detail.auditLogs.length === 0 ? (
          <EmptyHint label="Aucune entrée d'historique." />
        ) : (
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
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <Card className="flex items-center gap-3 p-3">
      <div className="grid h-9 w-9 place-items-center rounded-lg bg-muted">{icon}</div>
      <div className="min-w-0">
        <p className="truncate text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-semibold tabular-nums">{value}</p>
      </div>
    </Card>
  );
}

function PhotoGrid({ items }: { items: Array<{ id: string; url: string; caption: string | null; date: string }> }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((p) => (
        <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="group block overflow-hidden rounded-lg border border-border bg-muted">
          <div className="aspect-square overflow-hidden">
            <img src={p.url} alt={p.caption ?? ""} loading="lazy" className="h-full w-full object-cover transition-transform group-hover:scale-105" />
          </div>
          {(p.caption || p.date) && (
            <div className="p-1.5 text-[10px] text-muted-foreground">
              {p.caption && <p className="truncate">{p.caption}</p>}
              {p.date && <p className="truncate">{fmtDay(p.date)}</p>}
            </div>
          )}
        </a>
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
