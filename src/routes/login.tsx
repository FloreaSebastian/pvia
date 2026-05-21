import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { FileSignature, Loader2, Mail, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { logUserAuthEvent } from "@/lib/user-auth.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  component: LoginPage,
  head: () => ({ meta: [{ title: "Connexion — PVIA" }] }),
});

function LoginPage() {
  const navigate = useNavigate();
  const logEvent = useServerFn(logUserAuthEvent);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSendCode(e: React.FormEvent) {
    e.preventDefault();
    const normalized = email.trim().toLowerCase();
    if (!normalized) return;
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: normalized,
      options: { shouldCreateUser: false },
    });
    setLoading(false);
    if (error) {
      toast.error(
        error.message.includes("not found") || error.message.includes("Signups")
          ? "Aucun compte associé à cet email."
          : error.message,
      );
      return;
    }
    await logEvent({ data: { action: "user.login_code_sent", email: normalized } }).catch(() => {});
    toast.success("Code envoyé. Vérifiez votre boîte mail.");
    navigate({ to: "/verify", search: { email: normalized } });
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
    navigate({ to: "/dashboard" });
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden bg-gradient-to-br from-primary to-primary/70 p-12 text-primary-foreground lg:flex lg:flex-col lg:justify-between">
        <Link to="/" className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary-foreground/15">
            <FileSignature className="h-5 w-5" />
          </div>
          <span className="font-semibold">PVIA</span>
        </Link>
        <div>
          <h2 className="text-3xl font-semibold leading-tight">
            Connexion sans mot de passe.<br />Simple, rapide, sécurisée.
          </h2>
          <p className="mt-4 text-primary-foreground/80">
            Recevez un code à 6 chiffres par email. Plus de mot de passe à retenir.
          </p>
        </div>
        <p className="text-sm text-primary-foreground/70">© 2026 PVIA</p>
      </div>

      <div className="flex items-center justify-center p-6 sm:p-12">
        <Card className="w-full max-w-md p-8">
          <h1 className="text-2xl font-semibold tracking-tight">Connexion</h1>
          <p className="mt-1 text-sm text-muted-foreground">
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
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                  Recevoir mon code
                </Button>
                <p className="text-xs text-muted-foreground">
                  Un code à 6 chiffres valide 10 minutes vous sera envoyé.
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
                <Button type="submit" className="w-full" disabled={loading}>
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
      </div>
    </div>
  );
}
