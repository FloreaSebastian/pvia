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
import { listReserveLifts, getReserveLiftPdfUrl, resendValidatedReserveLiftEmail, resendReserveLiftValidationEmail } from "@/lib/reserve-lift.functions";
import { SignatureTimeline } from "@/components/app/SignatureTimeline";

export const Route = createFileRoute("/_authenticated/pv/$id")({
  component: PvDetail,
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
  client_otp_verified: boolean | null;
  sent_to_email: string | null;
};
type Photo = { id: string; url: string; caption: string | null; signedUrl?: string };
type Reserve = { id: string; description: string; severity: string; status: string; lifted_at?: string | null; validated_at?: string | null };

function PvDetail() {
  const { id } = Route.useParams();
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
  const [pv, setPv] = useState<Pv | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [reserves, setReserves] = useState<Reserve[]>([]);
  const [chantierName, setChantierName] = useState<string | null>(null);
  const [clientName, setClientName] = useState<string | null>(null);
  const [clientEmail, setClientEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendEmail, setSendEmail] = useState("");
  const [sendingClient, setSendingClient] = useState(false);
  const [lastSignUrl, setLastSignUrl] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [emailLogs, setEmailLogs] = useState<Array<{ id: string; recipient_email: string; email_type: string; status: string; error_message: string | null; subject: string | null; sent_at: string | null; created_at: string }>>([]);
  const [resendingSigned, setResendingSigned] = useState(false);
  const [lastEvent, setLastEvent] = useState<{ action: string; created_at: string; user_name: string | null } | null>(null);
  const [auditTotal, setAuditTotal] = useState<number>(0);
  const [lifts, setLifts] = useState<Array<{ id: string; numero: string; status: string; signed_at: string | null; pdf_url: string | null; created_at: string; client_validated_at?: string | null; client_validated_email?: string | null }>>([]);
  const fetchAuditFn = useServerFn(listPvAuditLogs);


  const load = useCallback(async () => {
    setLoading(true);
    const { data: pvData, error } = await supabase.from("pv").select("*").eq("id", id).maybeSingle();
    if (error || !pvData) {
      toast.error("PV introuvable");
      navigate({ to: "/pv" });
      return;
    }
    setPv(pvData as Pv);

    const [photosRes, reservesRes] = await Promise.all([
      supabase.from("pv_photos").select("id,url,caption").eq("pv_id", id),
      supabase.from("pv_reserves").select("id,description,severity,status,lifted_at,validated_at").eq("pv_id", id).order("created_at"),
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

  async function downloadLiftPdf(reportId: string) {
    try {
      const { url } = await getLiftPdfFn({ data: { reportId } });
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
    const prev = reserves.find((r) => r.id === rid);
    const { error } = await supabase.from("pv_reserves").update({ status }).eq("id", rid);
    if (error) return toast.error(error.message);
    setReserves((rs) => rs.map((r) => (r.id === rid ? { ...r, status } : r)));
    toast.success("Réserve mise à jour");
    if (pv?.company_id) {
      const action = status === "levee" ? "reserve.lifted" : status === "validee" ? "reserve.validated" : "reserve.update";
      logAction({ data: { companyId: pv.company_id, pvId: pv.id, entityType: "reserve", entityId: rid, action, oldValues: { status: prev?.status }, newValues: { status } } }).catch(() => {});
    }
  }

  async function deleteReserve(rid: string) {
    if (!confirm("Supprimer cette réserve ?")) return;
    const prev = reserves.find((r) => r.id === rid);
    const { error } = await supabase.from("pv_reserves").delete().eq("id", rid);
    if (error) return toast.error(error.message);
    setReserves((rs) => rs.filter((r) => r.id !== rid));
    if (pv?.company_id) {
      logAction({ data: { companyId: pv.company_id, pvId: pv.id, entityType: "reserve", entityId: rid, action: "reserve.delete", oldValues: prev ? { description: prev.description, severity: prev.severity, status: prev.status } : null } }).catch(() => {});
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

  if (loading || !pv) {
    return (
      <div className="grid h-64 place-items-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Link to="/pv" className="hover:text-foreground">Procès-verbaux</Link>
            <ChevronRight className="h-3 w-3" />
            <span>N° {pv.numero}</span>
          </div>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight">N° {pv.numero}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Créé le {new Date(pv.created_at).toLocaleDateString("fr-FR")}
            {pv.signed_at && ` · Signé le ${new Date(pv.signed_at).toLocaleDateString("fr-FR")}`}
            {pv.pdf_generated_at && ` · PDF généré le ${new Date(pv.pdf_generated_at).toLocaleString("fr-FR")}`}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <StatusPill tone="success" icon={<ShieldCheck />}>Traçabilité complète</StatusPill>
            {pv.locked_at && (
              <StatusPill tone="success" icon={<ShieldCheck />}>PV signé — verrouillé</StatusPill>
            )}
            {pv.signature_mode === "remote" && pv.status === "en_attente" && (
              <StatusPill tone="warning" icon={<Mail />}>Signature à distance — en attente client</StatusPill>
            )}
            {pv.signature_mode === "onsite" && pv.status === "signe" && (
              <StatusPill tone="success" icon={<CheckCircle2 />}>Signature sur place validée</StatusPill>
            )}
            {pv.pdf_url && (
              <StatusPill tone="success" icon={<CheckCircle2 />}>PDF signé disponible</StatusPill>
            )}
            {(() => {
              const lastClientSent = emailLogs.find((l) => l.status === "sent" && (l.email_type === "signed_to_client" || l.email_type === "signed_resend"));
              return lastClientSent ? (
                <StatusPill tone="info" icon={<Mail />}>
                  Email envoyé au client le {new Date(lastClientSent.sent_at || lastClientSent.created_at).toLocaleString("fr-FR")}
                </StatusPill>
              ) : null;
            })()}
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
          {!pv.locked_at && (
            <Button variant="outline" onClick={handleRegenerate} disabled={regenerating}>
              {regenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              {regenerating ? "Génération…" : "Régénérer le PDF"}
            </Button>
          )}
          {pv.pdf_url && <Button variant="outline" onClick={downloadPdf}><Download className="h-4 w-4" /> Télécharger PDF signé</Button>}
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

      {lastEvent && (
        <Card className="p-4 flex flex-wrap items-center justify-between gap-3 border-l-4 border-l-primary">
          <div className="flex items-start gap-3">
            <ShieldCheck className="h-5 w-5 text-primary mt-0.5" />
            <div className="space-y-0.5">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Dernier événement</div>
              <div className="font-medium text-sm">{lastEvent.action}</div>
              <div className="text-xs text-muted-foreground">
                {new Date(lastEvent.created_at).toLocaleString("fr-FR")}
                {lastEvent.user_name && <> · par <span className="font-medium text-foreground">{lastEvent.user_name}</span></>}
                {!lastEvent.user_name && <> · système</>}
                {auditTotal > 0 && <> · {auditTotal} événement{auditTotal > 1 ? "s" : ""} au total</>}
              </div>
            </div>
          </div>
          <Link to="/pv/$id/historique" params={{ id: pv.id }}>
            <Button size="sm" variant="outline"><ShieldCheck className="h-4 w-4" /> Voir l'historique complet</Button>
          </Link>
        </Card>
      )}

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
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">Description des travaux</p>
            <p className="whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-sm">{pv.description || "—"}</p>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">Observations</p>
            <p className="whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-sm">{pv.observations || "—"}</p>
          </div>
        </Card>

        <Card className="p-6 space-y-4">
          <h3 className="font-semibold">Signatures</h3>
          <SignatureBlock label="Client" data={pv.client_signature} />
          <SignatureBlock label="Entreprise" data={pv.company_signature} />
        </Card>
      </div>

      <Card className="p-6">
        <div className="mb-4 flex items-center gap-2">
          <Camera className="h-4 w-4 text-primary" />
          <h3 className="font-semibold">Photos chantier ({photos.length})</h3>
        </div>
        {photos.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Aucune photo.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {photos.map((p) => (
              <a key={p.id} href={p.signedUrl} target="_blank" rel="noreferrer" className="group block">
                <div className="aspect-square overflow-hidden rounded-lg border border-border bg-muted">
                  {p.signedUrl && <img src={p.signedUrl} alt={p.caption ?? ""} className="h-full w-full object-cover transition-transform group-hover:scale-105" />}
                </div>
                {p.caption && <p className="mt-1 truncate text-xs text-muted-foreground">{p.caption}</p>}
              </a>
            ))}
          </div>
        )}
      </Card>

      {(() => {
        const total = reserves.length;
        const open = reserves.filter((r) => r.status === "ouverte").length;
        const lifted = reserves.filter((r) => r.status === "levee").length;
        const validated = reserves.filter((r) => r.status === "validee").length;
        const liftStatus = pv.reserve_lift_status ?? (total === 0 ? "none" : open === total ? "pending" : open === 0 ? "completed" : "partial");
        const globalLabel =
          liftStatus === "none" ? "Aucune réserve"
          : liftStatus === "pending" ? "Levée à prévoir"
          : liftStatus === "partial" ? "Levée partielle"
          : "Toutes réserves levées";
        const globalTone =
          liftStatus === "completed" ? "success"
          : liftStatus === "partial" ? "warning"
          : liftStatus === "pending" ? "destructive"
          : "neutral";
        return (
          <Card className="p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" />
                <h3 className="font-semibold">Suivi des réserves</h3>
                <StatusPill tone={globalTone as any} dot>{globalLabel}</StatusPill>
              </div>
              <div className="flex flex-wrap gap-2">
                {(liftStatus === "pending" || liftStatus === "partial") && (
                  <Link to="/pv/$id/levee-reserves" params={{ id: pv.id }}>
                    <Button size="sm"><CheckCircle2 className="h-4 w-4" /> Préparer la levée de réserves</Button>
                  </Link>
                )}
                {liftStatus === "completed" && lifts[0] && (
                  <Button size="sm" variant="outline" onClick={() => lifts[0].pdf_url && downloadLiftPdf(lifts[0].id)} disabled={!lifts[0].pdf_url}>
                    <Download className="h-4 w-4" /> Voir le PV de levée
                  </Button>
                )}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              {[
                { label: "Total", value: total, tone: "neutral" as const },
                { label: "Ouvertes", value: open, tone: "destructive" as const },
                { label: "Levées", value: lifted, tone: "warning" as const },
                { label: "Validées", value: validated, tone: "success" as const },
              ].map((s) => (
                <div key={s.label} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">{s.label}</p>
                    <StatusPill tone={s.tone} size="sm" dot>{s.value}</StatusPill>
                  </div>
                  <p className="mt-1 font-display text-2xl font-bold">{s.value}</p>
                </div>
              ))}
            </div>
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">PV de levée émis ({lifts.length})</p>
              {lifts.length === 0 ? (
                <p className="rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">Aucun PV de levée pour le moment.</p>
              ) : (
                <div className="space-y-2">
                  {lifts.map((l) => {
                    const validated = !!l.client_validated_at;
                    const liftStatusLabel = validated ? "Validée par client" : l.status === "signe" ? "En attente validation client" : "Brouillon";
                    const liftTone = validated ? "success" : l.status === "signe" ? "warning" : "neutral";
                    const lastValidationEmail = validated
                      ? emailLogs.find((log) => log.email_type === "reserve_lift_validated" && log.status === "sent")
                      : null;
                    return (
                      <div key={l.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">N° {l.numero}</span>
                          <StatusPill tone={liftTone as any} dot>{liftStatusLabel}</StatusPill>
                          <span className="text-xs text-muted-foreground">
                            {new Date(l.signed_at || l.created_at).toLocaleString("fr-FR")}
                          </span>
                          {validated && (
                            <span className="text-xs text-muted-foreground">
                              · Validée le {new Date(l.client_validated_at!).toLocaleString("fr-FR")}
                              {l.client_validated_email ? ` par ${l.client_validated_email}` : ""}
                            </span>
                          )}
                          {lastValidationEmail && (
                            <StatusPill tone="info" icon={<Mail />} size="sm">
                              Email de validation envoyé {lastValidationEmail.sent_at ? `le ${new Date(lastValidationEmail.sent_at).toLocaleString("fr-FR")}` : ""}
                              {lastValidationEmail.recipient_email ? ` à ${lastValidationEmail.recipient_email}` : ""}
                            </StatusPill>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {l.pdf_url ? (
                            <Button size="sm" variant={validated ? "default" : "outline"} onClick={() => downloadLiftPdf(l.id)}>
                              <Download className="h-3.5 w-3.5" />
                              {validated ? " Télécharger le PV de levée validé" : " Télécharger le PV de levée signé entreprise"}
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">PDF non généré</span>
                          )}
                          {validated && (
                            <Button size="sm" variant="outline" onClick={() => resendLiftValidatedEmail(l.id)} disabled={resendingLiftId === l.id}>
                              {resendingLiftId === l.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
                              Renvoyer le PDF validé
                            </Button>
                          )}
                          {!validated && l.status === "signe" && (
                            <Button size="sm" variant="outline" onClick={() => resendLiftValidationRequest(l.id)} disabled={resendingLiftId === l.id}>
                              {resendingLiftId === l.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
                              Renvoyer demande de validation
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </Card>
        );
      })()}

      <Card className="p-6">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-primary" />
            <h3 className="font-semibold">Réserves ({reserves.length})</h3>
          </div>
          {reserves.some((r) => r.status === "ouverte") && (
            <Link to="/pv/$id/levee-reserves" params={{ id: pv.id }}>
              <Button size="sm"><CheckCircle2 className="h-4 w-4" /> Créer une levée de réserves</Button>
            </Link>
          )}
        </div>
        {reserves.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Aucune réserve.</p>
        ) : (
          <div className="space-y-2">
            {reserves.map((r) => {
              const statusLabel = r.status === "ouverte" ? "Ouverte" : r.status === "levee" ? "Levée par l'entreprise" : r.status === "validee" ? "Validée par le client" : r.status;
              const statusTone = r.status === "ouverte" ? "destructive" : r.status === "validee" ? "success" : "warning";
              return (
                <div key={r.id} className="flex items-start gap-3 rounded-lg border border-border p-3">
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill tone={r.severity === "majeure" ? "destructive" : "neutral"}>{r.severity}</StatusPill>
                      <StatusPill tone={statusTone as any} dot>{statusLabel}</StatusPill>
                    </div>
                    <p className="mt-2 text-sm">{r.description}</p>
                    {(r.lifted_at || r.validated_at) && (
                      <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
                        {r.lifted_at && <span>Levée le {new Date(r.lifted_at).toLocaleString("fr-FR")}</span>}
                        {r.validated_at && <span>Validée client le {new Date(r.validated_at).toLocaleString("fr-FR")}</span>}
                      </div>
                    )}
                  </div>
                  <Select value={r.status} onValueChange={(v) => updateReserve(r.id, v)}>
                    <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ouverte">Ouverte</SelectItem>
                      <SelectItem value="levee">Levée</SelectItem>
                      <SelectItem value="validee">Validée</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button size="icon" variant="ghost" onClick={() => deleteReserve(r.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </Card>

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

function SignatureBlock({ label, data }: { label: string; data: string | null }) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="grid h-24 place-items-center rounded-md border border-dashed border-border bg-muted/30">
        {data ? (
          <img src={data} alt={`Signature ${label}`} className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="text-xs text-muted-foreground">Non signé</span>
        )}
      </div>
    </div>
  );
}
