import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Download, FileText, PenLine, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusPill, PvStatusPill } from "@/components/ui/status-pill";
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
  loader: ({ context }) => context as { session: { email: string; clientId: string | null } },
  component: ClientDashboard,
  head: () => ({
    meta: [
      { title: "Mes procès-verbaux — Espace client | PVIA" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function statusLabel(s: string) {
  switch (s) {
    case "signe": return { label: "Signé", variant: "default" as const };
    case "envoye": return { label: "Envoyé", variant: "secondary" as const };
    case "en_attente_signature": return { label: "À signer", variant: "destructive" as const };
    case "brouillon": return { label: "Brouillon", variant: "outline" as const };
    default: return { label: s, variant: "outline" as const };
  }
}

function ClientDashboard() {
  const { session } = Route.useLoaderData();
  const listFn = useServerFn(getClientPvList);
  const pdfFn = useServerFn(getClientPdfSignedUrl);

  const q = useQuery({
    queryKey: ["client.pv-list"],
    queryFn: () => listFn(),
  });

  async function download(pvId: string, numero: string) {
    try {
      const { url } = await pdfFn({ data: { pvId } });
      // open in new tab
      window.open(url, "_blank", "noopener");
    } catch (e: any) {
      toast.error(e?.message ?? `PDF indisponible pour ${numero}`);
    }
  }

  return (
    <ClientShell email={session.email}>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Vos procès-verbaux</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Consultez, signez et téléchargez les PV qui vous sont adressés.
        </p>
      </div>

      {q.isLoading && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      )}

      {q.isError && (
        <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {(q.error as Error)?.message ?? "Impossible de charger vos PV."}
        </Card>
      )}

      {q.data && q.data.pvs.length === 0 && (
        <EmptyState
          icon={FileText}
          title="Aucun PV pour le moment"
          description="Dès qu'un PV vous est adressé, il apparaîtra ici. Pensez à vérifier votre email pour les nouvelles signatures à effectuer."
        />
      )}

      {q.data && q.data.pvs.length > 0 && (
        <motion.ul
          initial="hidden"
          animate="show"
          variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04 } } }}
          className="space-y-3"
        >
          {q.data.pvs.map((pv: any) => {
            const st = statusLabel(pv.status);
            const isSigned = pv.status === "signe" || !!pv.client_signature;
            const isExpired =
              !!pv.sign_token_expires_at && new Date(pv.sign_token_expires_at) < new Date();
            const signable = new Set(["en_attente", "en_attente_signature", "envoye"]);
            const needsSign = !isSigned && !isExpired && signable.has(pv.status);
            return (
              <motion.li
                key={pv.id}
                variants={{ hidden: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0 } }}
              >
                <Card className="flex flex-col gap-3 p-4 transition-shadow hover:shadow-md sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                      <FileText className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">PV {pv.numero}</span>
                        {isSigned ? (
                          <StatusPill tone="success" size="sm" dot>Signé</StatusPill>
                        ) : needsSign ? (
                          <StatusPill tone="warning" size="sm" dot>À signer</StatusPill>
                        ) : (
                          <PvStatusPill status={pv.status} size="sm" />
                        )}
                        {pv.pdf_url && (
                          <StatusPill tone="info" size="sm">PDF disponible</StatusPill>
                        )}
                      </div>
                      <div className="mt-1 truncate text-xs text-muted-foreground">
                        {pv.reception_date ? `Réception ${new Date(pv.reception_date).toLocaleDateString("fr-FR")}` : "Date non précisée"}
                        {pv.signed_at && ` · Signé le ${new Date(pv.signed_at).toLocaleDateString("fr-FR")}`}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
                    {needsSign && (
                      <Button asChild size="sm" variant="default">
                        <Link to="/client/pv/$id" params={{ id: pv.id }}>
                          <PenLine className="mr-1.5 h-3.5 w-3.5" /> Signer
                        </Link>
                      </Button>
                    )}
                    {pv.pdf_url && (
                      <Button size="sm" variant="outline" onClick={() => download(pv.id, pv.numero)}>
                        <Download className="mr-1.5 h-3.5 w-3.5" /> PDF
                      </Button>
                    )}
                    <Button asChild size="sm" variant="ghost">
                      <Link to="/client/pv/$id" params={{ id: pv.id }}>
                        Détails <ChevronRight className="ml-1 h-3.5 w-3.5" />
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
