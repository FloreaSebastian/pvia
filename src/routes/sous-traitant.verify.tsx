import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { supabase } from "@/integrations/supabase/client";
import { SubcontractorShell } from "@/components/subcontractor/SubcontractorShell";
import {
  sendSubcontractorLoginCode,
  verifySubcontractorLoginCode,
  acceptSubcontractorInvite,
} from "@/lib/subcontractor-auth.functions";

const searchSchema = z.object({
  email: z.string().email().optional(),
  invite: z.string().max(200).optional(),
});

export const Route = createFileRoute("/sous-traitant/verify")({
  validateSearch: (s) => searchSchema.parse(s),
  component: SubcontractorVerify,
  head: () => ({
    meta: [
      { title: "Vérification du code — Espace sous-traitant PVIA" },
      {
        name: "description",
        content: "Saisissez le code à 6 chiffres reçu par email pour accéder à votre espace sous-traitant PVIA.",
      },
      { property: "og:title", content: "Vérification du code — Espace sous-traitant PVIA" },
      { property: "og:description", content: "Connexion sécurisée par code à usage unique." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function SubcontractorVerify() {
  const { email = "", invite } = Route.useSearch();
  const navigate = useNavigate();
  const verifyCode = useServerFn(verifySubcontractorLoginCode);
  const resend = useServerFn(sendSubcontractorLoginCode);
  const accept = useServerFn(acceptSubcontractorInvite);

  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(60);
  const submitted = useRef(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    if (code.length === 6 && !submitted.current && !loading) {
      submitted.current = true;
      void submit(code);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, loading]);

  async function submit(value: string) {
    if (!email) {
      navigate({ to: "/login", search: { type: "subcontractor" } });
      return;
    }
    setLoading(true);
    try {
      const res = await verifyCode({ data: { email, code: value } });
      const { error } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: res.tokenHash! });
      if (error) throw new Error("Session impossible à créer. Demandez un nouveau code.");
      if (invite) {
        await accept({ data: { token: invite } });
        toast.success("Accès activé.");
      } else {
        toast.success("Connexion réussie.");
      }
      navigate({ to: "/sous-traitant" });
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message ?? "Code invalide.");
      setCode("");
      submitted.current = false;
    } finally {
      setLoading(false);
    }
  }

  return (
    <SubcontractorShell requireAuth={false}>
      <Link
        to="/login"
        search={{ type: "subcontractor" as const }}
        className="mb-3 inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Retour
      </Link>

      <Card className="p-5 sm:p-7">
        <h1 className="font-display text-2xl font-bold tracking-tight">Vérification</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Code à 6 chiffres envoyé à <span className="font-medium text-foreground">{email}</span>.
        </p>

        <div className="mt-6">
          <Label htmlFor="sc-otp" className="sr-only">
            Code à 6 chiffres
          </Label>
          <InputOTP id="sc-otp" maxLength={6} value={code} onChange={setCode} disabled={loading}>
            <InputOTPGroup className="w-full justify-between gap-1.5">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <InputOTPSlot key={i} index={i} className="h-12 w-full text-lg" />
              ))}
            </InputOTPGroup>
          </InputOTP>
        </div>

        {loading ? (
          <p className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Connexion en cours…
          </p>
        ) : null}

        <Button
          variant="ghost"
          className="mt-4 h-11 w-full"
          disabled={cooldown > 0 || !email}
          onClick={async () => {
            try {
              await resend({ data: { email } });
              toast.success("Nouveau code envoyé.");
              setCooldown(60);
              setCode("");
              submitted.current = false;
            } catch {
              toast.error("Veuillez patienter avant de redemander un code.");
            }
          }}
        >
          <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />
          {cooldown > 0 ? `Renvoyer le code (${cooldown}s)` : "Renvoyer le code"}
        </Button>
      </Card>
    </SubcontractorShell>
  );
}
