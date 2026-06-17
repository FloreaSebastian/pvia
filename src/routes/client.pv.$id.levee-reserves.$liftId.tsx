import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import SignaturePad from "react-signature-canvas";
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

export const Route = createFileRoute("/client/pv/$id/levee-reserves/$liftId")({
  beforeLoad: async () => {
    const s = await getClientSession();
    if (!s) throw redirect({ to: "/client/login" });
    return { session: s };
  },
  loader: ({ context }) => context as { session: { email: string; clientId: string | null } },
  component: ClientLiftDetail,
  head: () => ({
    meta: [
      { title: "Levée de réserves — Espace client | PVIA" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

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

  async function download() {
    try {
      const { url } = await pdfFn({ data: { pvId, liftId } });
      window.open(url, "_blank", "noopener");
    } catch (e: any) {
      toast.error(e?.message ?? "PDF indisponible");
    }
  }

  if (q.isLoading) {
    return (
      <ClientShell email={session.email}>
        <Skeleton className="mb-4 h-7 w-56" />
        <Skeleton className="mt-6 h-48 w-full" />
      </ClientShell>
    );
  }
  if (q.isError || !q.data) {
    return (
      <ClientShell email={session.email}>
        <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {(q.error as Error)?.message ?? "Levée introuvable."}
        </Card>
      </ClientShell>
    );
  }

  const { pv, report, items, company, chantier } = q.data;
  const isValidated = !!report.client_validated_at;
  const isRejected = !!(report as any).client_rejected_at;
  const isFinalized = isValidated || isRejected;

  return (
    <ClientShell email={session.email}>
      <Link to="/client/pv/$id" params={{ id: pvId }} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Retour au PV {pv.numero}
      </Link>

      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">N° {report.numero}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Levée de réserves · PV {pv.numero}
            {chantier?.name ? ` · ${chantier.name}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isValidated ? (
            <Badge className="gap-1 bg-success/15 text-success hover:bg-success/15">
              <CheckCircle2 className="h-3.5 w-3.5" /> Validée le {new Date(report.client_validated_at!).toLocaleDateString("fr-FR")}
            </Badge>
          ) : isRejected ? (
            <Badge variant="destructive" className="gap-1">
              <XCircle className="h-3.5 w-3.5" /> Rejetée le {new Date((report as any).client_rejected_at!).toLocaleDateString("fr-FR")}
            </Badge>
          ) : (
            <Badge variant="outline">En attente de validation</Badge>
          )}
          {report.pdf_url && (
            <Button onClick={download} variant="outline" size="sm">
              <Download className="mr-1.5 h-4 w-4" /> Télécharger le PDF
            </Button>
          )}
        </div>
      </div>

      <Card className="mb-4 p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Entreprise
        </h2>
        <p className="text-sm font-medium">{company?.name ?? "—"}</p>
      </Card>

      <Card className="mb-4 p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Réserves levées ({items.length})
        </h2>
        <ul className="space-y-3">
          {items.map((it: any) => (
            <li key={it.id} className="rounded-lg border border-border p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium">{it.reserve?.description ?? "(réserve supprimée)"}</p>
                <Badge variant="outline" className="text-[10px]">{it.reserve?.severity}</Badge>
              </div>
              {it.reserve?.nature && (
                <p className="mt-1 text-xs text-muted-foreground">Nature : {it.reserve.nature}</p>
              )}
              {it.reserve?.work_to_execute && (
                <p className="mt-1 text-xs text-muted-foreground">Travaux prévus : {it.reserve.work_to_execute}</p>
              )}
              {it.comment && (
                <p className="mt-2 rounded-md bg-muted/50 p-2 text-xs">
                  <strong>Travaux réalisés :</strong> {it.comment}
                </p>
              )}
              {it.photos.length > 0 && (
                <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {it.photos.map((p: string, idx: number) => (
                    <a key={idx} href={p} target="_blank" rel="noreferrer" className="overflow-hidden rounded-md border">
                      <img src={p} alt="Justificatif" className="aspect-square w-full object-cover" loading="lazy" />
                    </a>
                  ))}
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
          <p className="whitespace-pre-line text-sm text-foreground">{report.comment}</p>
        </Card>
      )}

      <Card className="mb-4 p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Signature entreprise
        </h2>
        {report.company_signature ? (
          <img src={report.company_signature} alt="Signature entreprise" className="h-28 rounded-md border bg-white" />
        ) : (
          <p className="text-sm text-muted-foreground">Non signée</p>
        )}
      </Card>

      {isValidated ? (
        <Card className="border-success/30 bg-success/5 p-5">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-success" />
            <div>
              <p className="font-semibold">Levée validée</p>
              <p className="text-sm text-muted-foreground">
                Validée le {new Date(report.client_validated_at!).toLocaleString("fr-FR")} par {report.client_validated_email ?? session.email}.
              </p>
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
                Rejetée le {new Date((report as any).client_rejected_at!).toLocaleString("fr-FR")} par {(report as any).client_rejected_email ?? session.email}.
              </p>
              {(report as any).client_rejected_reason && (
                <p className="mt-3 whitespace-pre-line rounded-md border border-destructive/20 bg-background p-3 text-sm">
                  <strong>Motif&nbsp;:</strong> {(report as any).client_rejected_reason}
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
  onSubmit,
}: {
  onSubmit: (signatureDataUrl: string) => Promise<void>;
}) {
  const padRef = useRef<SignaturePad | null>(null);
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handle() {
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
      await onSubmit(dataUrl);
    } catch (e: any) {
      toast.error(e?.message ?? "Échec de la validation");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <PenLine className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Votre validation</h3>
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
          Je confirme que les réserves indiquées ont été levées et accepte la signature électronique de ce procès-verbal de levée. Cette signature a la même valeur juridique qu'une signature manuscrite.
        </span>
      </label>
      <Button onClick={handle} disabled={submitting} size="lg" className="mt-4 w-full">
        {submitting ? (
          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
        ) : (
          <CheckCircle2 className="mr-1.5 h-4 w-4" />
        )}
        {submitting ? "Validation en cours…" : "Valider la levée de réserves"}
      </Button>
    </Card>
  );
}
