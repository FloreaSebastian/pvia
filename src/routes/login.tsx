import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { ArrowRight, Building2, Loader2, ShieldCheck, UserRound } from "lucide-react";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { AuthShell } from "@/components/auth/AuthShell";
import { useServerFn } from "@tanstack/react-start";
import { sendEnterpriseLoginCode } from "@/lib/enterprise-auth.functions";
import { sendClientLoginCode, getClientSession } from "@/lib/client-auth.functions";
import { logUserAuthEvent } from "@/lib/user-auth.functions";
import { setRememberMePreference, getRememberMePreference } from "@/lib/remember-me";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";

/**
 * Le sélecteur Professionnel / Client est une aide UX : il choisit le
 * PARCOURS d'authentification (OTP entreprise vs OTP client passwordless).
 * Il n'accorde jamais de droit : les permissions restent déterminées
 * côté serveur (RLS, sessions, middlewares).
 */
type AudienceType = "professional" | "client";

const searchSchema = z.object({
  type: z.enum(["professional", "client"]).optional(),
});

export const Route = createFileRoute("/login")({
  validateSearch: (s) => searchSchema.parse(s),
  // Un client déjà connecté est renvoyé vers son espace (cookie HttpOnly lu
  // côté serveur). La session professionnelle vit côté navigateur : elle est
  // traitée dans le composant.
  beforeLoad: async ({ search }) => {
    if (search.type === "client") {
      const session = await getClientSession();
      if (session) throw redirect({ to: "/client/dashboard" });
    }
  },
  component: LoginPage,
  head: () => ({
    meta: [
      { title: "Connexion — Espace professionnel ou client | PVIA" },
      {
        name: "description",
        content:
          "Connectez-vous à PVIA : espace professionnel pour gérer chantiers, PV et réserves, ou espace client pour consulter vos documents.",
      },
      { property: "og:title", content: "Connexion à votre espace PVIA" },
      {
        property: "og:description",
        content:
          "Accédez à votre espace professionnel ou à votre espace client PVIA en toute sécurité, sans mot de passe.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:url", content: "https://pvia.fr/login" },
    ],
    links: [{ rel: "canonical", href: "https://pvia.fr/login" }],
  }),
});

function LoginPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const logEvent = useServerFn(logUserAuthEvent);
  const sendProCode = useServerFn(sendEnterpriseLoginCode);
  const sendClientCode = useServerFn(sendClientLoginCode);

  const [audience, setAudience] = useState<AudienceType>(search.type ?? "professional");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [remember, setRemember] = useState(() => getRememberMePreference());

  // Synchronise l'onglet avec l'URL (?type=client dans un email par exemple).
  useEffect(() => {
    if (search.type && search.type !== audience) setAudience(search.type);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.type]);

  // Session professionnelle déjà active → on renvoie vers l'application.
  useEffect(() => {
    if (!authLoading && user && audience === "professional") {
      navigate({ to: "/dashboard" });
    }
  }, [authLoading, user, audience, navigate]);

  function selectAudience(next: AudienceType) {
    setAudience(next);
    navigate({ to: "/login", search: { type: next }, replace: true });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    const normalized = email.trim().toLowerCase();
    if (!normalized) return;
    setLoading(true);
    setRememberMePreference(remember);

    const NEUTRAL =
      audience === "professional"
        ? "Si un compte existe, un code de connexion a été envoyé."
        : "Si un accès existe pour cet email, un code vient d'être envoyé.";

    const goVerify = () =>
      audience === "professional"
        ? navigate({ to: "/verify", search: { email: normalized } })
        : navigate({ to: "/client/verify", search: { email: normalized } });

    try {
      if (audience === "professional") {
        await sendProCode({ data: { email: normalized } });
        await logEvent({ data: { action: "user.login_code_sent", email: normalized } }).catch(() => {});
      } else {
        await sendClientCode({ data: { email: normalized } });
      }
      toast.success(NEUTRAL);
      goVerify();
    } catch (err: unknown) {
      const msg = String((err as { message?: string })?.message ?? "");
      if (/rate|limit|trop|patient|429|too many/i.test(msg)) {
        toast.error("Veuillez patienter avant de redemander un code.");
      } else {
        // Anti-énumération : message neutre quelle que soit la cause.
        toast.success(NEUTRAL);
        goVerify();
      }
    } finally {
      setLoading(false);
    }
  }

  const isPro = audience === "professional";

  return (
    <AuthShell
      brandHeading={
        isPro ? (
          <>Connexion sans mot de passe.<br />Simple, rapide, sécurisée.</>
        ) : (
          <>Vos documents,<br />à portée d'email.</>
        )
      }
      brandSubtitle={
        isPro
          ? "Recevez un code à 6 chiffres par email. Plus de mot de passe oublié, plus de friction."
          : "Consultez et signez les procès-verbaux transmis par votre professionnel, sans créer de compte."
      }
      bullets={
        isPro
          ? [
              "Authentification chiffrée bout-en-bout",
              "Conforme RGPD · hébergement EU",
              "Séparation stricte des espaces professionnels et clients",
            ]
          : [
              "Connexion par code à usage unique",
              "Aucun mot de passe à retenir",
              "Vous n'accédez qu'à vos propres documents",
            ]
      }
    >
      <Card className="border-border/60 p-6 shadow-brand sm:p-8">
        <div className="mb-6 flex lg:hidden">
          <BrandLogo />
        </div>

        <h1 className="font-display text-3xl font-bold tracking-tight">Bienvenue sur PVIA</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">Connectez-vous à votre espace</p>

        {/* Sélecteur d'espace */}
        <div
          role="tablist"
          aria-label="Choisissez votre espace"
          className="mt-6 grid grid-cols-2 gap-1.5 rounded-xl bg-muted/60 p-1.5"
        >
          {([
            { key: "professional" as const, label: "Professionnel", Icon: Building2 },
            { key: "client" as const, label: "Client", Icon: UserRound },
          ]).map(({ key, label, Icon }) => {
            const active = audience === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                id={`tab-${key}`}
                aria-selected={active}
                aria-controls="auth-panel"
                onClick={() => selectAudience(key)}
                className={`flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  active
                    ? "bg-background text-foreground shadow-sm ring-1 ring-border"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </button>
            );
          })}
        </div>

        <div
          id="auth-panel"
          role="tabpanel"
          aria-labelledby={`tab-${audience}`}
          className="mt-6"
        >
          <h2 className="font-display text-lg font-semibold">
            {isPro ? "Espace professionnel" : "Espace client"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {isPro
              ? "Gérez vos chantiers, procès-verbaux, réserves, visites techniques et votre équipe depuis votre espace PVIA."
              : "Retrouvez les documents et procès-verbaux partagés avec vous par votre professionnel."}
          </p>
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            {isPro
              ? "Pour les entreprises et équipes terrain"
              : "Pour les clients de professionnels utilisant PVIA"}
          </p>

          <form onSubmit={onSubmit} className="mt-5 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="login-email">
                {isPro ? "Email professionnel" : "Adresse email"}
              </Label>
              <Input
                id="login-email"
                name="email"
                type="email"
                required
                autoComplete="email"
                inputMode="email"
                className="h-11 text-base sm:text-sm"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={isPro ? "vous@entreprise.fr" : "votre@email.fr"}
              />
            </div>

            <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-muted-foreground">
              <Checkbox
                className="h-5 w-5"
                checked={remember}
                onCheckedChange={(v) => setRemember(v === true)}
              />
              <span>Se souvenir de moi pendant 30 jours</span>
            </label>

            <Button
              type="submit"
              className="h-11 w-full shadow-brand"
              disabled={loading || !email}
              aria-busy={loading}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  {isPro ? "Recevoir mon code" : "Recevoir mon code"}
                  <ArrowRight className="ml-1 h-4 w-4" aria-hidden="true" />
                </>
              )}
            </Button>
            <p className="sr-only" role="status" aria-live="polite">
              {loading ? "Envoi du code en cours…" : ""}
            </p>
            <p className="text-xs text-muted-foreground">
              Un code à 6 chiffres valide 10 minutes vous sera envoyé.
            </p>
          </form>

          {isPro ? (
            <p className="mt-6 text-center text-sm text-muted-foreground">
              Vous n'avez pas encore de compte ?{" "}
              <Link to="/signup" className="font-medium text-primary hover:underline">
                Créer mon entreprise
              </Link>
            </p>
          ) : (
            <p className="mt-6 text-center text-xs text-muted-foreground">
              Vous n'avez pas reçu d'accès ? Contactez le professionnel qui suit votre chantier.
            </p>
          )}
        </div>
      </Card>
    </AuthShell>
  );
}
