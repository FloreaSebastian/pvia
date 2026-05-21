import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download, PenLine, MapPin, Building2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientShell } from "@/components/client/ClientShell";
import {
  getClientSession,
  getClientPvDetail,
  getClientPdfSignedUrl,
} from "@/lib/client-auth.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/client/pv/$id")({
  beforeLoad: async () => {
    const s = await getClientSession();
    if (!s) throw redirect({ to: "/client/login" });
    return { session: s };
  },
  loader: ({ context }) => context as { session: { email: string; clientId: string | null } },
  component: ClientPvDetail,
  head: ({ params }) => ({
    meta: [
      { title: `PV ${params.id.slice(0, 6)} — Espace client | PVIA` },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function ClientPvDetail() {
  const { id } = Route.useParams();
  const { session } = Route.useLoaderData();
  const detailFn = useServerFn(getClientPvDetail);
  const pdfFn = useServerFn(getClientPdfSignedUrl);

  const q = useQuery({
    queryKey: ["client.pv", id],
    queryFn: () => detailFn({ data: { pvId: id } }),
  });

  async function download() {
    try {
      const { url } = await pdfFn({ data: { pvId: id } });
      window.open(url, "_blank", "noopener");
    } catch (e: any) {
      toast.error(e?.message ?? "PDF indisponible");
    }
  }

  if (q.isLoading) {
    return (
      <ClientShell email={session.email}>
        <Skeleton className="mb-4 h-7 w-56" />
        <Skeleton className="mb-2 h-4 w-72" />
        <Skeleton className="mt-6 h-48 w-full" />
      </ClientShell>
    );
  }

  if (q.isError || !q.data) {
    return (
      <ClientShell email={session.email}>
        <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {(q.error as Error)?.message ?? "PV introuvable."}
        </Card>
      </ClientShell>
    );
  }

  const { pv, company, chantier, reserves, photos } = q.data;

  return (
    <ClientShell email={session.email}>
      <Link to="/client/dashboard" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Retour aux PV
      </Link>

      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">PV {pv.numero}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {company?.name && (
              <span className="inline-flex items-center gap-1"><Building2 className="h-3.5 w-3.5" /> {company.name}</span>
            )}
            {chantier?.address && (
              <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {chantier.address}</span>
            )}
            <Badge variant="outline" className="text-[10px]">{pv.status}</Badge>
          </div>
        </div>
        <div className="flex gap-2">
          {pv.pdf_url && (
            <Button onClick={download} variant="outline">
              <Download className="mr-1.5 h-4 w-4" /> Télécharger le PDF
            </Button>
          )}
          {pv.status !== "signe" && pv.sign_token && (
            <Button asChild>
              <a href={`/sign/pv/${pv.sign_token}`} target="_blank" rel="noopener">
                <PenLine className="mr-1.5 h-4 w-4" /> Signer
              </a>
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Informations</h2>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <Detail label="Type" value={pv.type} />
            <Detail label="Date de réception" value={pv.reception_date ? new Date(pv.reception_date).toLocaleDateString("fr-FR") : "—"} />
            <Detail label="Signé le" value={pv.signed_at ? new Date(pv.signed_at).toLocaleString("fr-FR") : "Non signé"} />
            <Detail label="Envoyé le" value={pv.sent_to_client_at ? new Date(pv.sent_to_client_at).toLocaleString("fr-FR") : "—"} />
            {pv.description && <Detail label="Description" value={pv.description} full />}
            {pv.observations && <Detail label="Observations" value={pv.observations} full />}
          </dl>
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Réserves <span className="text-foreground">({reserves.length})</span>
          </h2>
          {reserves.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune réserve enregistrée.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {reserves.map((r: any) => (
                <li key={r.id} className="rounded-md border border-border/60 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant={r.severity === "majeure" ? "destructive" : "outline"} className="text-[10px]">
                      {r.severity}
                    </Badge>
                    <span className="text-[11px] text-muted-foreground">{r.status}</span>
                  </div>
                  <p className="mt-1 text-foreground">{r.description}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {photos.length > 0 && (
        <Card className="mt-4 p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Photos ({photos.length})
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {photos.map((p: any) => (
              <div key={p.id} className="overflow-hidden rounded-lg border border-border/60">
                <img src={p.url} alt={p.caption ?? "Photo PV"} className="aspect-square w-full object-cover" loading="lazy" />
                {p.caption && <div className="px-2 py-1 text-[11px] text-muted-foreground">{p.caption}</div>}
              </div>
            ))}
          </div>
        </Card>
      )}
    </ClientShell>
  );
}

function Detail({ label, value, full }: { label: string; value: string; full?: boolean }) {
  return (
    <div className={full ? "sm:col-span-2" : undefined}>
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-line text-sm text-foreground">{value || "—"}</dd>
    </div>
  );
}
