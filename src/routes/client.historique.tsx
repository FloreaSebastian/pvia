import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import {
  History,
  LogIn,
  LogOut,
  Mail,
  Eye,
  Download,
  PenLine,
  ShieldOff,
  AlertCircle,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ClientShell } from "@/components/client/ClientShell";
import { getClientSession, getClientActivity } from "@/lib/client-auth.functions";

export const Route = createFileRoute("/client/historique")({
  beforeLoad: async () => {
    const s = await getClientSession();
    if (!s) throw redirect({ to: "/client/login" });
    return { session: s };
  },
  loader: ({ context }) => {
    // On ne sérialise que l'email : jamais l'objet session complet.
    const s = (context as { session: { email: string } }).session;
    return { session: { email: s.email } };
  },
  component: ClientHistorique,
  head: () => ({
    meta: [
      { title: "Historique — Espace client | PVIA" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

type EventItem = {
  id: string;
  action: string;
  created_at: string;
  pv_id: string | null;
  pv_numero: string | null;
  /** Entreprise émettrice — utile quand plusieurs entreprises adressent des PV. */
  companyName?: string | null;
};


const META: Record<string, { icon: typeof History; label: string; tone: string }> = {
  "client.login_code_sent": { icon: Mail, label: "Code de connexion envoyé", tone: "text-info" },
  "client.login_success":   { icon: LogIn, label: "Connexion réussie", tone: "text-success" },
  "client.login_failed":    { icon: AlertCircle, label: "Échec de connexion", tone: "text-destructive" },
  "client.logout":          { icon: LogOut, label: "Déconnexion", tone: "text-muted-foreground" },
  "client.pv_viewed":       { icon: Eye, label: "Procès-verbal consulté", tone: "text-foreground" },
  "client.pdf_downloaded":  { icon: Download, label: "PDF téléchargé", tone: "text-foreground" },
  "client.pv_signed":       { icon: PenLine, label: "Procès-verbal signé", tone: "text-success" },
  "client.session_revoked": { icon: ShieldOff, label: "Session déconnectée", tone: "text-warning" },
  "client.all_sessions_revoked": { icon: ShieldOff, label: "Toutes les sessions déconnectées", tone: "text-warning" },
};

/** Jamais de nom d'action technique à l'écran. */
function metaFor(action: string) {
  return (
    META[action] ?? {
      icon: History,
      label: "Activité sur votre espace",
      tone: "text-muted-foreground",
    }
  );
}

/**
 * Date fr-FR, fuseau Europe/Paris (aligné sur /client/pv/:id) :
 * jamais "Invalid Date" / NaN à l'écran.
 */
function fmtDateTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("fr-FR", {
    timeZone: "Europe/Paris",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Aucun détail technique (SQL, Zod, UUID, JWT) ne doit atteindre le client externe. */
function friendlyError(error: unknown): string {
  const raw = (error as Error)?.message ?? "";
  const technical = /[{[]|invalid_|uuid|jwt|postgres|supabase|fetch|column|relation|failed to/i.test(raw);
  if (!raw || technical) return "Impossible de charger votre historique pour le moment.";
  return raw;
}

function ClientHistorique() {
  const { session } = Route.useLoaderData();
  const fn = useServerFn(getClientActivity);

  const [extra, setExtra] = useState<EventItem[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreState, setMoreState] = useState<{ total: number; hasMore: boolean } | null>(null);

  // Clé scopée à l'identité de session : pas de réutilisation du cache d'un
  // autre client si la session change dans le même onglet.
  const q = useQuery({
    queryKey: ["client.activity", session.email],
    queryFn: () => fn({ data: { offset: 0 } }),
  });

  const first = q.data?.events ?? [];
  const events = [...first, ...extra];
  const total = moreState?.total ?? q.data?.total ?? 0;
  const hasMore = moreState?.hasMore ?? q.data?.hasMore ?? false;

  const loadMore = useCallback(async () => {
    if (loadingMore) return; // double-clic = une seule requête
    setLoadingMore(true);
    try {
      const res = await fn({ data: { offset: first.length + extra.length } });
      setExtra((prev) => {
        const seen = new Set([...first, ...prev].map((e) => e.id));
        return [...prev, ...res.events.filter((e) => !seen.has(e.id))];
      });
      setMoreState({ total: res.total, hasMore: res.hasMore });
    } catch {
      setMoreState({ total, hasMore: true });
    } finally {
      setLoadingMore(false);
    }
  }, [fn, first, extra, loadingMore, total]);

  return (
    <ClientShell email={session.email}>
      <div className="mb-6 flex items-start gap-3">
        <div
          aria-hidden="true"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"
        >
          <History className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold tracking-tight">Historique</h1>
          <p className="text-sm text-muted-foreground">
            Activité récente sur votre espace client, de la plus récente à la plus ancienne.
          </p>
        </div>
      </div>

      {q.isLoading && (
        <div role="status" aria-live="polite" aria-busy="true" className="space-y-2">
          <span className="sr-only">Chargement de votre historique…</span>
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      )}

      {q.isError && (
        <Card
          role="alert"
          className="border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
        >
          <p className="break-words">{friendlyError(q.error)}</p>
          <Button
            variant="outline"
            className="mt-3 h-11"
            onClick={() => void q.refetch()}
            disabled={q.isFetching}
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Réessayer
          </Button>
        </Card>
      )}

      {q.data && events.length === 0 && (
        <EmptyState
          icon={History}
          title="Aucune activité pour le moment"
          description="Dès que vous consulterez, téléchargerez ou signerez un procès-verbal, l'événement apparaîtra ici."
        />
      )}

      {events.length > 0 && (
        <>
          <Card className="overflow-hidden p-0">
            <ul className="divide-y divide-border/60">
              {events.map((e) => {
                const m = metaFor(e.action);
                const Icon = m.icon;
                const when = fmtDateTime(e.created_at);
                return (
                  <li key={e.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                    <Icon
                      aria-hidden="true"
                      className={`mt-1 h-4 w-4 shrink-0 ${m.tone}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{m.label}</p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        {when ? (
                          <time dateTime={e.created_at}>{when}</time>
                        ) : (
                          <span>Date inconnue</span>
                        )}
                        {e.pv_numero && e.pv_id && (
                          <>
                            <span aria-hidden="true">·</span>
                            <Link
                              to="/client/pv/$id"
                              params={{ id: e.pv_id }}
                              aria-label={`Ouvrir le procès-verbal ${e.pv_numero}`}
                              className="inline-flex min-h-11 max-w-full items-center break-all text-primary underline-offset-2 hover:underline"
                            >
                              N° {e.pv_numero}
                            </Link>
                          </>
                        )}
                        {e.companyName && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="[overflow-wrap:anywhere]">{e.companyName}</span>
                          </>
                        )}

                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>

          <div className="mt-4 flex flex-col items-center gap-2">
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {events.length} événement{events.length > 1 ? "s" : ""} affiché
              {events.length > 1 ? "s" : ""} sur {total}
            </p>
            {hasMore && (
              <Button
                variant="outline"
                className="h-11 w-full sm:w-auto"
                onClick={() => void loadMore()}
                disabled={loadingMore}
                aria-busy={loadingMore}
              >
                {loadingMore ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : null}
                Charger plus
              </Button>
            )}
          </div>
        </>
      )}
    </ClientShell>
  );
}
