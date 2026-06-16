import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { motion } from "motion/react";
import { ArrowRight, Loader2, ShieldCheck } from "lucide-react";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { sendClientLoginCode } from "@/lib/client-auth.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/client/login")({
  component: ClientLogin,
  head: () => ({
    meta: [
      { title: "Espace client — Connexion sécurisée | PVIA" },
      {
        name: "description",
        content:
          "Accédez à vos procès-verbaux PVIA sans mot de passe. Recevez un code à 6 chiffres par email.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function ClientLogin() {
  const navigate = useNavigate();
  const sendCode = useServerFn(sendClientLoginCode);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    const NEUTRAL = "Si un accès existe pour cet email, un code vient d'être envoyé.";
    const trimmed = email.trim();
    try {
      await sendCode({ data: { email: trimmed } });
      toast.success(NEUTRAL);
      navigate({ to: "/client/verify", search: { email: trimmed } });
    } catch (err: any) {
      const msg = String(err?.message ?? "");
      if (/rate|limit|trop|patient|429|too many/i.test(msg)) {
        toast.error("Veuillez patienter avant de redemander un code.");
      } else {
        // Anti-énumération : on n'expose pas la cause, on garde le message neutre
        // et on redirige tout de même vers la page de vérification.
        toast.success(NEUTRAL);
        navigate({ to: "/client/verify", search: { email: trimmed } });
      }
    } finally {
      setLoading(false);
    }
  }


  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden bg-brand-gradient p-12 text-primary-foreground lg:flex lg:flex-col lg:justify-between">
        <Link to="/" aria-label="PVIA"><BrandLogo variant="mono" /></Link>
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="space-y-6"
        >
          <h1 className="font-display text-4xl font-bold leading-tight tracking-tight">
            Vos procès-verbaux,<br />à portée d'email.
          </h1>
          <p className="max-w-md text-base text-primary-foreground/85">
            Consultez et signez vos PV en quelques secondes — sans créer de compte, sans mot de passe.
          </p>
          <ul className="space-y-2 text-sm text-primary-foreground/80">
            <li className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Connexion par code à usage unique</li>
            <li className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Aucun mot de passe à retenir</li>
            <li className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Vos données restent privées</li>
          </ul>
        </motion.div>
        <p className="text-xs text-primary-foreground/70">© 2026 PVIA — Réception de travaux intelligente</p>
      </div>

      <div className="flex items-center justify-center bg-background px-6 py-12 sm:px-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex lg:hidden"><BrandLogo /></div>
          <h2 className="font-display text-3xl font-bold tracking-tight">Espace client</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Entrez votre email. Nous vous enverrons un code à 6 chiffres pour vous connecter.
          </p>

          <Card className="mt-6 border-border/60 p-5 shadow-brand">
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Adresse email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  required
                  placeholder="vous@exemple.fr"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading || !email}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                  <>Recevoir un code <ArrowRight className="ml-1 h-4 w-4" /></>
                )}
              </Button>
            </form>
          </Card>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            Vous êtes une entreprise du BTP ?{" "}
            <Link to="/login" className="font-medium text-primary hover:underline">
              Espace professionnel
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
