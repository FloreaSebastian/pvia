import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SubcontractorShell } from "@/components/subcontractor/SubcontractorShell";
import { supabase } from "@/integrations/supabase/client";
import {
  acceptSubcontractorInvite,
  peekSubcontractorInvite,
  sendSubcontractorLoginCode,
} from "@/lib/subcontractor-auth.functions";

export const Route = createFileRoute("/sous-traitant/invitation/$token")({
  component: InvitePage,
  head: () => ({
    meta: [
      { title: "Invitation sous-traitant — PVIA" },
      {
        name: "description",
        content: "Activez votre accès sous-traitant PVIA pour consulter vos interventions et chantiers affectés.",
      },
      { property: "og:title", content: "Invitation sous-traitant — PVIA" },
      { property: "og:description", content: "Activez votre accès sécurisé en quelques secondes." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function InvitePage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const peek = useServerFn(peekSubcontractorInvite);
  const accept = useServerFn(acceptSubcontractorInvite);
  const sendCode = useServerFn(sendSubcontractorLoginCode);
  const [busy, setBusy] = useState(false);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setSignedIn(!!data.user));
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["subcontractor-invite", token],
    queryFn: () => peek({ data: { token } }),
    retry: false,
  });

  async function activate() {
    if (!data?.valid) return;
    setBusy(true);
    try {
      if (signedIn) {
        await accept({ data: { token } });
        toast.success("Accès activé.");
        navigate({ to: "/sous-traitant" });
      } else {
        await sendCode({ data: { email: data.email! } });
        navigate({ to: "/sous-traitant/verify", search: { email: data.email!, invite: token } });
      }
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message ?? "Activation impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SubcontractorShell requireAuth={false}>
      <Card className="p-5 sm:p-7">
        {isLoading || signedIn === null ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !data?.valid ? (
          <>
            <h1 className="font-display text-2xl font-bold tracking-tight">Invitation indisponible</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {data?.reason === "expired"
                ? "Cette invitation a expiré."
                : data?.reason === "used"
                  ? "Cette invitation a déjà été utilisée."
                  : "Cette invitation n'est plus valable."}{" "}
              Demandez une nouvelle invitation à l'entreprise concernée.
            </p>
          </>
        ) : (
          <>
            <h1 className="font-display text-2xl font-bold tracking-tight">
              {data.companyName} vous invite comme sous-traitant
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Vous accéderez uniquement aux chantiers et interventions qui vous sont affectés, avec les
              autorisations définies par l'entreprise.
            </p>
            <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              Invitation nominative pour {data.email}
            </p>
            <Button className="mt-5 h-11 w-full" onClick={activate} disabled={busy}>
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  Activer mon accès
                  <ArrowRight className="ml-1 h-4 w-4" aria-hidden="true" />
                </>
              )}
            </Button>
          </>
        )}
      </Card>
    </SubcontractorShell>
  );
}
