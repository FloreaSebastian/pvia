import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { AuthShell } from "@/components/auth/AuthShell";
import { useServerFn } from "@tanstack/react-start";
import { sendEnterpriseLoginCode } from "@/lib/enterprise-auth.functions";
import { logUserAuthEvent } from "@/lib/user-auth.functions";
import { setRememberMePreference, getRememberMePreference } from "@/lib/remember-me";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  component: LoginPage,
  head: () => ({
    meta: [
      { title: "Connexion — PVIA" },
      {
        name: "description",
        content:
          "Connectez-vous à votre compte PVIA pour créer, signer et archiver vos procès-verbaux de réception de travaux en toute sécurité.",
      },
      { property: "og:title", content: "Connexion à votre espace PVIA" },
      {
        property: "og:description",
        content:
          "Accédez à vos chantiers, PV et signatures électroniques depuis votre espace PVIA sécurisé.",
      },
      { property: "og:url", content: "https://pvia.fr/login" },
    ],
    links: [{ rel: "canonical", href: "https://pvia.fr/login" }],
  }),
});

function LoginPage() {
  const navigate = useNavigate();
  const logEvent = useServerFn(logUserAuthEvent);
  const sendLoginCode = useServerFn(sendEnterpriseLoginCode);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [remember, setRemember] = useState(() => getRememberMePreference());

  async function onSendCode(e: React.FormEvent) {
    e.preventDefault();
    const normalized = email.trim().toLowerCase();
    if (!normalized) return;
    setLoading(true);
    const NEUTRAL = "Si un compte existe, un code de connexion a été envoyé.";
    try {
      await sendLoginCode({ data: { email: normalized } });
      await logEvent({ data: { action: "user.login_code_sent", email: normalized } }).catch(() => {});
      toast.success(NEUTRAL);
      navigate({ to: "/verify", search: { email: normalized } });
    } catch (err: any) {
      const msg = String(err?.message ?? "");
      if (/rate|limit|trop|patient|429|too many/i.test(msg)) {
        toast.error("Veuillez patienter avant de redemander un code.");
      } else {
        toast.success(NEUTRAL);
        navigate({ to: "/verify", search: { email: normalized } });
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      brandHeading={<>Connexion sans mot de passe.<br />Simple, rapide, sécurisée.</>}
      brandSubtitle="Recevez un code à 6 chiffres par email. Plus de mot de passe oublié, plus de friction."
      bullets={[
        "Authentification chiffrée bout-en-bout",
        "Conforme RGPD · hébergement EU",
        "SSO Google disponible sur les plans Pro",
      ]}
    >
      <Card className="border-border/60 p-8 shadow-brand">
        <div className="mb-6 flex lg:hidden"><BrandLogo /></div>
        <h1 className="font-display text-3xl font-bold tracking-tight">Connexion</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Recevez un code de connexion sécurisé par email.
        </p>

        <form onSubmit={onSendCode} className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email-otp">Email professionnel</Label>
            <Input
              id="email-otp"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="vous@entreprise.fr"
            />
          </div>
          <Button type="submit" className="h-11 w-full shadow-brand" disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Recevoir mon code
          </Button>
          <p className="text-xs text-muted-foreground">
            Un code à 6 chiffres valide 10 minutes vous sera envoyé.
          </p>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Pas encore de compte ?{" "}
          <Link to="/signup" className="font-medium text-primary hover:underline">
            Créer un compte
          </Link>
        </p>
      </Card>
    </AuthShell>
  );
}
