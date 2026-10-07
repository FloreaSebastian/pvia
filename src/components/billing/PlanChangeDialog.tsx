import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CalendarClock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { confirmPlanChange, previewPlanChange } from "@/lib/billing-plan-change.functions";
import { CHANGE_KIND_LABELS, parsePriceId, type ChangeKind } from "@/lib/billing-plan-change";
import { PLAN_LABELS, formatFrDate } from "@/lib/plans";

type Preview = Awaited<ReturnType<typeof previewPlanChange>>;

const eur = (cents: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100);

export function priceLabel(priceId: string | null | undefined) {
  const p = parsePriceId(priceId ?? "");
  if (!p) return "—";
  return `${PLAN_LABELS[p.plan]} ${p.interval === "annual" ? "annuel" : "mensuel"}`;
}

function message(e: unknown) {
  const m = e instanceof Error ? e.message : "";
  return m && m.length < 300 ? m : "Le changement de formule est momentanément indisponible.";
}

export function PlanChangeDialog(props: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  companyId: string;
  environment: "sandbox" | "live";
  targetPriceId: string | null;
  onDone: () => void;
}) {
  const previewFn = useServerFn(previewPlanChange);
  const confirmFn = useServerFn(confirmPlanChange);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ack, setAck] = useState(false);
  const [ackReplace, setAckReplace] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!props.open || !props.targetPriceId) return;
    let cancelled = false;
    setPreview(null);
    setError(null);
    setAck(false);
    setAckReplace(false);
    setLoading(true);
    previewFn({
      data: {
        companyId: props.companyId,
        environment: props.environment,
        targetPriceId: props.targetPriceId as any,
      },
    })
      .then((p) => !cancelled && setPreview(p))
      .catch((e) => !cancelled && setError(message(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [props.open, props.targetPriceId, props.companyId, props.environment, previewFn]);

  async function confirm() {
    if (!preview || inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    try {
      const r = await confirmFn({
        data: {
          companyId: props.companyId,
          environment: props.environment,
          requestId: preview.requestId,
          acknowledgeOverages: ack,
          acknowledgeScheduleReplacement: ackReplace,
        },
      });
      if (r.status === "applied") toast.success("Nouvelle formule active.");
      else if (r.status === "scheduled")
        toast.success(
          `Changement programmé pour le ${formatFrDate(r.effectiveAt)}. Votre formule actuelle reste active d'ici là.`,
        );
      else if (r.status === "payment_pending") {
        toast.info(
          "Confirmez le paiement auprès de votre banque pour activer la nouvelle formule.",
        );
        if (r.hostedInvoiceUrl) window.open(r.hostedInvoiceUrl, "_blank", "noopener");
      } else if (r.status === "payment_failed")
        toast.error(
          "Le paiement a été refusé : votre formule actuelle est conservée. Mettez à jour votre moyen de paiement puis réessayez.",
        );
      if (r.replacedScheduled)
        toast.info(
          `Le changement prévu vers ${priceLabel(r.replacedScheduled.priceId)} a été annulé${r.status === "applied" ? "" : ", même si la nouvelle formule n'est pas encore active"}.`,
        );
      if (r.syncIncomplete)
        toast.info(
          "Mise à jour de l'affichage en cours : actualisez la page dans quelques instants.",
        );
      props.onOpenChange(false);
      props.onDone();
    } catch (e) {
      setError(message(e));
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  const kind = preview?.kind as ChangeKind | undefined;
  const overages = (preview?.overages ?? []) as { code: string; message: string }[];
  const needAck = overages.length > 0;
  const replaces = (preview as any)?.replacesScheduled as null | {
    priceId: string;
    at: string | null;
  };
  const due = preview?.dueNow;
  const next = preview?.nextInvoice;

  return (
    <AlertDialog open={props.open} onOpenChange={(o) => !submitting && props.onOpenChange(o)}>
      <AlertDialogContent className="max-h-[90dvh] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {kind ? CHANGE_KIND_LABELS[kind] : "Changer de formule"}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-4 text-left text-sm">
              {loading && (
                <div className="flex items-center gap-2 text-muted-foreground" role="status">
                  <Loader2 className="h-4 w-4 animate-spin" /> Calcul du montant exact…
                </div>
              )}
              {error && (
                <div
                  className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-destructive"
                  role="alert"
                >
                  {error}
                </div>
              )}
              {preview && (
                <>
                  <p>
                    <span className="font-medium text-foreground">
                      {priceLabel(preview.fromPriceId)}
                    </span>{" "}
                    →{" "}
                    <span className="font-medium text-foreground">
                      {priceLabel(preview.toPriceId)}
                    </span>
                  </p>

                  {preview.mode === "immediate" ? (
                    <div className="rounded-lg border border-border p-3">
                      <div className="mb-2 font-medium text-foreground">
                        {preview.trialing ? "Pendant votre essai" : "À régler maintenant (prorata)"}
                      </div>
                      {due && due.ttc < 0 ? (
                        <p>
                          Crédit de{" "}
                          <span className="font-semibold text-foreground">{eur(-due.ttc)} TTC</span>{" "}
                          reporté sur vos prochaines factures.
                        </p>
                      ) : due ? (
                        <dl className="grid grid-cols-2 gap-1">
                          <dt>Montant HT</dt>
                          <dd className="text-right">{eur(due.ht)}</dd>
                          <dt>TVA</dt>
                          <dd className="text-right">{eur(due.tva)}</dd>
                          <dt className="font-medium text-foreground">Total TTC</dt>
                          <dd className="text-right font-semibold text-foreground">
                            {eur(due.ttc)}
                          </dd>
                        </dl>
                      ) : null}
                      <p className="mt-2 text-xs">
                        {preview.trialing
                          ? "Aucun prélèvement avant la fin de votre essai. La nouvelle formule s'applique immédiatement."
                          : "Le prorata tient compte du temps restant sur votre période actuelle. La nouvelle formule et ses droits sont activés dès que le paiement est confirmé ; sinon votre formule actuelle est conservée."}
                      </p>
                      {kind === "interval_upgrade" ||
                      (kind === "upgrade" &&
                        parsePriceId(preview.toPriceId)?.interval === "annual" &&
                        parsePriceId(preview.fromPriceId)?.interval === "monthly") ? (
                        <p className="mt-2 text-xs">
                          Passage à l'annuel : votre période mensuelle non consommée est déduite,
                          une nouvelle période d'un an démarre aujourd'hui.
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <div className="flex gap-2 rounded-lg border border-border p-3">
                      <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" />
                      <p>
                        Rien n'est facturé maintenant. Votre formule actuelle et ses droits restent
                        actifs jusqu'au{" "}
                        <span className="font-medium text-foreground">
                          {formatFrDate(preview.effectiveAt)}
                        </span>
                        , puis la nouvelle formule s'applique. Vous pourrez annuler ce changement
                        d'ici là.
                      </p>
                    </div>
                  )}

                  <dl className="grid grid-cols-[1fr_auto] gap-1">
                    <dt>Date d'effet</dt>
                    <dd className="text-right">
                      {preview.mode === "immediate"
                        ? "Immédiate (après paiement)"
                        : formatFrDate(preview.effectiveAt)}
                    </dd>
                    <dt>Prochaine échéance</dt>
                    <dd className="text-right">{formatFrDate(preview.nextBillingAt)}</dd>
                    {next && (
                      <>
                        <dt>Puis, à chaque échéance (estimation)</dt>
                        <dd className="text-right">
                          {eur(next.ht)} HT · {eur(next.ttc)} TTC
                        </dd>
                      </>
                    )}
                  </dl>

                  {replaces && (
                    <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                      <div className="flex items-center gap-2 font-medium text-foreground">
                        <AlertTriangle className="h-4 w-4" /> Changement déjà programmé annulé
                      </div>
                      <p>
                        Le passage prévu à {priceLabel(replaces.priceId)}
                        {replaces.at ? ` le ${formatFrDate(replaces.at)}` : ""} sera annulé dès
                        votre confirmation
                        {preview.mode === "immediate"
                          ? ", même si le paiement est refusé ou demande une authentification bancaire. Vous pourrez le reprogrammer ensuite."
                          : " et remplacé par ce nouveau changement."}
                      </p>
                      <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-foreground">
                        <Checkbox
                          checked={ackReplace}
                          onCheckedChange={(v) => setAckReplace(v === true)}
                        />
                        J'accepte l'annulation du changement programmé
                      </label>
                    </div>
                  )}

                  {needAck && (
                    <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 p-3">
                      <div className="flex items-center gap-2 font-medium text-foreground">
                        <AlertTriangle className="h-4 w-4" /> Points d'attention
                      </div>
                      <ul className="list-disc space-y-1 pl-5">
                        {overages.map((o) => (
                          <li key={o.code}>{o.message}</li>
                        ))}
                      </ul>
                      <p className="text-xs">
                        Aucune donnée (PV, réserves, photos, documents, utilisateurs) n'est
                        supprimée.
                      </p>
                      <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-foreground">
                        <Checkbox checked={ack} onCheckedChange={(v) => setAck(v === true)} />
                        J'ai pris connaissance de ces points
                      </label>
                    </div>
                  )}
                  <p className="text-xs">
                    Montant à régler maintenant calculé par Stripe selon votre adresse de
                    facturation et revérifié à la confirmation. Le montant des échéances suivantes
                    est une estimation : la TVA et les éventuelles remises sont appliquées à la date
                    de facturation.
                  </p>
                </>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="min-h-[44px]" disabled={submitting}>
            Annuler
          </AlertDialogCancel>
          <Button
            className="min-h-[44px]"
            onClick={confirm}
            disabled={
              !preview || submitting || loading || (needAck && !ack) || (!!replaces && !ackReplace)
            }
          >
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {preview?.mode === "scheduled" ? "Programmer le changement" : "Confirmer le changement"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
