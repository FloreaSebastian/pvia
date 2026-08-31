import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  CreditCard,
  FileText,
  History,
  PauseCircle,
  PlayCircle,
  Repeat,
  Sparkles,
  XCircle,
} from "lucide-react";
import { getBillingTimeline, type BillingEvent } from "@/lib/billing-invoices.functions";
import { getStripeEnvironment } from "@/lib/stripe";

const ICONS: Record<BillingEvent["kind"], typeof History> = {
  trial_started: Sparkles,
  trial_ending: CalendarClock,
  trial_ended: CalendarClock,
  subscription_started: CheckCircle2,
  invoice_created: FileText,
  invoice_paid: CreditCard,
  payment_failed: AlertTriangle,
  plan_changed: Repeat,
  cancel_scheduled: CalendarClock,
  canceled: XCircle,
  paused: PauseCircle,
  resumed: PlayCircle,
  reactivated: PlayCircle,
};

function frDateTime(iso: string) {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

export function BillingTimeline({ companyId }: { companyId: string }) {
  const env = getStripeEnvironment();
  const fn = useServerFn(getBillingTimeline);
  const query = useQuery({
    queryKey: ["billing-timeline", companyId, env],
    queryFn: () => fn({ data: { companyId, environment: env } }),
    enabled: !!companyId,
    staleTime: 60_000,
    retry: 1,
  });

  const events = query.data?.events ?? [];

  return (
    <section aria-labelledby="historique-facturation" className="space-y-4">
      <h2 id="historique-facturation" className="text-xl font-semibold tracking-tight">
        Historique
      </h2>

      {query.isLoading && (
        <Card className="space-y-3 p-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </Card>
      )}

      {query.isError && (
        <Card className="flex flex-col items-start gap-3 p-6 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="text-muted-foreground">Impossible de charger votre historique de facturation.</p>
          <Button variant="outline" className="min-h-[44px]" onClick={() => void query.refetch()}>
            Réessayer
          </Button>
        </Card>
      )}

      {!query.isLoading && !query.isError && events.length === 0 && (
        <Card className="flex flex-col items-center gap-2 p-8 text-center">
          <History className="h-8 w-8 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium">Aucun événement pour le moment</p>
          <p className="text-sm text-muted-foreground">L'historique se remplit dès le démarrage de votre essai.</p>
        </Card>
      )}

      {events.length > 0 && (
        <Card className="p-4 sm:p-6">
          <ol className="relative space-y-5 border-l border-border pl-6">
            {events.map((ev, i) => {
              const Icon = ICONS[ev.kind] ?? History;
              return (
                <li key={`${ev.at}-${ev.kind}-${i}`} className="relative">
                  <span className="absolute -left-[31px] grid h-6 w-6 place-items-center rounded-full border border-border bg-card">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                  </span>
                  <div className="text-xs text-muted-foreground">{frDateTime(ev.at)}</div>
                  <div className="font-medium">{ev.title}</div>
                  {ev.detail && <div className="text-sm text-muted-foreground">{ev.detail}</div>}
                </li>
              );
            })}
          </ol>
        </Card>
      )}
    </section>
  );
}
