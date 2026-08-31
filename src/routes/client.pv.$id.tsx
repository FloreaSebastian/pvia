import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import SignaturePad from "react-signature-canvas";
import { useSignatureResize } from "@/hooks/use-signature-resize";
import {
  ArrowLeft,
  Download,
  PenLine,
  MapPin,
  Building2,
  Camera,
  AlertCircle,
  CheckCircle2,
  Eraser,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusPill, PvStatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientShell } from "@/components/client/ClientShell";
import {
  getClientSession,
  getClientPvDetail,
  getClientPdfSignedUrl,
  signPvAsClient,
} from "@/lib/client-auth.functions";
import { listClientReserveLifts } from "@/lib/client-reserve-lift.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/client/pv/$id")({
  beforeLoad: async () => {
    const s = await getClientSession();
    if (!s) throw redirect({ to: "/client/login" });
    return { session: s };
  },
  loader: ({ context }) => ({
    session: (context as { session: { email: string; clientId: string | null } }).session,
  }),
  component: ClientPvDetail,
  head: ({ params }) => ({
    meta: [
      { title: `PV ${params.id.slice(0, 6)} — Espace client | PVIA` },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

const RESERVE_STATUS_LABEL: Record<string, { label: string; tone: "open" | "lifted" | "done" | "rejected" }> = {
  ouverte: { label: "Ouverte", tone: "open" },
  en_cours: { label: "En cours de traitement", tone: "open" },
  levee: { label: "Levée", tone: "lifted" },
  en_attente_validation: { label: "En attente de votre validation", tone: "lifted" },
  validee: { label: "Validée", tone: "done" },
  rejetee: { label: "Refusée", tone: "rejected" },
};

const SEVERITY_LABEL: Record<string, string> = {
  mineure: "Mineure",
  majeure: "Majeure",
  bloquante: "Bloquante",
};

function formatDate(value: string | null | undefined, withTime = false) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fr-FR", {
    timeZone: "Europe/Paris",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

function ClientPvDetail() {
  const { id } = Route.useParams();
  const { session } = Route.useLoaderData();
  const detailFn = useServerFn(getClientPvDetail);
  const pdfFn = useServerFn(getClientPdfSignedUrl);
  const signFn = useServerFn(signPvAsClient);
  const liftsFn = useServerFn(listClientReserveLifts);
  const qc = useQueryClient();
  const [pdfLoading, setPdfLoading] = useState(false);

  const q = useQuery({
    queryKey: ["client.pv", id],
    queryFn: () => detailFn({ data: { pvId: id } }),
    retry: false,
  });
  const liftsQ = useQuery({
    queryKey: ["client.lifts", id],
    queryFn: () => liftsFn({ data: { pvId: id } }),
    retry: false,
  });

  async function download() {
    if (pdfLoading) return;
    setPdfLoading(true);
    try {
      const { url } = await pdfFn({ data: { pvId: id } });
      window.open(url, "_blank", "noopener");
    } catch (e: any) {
      toast.error(e?.message ?? "PDF indisponible");
    } finally {
      setPdfLoading(false);
    }
  }

  if (q.isLoading) {
    return (
      <ClientShell email={session.email}>
        <span className="sr-only" aria-live="polite">
          Chargement du procès-verbal…
        </span>
        <Skeleton className="mb-4 h-5 w-44" />
        <Skeleton className="mb-2 h-7 w-56" />
        <Skeleton className="mb-6 h-4 w-64" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-56 w-full lg:col-span-2" />
          <Skeleton className="h-56 w-full" />
        </div>
      </ClientShell>
    );
  }

  if (q.isError || !q.data) {
    const raw = (q.error as Error)?.message ?? "";
    const denied = /refus|introuvable|session/i.test(raw);
    return (
      <ClientShell email={session.email}>
        <BackLink />
        <Card className="p-5">
          <h1 className="text-lg font-semibold">Document indisponible</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {denied
              ? "Ce procès-verbal n'existe pas ou n'est pas accessible avec votre compte."
              : "Le document n'a pas pu être chargé. Réessayez dans un instant."}
          </p>
          <div className="mt-4 grid gap-2 sm:flex">
            <Button onClick={() => q.refetch()} className="h-11 w-full sm:h-9 sm:w-auto">
              Réessayer
            </Button>
            <Link to="/client/dashboard" className="w-full sm:w-auto">
              <Button variant="outline" className="h-11 w-full sm:h-9 sm:w-auto">
                Retour à mes PV
              </Button>
            </Link>
          </div>
        </Card>
      </ClientShell>
    );
  }

  const { pv, company, chantier, reserves, photos } = q.data as any;
  const isSigned = pv.status === "signe" || !!pv.client_signature;
  const isExpired =
    !!pv.sign_token_expires_at && new Date(pv.sign_token_expires_at) < new Date();
  const signableStatuses = new Set(["en_attente", "en_attente_signature", "envoye"]);
  const canSign = !isSigned && !isExpired && signableStatuses.has(pv.status);

  const openCount = reserves.filter((r: any) => r.status === "ouverte" || r.status === "en_cours").length;
  const liftedCount = reserves.filter(
    (r: any) => r.status === "levee" || r.status === "en_attente_validation",
  ).length;
  const validatedCount = reserves.filter((r: any) => r.status === "validee").length;

  return (
    <ClientShell email={session.email}>
      <BackLink />

      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-xl font-bold tracking-tight [overflow-wrap:anywhere] sm:text-2xl">
            N° {pv.numero}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {isSigned ? (
              <StatusPill tone="success" size="sm" dot>
                Signé
              </StatusPill>
            ) : canSign ? (
              <StatusPill tone="warning" size="sm" dot>
                À signer
              </StatusPill>
            ) : (
              <PvStatusPill status={pv.status} size="sm" />
            )}
            {pv.pdf_url && (
              <StatusPill tone="info" size="sm">
                PDF disponible
              </StatusPill>
            )}
          </div>
          <div className="mt-2 space-y-1 text-sm text-muted-foreground">
            {company?.name && (
              <p className="flex min-w-0 items-start gap-1.5" title={company.name}>
                <Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="min-w-0 [overflow-wrap:anywhere]">{company.name}</span>
              </p>
            )}
            {(chantier?.name || chantier?.address) && (
              <p
                className="flex min-w-0 items-start gap-1.5"
                title={[chantier?.name, chantier?.address].filter(Boolean).join(" — ")}
              >
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  {[chantier?.name, chantier?.address].filter(Boolean).join(" — ")}
                </span>
              </p>
            )}
          </div>
        </div>
        {pv.pdf_url && (
          <div className="shrink-0">
            <Button
              onClick={download}
              variant={isSigned ? "default" : "outline"}
              disabled={pdfLoading}
              aria-label="Télécharger le PDF du procès-verbal"
              className="h-11 w-full sm:h-10 sm:w-auto"
            >
              {pdfLoading ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Download className="mr-1.5 h-4 w-4" aria-hidden />
              )}
              {pdfLoading ? "Préparation…" : "Télécharger le PDF"}
            </Button>
          </div>
        )}
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="min-w-0 p-4 sm:p-5 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Informations
          </h2>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <Detail label="Type" value={pv.type} />
            <Detail label="Date de réception" value={formatDate(pv.reception_date)} />
            <Detail
              label="Signé le"
              value={pv.signed_at ? formatDate(pv.signed_at, true) : "Non signé"}
            />
            <Detail label="Envoyé le" value={formatDate(pv.sent_to_client_at, true)} />
            {pv.description && <Detail label="Description" value={pv.description} full />}
            {pv.observations && <Detail label="Observations" value={pv.observations} full />}
          </dl>
        </Card>

        <Card className="min-w-0 p-4 sm:p-5">
          <h2 className="mb-3 flex flex-wrap items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden /> Réserves
            <span className="text-foreground">({reserves.length})</span>
          </h2>
          {reserves.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucune réserve n'a été émise sur ce procès-verbal.
            </p>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap gap-1.5 text-[11px]">
                <span className="rounded-full bg-warning/15 px-2 py-1 font-medium text-warning">
                  {openCount} ouverte(s)
                </span>
                <span className="rounded-full bg-info/15 px-2 py-1 font-medium text-info">
                  {liftedCount} levée(s)
                </span>
                <span className="rounded-full bg-success/15 px-2 py-1 font-medium text-success">
                  {validatedCount} validée(s)
                </span>
              </div>
              <ul className="space-y-2 text-sm">
                {reserves.map((r: any) => {
                  const st = RESERVE_STATUS_LABEL[r.status] ?? { label: r.status, tone: "open" as const };
                  return (
                    <li key={r.id} className="min-w-0 rounded-md border border-border/60 p-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge
                          variant={
                            r.severity === "bloquante" || r.severity === "majeure"
                              ? "destructive"
                              : "outline"
                          }
                          className="text-[10px]"
                        >
                          {SEVERITY_LABEL[r.severity] ?? r.severity}
                        </Badge>
                        <span
                          className={
                            "rounded-full px-2 py-0.5 text-[10px] font-medium " +
                            (st.tone === "done"
                              ? "bg-success/15 text-success"
                              : st.tone === "lifted"
                                ? "bg-info/15 text-info"
                                : st.tone === "rejected"
                                  ? "bg-destructive/15 text-destructive"
                                  : "bg-warning/15 text-warning")
                          }
                        >
                          {st.label}
                        </span>
                      </div>
                      <p className="mt-1 text-foreground [overflow-wrap:anywhere]">{r.description}</p>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Card>
      </div>

      {photos.length > 0 && (
        <Card className="mt-4 min-w-0 p-4 sm:p-5">
          <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <Camera className="h-3.5 w-3.5 shrink-0" aria-hidden /> Photos ({photos.length})
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {photos.map((p: any) => (
              <a
                key={p.id}
                href={p.url}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 overflow-hidden rounded-lg border border-border/60"
                aria-label={p.caption ? `Ouvrir la photo : ${p.caption}` : "Ouvrir la photo en grand"}
              >
                <img
                  src={p.url}
                  alt={p.caption ?? "Photo du procès-verbal"}
                  className="aspect-square w-full object-cover"
                  loading="lazy"
                />
                {p.caption && (
                  <div className="px-2 py-1 text-[11px] text-muted-foreground [overflow-wrap:anywhere]">
                    {p.caption}
                  </div>
                )}
              </a>
            ))}
          </div>
        </Card>
      )}

      {liftsQ.data && liftsQ.data.lifts.length > 0 && (
        <Card className="mt-4 min-w-0 p-4 sm:p-5">
          <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden /> Levée de réserves (
            {liftsQ.data.lifts.length})
          </h2>
          <ul className="space-y-2">
            {liftsQ.data.lifts.map((l: any) => {
              const validated = !!l.client_validated_at;
              return (
                <li
                  key={l.id}
                  className="flex min-w-0 flex-col gap-2 rounded-lg border border-border/60 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium [overflow-wrap:anywhere]">N° {l.numero}</p>
                    <p className="text-[11px] text-muted-foreground [overflow-wrap:anywhere]">
                      {l.items_count} réserve(s) · {formatDate(l.created_at)}
                      {validated && ` · validée le ${formatDate(l.client_validated_at)}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {validated ? (
                      <Badge className="bg-success/15 text-success hover:bg-success/15">Validée</Badge>
                    ) : (
                      <Badge variant="outline" className="border-warning/40 text-warning">
                        À valider
                      </Badge>
                    )}
                    <Link
                      to="/client/pv/$id/levee-reserves/$liftId"
                      params={{ id, liftId: l.id }}
                      className="flex-1 sm:flex-none"
                    >
                      <Button
                        variant={validated ? "outline" : "default"}
                        className="h-11 w-full sm:h-9 sm:w-auto"
                      >
                        {validated ? "Consulter" : "Consulter & valider"}
                      </Button>
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <div className="mt-6">
        {isSigned ? (
          <Card className="border-success/30 bg-success/5 p-4 sm:p-5">
            <div className="flex min-w-0 items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden />
              <div className="min-w-0">
                <p className="font-semibold">PV signé</p>
                <p className="text-sm text-muted-foreground">
                  Signé le {formatDate(pv.signed_at, true)}.
                  {pv.pdf_url && " Vous pouvez télécharger le PDF ci-dessus."}
                </p>
              </div>
            </div>
          </Card>
        ) : canSign ? (
          <InlineSignature
            onSubmit={async (signatureDataUrl) => {
              await signFn({ data: { pvId: id, signatureDataUrl, consent: true } });
              toast.success("Signature enregistrée. Le PDF signé vous a été envoyé par email.");
              await qc.invalidateQueries({ queryKey: ["client.pv", id] });
              await qc.invalidateQueries({ queryKey: ["client.pv-list"] });
            }}
          />
        ) : (
          <Card className="border-warning/30 bg-warning/5 p-4 text-sm sm:p-5">
            <p className="font-medium">Aucune action requise de votre part</p>
            <p className="mt-1 text-muted-foreground">
              {isExpired
                ? "Le lien de signature a expiré. Contactez l'entreprise pour en recevoir un nouveau."
                : "Ce procès-verbal n'est pas en attente de signature."}
            </p>
          </Card>
        )}
      </div>
    </ClientShell>
  );
}

function BackLink() {
  return (
    <Link
      to="/client/dashboard"
      className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground sm:min-h-0"
    >
      <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden /> Retour au tableau de bord
    </Link>
  );
}

function InlineSignature({
  onSubmit,
}: {
  onSubmit: (signatureDataUrl: string) => Promise<void>;
}) {
  const padRef = useRef<SignaturePad | null>(null);
  useSignatureResize(padRef);
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSign() {
    if (!padRef.current || padRef.current.isEmpty()) {
      toast.error("Veuillez apposer votre signature.");
      return;
    }
    if (!consent) {
      toast.error("Vous devez confirmer avoir pris connaissance du PV.");
      return;
    }
    const dataUrl = padRef.current.getCanvas().toDataURL("image/png");
    setSubmitting(true);
    try {
      await onSubmit(dataUrl);
    } catch (e: any) {
      toast.error(e?.message ?? "Échec de la signature");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="min-w-0 p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <PenLine className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        <h2 className="text-sm font-semibold">Votre signature</h2>
        <Badge variant="outline" className="ml-auto gap-1 text-[10px]">
          <ShieldCheck className="h-3 w-3" aria-hidden /> Sécurisé
        </Badge>
      </div>

      <div className="rounded-lg border-2 border-dashed border-border bg-background">
        <SignaturePad
          ref={padRef}
          canvasProps={{
            className: "w-full touch-none h-[clamp(7rem,28vw,12.0rem)] rounded-lg",
            "aria-label": "Zone de signature",
          }}
          penColor="rgb(20, 35, 80)"
        />
      </div>
      <div className="mt-2 flex justify-end">
        <Button
          variant="ghost"
          onClick={() => padRef.current?.clear()}
          type="button"
          className="h-11 sm:h-9"
        >
          <Eraser className="mr-1 h-4 w-4" aria-hidden /> Effacer
        </Button>
      </div>

      <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-muted/40">
        <Checkbox
          checked={consent}
          onCheckedChange={(v) => setConsent(!!v)}
          className="mt-0.5 h-5 w-5"
          aria-label="Je confirme avoir pris connaissance du procès-verbal"
        />
        <span className="min-w-0 text-sm leading-relaxed">
          Je confirme avoir pris connaissance du procès-verbal, des éventuelles réserves et accepte
          de signer électroniquement ce document. Cette signature a la même valeur juridique qu'une
          signature manuscrite.
        </span>
      </label>

      <Button
        onClick={handleSign}
        disabled={submitting}
        size="lg"
        className="mt-4 h-12 w-full"
        aria-live="polite"
      >
        {submitting ? (
          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <CheckCircle2 className="mr-1.5 h-4 w-4" aria-hidden />
        )}
        {submitting ? "Signature en cours…" : "Signer le PV"}
      </Button>
    </Card>
  );
}

function Detail({ label, value, full }: { label: string; value: string; full?: boolean }) {
  return (
    <div className={full ? "min-w-0 sm:col-span-2" : "min-w-0"}>
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-line text-sm text-foreground [overflow-wrap:anywhere]">
        {value || "—"}
      </dd>
    </div>
  );
}
