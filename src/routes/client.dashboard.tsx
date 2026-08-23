import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { motion, useReducedMotion } from "motion/react";
import { useMemo, useState } from "react";
import {
  Download,
  FileText,
  PenLine,
  ChevronRight,
  Clock,
  Loader2,
  Building2,
  CheckCircle2,
} from "lucide-react";
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
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/client/dashboard")({
  beforeLoad: async () => {
    const s = await getClientSession();
    if (!s) throw redirect({ to: "/client/login" });
    return { session: s };
  },
  loader: ({ context }) => {
    const s = (context as { session: { email: string } }).session;
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
          "Espace client PVIA : consultez, signez et téléchargez vos procès-verbaux de réception, toutes entreprises confondues.",
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
  companyName: string | null;
  companyKey: string | null;
  chantierName: string | null;
  hasPdf: boolean;
  isSigned: boolean;
  signExpired: boolean;
  canSign: boolean;
};

type ClientLift = {
  id: string;
  pvId: string;
  numero: string;
  pvNumero: string;
  created_at: string | null;
  companyName: string | null;
  companyKey: string | null;
  chantierName: string | null;
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
  // Filtre entreprise : clé opaque, jamais d'identifiant interne.
  const [companyFilter, setCompanyFilter] = useState<string>("all");

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

  const allPvs = (q.data?.pvs ?? []) as ClientPv[];
  const allLifts = (q.data?.lifts ?? []) as ClientLift[];
  const companies = (q.data?.companies ?? []) as { key: string; name: string }[];
  const multiCompany = companies.length > 1;

  const pvs = useMemo(
    () => (companyFilter === "all" ? allPvs : allPvs.filter((p) => p.companyKey === companyFilter)),
    [allPvs, companyFilter],
  );
  const lifts = useMemo(
    () =>
      companyFilter === "all" ? allLifts : allLifts.filter((l) => l.companyKey === companyFilter),
    [allLifts, companyFilter],
  );

  const toSign = pvs.filter((p) => p.canSign);
  const todoCount = toSign.length + lifts.length;

  return (
    <ClientShell email={session.email}>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight [overflow-wrap:anywhere] sm:text-3xl">
          Vos documents
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {multiCompany
            ? "Retrouvez ici les documents de toutes les entreprises qui vous en ont adressé."
            : "Consultez, signez et téléchargez les documents qui vous sont adressés."}
        </p>
      </div>

      {/* Filtre entreprise — affiché seulement s'il y a plusieurs émetteurs */}
      {multiCompany && (
        <div
          className="mb-5 flex flex-wrap gap-2"
          role="group"
          aria-label="Filtrer par entreprise"
        >
          {[{ key: "all", name: "Toutes" }, ...companies].map((c) => {
            const active = companyFilter === c.key;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => setCompanyFilter(c.key)}
                aria-pressed={active}
                className={cn(
                  "inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors sm:min-h-9",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-muted-foreground hover:text-foreground",
                )}
              >
                {c.key !== "all" && <Building2 className="h-3.5 w-3.5 shrink-0" aria-hidden />}
                <span className="truncate">{c.name}</span>
              </button>
            );
          })}
        </div>
      )}

      {q.isLoading && (
        <div
          className="space-y-3"
          role="status"
          aria-live="polite"
          aria-label="Chargement de vos documents"
        >
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

      {/* ─── À faire ─────────────────────────────────────────────────────── */}
      {q.data && todoCount > 0 && (
        <section className="mb-8" aria-labelledby="client-todo-title">
          <h2
            id="client-todo-title"
            className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground"
          >
            À faire
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
              {todoCount}
            </span>
          </h2>
          <ul className="space-y-3">
            {toSign.map((pv) => (
              <li key={`sign-${pv.id}`}>
                <Card className="flex flex-col gap-3 border-primary/30 bg-primary/[0.03] p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold [overflow-wrap:anywhere]">
                      PV N° {pv.numero || "—"} à signer
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                      {[pv.companyName, pv.chantierName].filter(Boolean).join(" · ") ||
                        "Document en attente"}
                    </p>
                  </div>
                  <Button asChild className="h-11 shrink-0 sm:h-9">
                    <Link to="/client/pv/$id" params={{ id: pv.id }}>
                      <PenLine className="mr-1.5 h-4 w-4" aria-hidden /> Signer
                    </Link>
                  </Button>
                </Card>
              </li>
            ))}
            {lifts.map((l) => (
              <li key={`lift-${l.id}`}>
                <Card className="flex flex-col gap-3 border-primary/30 bg-primary/[0.03] p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold [overflow-wrap:anywhere]">
                      Levée de réserves {l.numero || ""} à valider
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                      {[l.companyName, l.chantierName, l.pvNumero ? `PV N° ${l.pvNumero}` : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <Button asChild className="h-11 shrink-0 sm:h-9">
                    <Link
                      to="/client/pv/$id/levee-reserves/$liftId"
                      params={{ id: l.pvId, liftId: l.id }}
                    >
                      <CheckCircle2 className="mr-1.5 h-4 w-4" aria-hidden /> Vérifier
                    </Link>
                  </Button>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}

      {q.data && pvs.length === 0 && (
        <EmptyState
          icon={FileText}
          title="Aucun document pour le moment"
          description="Dès qu'une entreprise vous adresse un document, il apparaîtra ici. Pensez à vérifier votre email pour les nouvelles signatures à effectuer."
        />
      )}

      {q.data && pvs.length > 0 && (
        <section aria-labelledby="client-docs-title">
          <h2
            id="client-docs-title"
            className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground"
          >
            Mes documents
          </h2>
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
                        <h3 className="text-sm font-semibold leading-snug [overflow-wrap:anywhere]">
                          N° {pv.numero || "—"}
                        </h3>
                        {(pv.companyName || pv.chantierName) && (
                          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                            <Building2 className="h-3 w-3 shrink-0" aria-hidden />
                            {[pv.companyName, pv.chantierName].filter(Boolean).join(" · ")}
                          </p>
                        )}
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
                          ) : isKnownPvStatus(pv.status) ? (
                            <PvStatusPill status={pv.status} size="sm" />
                          ) : (
                            // Statut inattendu : on n'affiche jamais l'identifiant
                            // technique au client externe (conservé en title).
                            <StatusPill tone="neutral" size="sm" dot>
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
                              Le lien de signature a expiré. Contactez l'entreprise pour en recevoir
                              un nouveau.
                            </span>
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0 sm:items-center">
                      {pv.canSign && (
                        <Button asChild variant="default" className="col-span-2 h-11 sm:h-9">
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
        </section>
      )}
    </ClientShell>
  );
}
