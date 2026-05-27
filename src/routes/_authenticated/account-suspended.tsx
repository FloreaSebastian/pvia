import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { ShieldAlert, Mail, ArrowLeft } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/PageHeader";
import { useCompany } from "@/hooks/use-company";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { z } from "zod";

const Search = z.object({ reason: z.string().optional() });

export const Route = createFileRoute("/_authenticated/account-suspended")({
  component: AccountSuspendedPage,
  validateSearch: (s) => Search.parse(s),
  head: () => ({ meta: [{ title: "Compte suspendu — PVIA" }] }),
});

function AccountSuspendedPage() {
  const { reason } = useSearch({ from: "/_authenticated/account-suspended" });
  const { activeCompanyId } = useCompany();

  const { data: company } = useQuery({
    queryKey: ["company-suspension", activeCompanyId],
    queryFn: async () => {
      if (!activeCompanyId) return null;
      const { data } = await supabase
        .from("companies")
        .select("name,suspended_at,suspension_reason,support_status")
        .eq("id", activeCompanyId)
        .maybeSingle();
      return data;
    },
    enabled: !!activeCompanyId,
  });

  const finalReason = company?.suspension_reason ?? reason ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Compte suspendu"
        description="Votre accès à PVIA est temporairement restreint."
      />

      <Card className="border-destructive/40 bg-destructive/5 p-8">
        <div className="flex items-start gap-4">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-destructive/15 text-destructive">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <div className="flex-1 space-y-3">
            <h2 className="text-xl font-semibold">
              Votre compte PVIA est suspendu
            </h2>
            <p className="text-sm text-muted-foreground">
              {company?.name ? <strong>{company.name}</strong> : "Votre entreprise"} ne peut plus
              effectuer d'actions sensibles (création de PV, signatures, exports, invitations).
              Vous conservez l'accès en <strong>lecture seule</strong> à votre historique.
            </p>
            {finalReason && (
              <div className="rounded-md border border-destructive/30 bg-background/60 p-3 text-sm">
                <div className="font-medium text-destructive">Motif</div>
                <div className="mt-1 text-muted-foreground">{finalReason}</div>
              </div>
            )}
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="font-semibold">Contacter le support</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Pour réactiver votre compte ou comprendre la décision, contactez l'équipe PVIA.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <a href="mailto:contact@pvia.fr?subject=Compte%20suspendu%20-%20PVIA">
            <Button>
              <Mail className="h-4 w-4" />
              Contacter le support
            </Button>
          </a>
          <Link to="/dashboard">
            <Button variant="outline">
              <ArrowLeft className="h-4 w-4" />
              Retour lecture seule
            </Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
