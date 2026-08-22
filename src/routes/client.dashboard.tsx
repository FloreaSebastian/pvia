import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { Download, FileText, PenLine, ChevronRight, Clock, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusPill, PvStatusPill, isKnownPvStatus } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientShell } from "@/components/client/ClientShell";
import {
  getClientSession,
  getClientPvList,
  getClientPdfSignedUrl,
} from "@/lib/client-auth.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/client/dashboard")({
  beforeLoad: async () => {
    const s = await getClientSession();
    if (!s) throw redirect({ to: "/client/login" });
    return { session: s };
  },
  loader: ({ context }) => {
    const s = (context as { session: { email: string; clientId: string | null } }).session;
    // Uniquement des données sérialisables et non sensibles.
    return { session: { email: s.email } };
  },
  component: ClientDashboard,
  head: () => ({
    meta: [
      { title: "Mes procès-verbaux — Espace client | PVIA" },
      {
        name: "description",
        content:
          "Espace client PVIA : consultez, signez et téléchargez vos procès-verbaux de réception.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
});

/** Date fr-FR sûre : jamais "Invalid Date"/NaN à l'écran. */
function fmtDate(v: string | null | undefined): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("fr-FR");
}

/** Aucun détail technique (SQL, Zod, UUID, JWT) ne doit atteindre le client externe. */
function friendlyError(error: unknown): string {
  const raw = (error as Error)?.message ?? "";
  const technical = /[{[]|invalid_|uuid|jwt|postgres|supabase|fetch|column|relation/i.test(raw);
  if (!raw || technical) return "Impossible de charger vos procès-verbaux pour le moment.";
  return raw;
}

type ClientPv = {
  id: string;
  numero: string;
  status: string;
  reception_date: string | null;
  signed_at: string | null;
  hasPdf: boolean;
  isSigned: boolean;
  signExpired: boolean;
  canSign: boolean;
};

function ClientDashboard() {
  const { session } = Route.useLoaderData();
  const listFn = useServerFn(getClientPvList);
  const pdfFn = useServerFn(getClientPdfSignedUrl);
  const reduceMotion = useReducedMotion();

  const q = useQuery({
    queryKey: ["client.pv-list"],
    queryFn: () => listFn(),
    retry: false,
  });

  // Un seul téléchargement PDF à la fois par PV (anti double-tap mobile).
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);

  async function download(pvId: string, numero: string) {
    if (pdfBusy) return;
    setPdfBusy(pvId);
    try {
      const { url } = await pdfFn({ data: { pvId } });
      window.open(url, "_blank", "noopener");
    } catch {
      toast.error(`PDF indisponible pour le PV ${numero}.`);
    } finally {
      setPdfBusy(null);
    }
  }

  const pvs = (q.data?.pvs ?? []) as ClientPv[];
  const toSign = pvs.filter((p) => p.canSign).length;

  return (
    <ClientShell email={session.email}>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight [overflow-wrap:anywhere] sm:text-3xl">
          Vos procès-verbaux
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Consultez, signez et téléchargez les PV qui vous sont adressés.
        </p>
        {toSign > 0 && (
          <p className="mt-2 text-sm font-medium text-foreground">
            {toSign} PV {toSign > 1 ? "attendent" : "attend"} votre signature.
          </p>
        )}
      </div>

      {q.isLoading && (
        <div className="space-y-3" role="status" aria-live="polite" aria-label="Chargement de vos procès-verbaux">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[132px] w-full rounded-xl sm:h-24" />
          ))}
        </div>
      )}

      {q.isError && (
        <Card
          role="alert"
          className="border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive [overflow-wrap:anywhere]"
        >
          {friendlyError(q.error)}
        </Card>
      )}

      {q.data && pvs.length === 0 && (
        <EmptyState
          icon={FileText}
          title="Aucun PV pour le moment"
          description="Dès qu'un PV vous est adressé, il apparaîtra ici. Pensez à vérifier votre email pour les nouvelles signatures à effectuer."
        />
      )}

      {q.data && pvs.length > 0 && (
        <motion.ul
          initial={reduceMotion ? undefined : "hidden"}
          animate={reduceMotion ? undefined : "show"}
          variants={{ hidden: {}, show: { transition: { staggerChildren: 0.03 } } }}
          className="space-y-3"
          aria-label="Liste de vos procès-verbaux"
        >
          {pvs.map((pv) => {
            const reception = fmtDate(pv.reception_date);
            const signed = fmtDate(pv.signed_at);
            return (
              <motion.li
                key={pv.id}
                variants={
                  reduceMotion
                    ? undefined
                    : { hidden: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0 } }
                }
              >
                <Card className="flex flex-col gap-3 p-4 transition-shadow hover:shadow-md sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                      <FileText className="h-5 w-5" aria-hidden />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h2 className="text-sm font-semibold leading-snug [overflow-wrap:anywhere]">
                        N° {pv.numero || "—"}
                      </h2>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {pv.isSigned ? (
                          <StatusPill tone="success" size="sm" dot>
                            Signé
                          </StatusPill>
                        ) : pv.canSign ? (
                          <StatusPill tone="warning" size="sm" dot>
                            À signer
                          </StatusPill>
                        ) : pv.signExpired ? (
                          <StatusPill tone="destructive" size="sm" dot>
                            Lien expiré
                          </StatusPill>
                        ) : (
                        ) : isKnownPvStatus(pv.status) ? (
                          <PvStatusPill status={pv.status} size="sm" />
                        ) : (
                          // Statut inattendu : on n'affiche jamais l'identifiant
                          // technique au client externe (mais on le conserve en title).
                          <StatusPill tone="neutral" size="sm" dot className="cursor-help">
                            <span title={pv.status}>En cours de traitement</span>
                          </StatusPill>

                        )}
                        {pv.hasPdf && (
                          <StatusPill tone="info" size="sm">
                            PDF
                          </StatusPill>
                        )}
                      </div>
                      <p className="mt-1.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                        {reception ? `Réception ${reception}` : "Date non précisée"}
                        {signed && ` · Signé le ${signed}`}
                      </p>
                      {pv.signExpired && (
                        <p className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground">
                          <Clock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                          <span>
                            Le lien de signature a expiré. Contactez l'entreprise pour en recevoir un
                            nouveau.
                          </span>
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0 sm:items-center">
                    {pv.canSign && (
                      <Button
                        asChild
                        variant="default"
                        className="col-span-2 h-11 sm:h-9"
                      >
                        <Link to="/client/pv/$id" params={{ id: pv.id }}>
                          <PenLine className="mr-1.5 h-4 w-4" aria-hidden /> Signer
                        </Link>
                      </Button>
                    )}
                    {pv.hasPdf && (
                      <Button
                        variant="outline"
                        className="h-11 sm:h-9"
                        onClick={() => download(pv.id, pv.numero)}
                        disabled={pdfBusy === pv.id}
                        aria-label={`Télécharger le PDF du PV ${pv.numero}`}
                      >
                        {pdfBusy === pv.id ? (
                          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
                        ) : (
                          <Download className="mr-1.5 h-4 w-4" aria-hidden />
                        )}
                        PDF
                      </Button>
                    )}
                    <Button
                      asChild
                      variant={pv.canSign || pv.hasPdf ? "ghost" : "outline"}
                      className={`h-11 sm:h-9 ${pv.hasPdf ? "" : "col-span-2"}`}
                    >
                      <Link
                        to="/client/pv/$id"
                        params={{ id: pv.id }}
                        aria-label={`Voir le détail du PV ${pv.numero}`}
                      >
                        Détails <ChevronRight className="ml-1 h-4 w-4" aria-hidden />
                      </Link>
                    </Button>
                  </div>
                </Card>
              </motion.li>
            );
          })}
        </motion.ul>
      )}
    </ClientShell>
  );
}
