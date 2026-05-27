import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import SignaturePad from "react-signature-canvas";
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
  loader: ({ context }) => context as { session: { email: string; clientId: string | null } },
  component: ClientPvDetail,
  head: ({ params }) => ({
    meta: [
      { title: `PV ${params.id.slice(0, 6)} — Espace client | PVIA` },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function ClientPvDetail() {
  const { id } = Route.useParams();
  const { session } = Route.useLoaderData();
  const detailFn = useServerFn(getClientPvDetail);
  const pdfFn = useServerFn(getClientPdfSignedUrl);
  const signFn = useServerFn(signPvAsClient);
  const liftsFn = useServerFn(listClientReserveLifts);
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["client.pv", id],
    queryFn: () => detailFn({ data: { pvId: id } }),
  });
  const liftsQ = useQuery({
    queryKey: ["client.lifts", id],
    queryFn: () => liftsFn({ data: { pvId: id } }),
  });

  async function download() {
    try {
      const { url } = await pdfFn({ data: { pvId: id } });
      window.open(url, "_blank", "noopener");
    } catch (e: any) {
      toast.error(e?.message ?? "PDF indisponible");
    }
  }

  if (q.isLoading) {
    return (
      <ClientShell email={session.email}>
        <Skeleton className="mb-4 h-7 w-56" />
        <Skeleton className="mb-2 h-4 w-72" />
        <Skeleton className="mt-6 h-48 w-full" />
      </ClientShell>
    );
  }

  if (q.isError || !q.data) {
    return (
      <ClientShell email={session.email}>
        <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {(q.error as Error)?.message ?? "PV introuvable."}
        </Card>
      </ClientShell>
    );
  }

  const { pv, company, chantier, reserves, photos } = q.data;
  const isSigned = pv.status === "signe" || !!pv.client_signature;
  const isExpired =
    !!pv.sign_token_expires_at && new Date(pv.sign_token_expires_at) < new Date();
  const signableStatuses = new Set(["en_attente", "en_attente_signature", "envoye"]);
  const canSign = !isSigned && !isExpired && signableStatuses.has(pv.status);

  return (
    <ClientShell email={session.email}>
      <Link
        to="/client/dashboard"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Retour au tableau de bord
      </Link>

      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">N° {pv.numero}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {company?.name && (
              <span className="inline-flex items-center gap-1">
                <Building2 className="h-3.5 w-3.5" /> {company.name}
              </span>
            )}
            {chantier?.address && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" /> {chantier.address}
              </span>
            )}
            {isSigned ? (
              <StatusPill tone="success" size="sm" dot>Signé</StatusPill>
            ) : canSign ? (
              <StatusPill tone="warning" size="sm" dot>À signer</StatusPill>
            ) : (
              <PvStatusPill status={pv.status} size="sm" />
            )}
            {pv.pdf_url && (
              <StatusPill tone="info" size="sm">PDF disponible</StatusPill>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          {pv.pdf_url && (
            <Button onClick={download} variant="outline">
              <Download className="mr-1.5 h-4 w-4" /> Télécharger le PDF
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Informations
          </h2>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <Detail label="Type" value={pv.type} />
            <Detail
              label="Date de réception"
              value={pv.reception_date ? new Date(pv.reception_date).toLocaleDateString("fr-FR") : "—"}
            />
            <Detail
              label="Signé le"
              value={pv.signed_at ? new Date(pv.signed_at).toLocaleString("fr-FR") : "Non signé"}
            />
            <Detail
              label="Envoyé le"
              value={pv.sent_to_client_at ? new Date(pv.sent_to_client_at).toLocaleString("fr-FR") : "—"}
            />
            {pv.description && <Detail label="Description" value={pv.description} full />}
            {pv.observations && <Detail label="Observations" value={pv.observations} full />}
          </dl>
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <AlertCircle className="h-3.5 w-3.5" /> Réserves
            <span className="text-foreground">({reserves.length})</span>
          </h2>
          {reserves.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune réserve enregistrée.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {reserves.map((r: any) => (
                <li key={r.id} className="rounded-md border border-border/60 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <Badge
                      variant={r.severity === "majeure" ? "destructive" : "outline"}
                      className="text-[10px]"
                    >
                      {r.severity}
                    </Badge>
                    <span className="text-[11px] text-muted-foreground">{r.status}</span>
                  </div>
                  <p className="mt-1 text-foreground">{r.description}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {photos.length > 0 && (
        <Card className="mt-4 p-5">
          <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <Camera className="h-3.5 w-3.5" /> Photos ({photos.length})
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {photos.map((p: any) => (
              <a
                key={p.id}
                href={p.url}
                target="_blank"
                rel="noreferrer"
                className="overflow-hidden rounded-lg border border-border/60"
              >
                <img
                  src={p.url}
                  alt={p.caption ?? "Photo PV"}
                  className="aspect-square w-full object-cover"
                  loading="lazy"
                />
                {p.caption && (
                  <div className="px-2 py-1 text-[11px] text-muted-foreground">{p.caption}</div>
                )}
              </a>
            ))}
          </div>
        </Card>
      )}

      <div className="mt-6">
        {isSigned ? (
          <Card className="border-success/30 bg-success/5 p-5">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-success" />
              <div>
                <p className="font-semibold">PV signé</p>
                <p className="text-sm text-muted-foreground">
                  Signé le {pv.signed_at ? new Date(pv.signed_at).toLocaleString("fr-FR") : "—"}.
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
          <Card className="border-warning/30 bg-warning/5 p-5 text-sm">
            <p className="font-medium">Signature indisponible</p>
            <p className="mt-1 text-muted-foreground">
              {isExpired
                ? "Le lien de signature a expiré. Contactez l'entreprise pour en recevoir un nouveau."
                : "Ce PV n'est pas en attente de signature."}
            </p>
          </Card>
        )}
      </div>
    </ClientShell>
  );
}

function InlineSignature({
  onSubmit,
}: {
  onSubmit: (signatureDataUrl: string) => Promise<void>;
}) {
  const padRef = useRef<SignaturePad | null>(null);
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
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <PenLine className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Votre signature</h3>
        <Badge variant="outline" className="ml-auto gap-1 text-[10px]">
          <ShieldCheck className="h-3 w-3" /> Sécurisé
        </Badge>
      </div>

      <div className="rounded-lg border-2 border-dashed border-border bg-background">
        <SignaturePad
          ref={padRef}
          canvasProps={{ className: "w-full h-48 touch-none rounded-lg" }}
          penColor="rgb(20, 35, 80)"
        />
      </div>
      <div className="mt-2 flex justify-end">
        <Button variant="ghost" size="sm" onClick={() => padRef.current?.clear()} type="button">
          <Eraser className="mr-1 h-3.5 w-3.5" /> Effacer
        </Button>
      </div>

      <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-muted/40">
        <Checkbox checked={consent} onCheckedChange={(v) => setConsent(!!v)} className="mt-0.5" />
        <span className="text-sm leading-relaxed">
          Je confirme avoir pris connaissance du procès-verbal, des éventuelles réserves et accepte
          de signer électroniquement ce document. Cette signature a la même valeur juridique qu'une
          signature manuscrite.
        </span>
      </label>

      <Button onClick={handleSign} disabled={submitting} size="lg" className="mt-4 w-full">
        {submitting ? (
          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
        ) : (
          <CheckCircle2 className="mr-1.5 h-4 w-4" />
        )}
        {submitting ? "Signature en cours…" : "Signer le PV"}
      </Button>
    </Card>
  );
}

function Detail({ label, value, full }: { label: string; value: string; full?: boolean }) {
  return (
    <div className={full ? "sm:col-span-2" : undefined}>
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-line text-sm text-foreground">{value || "—"}</dd>
    </div>
  );
}
