// Présentation de la page d'invitation (sans accès réseau) : utilisée par la
// route /invite/$token et contrôlable par des données factices pour la QA.
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  RotateCcw,
  MailCheck,
  UserRound,
  KeyRound,
} from "lucide-react";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RoleBadge } from "@/components/app/RoleBadge";
import { ROLE_PROFILES, asKnownRole } from "@/lib/role-access";
import { INVITE_PASSWORD_MIN } from "@/lib/invite-core";

export type InviteDetails = {
  email: string;
  role: string;
  companyName: string;
  expiresAt: string | null;
};

/** État de la session vis-à-vis d'une invitation valide. */
export type InviteSessionState =
  | { kind: "anonymous" }
  | { kind: "signup_done" }
  | { kind: "checking" }
  | { kind: "accepting" }
  | { kind: "accept_error"; message: string }
  | { kind: "need_proof" }
  | { kind: "wrong_recipient"; sessionEmail: string };

export type InviteViewState =
  | { kind: "loading" }
  | { kind: "load_error" }
  | { kind: "invalid"; reason?: "used" | "expired" | "wrong_recipient" }
  | { kind: "valid"; invite: InviteDetails; session: InviteSessionState };

export type InviteViewProps = {
  token: string;
  state: InviteViewState;
  onRetryLoad: () => void;
  onRetryAccept: () => void;
  onSwitchAccount: () => void;
  signup: {
    fullName: string;
    password: string;
    busy: boolean;
    onFullName: (v: string) => void;
    onPassword: (v: string) => void;
    onSubmit: (e: React.FormEvent) => void;
  };
};

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-muted/30 px-4 py-8">
      <Card className="w-full min-w-0 max-w-md border-border/60 p-6 sm:p-8">{children}</Card>
    </div>
  );
}

function CodeLink({ token, label }: { token: string; label: string }) {
  return (
    <Button asChild className="h-auto min-h-11 w-full whitespace-normal py-2 text-center">
      <Link to="/login" search={{ invite: token }}>
        <KeyRound className="h-4 w-4" aria-hidden /> {label}
      </Link>
    </Button>
  );
}

export function InviteView(props: InviteViewProps) {
  const { state, token } = props;

  if (state.kind === "load_error") {
    return (
      <Shell>
        <div role="alert" className="text-center">
          <XCircle className="mx-auto h-10 w-10 text-destructive" aria-hidden />
          <h1 className="mt-3 text-lg font-semibold">Invitation impossible à charger</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Vérifiez votre connexion puis réessayez.
          </p>
          <Button className="mt-4 h-11 w-full" onClick={props.onRetryLoad}>
            <RotateCcw className="h-4 w-4" aria-hidden /> Réessayer
          </Button>
        </div>
      </Shell>
    );
  }

  if (state.kind === "loading") {
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

  if (state.kind === "invalid") {
    return (
      <Shell>
        <div className="text-center">
          <XCircle className="mx-auto h-10 w-10 text-destructive" aria-hidden />
          <h1 className="mt-3 text-lg font-semibold">
            {state.reason === "expired"
              ? "Invitation expirée"
              : state.reason === "used"
                ? "Invitation déjà utilisée"
                : "Invitation invalide"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {state.reason === "expired"
              ? "Ce lien n'est plus valable. Demandez un nouveau lien à l'administrateur de l'entreprise."
              : state.reason === "used"
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

  const { invite, session } = state;
  const role = asKnownRole(invite.role);
  const profile = role ? ROLE_PROFILES[role] : null;
  const s = props.signup;

  return (
    <Shell>
      <BrandLogo variant="compact" />
      <h1 className="mt-4 break-words font-display text-2xl font-bold tracking-tight [overflow-wrap:anywhere]">
        Rejoindre <span className="text-primary">{invite.companyName}</span>
      </h1>
      <p className="mt-1.5 break-words text-sm text-muted-foreground [overflow-wrap:anywhere]">
        Invitation pour <strong className="text-foreground">{invite.email}</strong>
        {invite.expiresAt && (
          <> · valable jusqu'au {new Date(invite.expiresAt).toLocaleDateString("fr-FR")}</>
        )}
      </p>

      <div className="mt-4 rounded-lg border border-border bg-muted/40 p-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">Votre rôle :</span>
          <RoleBadge role={invite.role} long />
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

      {(session.kind === "checking" || session.kind === "accepting") && (
        <p className="mt-6 flex items-center gap-2 text-sm" role="status" aria-live="polite">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {session.kind === "checking" ? "Vérification de votre session…" : "Rattachement à l'entreprise…"}
        </p>
      )}

      {session.kind === "accept_error" && (
        <div className="mt-6 space-y-3">
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
          >
            {session.message}
          </p>
          <Button className="h-11 w-full" onClick={props.onRetryAccept}>
            <RotateCcw className="h-4 w-4" aria-hidden /> Réessayer
          </Button>
        </div>
      )}

      {session.kind === "need_proof" && (
        <div className="mt-6 space-y-3 text-sm">
          <p className="rounded-md border border-border bg-muted/40 p-3">
            Vous êtes connecté avec la bonne adresse, mais pour rejoindre l'entreprise nous devons
            vérifier que vous la recevez : demandez un code à 6 chiffres envoyé à{" "}
            <strong className="break-words [overflow-wrap:anywhere]">{invite.email}</strong>. Une
            connexion par mot de passe ne suffit pas pour accepter une invitation.
          </p>
          <CodeLink token={token} label="Recevoir un code" />
        </div>
      )}

      {session.kind === "wrong_recipient" && (
        <div role="alert" className="mt-6 space-y-3 text-sm">
          <p className="break-words rounded-md border border-warning/50 bg-warning/10 p-3 [overflow-wrap:anywhere]">
            Vous êtes connecté avec <strong>{session.sessionEmail || "un autre compte"}</strong>,
            mais cette invitation est destinée à <strong>{invite.email}</strong>.
          </p>
          <Button className="h-11 w-full" onClick={props.onSwitchAccount}>
            <UserRound className="h-4 w-4" aria-hidden /> Se connecter avec le bon compte
          </Button>
        </div>
      )}

      {session.kind === "signup_done" && (
        <div className="mt-6 space-y-3 text-sm" aria-live="polite">
          <p className="flex items-center gap-2 font-medium">
            <MailCheck className="h-4 w-4 text-success" aria-hidden /> Compte créé
          </p>
          <p className="text-muted-foreground">
            Pour rejoindre l'entreprise, confirmez votre adresse {invite.email} avec un code reçu
            par email. Si un lien de confirmation vous a aussi été envoyé, vous pouvez l'ignorer.
          </p>
          <CodeLink token={token} label="Recevoir un code" />
        </div>
      )}

      {session.kind === "anonymous" && (
        <div className="mt-6 space-y-5">
          <CodeLink token={token} label="J'ai déjà un compte : recevoir un code" />
          <div className="relative text-center text-xs text-muted-foreground">
            <span className="bg-card px-2">ou créer un compte</span>
          </div>
          <form onSubmit={s.onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="inv-name">Nom complet</Label>
              <Input
                id="inv-name"
                className="h-11"
                required
                autoComplete="name"
                value={s.fullName}
                onChange={(e) => s.onFullName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-email">Email</Label>
              <Input id="inv-email" className="h-11" value={invite.email} disabled />
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
                aria-describedby="inv-pwd-help"
                value={s.password}
                onChange={(e) => s.onPassword(e.target.value)}
              />
              <p id="inv-pwd-help" className="text-xs text-muted-foreground">
                {INVITE_PASSWORD_MIN} caractères minimum. Un code email vous sera ensuite demandé
                pour rejoindre l'entreprise.
              </p>
            </div>
            <Button type="submit" className="h-11 w-full" disabled={s.busy}>
              {s.busy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <CheckCircle2 className="h-4 w-4" aria-hidden />
              )}
              Créer mon compte
            </Button>
          </form>
        </div>
      )}
    </Shell>
  );
}
