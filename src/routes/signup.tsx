import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Loader2, Check } from "lucide-react";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/signup")({
  component: SignupPage,
  head: () => ({ meta: [{ title: "Inscription — PVIA" }] }),
});

function SignupPage() {
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/dashboard`,
        data: { full_name: fullName, company_name: company },
      },
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Compte créé. Vérifiez vos emails pour confirmer.");
    navigate({ to: "/login" });
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden bg-brand-gradient p-12 text-primary-foreground lg:flex lg:flex-col lg:justify-between">
        <Link to="/" aria-label="PVIA"><BrandLogo variant="mono" /></Link>
        <div>
          <h2 className="font-display text-4xl font-bold leading-tight tracking-tight">
            Essayez PVIA gratuitement
          </h2>
          <ul className="mt-8 space-y-3 text-primary-foreground/90">
            {["14 jours d'essai, sans carte bancaire", "Création illimitée de PV de réception", "Signature électronique conforme eIDAS", "Génération PDF automatique & horodatage"].map((t) => (
              <li key={t} className="flex items-start gap-2.5 text-sm">
                <span className="mt-0.5 grid h-5 w-5 place-items-center rounded-full bg-primary-foreground/15"><Check className="h-3 w-3" /></span>
                {t}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-primary-foreground/70">© 2026 PVIA — Réception de travaux intelligente</p>
      </div>

      <div className="flex items-center justify-center p-6 sm:p-12">
        <Card className="w-full max-w-md border-border/60 p-8 shadow-brand">
          <div className="mb-6 flex lg:hidden"><BrandLogo /></div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Créer un compte</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">Démarrez en moins de 2 minutes</p>
          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="name">Nom complet</Label>
                <Input id="name" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="company">Entreprise</Label>
                <Input id="company" required value={company} onChange={(e) => setCompany(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email pro</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Mot de passe</Label>
              <Input id="password" type="password" minLength={6} required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Créer mon compte
            </Button>
          </form>
          <p className="mt-6 text-center text-sm text-muted-foreground">
            Déjà inscrit ?{" "}
            <Link to="/login" className="font-medium text-primary hover:underline">
              Se connecter
            </Link>
          </p>
        </Card>
      </div>
    </div>
  );
}
