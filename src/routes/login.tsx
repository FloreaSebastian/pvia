import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Loader2, Mail, KeyRound } from "lucide-react";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AuthShell } from "@/components/auth/AuthShell";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { sendEnterpriseLoginCode } from "@/lib/enterprise-auth.functions";
import { logUserAuthEvent } from "@/lib/user-auth.functions";
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
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSendCode(e: React.FormEvent) {
    e.preventDefault();
    const normalized = email.trim().toLowerCase();
    if (!normalized) return;
    setLoading(true);
    try {
      await sendLoginCode({ data: { email: normalized } });
      await logEvent({ data: { action: "user.login_code_sent", email: normalized } }).catch(() => {});
      toast.success("Code envoyé. Vérifiez votre boîte mail.");
      navigate({ to: "/verify", search: { email: normalized } });
    } catch (err: any) {
      toast.error(err?.message ?? "Impossible d'envoyer le code.");
    } finally {
      setLoading(false);
    }
  }

  async function onPassword(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      await logEvent({ data: { action: "user.login_failed", email, metadata: { method: "password" } } }).catch(() => {});
      toast.error(error.message);
      return;
    }
    await logEvent({ data: { action: "user.login_success", email, metadata: { method: "password" } } }).catch(() => {});
    toast.success("Connexion réussie");
    const { data: { user } } = await supabase.auth.getUser();
    let isAdmin = false;
    if (user) {
      const { isPlatformAdminEmail } = await import("@/lib/platform-admin");
      if (isPlatformAdminEmail(user.email)) {
        const { data: role } = await supabase.from("user_roles").select("role").eq("user_id", user.id).in("role", ["platform_admin","admin"]).limit(1).maybeSingle();
        isAdmin = !!role;
      }
    }
    navigate({ to: isAdmin ? "/admin/dashboard" : "/dashboard" });
  }


  return (
    <AuthShell
      brandHeading={<>Connexion sans mot de passe.<br />Simple, rapide, sécurisée.</>}
      brandSubtitle="Recevez un code à 8 chiffres par email. Plus de mot de passe oublié, plus de friction."
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
          Accédez à votre espace professionnel
        </p>

        <Tabs defaultValue="otp" className="mt-6">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="otp" className="gap-2"><Mail className="h-4 w-4" />Code email</TabsTrigger>
            <TabsTrigger value="password" className="gap-2"><KeyRound className="h-4 w-4" />Mot de passe</TabsTrigger>
          </TabsList>

          <TabsContent value="otp" className="mt-4">
            <form onSubmit={onSendCode} className="space-y-4">
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
                Un code à 8 chiffres valide 10 minutes vous sera envoyé.
              </p>
            </form>
          </TabsContent>

          <TabsContent value="password" className="mt-4">
            <form onSubmit={onPassword} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="vous@entreprise.fr" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Mot de passe</Label>
                <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <Button type="submit" className="h-11 w-full shadow-brand" disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                Se connecter
              </Button>
            </form>
          </TabsContent>
        </Tabs>

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
