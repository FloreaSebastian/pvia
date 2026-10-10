import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, CheckCircle2, XCircle, RotateCcw, MailCheck, UserRound } from "lucide-react";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  getInviteByToken,
  acceptInviteForCurrentUser,
  signUpWithInvite,
} from "@/lib/invites.functions";
import { INVITE_PASSWORD_MIN, INVITE_TOKEN_RE, normalizeInviteEmail } from "@/lib/invite-core";
import { ROLE_PROFILES, asKnownRole } from "@/lib/role-access";
import { RoleBadge } from "@/components/app/RoleBadge";
import { toast } from "sonner";

export const Route = createFileRoute("/invite/$token")({
  component: InvitePage,
  head: () => ({
    meta: [
      { title: "Rejoindre une entreprise — PVIA" },
      {
        name: "description",
        content: "Acceptez votre invitation pour rejoindre l'espace de votre entreprise sur PVIA.",
      },
      { property: "og:title", content: "Rejoindre une entreprise — PVIA" },
      { property: "og:description", content: "Invitation à rejoindre un espace entreprise PVIA." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

type InviteInfo =
  | {
      valid: true;
      email: string;
      role: string;
      roleLabel: string;
      companyName: string;
      expiresAt: string | null;
    }
  | { valid: false; reason?: "used" | "expired" | "wrong_recipient" };

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-muted/30 px-4 py-8">
      <Card className="w-full max-w-md min-w-0 border-border/60 p-6 sm:p-8">{children}</Card>
    </div>
  );
}

function InvitePage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const getInvite = useServerFn(getInviteByToken);
  const accept = useServerFn(acceptInviteForCurrentUser);
  const signUp = useServerFn(signUpWithInvite);
  const validToken = INVITE_TOKEN_RE.test(token);

  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [signupDone, setSignupDone] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const acceptingRef = useRef(false);

  const load = useCallback(() => {
    if (!validToken) {
      setInfo({ valid: false });
      return;
    }
    setLoadError(false);
    setInfo(null);
    getInvite({ data: { token } })
      .then((r) => setInfo(r as InviteInfo))
      .catch(() => setLoadError(true));
  }, [token, getInvite, validToken]);

  useEffect(() => {
    load();
  }, [load]);

  const sessionEmail = normalizeInviteEmail(user?.email);
  const sameRecipient = !!info && info.valid && !!user && sessionEmail === info.email;
  const wrongRecipient = !!info && info.valid && !!user && sessionEmail !== info.email;

  const runAccept = useCallback(async () => {
    if (acceptingRef.current || !info || !info.valid) return;
    acceptingRef.current = true;
    setAcceptError(null);
    try {
      await accept({ data: { token } });
      toast.success(`Bienvenue dans ${info.companyName} !`);
      navigate({ to: "/dashboard" });
    } catch (e) {
      setAcceptError((e as Error)?.message || "Impossible d'accepter l'invitation.");
      acceptingRef.current = false;
    }
  }, [accept, info, navigate, token]);

  useEffect(() => {
    if (!authLoading && sameRecipient) void runAccept();
  }, [authLoading, sameRecipient, runAccept]);

  if (loadError) {
    return (
      <Shell>
        <div role="alert" className="text-center">
          <XCircle className="mx-auto h-10 w-10 text-destructive" aria-hidden />
          <h1 className="mt-3 text-lg font-semibold">Invitation impossible à charger</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Vérifiez votre connexion puis réessayez.
          </p>
          <Button className="mt-4 h-11 w-full" onClick={load}>
            <RotateCcw className="h-4 w-4" aria-hidden /> Réessayer
          </Button>
        </div>
      </Shell>
    );
  }

  if (!info || authLoading) {
    return (
      <div
        className="grid min-h-screen place-items-center"
        role="status"
        aria-label="Chargement de l'invitation"
      >
        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden />
      </div>
    );
  }

  if (!info.valid) {
    return (
      <Shell>
        <div className="text-center">
          <XCircle className="mx-auto h-10 w-10 text-destructive" aria-hidden />
          <h1 className="mt-3 text-lg font-semibold">
            {info.reason === "expired"
              ? "Invitation expirée"
              : info.reason === "used"
                ? "Invitation déjà utilisée"
                : "Invitation invalide"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {info.reason === "expired"
              ? "Ce lien n'est plus valable. Demandez un nouveau lien à l'administrateur de l'entreprise."
              : info.reason === "used"
                ? "Cette invitation a déjà été acceptée ou remplacée par un lien plus récent."
                : "Ce lien d'invitation est introuvable ou a été annulé."}
          </p>
          <Button asChild className="mt-4 h-11 w-full">
            <Link to="/login">Se connecter</Link>
          </Button>
        </div>
      </Shell>
    );
  }

  const role = asKnownRole(info.role);
  const profile = role ? ROLE_PROFILES[role] : null;

  async function onSignup(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (password.length < INVITE_PASSWORD_MIN)
      return toast.error(`Mot de passe : ${INVITE_PASSWORD_MIN} caractères minimum.`);
    setBusy(true);
    try {
      await signUp({ data: { token, fullName, password } });
      setSignupDone(true);
    } catch (err) {
      toast.error((err as Error)?.message || "Création du compte impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <BrandLogo variant="compact" />
      <h1 className="mt-4 break-words font-display text-2xl font-bold tracking-tight [overflow-wrap:anywhere]">
        Rejoindre <span className="text-primary">{info.companyName}</span>
      </h1>
      <p className="mt-1.5 break-words text-sm text-muted-foreground [overflow-wrap:anywhere]">
        Invitation pour <strong className="text-foreground">{info.email}</strong>
        {info.expiresAt && (
          <> · valable jusqu'au {new Date(info.expiresAt).toLocaleDateString("fr-FR")}</>
        )}
      </p>

      <div className="mt-4 rounded-lg border border-border bg-muted/40 p-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">Votre rôle :</span>
          <RoleBadge role={info.role} long />
        </div>
        {profile && (
          <ul className="mt-2 space-y-0.5">
            {profile.can.map((t) => (
              <li key={t}>
                <span aria-hidden>✓ </span>
                {t}
              </li>
            ))}
          </ul>
        )}
      </div>

      {sameRecipient && (
        <div className="mt-6 space-y-3" aria-live="polite">
          {acceptError ? (
            <>
              <p
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
              >
                {acceptError}
              </p>
              <Button className="h-11 w-full" onClick={runAccept}>
                <RotateCcw className="h-4 w-4" aria-hidden /> Réessayer
              </Button>
            </>
          ) : (
            <p className="flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Rattachement à l'entreprise…
            </p>
          )}
        </div>
      )}

      {wrongRecipient && (
        <div role="alert" className="mt-6 space-y-3 text-sm">
          <p className="break-words rounded-md border border-warning/50 bg-warning/10 p-3 [overflow-wrap:anywhere]">
            Vous êtes connecté avec <strong>{sessionEmail || "un autre compte"}</strong>, mais cette
            invitation est destinée à <strong>{info.email}</strong>.
          </p>
          <Button
            className="h-11 w-full"
            onClick={async () => {
              await supabase.auth.signOut();
              navigate({ to: "/login", search: { invite: token } });
            }}
          >
            <UserRound className="h-4 w-4" aria-hidden /> Se connecter avec le bon compte
          </Button>
        </div>
      )}

      {!user &&
        (signupDone ? (
          <div className="mt-6 space-y-2 text-sm" aria-live="polite">
            <p className="flex items-center gap-2 font-medium">
              <MailCheck className="h-4 w-4 text-success" aria-hidden /> Vérifiez votre boîte mail
            </p>
            <p className="text-muted-foreground">
              Ouvrez le lien de confirmation envoyé à {info.email}. Vous reviendrez ici pour
              finaliser votre arrivée.
            </p>
          </div>
        ) : (
          <div className="mt-6 space-y-5">
            <Button asChild variant="outline" className="h-11 w-full">
              <Link to="/login" search={{ invite: token }}>
                J'ai déjà un compte : recevoir un code
              </Link>
            </Button>
            <div className="relative text-center text-xs text-muted-foreground">
              <span className="bg-card px-2">ou créer un compte</span>
            </div>
            <form onSubmit={onSignup} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="inv-name">Nom complet</Label>
                <Input
                  id="inv-name"
                  className="h-11"
                  required
                  autoComplete="name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="inv-email">Email</Label>
                <Input id="inv-email" className="h-11" value={info.email} disabled />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="inv-pwd">Mot de passe</Label>
                <Input
                  id="inv-pwd"
                  className="h-11"
                  type="password"
                  autoComplete="new-password"
                  minLength={INVITE_PASSWORD_MIN}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {INVITE_PASSWORD_MIN} caractères minimum.
                </p>
              </div>
              <Button type="submit" className="h-11 w-full" disabled={busy}>
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <CheckCircle2 className="h-4 w-4" aria-hidden />
                )}
                Créer mon compte
              </Button>
            </form>
          </div>
        ))}
    </Shell>
  );
}
