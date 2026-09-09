import { createFileRoute, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck, Download, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ClientShell } from "@/components/client/ClientShell";
import { getClientSession } from "@/lib/client-auth.functions";
import { getClientStudies, getClientStudyPdfUrl } from "@/lib/etudes-client.functions";
import { getStudyTemplate } from "@/lib/etudes/templates";
import { STUDY_STATUS_META, type StudyStatus, type StudyType } from "@/lib/etudes/types";
import { toast } from "sonner";

export const Route = createFileRoute("/client/etudes")({
  beforeLoad: async () => {
    const s = await getClientSession();
    if (!s) throw redirect({ to: "/client/login" });
    return { session: s };
  },
  loader: ({ context }) => ({ session: { email: (context as { session: { email: string } }).session.email } }),
  component: ClientStudiesPage,
  head: () => ({
    meta: [
      { title: "Mes cahiers des charges — Espace client | PVIA" },
      {
        name: "description",
        content: "Espace client PVIA : consultez les cahiers des charges envoyés par vos installateurs et téléchargez-les en PDF.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function ClientStudiesPage() {
  const { session } = Route.useLoaderData();
  const listFn = useServerFn(getClientStudies);
  const pdfFn = useServerFn(getClientStudyPdfUrl);

  const { data, isLoading } = useQuery({
    queryKey: ["client-studies"],
    queryFn: () => listFn(),
  });

  async function openPdf(studyId: string) {
    try {
      const r = await pdfFn({ data: { studyId } });
      window.open(r.url, "_blank", "noopener");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Document indisponible.");
    }
  }

  return (
    <ClientShell email={session.email}>
      <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Mes cahiers des charges</h1>
        <p className="mb-5 mt-1 text-sm text-muted-foreground">
          Les pré-études envoyées par vos installateurs, avant la visite technique.
        </p>

        {isLoading ? (
          <div className="space-y-2">
            {[0, 1].map((i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
          </div>
        ) : !data || data.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            title="Aucun cahier des charges"
            description="Vous recevrez ici les pré-études que vos installateurs vous envoient."
          />
        ) : (
          <ul className="space-y-2">
            {data.map((s) => {
              const meta = STUDY_STATUS_META[s.status as StudyStatus];
              const template = getStudyTemplate(s.study_type as StudyType);
              return (
                <li key={s.id} className="rounded-xl border border-border bg-card p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{s.reference}</span>
                    <Badge variant="outline">{template?.label ?? s.study_type}</Badge>
                    {meta && <Badge variant="secondary">{meta.label}</Badge>}
                  </div>
                  <div className="mt-1 font-medium">{s.title || template?.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {[s.companyName, s.site_city].filter(Boolean).join(" · ")}
                    {s.sent_at ? ` · ${new Date(s.sent_at).toLocaleDateString("fr-FR")}` : ""}
                  </div>
                  <Button variant="outline" className="mt-3 min-h-11 gap-2" onClick={() => void openPdf(s.id)}>
                    <Download className="h-4 w-4" /> Télécharger le PDF
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </ClientShell>
  );
}
