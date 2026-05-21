import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { AuthShell } from "@/components/auth/AuthShell";
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
    <AuthShell
      brandHeading={<>Essayez PVIA<br />gratuitement.</>}
      brandSubtitle="14 jours d'essai complet. Sans carte bancaire. Sans engagement."
      bullets={[
        "Création illimitée de PV de réception",
        "Signature électronique conforme eIDAS",
        "Génération PDF automatique & horodatage",
        "Support FR 7j/7 inclus",
      ]}
      quote={{
        text: "Adoption immédiate par toute l'équipe terrain. Aucune formation nécessaire.",
        author: "Sandra K.",
        role: "Directrice — BTP Aurélien",
      }}
    >
      <Card className="border-border/60 p-8 shadow-brand">
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
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="vous@entreprise.fr" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Mot de passe</Label>
            <Input id="password" type="password" minLength={6} required value={password} onChange={(e) => setPassword(e.target.value)} />
            <p className="text-xs text-muted-foreground">Minimum 6 caractères.</p>
          </div>
          <Button type="submit" className="h-11 w-full shadow-brand" disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Créer mon compte
          </Button>
          <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
            En créant un compte, vous acceptez nos{" "}
            <Link to="/cgv" className="underline hover:text-foreground">CGV</Link> et notre{" "}
            <Link to="/confidentialite" className="underline hover:text-foreground">politique de confidentialité</Link>.
          </p>
        </form>
        <p className="mt-6 border-t border-border pt-6 text-center text-sm text-muted-foreground">
          Déjà inscrit ?{" "}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Se connecter
          </Link>
        </p>
      </Card>
    </AuthShell>
  );
}
