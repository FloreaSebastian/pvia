import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import SignaturePad from "react-signature-canvas";
import { useSignatureResize } from "@/hooks/use-signature-resize";
import {
  ArrowLeft, CheckCircle2, Download, Eraser, Loader2, PenLine, ShieldCheck,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientShell } from "@/components/client/ClientShell";
import { getClientSession } from "@/lib/client-auth.functions";
import {
  getClientReserveLiftDetail,
  getClientReserveLiftPdfUrl,
  validateReserveLiftAsClient,
  rejectReserveLiftAsClient,
} from "@/lib/client-reserve-lift.functions";
import { Textarea } from "@/components/ui/textarea";
import { XCircle } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/client/pv/$id_/levee-reserves/$liftId")({
  beforeLoad: async () => {
    const s = await getClientSession();
    if (!s) throw redirect({ to: "/client/login" });
    return { session: s };
  },
  loader: ({ context }) => ({
    session: (context as { session: { email: string; clientId: string | null } }).session,
  }),
  component: ClientLiftDetail,
  head: () => ({
    meta: [
      { title: "Levée de réserves — Espace client | PVIA" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

/** Formate une date en fr-FR, en évitant tout "Invalid Date" affiché à l'écran. */
function fmtDate(v: string | null | undefined): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("fr-FR");
}
function fmtDateTime(v: string | null | undefined): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString("fr-FR");
}

function ClientLiftDetail() {
  const { id: pvId, liftId } = Route.useParams();
  const { session } = Route.useLoaderData();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const detailFn = useServerFn(getClientReserveLiftDetail);
  const pdfFn = useServerFn(getClientReserveLiftPdfUrl);
  const validateFn = useServerFn(validateReserveLiftAsClient);
  const rejectFn = useServerFn(rejectReserveLiftAsClient);

  const q = useQuery({
    queryKey: ["client.lift", pvId, liftId],
    queryFn: () => detailFn({ data: { pvId, liftId } }),
  });

  const [downloading, setDownloading] = useState(false);
  async function download() {
    if (downloading) return;
    setDownloading(true);
    try {
      const { url } = await pdfFn({ data: { pvId, liftId } });
      window.open(url, "_blank", "noopener");
    } catch (e: any) {
      toast.error(e?.message ?? "PDF indisponible");
    } finally {
      setDownloading(false);
    }
  }

  if (q.isLoading) {
    return (
      <ClientShell email={session.email}>
        <h1 className="sr-only">Levée de réserves</h1>
        <Skeleton className="mb-4 h-7 w-56" />
        <Skeleton className="mt-6 h-48 w-full" />
        <p aria-live="polite" className="sr-only">Chargement de la levée de réserves…</p>
      </ClientShell>
    );
  }
  if (q.isError || !q.data) {
    return (
      <ClientShell email={session.email}>
        <h1 className="font-display text-xl font-bold tracking-tight">Levée de réserves</h1>
        <Card className="mt-4 border-destructive/40 bg-destructive/5 p-4">
          <p className="text-sm text-destructive [overflow-wrap:anywhere]">
            {(q.error as Error)?.message || "Cette levée de réserves est introuvable ou n'est plus accessible."}
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Button onClick={() => q.refetch()} variant="outline" className="min-h-11 sm:flex-none">
              Réessayer
            </Button>
            <Button asChild variant="ghost" className="min-h-11 sm:flex-none">
              <Link to="/client/pv/$id" params={{ id: pvId }}>Retour au PV</Link>
            </Button>
            <Button asChild variant="ghost" className="min-h-11 sm:flex-none">
              <Link to="/client/dashboard">Mes PV</Link>
            </Button>
          </div>
        </Card>
      </ClientShell>
    );
  }


  const { pv, report, items, company, chantier } = q.data;
  const isValidated = !!report.client_validated_at;
  const isRejected = !!(report as any).client_rejected_at;

  return (
    <ClientShell email={session.email}>
      <Link
        to="/client/pv/$id"
        params={{ id: pvId }}
        className="mb-3 -ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4 shrink-0" />
        <span className="[overflow-wrap:anywhere]">Retour au PV {pv.numero}</span>
      </Link>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold tracking-tight [overflow-wrap:anywhere]">
            N° {report.numero}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground [overflow-wrap:anywhere]">
            Levée de réserves · PV {pv.numero}
            {chantier?.name ? ` · ${chantier.name}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isValidated ? (
            <Badge className="gap-1 bg-success/15 text-success hover:bg-success/15">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> Validée le {fmtDate(report.client_validated_at)}
            </Badge>
          ) : isRejected ? (
            <Badge variant="destructive" className="gap-1">
              <XCircle className="h-3.5 w-3.5 shrink-0" /> Rejetée le {fmtDate((report as any).client_rejected_at)}
            </Badge>
          ) : (
            <Badge variant="outline">En attente de validation</Badge>
          )}
          {report.pdf_url && (
            <Button onClick={download} disabled={downloading} variant="outline" size="sm" className="h-11 sm:h-9">
              <Download className="mr-1.5 h-4 w-4" /> Télécharger le PDF
            </Button>
          )}
        </div>
      </div>


      <Card className="mb-4 p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Entreprise
        </h2>
        <p className="text-sm font-medium [overflow-wrap:anywhere]">{company?.name ?? "—"}</p>
      </Card>

      <Card className="mb-4 p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Réserves levées ({items.length})
        </h2>
        <ul className="space-y-3">
          {items.map((it: any, itemIdx: number) => (
            <li key={it.id} className="min-w-0 rounded-lg border border-border p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 flex-1 text-sm font-medium [overflow-wrap:anywhere]">
                  {it.reserve?.description ?? "(réserve supprimée)"}
                </p>
                {it.reserve?.severity && (
                  <Badge variant="outline" className="shrink-0 text-[10px]">{it.reserve.severity}</Badge>
                )}
              </div>
              {it.reserve?.nature && (
                <p className="mt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">Nature : {it.reserve.nature}</p>
              )}
              {it.reserve?.work_to_execute && (
                <p className="mt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">Travaux prévus : {it.reserve.work_to_execute}</p>
              )}
              {it.comment && (
                <p className="mt-2 whitespace-pre-line rounded-md bg-muted/50 p-2 text-xs [overflow-wrap:anywhere]">
                  <strong>Travaux réalisés :</strong> {it.comment}
                </p>
              )}
              {it.photos.length > 0 && (
                <div className="mt-3 space-y-3">
                  {(["before", "after", "legacy"] as const).map((kind) => {
                    const subset = it.photos.filter((p: any) => p.photoType === kind);
                    if (subset.length === 0) return null;
                    const title =
                      kind === "before" ? "Avant intervention"
                      : kind === "after" ? "Après intervention"
                      : "Photos";
                    return (
                      <div key={kind}>
                        <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                          {title} ({subset.length})
                        </div>
                        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                          {subset.map((p: any, photoIdx: number) => (
                            <a
                              key={p.id}
                              href={p.url}
                              target="_blank"
                              rel="noreferrer"
                              aria-label={`Agrandir la photo ${photoIdx + 1} sur ${subset.length} — ${title.toLowerCase()}, réserve ${itemIdx + 1}`}
                              className="group relative block min-h-11 min-w-11 overflow-hidden rounded-md border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                            >
                              <img
                                src={p.url}
                                alt={`${title} — photo ${photoIdx + 1} de la réserve ${itemIdx + 1}`}
                                className="aspect-square w-full bg-muted object-cover"
                                loading="lazy"
                                decoding="async"
                                onError={(e) => {
                                  const el = e.currentTarget;
                                  el.style.visibility = "hidden";
                                  el.parentElement?.setAttribute("data-photo-error", "true");
                                }}
                              />
                              <span className="pointer-events-none absolute inset-0 hidden items-center justify-center bg-muted px-1 text-center text-[9px] leading-tight text-muted-foreground group-data-[photo-error=true]:flex">
                                Photo indisponible
                              </span>
                              {p.isGeolocated && (
                                <span
                                  title="Photo géolocalisée"
                                  className="absolute bottom-1 left-1 rounded bg-black/60 px-1 py-0.5 text-[9px] text-white"
                                >
                                  📍
                                </span>
                              )}
                              {fmtDate(p.takenAt) && (
                                <span className="absolute right-1 top-1 max-w-[calc(100%-0.5rem)] truncate rounded bg-black/60 px-1 py-0.5 text-[9px] text-white">
                                  {fmtDate(p.takenAt)}
                                </span>
                              )}
                            </a>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </li>
          ))}

        </ul>
      </Card>

      {report.comment && (
        <Card className="mb-4 p-5">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Commentaire de l'entreprise
          </h2>
          <p className="whitespace-pre-line text-sm text-foreground [overflow-wrap:anywhere]">{report.comment}</p>
        </Card>
      )}

      <Card className="mb-4 p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Signature entreprise
        </h2>
        {report.company_signature ? (
          <img src={report.company_signature} alt="Signature de l’entreprise" className="h-28 max-w-full rounded-md border bg-white object-contain" />
        ) : (
          <p className="text-sm text-muted-foreground">Non signée</p>
        )}
      </Card>

      {isValidated ? (
        <Card className="border-success/30 bg-success/5 p-5">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 text-success" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">Levée validée et signée</p>
                <Badge className="gap-1 bg-success/15 text-success hover:bg-success/15">
                  <ShieldCheck className="h-3 w-3" /> Signature électronique
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Validée le {fmtDateTime(report.client_validated_at)} par <span className="[overflow-wrap:anywhere]">{(report as any).client_signature_email ?? report.client_validated_email ?? session.email}</span>.
              </p>
              {(report as any).client_signature && (
                <div className="mt-3">
                  <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">Votre signature</p>
                  <img
                    src={(report as any).client_signature}
                    alt="Votre signature"
                    className="h-24 max-w-full rounded-md border bg-white object-contain"
                  />
                </div>
              )}
              <div className="mt-3">
                <Button onClick={download} disabled={downloading} variant="outline" size="sm" className="h-11 w-full sm:h-9 sm:w-auto">
                  <Download className="mr-1.5 h-4 w-4" /> Télécharger le PDF signé
                </Button>
              </div>
            </div>
          </div>
        </Card>
      ) : isRejected ? (
        <Card className="border-destructive/30 bg-destructive/5 p-5">
          <div className="flex items-start gap-3">
            <XCircle className="mt-0.5 h-5 w-5 text-destructive" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">Levée rejetée</p>
              <p className="text-sm text-muted-foreground">
                Rejetée le {fmtDateTime((report as any).client_rejected_at)} par <span className="[overflow-wrap:anywhere]">{(report as any).client_rejected_email ?? session.email}</span>.
              </p>
              {(report as any).client_rejected_reason && (
                <p className="mt-3 whitespace-pre-line rounded-md border border-destructive/20 bg-background p-3 text-sm">
                  <strong>Motif&nbsp;:</strong> <span className="[overflow-wrap:anywhere]">{(report as any).client_rejected_reason}</span>
                </p>
              )}
            </div>
          </div>
        </Card>
      ) : (
        <ClientLiftValidation
          onValidate={async (signatureDataUrl) => {
            await validateFn({
              data: { pvId, liftId, signatureDataUrl, consent: true },
            });
            toast.success("Levée validée. PDF final envoyé par email.");
            await qc.invalidateQueries({ queryKey: ["client.lift", pvId, liftId] });
            await qc.invalidateQueries({ queryKey: ["client.pv", pvId] });
            navigate({ to: "/client/pv/$id", params: { id: pvId } });
          }}
          onReject={async (reason) => {
            await rejectFn({ data: { pvId, liftId, reason } });
            toast.success("Levée rejetée. L'entreprise a été notifiée.");
            await qc.invalidateQueries({ queryKey: ["client.lift", pvId, liftId] });
            await qc.invalidateQueries({ queryKey: ["client.pv", pvId] });
          }}
        />
      )}
    </ClientShell>
  );
}

function ClientLiftValidation({
  onValidate,
  onReject,
}: {
  onValidate: (signatureDataUrl: string) => Promise<void>;
  onReject: (reason: string) => Promise<void>;
}) {
  const padRef = useRef<SignaturePad | null>(null);
  useSignatureResize(padRef);
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState("");

  async function handleValidate() {
    if (submitting || rejecting) return;
    if (!padRef.current || padRef.current.isEmpty()) {
      toast.error("Veuillez apposer votre signature.");
      return;
    }
    if (!consent) {
      toast.error("Vous devez confirmer la levée des réserves.");
      return;
    }
    const dataUrl = padRef.current.getCanvas().toDataURL("image/png");
    setSubmitting(true);
    try {
      await onValidate(dataUrl);
    } catch (e: any) {
      toast.error(e?.message ?? "Échec de la validation");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReject() {
    if (submitting || rejecting) return;
    const r = reason.trim();
    if (r.length < 5) {
      toast.error("Motif obligatoire (5 caractères minimum).");
      return;
    }
    setRejecting(true);
    try {
      await onReject(r);
    } catch (e: any) {
      toast.error(e?.message ?? "Échec du rejet");
    } finally {
      setRejecting(false);
    }
  }

  return (
    <>
      <Card className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <PenLine className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Votre validation</h3>
          <Badge variant="outline" className="ml-auto gap-1 text-[10px]">
            <ShieldCheck className="h-3 w-3" /> Sécurisé
          </Badge>
        </div>
        <div
          className="rounded-lg border-2 border-dashed border-border bg-background"
          role="application"
          aria-label="Zone de signature — tracez votre signature avec le doigt ou la souris"
        >
          <SignaturePad
            ref={padRef}
            canvasProps={{
              className: "w-full touch-none h-[clamp(7rem,28vw,12rem)] rounded-lg",
              "aria-label": "Zone de signature",
            }}
            penColor="rgb(20, 35, 80)"
          />
        </div>
        <div className="mt-2 flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => padRef.current?.clear()}
            type="button"
            className="h-11 sm:h-9"
          >
            <Eraser className="mr-1 h-4 w-4" /> Effacer
          </Button>
        </div>
        <label
          htmlFor="lift-consent"
          className="mt-4 flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-muted/40"
        >
          <Checkbox
            id="lift-consent"
            checked={consent}
            onCheckedChange={(v) => setConsent(!!v)}
            className="mt-0.5 h-5 w-5"
          />
          <span className="text-sm leading-relaxed">
            Je confirme que les réserves indiquées ont été levées et accepte la signature électronique de ce procès-verbal de levée. Cette signature a la même valeur juridique qu'une signature manuscrite.
          </span>
        </label>
        <Button onClick={handleValidate} disabled={submitting || rejecting || !consent} size="lg" className="mt-4 min-h-12 w-full">
          {submitting ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="mr-1.5 h-4 w-4" />
          )}
          {submitting ? "Validation en cours…" : "Valider et signer la levée"}
        </Button>
        <p aria-live="polite" className="sr-only">
          {submitting ? "Validation en cours, veuillez patienter." : ""}
        </p>
      </Card>

      <Card className="mt-4 border-destructive/30 p-5">
        <div className="mb-3 flex items-center gap-2">
          <XCircle className="h-4 w-4 shrink-0 text-destructive" />
          <h3 className="text-sm font-semibold">Refuser la levée</h3>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          Si les travaux ne sont pas conformes, vous pouvez rejeter cette levée. L'entreprise sera notifiée et devra reprendre l'intervention. Un motif est obligatoire.
        </p>
        {!showReject ? (
          <Button
            type="button"
            variant="outline"
            className="min-h-11 w-full border-destructive/40 text-destructive hover:bg-destructive/5 hover:text-destructive"
            onClick={() => setShowReject(true)}
            disabled={submitting || rejecting}
          >
            <XCircle className="mr-1.5 h-4 w-4" /> Rejeter la levée
          </Button>
        ) : (
          <>
            <label htmlFor="lift-reject-reason" className="mb-1.5 block text-sm font-medium">
              Motif du rejet <span aria-hidden="true">*</span>
            </label>
            <Textarea
              id="lift-reject-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Décrivez précisément les motifs du rejet (travaux non conformes, finition manquante, etc.)"
              rows={4}
              maxLength={2000}
              disabled={rejecting}
              required
              aria-describedby="lift-reject-help"
              aria-invalid={reason.length > 0 && reason.trim().length < 5}
              className="min-h-24 w-full"
            />
            <div id="lift-reject-help" className="mt-2 flex justify-between gap-2 text-[11px] text-muted-foreground">
              <span>5 caractères minimum</span>
              <span aria-live="polite">{reason.length} / 2000</span>
            </div>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                variant="ghost"
                onClick={() => { setShowReject(false); setReason(""); }}
                disabled={rejecting}
                className="min-h-11 sm:flex-1"
              >
                Annuler
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handleReject}
                disabled={rejecting || submitting || reason.trim().length < 5}
                className="min-h-11 sm:flex-1"
              >
                {rejecting ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <XCircle className="mr-1.5 h-4 w-4" />
                )}
                {rejecting ? "Rejet en cours…" : "Confirmer le rejet"}
              </Button>
            </div>
          </>
        )}

      </Card>
    </>
  );
}
