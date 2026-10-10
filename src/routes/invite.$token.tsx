import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  getInviteByToken,
  acceptInviteForCurrentUser,
  getInviteSessionProof,
  signUpWithInvite,
} from "@/lib/invites.functions";
import { INVITE_PASSWORD_MIN, INVITE_TOKEN_RE, normalizeInviteEmail } from "@/lib/invite-core";
import { acceptAndSelectCompany, storeCompanyId } from "@/lib/active-company-storage";
import {
  InviteView,
  type InviteDetails,
  type InviteSessionState,
  type InviteViewState,
} from "@/components/invite/InviteView";
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
  | ({ valid: true; roleLabel: string } & InviteDetails)
  | { valid: false; reason?: "used" | "expired" | "wrong_recipient" };

function InvitePage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const getInvite = useServerFn(getInviteByToken);
  const accept = useServerFn(acceptInviteForCurrentUser);
  const getProof = useServerFn(getInviteSessionProof);
  const signUp = useServerFn(signUpWithInvite);
  const validToken = INVITE_TOKEN_RE.test(token);

  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [signupDone, setSignupDone] = useState(false);
  const [flow, setFlow] = useState<InviteSessionState | null>(null);
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

  const runAccept = useCallback(async () => {
    if (acceptingRef.current || !info || !info.valid) return;
    acceptingRef.current = true;
    setFlow({ kind: "checking" });
    try {
      // Preuve email lue côté serveur depuis les claims vérifiés : pas de
      // tentative d'acceptation (ni de boucle « Réessayer ») sans elle.
      const proof = await getProof();
      if (!proof.emailProof) {
        setFlow({ kind: "need_proof" });
        acceptingRef.current = false;
        return;
      }
      setFlow({ kind: "accepting" });
      await acceptAndSelectCompany(() => accept({ data: { token } }), storeCompanyId);
      toast.success(`Bienvenue dans ${info.companyName} !`);
      navigate({ to: "/dashboard" });
    } catch (e) {
      setFlow({
        kind: "accept_error",
        message: (e as Error)?.message || "Impossible d'accepter l'invitation.",
      });
      acceptingRef.current = false;
    }
  }, [accept, getProof, info, navigate, token]);

  useEffect(() => {
    if (!authLoading && sameRecipient) void runAccept();
  }, [authLoading, sameRecipient, runAccept]);

  async function onSignup(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (password.length < INVITE_PASSWORD_MIN)
      return void toast.error(`Mot de passe : ${INVITE_PASSWORD_MIN} caractères minimum.`);
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

  let state: InviteViewState;
  if (loadError) state = { kind: "load_error" };
  else if (!info || authLoading) state = { kind: "loading" };
  else if (!info.valid) state = { kind: "invalid", reason: info.reason };
  else {
    const session: InviteSessionState = !user
      ? signupDone
        ? { kind: "signup_done" }
        : { kind: "anonymous" }
      : !sameRecipient
        ? { kind: "wrong_recipient", sessionEmail }
        : (flow ?? { kind: "checking" });
    state = { kind: "valid", invite: info, session };
  }

  return (
    <InviteView
      token={token}
      state={state}
      onRetryLoad={load}
      onRetryAccept={() => void runAccept()}
      onSwitchAccount={async () => {
        await supabase.auth.signOut();
        navigate({ to: "/login", search: { invite: token } });
      }}
      signup={{
        fullName,
        password,
        busy,
        onFullName: setFullName,
        onPassword: setPassword,
        onSubmit: onSignup,
      }}
    />
  );
}
