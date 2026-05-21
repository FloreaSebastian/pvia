import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { User, Mail, Monitor, ShieldOff, Loader2, CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientShell } from "@/components/client/ClientShell";
import {
  getClientSession,
  getClientProfile,
  revokeClientSession,
  revokeAllClientSessions,
} from "@/lib/client-auth.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/client/profil")({
  beforeLoad: async () => {
    const s = await getClientSession();
    if (!s) throw redirect({ to: "/client/login" });
    return { session: s };
  },
  loader: ({ context }) => context as { session: { email: string; clientId: string | null } },
  component: ClientProfil,
  head: () => ({
    meta: [
      { title: "Profil — Espace client | PVIA" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function ClientProfil() {
  const { session } = Route.useLoaderData();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const profileFn = useServerFn(getClientProfile);
  const revokeFn = useServerFn(revokeClientSession);
  const revokeAllFn = useServerFn(revokeAllClientSessions);

  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["client.profile"], queryFn: () => profileFn() });

  async function onRevoke(id: string, isCurrent: boolean) {
    setBusy(id);
    try {
      const r = await revokeFn({ data: { sessionId: id } });
      toast.success("Session révoquée");
      if (r.wasCurrent) {
        navigate({ to: "/client/login" });
        return;
      }
      await qc.invalidateQueries({ queryKey: ["client.profile"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Échec");
    } finally {
      setBusy(null);
      void isCurrent;
    }
  }

  async function onRevokeAll() {
    setBusy("all");
    try {
      await revokeAllFn();
      toast.success("Toutes les sessions ont été révoquées");
      navigate({ to: "/client/login" });
    } catch (e: any) {
      toast.error(e?.message ?? "Échec");
    } finally {
      setBusy(null);
    }
  }

  return (
    <ClientShell email={session.email}>
      <div className="mb-6 flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
          <User className="h-5 w-5" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Profil</h1>
          <p className="text-sm text-muted-foreground">
            Gérez votre compte et vos appareils connectés.
          </p>
        </div>
      </div>

      <Card className="mb-5 p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Compte
        </h2>
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-md bg-muted">
            <Mail className="h-4 w-4 text-muted-foreground" />
          </div>
          <div>
            <div className="text-sm font-medium">{session.email}</div>
            <div className="text-xs text-muted-foreground">
              Connexion sans mot de passe (code email)
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Sessions actives
          </h2>
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={onRevokeAll}
            className="gap-1.5"
          >
            {busy === "all" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ShieldOff className="h-3.5 w-3.5" />
            )}
            Tout déconnecter
          </Button>
        </div>

        {q.isLoading && (
          <div className="space-y-2">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        )}

        {q.data && q.data.sessions.length === 0 && (
          <p className="text-sm text-muted-foreground">Aucune session active.</p>
        )}

        {q.data && q.data.sessions.length > 0 && (
          <ul className="space-y-2">
            {q.data.sessions.map((s) => (
              <li
                key={s.id}
                className="flex flex-col gap-3 rounded-lg border border-border/60 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-muted">
                    <Monitor className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">{s.deviceLabel}</span>
                      {s.isCurrent && (
                        <StatusPill tone="success" size="sm" icon={<CheckCircle2 />}>
                          Cet appareil
                        </StatusPill>
                      )}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {s.ip ?? "IP inconnue"} · vu pour la dernière fois{" "}
                      {new Date(s.last_seen_at).toLocaleString("fr-FR")}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      Expire le {new Date(s.expires_at).toLocaleDateString("fr-FR")}
                    </div>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy !== null}
                  onClick={() => onRevoke(s.id, s.isCurrent)}
                  className="gap-1.5"
                >
                  {busy === s.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ShieldOff className="h-3.5 w-3.5" />
                  )}
                  {s.isCurrent ? "Me déconnecter" : "Déconnecter"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </ClientShell>
  );
}
