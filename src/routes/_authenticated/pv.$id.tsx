import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import {
  ArrowLeft,
  Download,
  Trash2,
  CheckCircle2,
  AlertCircle,
  FileText,
  Camera,
  Loader2,
  ChevronRight,
  Send,
  Copy,
  Mail,
  RotateCw,
  ShieldCheck,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { StatusPill, PvStatusPill } from "@/components/ui/status-pill";
import { useServerFn } from "@tanstack/react-start";
import { sendPvToClient } from "@/lib/sign.functions";
import { updatePvStatus } from "@/lib/pv-status.functions";
import { regeneratePvPdf, getPvPdfSignedUrl } from "@/lib/pdf.functions";
import { sendSignedPvEmail, listPvEmailLogs } from "@/lib/signed-email.functions";
import { logUserAction, listPvAuditLogs } from "@/lib/audit.functions";
import { listReserveLifts, getReserveLiftPdfUrl, resendValidatedReserveLiftEmail, resendReserveLiftValidationEmail, reopenReserveLiftReport } from "@/lib/reserve-lift.functions";
import { deriveDisplayStatus, STATUS_LABELS, STATUS_TONES, canReopenClientSide, isEditableDraft } from "@/lib/reserve-lift-status";
import { exportReserveLiftExpertise } from "@/lib/reserve-lift-expertise.functions";
import { FileArchive } from "lucide-react";
import { SignatureTimeline } from "@/components/app/SignatureTimeline";
import { updateReserveStatus, deleteReserve as deleteReserveFn } from "@/lib/reserves.functions";
import { ReserveDetailDialog, type ReserveDetail } from "@/components/pv/ReserveDetailDialog";
import { ReserveLiftWorkflowDialog, type LiftDialogReserve } from "@/components/pv/ReserveLiftWorkflowDialog";
import { PhotoLightboxDialog, type LightboxPhoto } from "@/components/pv/PhotoLightboxDialog";
import { reserveStatusLabel, reserveStatusTone, isReserveOverdue } from "@/lib/reserve-status";



export const Route = createFileRoute("/_authenticated/pv/$id")({
  component: PvDetail,
  validateSearch: (s: Record<string, unknown>) => ({
    openLift: typeof s.openLift === "string" ? s.openLift : undefined,
  }),
  head: () => ({ meta: [{ title: "Détail PV — PVIA" }] }),
});


type Pv = {
  id: string;
  numero: string;
  type: string;
  status: string;
  reception_date: string | null;
  created_at: string;
  signed_at: string | null;
  description: string | null;
  observations: string | null;
  client_signature: string | null;
  company_signature: string | null;
  pdf_url: string | null;
  pdf_generated_at: string | null;
  chantier_id: string | null;
  client_id: string | null;
  company_id: string | null;
  reception_with_reserves: boolean | null;
  work_reference_type: string | null;
  work_reference_number: string | null;
  work_reference_date: string | null;
  work_reference_amount: number | null;
  reserve_completion_delay: string | null;
  reserve_due_date: string | null;
  reserve_lift_status: string | null;
  chantier_address: string | null;
  chantier_postal_code: string | null;
  chantier_city: string | null;
  signature_mode: "remote" | "onsite" | null;
  locked_at: string | null;
  client_identity_email: string | null;
  client_identity_verified_at: string | null;
  client_otp_verified: boolean | null;
  sent_to_email: string | null;
  processing_status?: string | null;
  processing_errors?: Array<{ step: string; message: string; at: string }> | null;
  pdf_generation_status?: string | null;
  photos_failed_count?: number | null;
};
type Photo = {
  id: string; url: string; caption: string | null;
  reserve_id?: string | null; kind?: string | null; signedUrl?: string;
  latitude?: number | null; longitude?: number | null; accuracy?: number | null;
  taken_at?: string | null; created_at?: string | null;
  device_info?: string | null; file_name?: string | null; photo_label?: string | null;
};
type Reserve = {
  id: string;
  description: string;
  severity: string;
  status: string;
  priority?: string | null;
  nature?: string | null;
  work_to_execute?: string | null;
  due_date?: string | null;
  assigned_to?: string | null;
  lifted_at?: string | null;
  validated_at?: string | null;
  created_at: string;
  pv_id: string;
  company_id: string | null;
};


function PvDetail() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const sendPv = useServerFn(sendPvToClient);
  const changeStatusFn = useServerFn(updatePvStatus);
  const regenPdf = useServerFn(regeneratePvPdf);
  const fetchPdfUrl = useServerFn(getPvPdfSignedUrl);
  const resendSignedFn = useServerFn(sendSignedPvEmail);
  const fetchLogsFn = useServerFn(listPvEmailLogs);
  const logAction = useServerFn(logUserAction);
  const listLiftsFn = useServerFn(listReserveLifts);
  const getLiftPdfFn = useServerFn(getReserveLiftPdfUrl);
  const resendLiftFn = useServerFn(resendValidatedReserveLiftEmail);
  const resendLiftValidationFn = useServerFn(resendReserveLiftValidationEmail);
  const [resendingLiftId, setResendingLiftId] = useState<string | null>(null);
  const [exportingLiftId, setExportingLiftId] = useState<string | null>(null);
  const exportExpertiseFn = useServerFn(exportReserveLiftExpertise);
  const [pv, setPv] = useState<Pv | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [reserves, setReserves] = useState<Reserve[]>([]);
  const [reserveDetail, setReserveDetail] = useState<ReserveDetail | null>(null);
  const [liftDialogOpen, setLiftDialogOpen] = useState(false);
  const [liftPreselectedId, setLiftPreselectedId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ photos: LightboxPhoto[]; index: number; reserve?: Reserve | null } | null>(null);
  const updateReserveFn = useServerFn(updateReserveStatus);
  const deleteReserveServerFn = useServerFn(deleteReserveFn);

  const [chantierName, setChantierName] = useState<string | null>(null);
  const [clientName, setClientName] = useState<string | null>(null);
  const [clientEmail, setClientEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendEmail, setSendEmail] = useState("");
  const [sendingClient, setSendingClient] = useState(false);
  const [lastSignUrl, setLastSignUrl] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [emailLogs, setEmailLogs] = useState<Array<{ id: string; recipient_email: string; email_type: string; status: string; error_message: string | null; subject: string | null; sent_at: string | null; created_at: string }>>([]);
  const [resendingSigned, setResendingSigned] = useState(false);
  const [lastEvent, setLastEvent] = useState<{ action: string; created_at: string; user_name: string | null } | null>(null);
  const [auditTotal, setAuditTotal] = useState<number>(0);
  const [lifts, setLifts] = useState<Array<{ id: string; numero: string; status: string; signed_at: string | null; pdf_url: string | null; pdf_internal_url?: string | null; pdf_client_url?: string | null; created_at: string; client_validated_at?: string | null; client_validated_email?: string | null }>>([]);
  const fetchAuditFn = useServerFn(listPvAuditLogs);


  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    // Note: sign_token and sign_token_hash column-level revoked from authenticated.
    // The signing URL is returned by the server fn that (re)generates the token.
    const cols = "id,owner_id,chantier_id,client_id,numero,type,status,reception_date,description,observations,client_signature,company_signature,signed_at,pdf_url,created_at,updated_at,company_id,sign_token_expires_at,sent_to_client_at,sent_to_email,pdf_generated_at,is_field_draft,latitude,longitude,field_last_saved_at,reception_with_reserves,work_reference_type,work_reference_number,work_reference_date,work_reference_amount,reserve_completion_delay,reserve_due_date,chantier_address,chantier_postal_code,chantier_city,reserve_lift_status,signature_mode,client_identity_verified_at,client_identity_verified_by,client_identity_email,client_identity_phone,client_otp_verified,locked_at,processing_status,processing_errors,pdf_generation_status,photos_failed_count";
    // Retry up to 4× (≈1.2s) — covers the small replication window right
    // after createPv, where the row may not yet be visible to the read replica.
    let pvData: any = null;
    let lastError: any = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = await supabase.from("pv").select(cols).eq("id", id).maybeSingle();
      if (r.data) { pvData = r.data; lastError = null; break; }
      lastError = r.error;
      if (attempt < 3) await new Promise((res) => setTimeout(res, 350));
    }
    if (!pvData) {
      // eslint-disable-next-line no-console
      console.error("[pv] lecture impossible après création/retries", { pvId: id, error: lastError });
      const message = lastError?.message ? `Lecture PV impossible : ${lastError.message}` : "PV non visible après création. Rechargez la fiche.";
      setLoadError(message);
      toast.error(message);
      setLoading(false);
      return;
    }
    setPv(pvData as Pv);

    const [photosRes, reservesRes] = await Promise.all([
      supabase.from("pv_photos").select("id,url,caption,reserve_id,kind,latitude,longitude,accuracy,taken_at,created_at,device_info,file_name,photo_label").eq("pv_id", id),
      supabase.from("pv_reserves").select("id,description,severity,status,priority,nature,work_to_execute,due_date,assigned_to,lifted_at,validated_at,created_at,pv_id,company_id").eq("pv_id", id).order("created_at"),
    ]);
    const ph = (photosRes.data ?? []) as Photo[];
    // Sign URLs for photos
    const signed = await Promise.all(
      ph.map(async (p) => {
        const { data } = await supabase.storage.from("pv-assets").createSignedUrl(p.url, 3600);
        return { ...p, signedUrl: data?.signedUrl };
      }),
    );
    setPhotos(signed);
    setReserves((reservesRes.data ?? []) as Reserve[]);

    if (pvData.chantier_id) {
      const { data: c } = await supabase.from("chantiers").select("name").eq("id", pvData.chantier_id).maybeSingle();
      setChantierName(c?.name ?? null);
    }
    if (pvData.client_id) {
      const { data: cl } = await supabase.from("clients").select("name,email").eq("id", pvData.client_id).maybeSingle();
      setClientName(cl?.name ?? null);
      setClientEmail(cl?.email ?? null);
    }
    setLoading(false);
  }, [id, navigate]);

  useEffect(() => { load(); }, [load]);

  // Auto-open lift dialog when navigating with ?openLift=<reserveId>
  useEffect(() => {
    if (!search.openLift || reserves.length === 0) return;
    const target = reserves.find((r) => r.id === search.openLift);
    if (!target) return;
    if (["validee", "en_attente_validation", "levee"].includes(target.status)) {
      toast.message("Cette réserve n'est pas à lever.");
    } else {
      setLiftPreselectedId(target.id);
      setLiftDialogOpen(true);
    }
    navigate({ to: "/pv/$id", params: { id }, search: {}, replace: true });
  }, [search.openLift, reserves, id, navigate]);

  const loadLogs = useCallback(async () => {
    try {
      const { logs } = await fetchLogsFn({ data: { pvId: id } });
      setEmailLogs(logs as any);
    } catch {
      /* silent */
    }
  }, [fetchLogsFn, id]);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  const loadLifts = useCallback(async () => {
    try {
      const { lifts } = await listLiftsFn({ data: { pvId: id } });
      setLifts(lifts as any);
    } catch { /* silent */ }
  }, [listLiftsFn, id]);

  useEffect(() => { loadLifts(); }, [loadLifts]);

  async function downloadLiftPdf(reportId: string, variant: "client" | "internal" = "client") {
    try {
      const { url } = await getLiftPdfFn({ data: { reportId, variant } });
      window.open(url, "_blank");
    } catch (e: any) {
      toast.error(e?.message || "PDF indisponible");
    }
  }

  async function resendLiftValidatedEmail(reportId: string) {
    setResendingLiftId(reportId);
    try {
      await resendLiftFn({ data: { reportId } });
      toast.success("PDF validé renvoyé par email.");
      loadLogs();
    } catch (e: any) {
      toast.error(e?.message || "Échec de l'envoi");
    } finally {
      setResendingLiftId(null);
    }
  }

  async function resendLiftValidationRequest(reportId: string) {
    setResendingLiftId(reportId);
    try {
      const r = await resendLiftValidationFn({ data: { reportId } });
      toast.success(r.recipient ? `Demande renvoyée à ${r.recipient}` : "Demande de validation renvoyée.");
      loadLogs();
    } catch (e: any) {
      toast.error(e?.message || "Échec de l'envoi");
    } finally {
      setResendingLiftId(null);
    }
  }

  async function exportLiftExpertise(reportId: string) {
    setExportingLiftId(reportId);
    try {
      const r = await exportExpertiseFn({ data: { reportId } });
      const bin = atob(r.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = r.fileName; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast.success(`Export expertise prêt (${r.photosTotal} photos${r.photosMissing ? `, ${r.photosMissing} manquantes` : ""}).`);
    } catch (e: any) {
      toast.error(e?.message || "Export indisponible");
    } finally {
      setExportingLiftId(null);
    }
  }




  const loadLastEvent = useCallback(async () => {
    try {
      const res = await fetchAuditFn({ data: { pvId: id, limit: 1, offset: 0 } });
      setLastEvent(res.logs[0] ? { action: res.logs[0].action, created_at: res.logs[0].created_at, user_name: res.logs[0].user_name } : null);
      setAuditTotal(res.total);
    } catch { /* silent */ }
  }, [fetchAuditFn, id]);

  useEffect(() => { loadLastEvent(); }, [loadLastEvent]);


  async function handleResendSigned() {
    if (!pv) return;
    setResendingSigned(true);
    try {
      const res = await resendSignedFn({ data: { pvId: pv.id } });
      if (res.ok) toast.success("Email envoyé avec le PDF signé en pièce jointe.");
      else toast.error("Aucun destinataire n'a reçu l'email — vérifiez les logs.");
      loadLogs();
    } catch (e: any) {
      toast.error(e?.message || "Échec de l'envoi");
    } finally {
      setResendingSigned(false);
    }
  }


  async function changeStatus(status: string) {
    if (!pv) return;
    if (status === pv.status) return;
    if (status !== "brouillon" && status !== "archive") {
      toast.error("Seules les transitions brouillon ↔ archive sont autorisées.");
      return;
    }
    try {
      await changeStatusFn({ data: { pvId: pv.id, status: status as "brouillon" | "archive" } });
      toast.success("Statut mis à jour");
      load();
      loadLastEvent();
    } catch (e: any) {
      toast.error(e?.message || "Statut non modifiable");
    }
  }


  async function updateReserve(rid: string, status: string) {
    if (!pv?.company_id) return;
    try {
      await updateReserveFn({
        data: { companyId: pv.company_id, id: rid, status: status as any },
      });
      setReserves((rs) => rs.map((r) => (r.id === rid ? { ...r, status } : r)));
      toast.success("Réserve mise à jour");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Mise à jour impossible");
    }
  }

  async function deleteReserve(rid: string) {
    if (!pv?.company_id) return;
    if (!confirm("Supprimer cette réserve ?")) return;
    try {
      await deleteReserveServerFn({ data: { companyId: pv.company_id, id: rid } });
      setReserves((rs) => rs.filter((r) => r.id !== rid));
      toast.success("Réserve supprimée");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Suppression impossible");
    }
  }


  async function downloadPdf() {
    if (!pv) return;
    if (!pv.pdf_url) return toast.error("Aucun PDF disponible. Régénérez-le d'abord.");
    try {
      const { url } = await fetchPdfUrl({ data: { pvId: pv.id } });
      window.open(url, "_blank");
    } catch (e: any) {
      toast.error(e?.message || "PDF indisponible");
    }
  }

  async function handleRegenerate() {
    if (!pv) return;
    setRegenerating(true);
    try {
      await regenPdf({ data: { pvId: pv.id } });
      toast.success("PDF régénéré avec succès");
      load();
    } catch (e: any) {
      toast.error(e?.message || "Échec de la régénération du PDF");
    } finally {
      setRegenerating(false);
    }
  }


  async function deletePv() {
    if (!pv) return;
    if (pv.locked_at) return toast.error("Ce PV est signé et verrouillé — suppression interdite.");
    if (!confirm("Supprimer définitivement ce PV ainsi que ses photos et réserves ?")) return;
    const snapshot = { numero: pv.numero, status: pv.status, type: pv.type };
    // delete dependents (RLS scoped to owner)
    await supabase.from("pv_photos").delete().eq("pv_id", pv.id);
    await supabase.from("pv_reserves").delete().eq("pv_id", pv.id);
    const { error } = await supabase.from("pv").delete().eq("id", pv.id);
    if (error) return toast.error(error.message);
    if (pv.company_id) {
      logAction({ data: { companyId: pv.company_id, pvId: pv.id, entityType: "pv", entityId: pv.id, action: "pv.delete", oldValues: snapshot } }).catch(() => {});
    }
    toast.success("PV supprimé");
    navigate({ to: "/pv" });
  }

  async function openSendDialog() {
    if (!pv) return;
    if (pv.client_signature) {
      toast.error("Ce PV est déjà signé par le client.");
      return;
    }
    setSendEmail(clientEmail ?? "");
    setLastSignUrl(null);
    setSendOpen(true);
  }

  async function handleSendToClient() {
    if (!pv) return;
    if (!sendEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(sendEmail)) {
      toast.error("Email client invalide.");
      return;
    }
    setSendingClient(true);
    try {
      const res = await sendPv({ data: { pvId: pv.id, email: sendEmail } });
      setLastSignUrl(res.signUrl);
      toast.success(`Email envoyé à ${sendEmail}`);
      load();
    } catch (e: any) {
      toast.error(e?.message || "Échec de l'envoi");
    } finally {
      setSendingClient(false);
    }
  }

  if (loading) {
    return (
      <div className="grid h-64 place-items-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!pv) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => navigate({ to: "/pv" })}>
          <ArrowLeft className="h-4 w-4" /> Retour aux PV
        </Button>
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          <div className="font-semibold">Fiche PV non chargée</div>
          <p className="mt-1">{loadError ?? "Erreur de lecture inconnue."}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {pv.processing_status && pv.processing_status !== "ok" && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900">
          <div className="flex items-start gap-3">
            <ShieldCheck className="h-5 w-5 mt-0.5 text-amber-700" />
            <div className="flex-1 text-sm">
              <div className="font-semibold">
                PV créé avec des erreurs partielles
                {pv.processing_status === "failed" ? " (critique)" : ""}
              </div>
              <ul className="mt-1 list-disc pl-5 space-y-0.5">
                {pv.pdf_generation_status === "failed" && (
                  <li>Génération PDF échouée — utilisez « Régénérer le PDF ».</li>
                )}
                {(pv.photos_failed_count ?? 0) > 0 && (
                  <li>{pv.photos_failed_count} photo(s) non importée(s).</li>
                )}
                {(pv.processing_errors ?? []).slice(0, 5).map((err, i) => (
                  <li key={i} className="font-mono text-xs">
                    {err.step} — {err.message}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Link to="/pv" className="hover:text-foreground">Procès-verbaux</Link>
            <ChevronRight className="h-3 w-3" />
            <span>N° {pv.numero}</span>
          </div>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight">N° {pv.numero}</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Créé le {new Date(pv.created_at).toLocaleDateString("fr-FR")}
            {pv.signed_at && ` · Signé le ${new Date(pv.signed_at).toLocaleDateString("fr-FR")}`}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {pv.locked_at && (
              <StatusPill tone="success" icon={<ShieldCheck />} size="sm">Verrouillé</StatusPill>
            )}
            {pv.signature_mode === "remote" && pv.status === "en_attente" && (
              <StatusPill tone="warning" icon={<Mail />} size="sm">En attente signature client</StatusPill>
            )}
            {pv.pdf_url && (
              <StatusPill tone="success" icon={<CheckCircle2 />} size="sm">PDF signé</StatusPill>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/pv"><Button variant="ghost"><ArrowLeft className="h-4 w-4" /> Retour</Button></Link>
          {!pv.client_signature && !pv.locked_at && (
            <Button onClick={openSendDialog}>
              <Send className="h-4 w-4" /> {pv.signature_mode === "remote" && pv.status === "en_attente" ? "Renvoyer le lien de signature" : "Envoyer au client pour signature"}
            </Button>
          )}
          {pv.status === "signe" && pv.pdf_url && (
            <Button variant="outline" onClick={handleResendSigned} disabled={resendingSigned}>
              {resendingSigned ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
              {resendingSigned ? "Envoi…" : "Renvoyer le PDF signé"}
            </Button>
          )}
          {(() => {
            const fullySigned =
              pv.status === "signe" &&
              !!pv.company_signature &&
              !!pv.client_signature &&
              (pv.signature_mode === "remote"
                ? !!pv.client_identity_verified_at
                : pv.client_otp_verified === true);
            const showRegen = fullySigned && (pv.pdf_generation_status === "failed" || !pv.pdf_url);
            return showRegen ? (
              <Button variant="outline" onClick={handleRegenerate} disabled={regenerating}>
                {regenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                {regenerating ? "Génération…" : "Régénérer le PDF"}
              </Button>
            ) : null;
          })()}
          {pv.pdf_url && <Button variant="outline" onClick={downloadPdf}><Download className="h-4 w-4" /> Télécharger PDF signé</Button>}
          {!pv.pdf_url && pv.status !== "signe" && (
            <span className="self-center text-xs text-muted-foreground">
              PDF disponible uniquement après signature complète du PV.
            </span>
          )}
          <Link to="/pv/$id/historique" params={{ id: pv.id }}>
            <Button variant="outline"><ShieldCheck className="h-4 w-4" /> Historique légal</Button>
          </Link>
          {!pv.locked_at && (
            <Button variant="outline" onClick={deletePv}><Trash2 className="h-4 w-4 text-destructive" /> Supprimer</Button>
          )}
        </div>
      </div>



      <SignatureTimeline
        createdAt={pv.created_at}
        sentAt={
          emailLogs.find(
            (l) => l.status === "sent" && (l.email_type === "signed_to_client" || l.email_type === "invite"),
          )?.sent_at ?? null
        }
        signedAt={pv.signed_at}
        pdfGeneratedAt={pv.pdf_generated_at}
        hasClientSignature={!!pv.client_signature}
      />




      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Envoyer au client pour signature</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Un email professionnel sera envoyé à votre client avec un lien sécurisé pour consulter et signer ce PV en ligne. Aucun compte n'est requis.
            </p>
            <div>
              <Label htmlFor="client-email">Email du client</Label>
              <Input id="client-email" type="email" value={sendEmail} onChange={(e) => setSendEmail(e.target.value)} placeholder="client@exemple.fr" className="mt-1.5" />
            </div>
            {lastSignUrl && (
              <div className="rounded-lg border bg-muted/30 p-3 text-xs">
                <div className="mb-1 font-medium text-foreground">Lien généré (valable 14 jours)</div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate text-muted-foreground">{lastSignUrl}</code>
                  <Button size="icon" variant="ghost" onClick={() => { navigator.clipboard.writeText(lastSignUrl); toast.success("Lien copié"); }}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSendOpen(false)}>Fermer</Button>
            <Button onClick={handleSendToClient} disabled={sendingClient}>
              {sendingClient ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {sendingClient ? "Envoi…" : "Envoyer l'email"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-6 lg:col-span-2 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Informations</h3>
            <div className="flex items-center gap-2">
              <PvStatusPill status={pv.status} />
              {!pv.locked_at && (pv.status === "brouillon" || pv.status === "archive") ? (
                <Select value={pv.status} onValueChange={changeStatus}>
                  <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="brouillon">Brouillon</SelectItem>
                    <SelectItem value="archive">Archivé</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <span className="text-xs text-muted-foreground italic">
                  {pv.locked_at ? "Verrouillé" : "Statut géré par le flux de signature"}
                </span>
              )}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 text-sm">
            <Info label="Type">{pv.type}</Info>
            <Info label="Date de réception">{pv.reception_date ? new Date(pv.reception_date).toLocaleDateString("fr-FR") : "—"}</Info>
            <Info label="Chantier">{chantierName ?? "—"}</Info>
            <Info label="Client">{clientName ?? "—"}</Info>
            <Info label="Décision">
              {pv.reception_with_reserves == null ? "—" : pv.reception_with_reserves ? (
                <span className="inline-flex items-center gap-1 text-warning"><AlertCircle className="h-3.5 w-3.5" /> Avec réserves</span>
              ) : (
                <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="h-3.5 w-3.5" /> Sans réserve</span>
              )}
            </Info>
            <Info label="Levée de réserves">
              {pv.reserve_lift_status && pv.reserve_lift_status !== "none" ? (
                <StatusPill tone={pv.reserve_lift_status === "completed" ? "success" : pv.reserve_lift_status === "partial" ? "warning" : "destructive"} dot>
                  {pv.reserve_lift_status === "completed" ? "Toutes réserves levées" : pv.reserve_lift_status === "partial" ? "Levée partielle" : "Levée à prévoir"}
                </StatusPill>
              ) : "—"}
            </Info>
            {pv.work_reference_type && (
              <Info label="Référence travaux">
                {pv.work_reference_type}{pv.work_reference_number ? ` n° ${pv.work_reference_number}` : ""}
                {pv.work_reference_date ? ` · ${new Date(pv.work_reference_date).toLocaleDateString("fr-FR")}` : ""}
                {pv.work_reference_amount ? ` · ${pv.work_reference_amount} €` : ""}
              </Info>
            )}
            {(pv.chantier_address || pv.chantier_city) && (
              <Info label="Adresse chantier">{[pv.chantier_address, [pv.chantier_postal_code, pv.chantier_city].filter(Boolean).join(" ")].filter(Boolean).join(", ")}</Info>
            )}
            {pv.reception_with_reserves && (pv.reserve_completion_delay || pv.reserve_due_date) && (
              <Info label="Délai levée">
                {pv.reserve_completion_delay || "—"}
                {pv.reserve_due_date ? ` (échéance ${new Date(pv.reserve_due_date).toLocaleDateString("fr-FR")})` : ""}
              </Info>
            )}
          </div>
          <DescriptionBlock label="Description des travaux" text={pv.description} />
          {pv.observations && (
            <DescriptionBlock label="Observations" text={pv.observations} />
          )}
        </Card>

        <Card className="p-4 space-y-3">
          <h3 className="font-semibold text-sm">Signatures</h3>
          <CompactSignature
            label="Client"
            data={pv.client_signature}
            name={clientName ?? pv.client_identity_email ?? null}
            date={pv.signed_at}
          />
          <CompactSignature
            label="Entreprise"
            data={pv.company_signature}
            name={null}
            date={pv.signed_at}
          />
        </Card>
      </div>

      {(() => {
        const globalPhotos = photos.filter((p) => !p.reserve_id);
        if (globalPhotos.length === 0) return null;
        return (
          <Card className="p-6">
            <div className="mb-4 flex items-center gap-2">
              <Camera className="h-4 w-4 text-primary" />
              <h3 className="font-semibold">Photos chantier ({globalPhotos.length})</h3>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {globalPhotos.map((p) => (
                <a key={p.id} href={p.signedUrl} target="_blank" rel="noreferrer" className="group block">
                  <div className="aspect-square overflow-hidden rounded-lg border border-border bg-muted">
                    {p.signedUrl && <img src={p.signedUrl} alt={p.caption ?? ""} className="h-full w-full object-cover transition-transform group-hover:scale-105" />}
                  </div>
                  {p.caption && <p className="mt-1 truncate text-xs text-muted-foreground">{p.caption}</p>}
                </a>
              ))}
            </div>
          </Card>
        );
      })()}


      {(() => {
        const total = reserves.length;
        const open = reserves.filter((r) => r.status === "ouverte").length;
        const lifted = reserves.filter((r) => r.status === "levee").length;
        const validated = reserves.filter((r) => r.status === "validee").length;
        const liftStatus = pv.reserve_lift_status ?? (total === 0 ? "none" : open === total ? "pending" : open === 0 ? "completed" : "partial");
        const globalLabel =
          liftStatus === "pending" ? "Levée à prévoir"
          : liftStatus === "partial" ? "Levée partielle"
          : liftStatus === "completed" ? "Toutes réserves levées"
          : "Réserves";
        const globalTone =
          liftStatus === "completed" ? "success"
          : liftStatus === "partial" ? "warning"
          : liftStatus === "pending" ? "destructive"
          : "neutral";
        if (total === 0 && lifts.length === 0) return null;
        const tiles = [
          { label: "Ouvertes", value: open, tone: "destructive" as const },
          { label: "Levées", value: lifted, tone: "warning" as const },
          { label: "Validées", value: validated, tone: "success" as const },
        ].filter((t) => t.value > 0);
        return (
          <Card className="p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
                <h3 className="truncate text-sm font-semibold">Suivi des réserves</h3>
                <StatusPill tone={globalTone as any} size="sm" dot>{globalLabel}</StatusPill>
                {total > 0 && <span className="text-xs text-muted-foreground">· {total} au total</span>}
              </div>
              <div className="flex flex-wrap gap-2">
                {(liftStatus === "pending" || liftStatus === "partial") && (
                  <Button size="sm" onClick={() => {
                    const open = reserves.filter((r) => ["ouverte", "en_cours", "rejetee"].includes(r.status));
                    if (open.length === 0) { toast.error("Aucune réserve ouverte à lever."); return; }
                    setLiftPreselectedId(null);
                    setLiftDialogOpen(true);
                  }}>
                    <CheckCircle2 className="h-4 w-4" /> Préparer la levée
                  </Button>
                )}
                {liftStatus === "completed" && (lifts[0]?.pdf_client_url || lifts[0]?.pdf_url) && (
                  <Button size="sm" variant="outline" onClick={() => downloadLiftPdf(lifts[0].id, "client")}>
                    <Download className="h-4 w-4" /> PV de levée (client)
                  </Button>
                )}
              </div>
            </div>
            {tiles.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {tiles.map((s) => (
                  <div key={s.label} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5">
                    <StatusPill tone={s.tone} size="sm" dot>{s.value}</StatusPill>
                    <span className="text-xs text-muted-foreground">{s.label}</span>
                  </div>
                ))}
              </div>
            )}
            {reserves.length > 0 && (
              <div className="space-y-1.5">
                {reserves.map((r, reserveIdx) => {
                  const overdue = isReserveOverdue(r.due_date, r.status);
                  const reservePhotos = photos.filter((p) => p.reserve_id === r.id);
                  return (
                    <div key={r.id} className={`flex flex-col gap-2 rounded-md border p-2.5 ${overdue ? "border-red-500/50" : "border-border"}`}>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <StatusPill tone={r.severity === "majeure" ? "destructive" : "neutral"} size="sm">{r.severity}</StatusPill>
                            <StatusPill tone={reserveStatusTone(r.status) as any} size="sm" dot>{reserveStatusLabel(r.status)}</StatusPill>
                            {r.priority && r.priority !== "normal" && (
                              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">P. {r.priority}</span>
                            )}
                            {overdue && <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">En retard</span>}
                            {reservePhotos.length === 0 ? (
                              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">Ancienne réserve sans photo</span>
                            ) : (
                              <>
                                <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                  <Camera className="h-2.5 w-2.5" /> {reservePhotos.length}
                                </span>
                                {reservePhotos.some((p) => p.latitude != null) ? (
                                  <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">📍 Géolocalisée</span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">Non géolocalisée</span>
                                )}
                              </>
                            )}
                          </div>
                          <p className="line-clamp-2 text-sm leading-snug">{r.description}</p>
                          {r.work_to_execute && (
                            <p className="line-clamp-1 text-[11px] text-muted-foreground"><span className="font-medium">Travaux :</span> {r.work_to_execute}</p>
                          )}
                          <div className="flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                            {r.due_date && <span className={overdue ? "font-semibold text-red-600" : ""}>📅 {new Date(r.due_date).toLocaleDateString("fr-FR")}</span>}
                            {r.assigned_to && <span>👷 Assigné</span>}
                            {r.lifted_at && <span>Levée {new Date(r.lifted_at).toLocaleDateString("fr-FR")}</span>}
                            {r.validated_at && <span className="text-success">Validée {new Date(r.validated_at).toLocaleDateString("fr-FR")}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 sm:shrink-0">
                          <Button size="sm" variant="outline" className="h-8" onClick={() => setReserveDetail(r as ReserveDetail)}>
                            Détails
                          </Button>
                          {(r.status === "ouverte" || r.status === "en_cours" || r.status === "rejetee") && (
                            <Button
                              size="sm" variant="outline" className="h-8"
                              onClick={() => {
                                if (r.status === "validee") { toast.error("Cette réserve est déjà validée."); return; }
                                if (r.status === "en_attente_validation") { toast.error("Cette réserve est en attente de validation."); return; }
                                if (r.status === "levee") { toast.error("Cette réserve est déjà levée."); return; }
                                setLiftPreselectedId(r.id);
                                setLiftDialogOpen(true);
                              }}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" /> Lever
                            </Button>
                          )}
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => deleteReserve(r.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                      {reservePhotos.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {reservePhotos.map((p, pi) => {
                            const reserveNum = String(reserveIdx + 1).padStart(3, "0");
                            const label = p.photo_label ?? `RES-${reserveNum}-CONST-${String(pi + 1).padStart(3, "0")}`;
                            const lbPhotos: LightboxPhoto[] = reservePhotos.map((q, qi) => ({
                              id: q.id, url: q.signedUrl ?? null,
                              label: q.photo_label ?? `RES-${reserveNum}-CONST-${String(qi + 1).padStart(3, "0")}`,
                              fileName: q.file_name ?? null,
                              takenAt: q.taken_at ?? null, uploadedAt: q.created_at ?? null,
                              latitude: q.latitude ?? null, longitude: q.longitude ?? null,
                              accuracy: q.accuracy ?? null, deviceInfo: q.device_info ?? null,
                              photoType: "initial",
                            }));
                            return (
                              <button
                                key={p.id} type="button"
                                onClick={() => setLightbox({ photos: lbPhotos, index: pi, reserve: r })}
                                title={label}
                                className="relative block h-14 w-14 overflow-hidden rounded border border-border bg-muted"
                              >
                                {p.signedUrl && <img src={p.signedUrl} alt={label} className="h-full w-full object-cover" />}
                                {p.latitude == null && (
                                  <span className="absolute left-0.5 top-0.5 rounded bg-amber-500/90 px-1 text-[8px] font-medium text-white">!</span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}


            {lifts.length > 0 && (
              <div className="space-y-1.5 border-t border-border pt-3">
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">PV de levée ({lifts.length})</p>
                {lifts.map((l) => {
                  const validated = !!l.client_validated_at;
                  const liftStatusLabel = validated ? "Validée client" : l.status === "signe" ? "Attente validation client" : "Brouillon";
                  const liftTone = validated ? "success" : l.status === "signe" ? "warning" : "neutral";
                  return (
                    <div key={l.id} className="flex flex-col gap-2 rounded-md border border-border p-2.5 text-sm sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex flex-wrap items-center gap-2 min-w-0">
                        <span className="font-medium">N° {l.numero}</span>
                        <StatusPill tone={liftTone as any} size="sm" dot>{liftStatusLabel}</StatusPill>
                        <span className="text-[11px] text-muted-foreground">{new Date(l.signed_at || l.created_at).toLocaleDateString("fr-FR")}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {(l.pdf_client_url || l.pdf_url) && (
                          <Button size="sm" variant={validated ? "default" : "outline"} className="h-8" onClick={() => downloadLiftPdf(l.id, "client")}>
                            <Download className="h-3.5 w-3.5" /> PDF client
                          </Button>
                        )}
                        {l.pdf_internal_url && (
                          <Button size="sm" variant="outline" className="h-8" onClick={() => downloadLiftPdf(l.id, "internal")} title="Version interne avec GPS / EXIF / IP — usage entreprise uniquement">
                            <Download className="h-3.5 w-3.5" /> PDF interne
                          </Button>
                        )}
                        <Button size="sm" variant="outline" className="h-8" onClick={() => exportLiftExpertise(l.id)} disabled={exportingLiftId === l.id} title="ZIP : PDFs + photos originales + manifest.json (GPS, EXIF, SHA-256) + audit trail">
                          {exportingLiftId === l.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileArchive className="h-3.5 w-3.5" />}
                          Export expertise
                        </Button>
                        {validated && (
                          <Button size="sm" variant="outline" className="h-8" onClick={() => resendLiftValidatedEmail(l.id)} disabled={resendingLiftId === l.id}>
                            {resendingLiftId === l.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
                            Renvoyer
                          </Button>
                        )}
                        {!validated && l.status === "signe" && (
                          <Button size="sm" variant="outline" className="h-8" onClick={() => resendLiftValidationRequest(l.id)} disabled={resendingLiftId === l.id}>
                            {resendingLiftId === l.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
                            Relancer
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        );
      })()}

      <Card className="p-6">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-primary" />
            <h3 className="font-semibold">Historique des emails ({emailLogs.length})</h3>
          </div>
          {pv.status === "signe" && pv.pdf_url && (
            <Button size="sm" variant="outline" onClick={handleResendSigned} disabled={resendingSigned}>
              {resendingSigned ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
              Renvoyer le PDF signé
            </Button>
          )}
        </div>
        {emailLogs.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Aucun email envoyé pour ce PV.</p>
        ) : (
          <div className="space-y-2">
            {emailLogs.map((l) => (
              <div key={l.id} className="flex items-start justify-between gap-3 rounded-lg border border-border p-3 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill tone={l.status === "sent" ? "success" : "destructive"} dot>
                      {l.status === "sent" ? "Envoyé" : "Échec"}
                    </StatusPill>
                    <span className="text-xs uppercase tracking-wider text-muted-foreground">{labelForType(l.email_type)}</span>
                  </div>
                  <p className="mt-1 truncate font-medium">{l.recipient_email}</p>
                  {l.subject && <p className="truncate text-xs text-muted-foreground">{l.subject}</p>}
                  {l.error_message && <p className="mt-1 text-xs text-destructive">{l.error_message}</p>}
                </div>
                <div className="shrink-0 text-right text-xs text-muted-foreground">
                  {new Date(l.sent_at || l.created_at).toLocaleString("fr-FR")}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
      <ReserveDetailDialog
        open={!!reserveDetail}
        onOpenChange={(o) => !o && setReserveDetail(null)}
        reserve={reserveDetail}
        onChanged={() => load()}
      />
      <ReserveLiftWorkflowDialog
        open={liftDialogOpen}
        onOpenChange={setLiftDialogOpen}
        pvId={pv.id}
        pvNumero={pv.numero}
        reserves={reserves
          .filter((r) => ["ouverte", "en_cours", "rejetee"].includes(r.status))
          .map<LiftDialogReserve>((r) => ({
            id: r.id, description: r.description, severity: r.severity, status: r.status,
            priority: r.priority, due_date: r.due_date, work_to_execute: r.work_to_execute,
          }))}
        preselectedReserveId={liftPreselectedId}
        chantierLabel={chantierName}
        clientLabel={clientName}
        clientEmail={clientEmail}
        onCompleted={() => load()}
      />
      {lightbox && (
        <PhotoLightboxDialog
          open={!!lightbox}
          onOpenChange={(o) => !o && setLightbox(null)}
          photos={lightbox.photos}
          startIndex={lightbox.index}
          context={{
            reserveDescription: lightbox.reserve?.description,
            reserveSeverity: lightbox.reserve?.severity,
            reserveStatus: lightbox.reserve ? reserveStatusLabel(lightbox.reserve.status) : undefined,
            showExactGps: true,
          }}
        />
      )}
    </div>
  );
}


function labelForType(t: string) {
  switch (t) {
    case "signed_to_client": return "PV signé → client";
    case "signed_copy_to_company": return "Copie entreprise";
    case "signed_resend": return "Renvoi manuel";
    case "invite": return "Invitation";
    case "reserve_lift_validated": return "Levée validée → client";
    default: return t;
  }
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1">{children}</p>
    </div>
  );
}

function CompactSignature({ label, data, name, date }: { label: string; data: string | null; name: string | null; date: string | null }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-muted/20 p-2">
      <div className="grid h-10 w-20 shrink-0 place-items-center overflow-hidden rounded bg-background">
        {data ? (
          <img src={data} alt={`Signature ${label}`} className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="text-[10px] text-muted-foreground">Non signé</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="truncate text-sm font-medium">{name ?? "—"}</div>
        {data && date && (
          <div className="text-[11px] text-muted-foreground">
            {new Date(date).toLocaleDateString("fr-FR")} · {new Date(date).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
          </div>
        )}
      </div>
    </div>
  );
}

function DescriptionBlock({ label, text }: { label: string; text: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const value = text?.trim() || "";
  const isLong = value.length > 220 || value.split("\n").length > 3;
  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-sm ${!expanded && isLong ? "line-clamp-3" : ""}`}>
        {value || "—"}
      </p>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-xs font-medium text-primary hover:underline"
        >
          {expanded ? "Voir moins" : "Voir plus"}
        </button>
      )}
    </div>
  );
}
