import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
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
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  loader: ({ context }) => context as { session: { email: string; clientId: string | null } },
  component: ClientHistorique,
  head: () => ({
    meta: [
      { title: "Historique — Espace client | PVIA" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

const META: Record<string, { icon: any; label: string; tone: string }> = {
  "client.login_code_sent": { icon: Mail, label: "Code de connexion envoyé", tone: "text-blue-600" },
  "client.login_success":   { icon: LogIn, label: "Connexion réussie", tone: "text-emerald-600" },
  "client.login_failed":    { icon: AlertCircle, label: "Échec de connexion", tone: "text-destructive" },
  "client.logout":          { icon: LogOut, label: "Déconnexion", tone: "text-muted-foreground" },
  "client.pv_viewed":       { icon: Eye, label: "PV consulté", tone: "text-foreground" },
  "client.pdf_downloaded":  { icon: Download, label: "PDF téléchargé", tone: "text-foreground" },
  "client.pv_signed":       { icon: PenLine, label: "PV signé", tone: "text-emerald-600" },
  "client.session_revoked": { icon: ShieldOff, label: "Session révoquée", tone: "text-amber-600" },
  "client.all_sessions_revoked": { icon: ShieldOff, label: "Toutes les sessions révoquées", tone: "text-amber-600" },
};

function ClientHistorique() {
  const { session } = Route.useLoaderData();
  const fn = useServerFn(getClientActivity);
  const q = useQuery({ queryKey: ["client.activity"], queryFn: () => fn() });

  return (
    <ClientShell email={session.email}>
      <div className="mb-6 flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
          <History className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Historique</h1>
          <p className="text-sm text-muted-foreground">
            Activité récente sur votre espace client (100 derniers événements).
          </p>
        </div>
      </div>

      {q.isLoading && (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      )}

      {q.isError && (
        <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {(q.error as Error)?.message ?? "Impossible de charger l'historique."}
        </Card>
      )}

      {q.data && q.data.events.length === 0 && (
        <EmptyState
          icon={History}
          title="Aucune activité"
          description="Dès que vous interagissez avec votre espace, les événements apparaîtront ici."
        />
      )}

      {q.data && q.data.events.length > 0 && (
        <Card className="overflow-hidden p-0">
          <ul className="divide-y divide-border/60">
            {q.data.events.map((e) => {
              const m = META[e.action] ?? {
                icon: History,
                label: e.action,
                tone: "text-muted-foreground",
              };
              const Icon = m.icon;
              return (
                <li key={e.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${m.tone}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">{m.label}</span>
                      {e.pv_numero && (
                        <Link
                          to="/client/pv/$id"
                          params={{ id: e.pv_id! }}
                          className="text-primary hover:underline"
                        >
                          PV {e.pv_numero}
                        </Link>
                      )}
                      <Badge variant="outline" className="ml-auto shrink-0 text-[10px]">
                        {new Date(e.created_at).toLocaleString("fr-FR")}
                      </Badge>
                    </div>
                    {e.ip && (
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        IP {e.ip}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </ClientShell>
  );
}
