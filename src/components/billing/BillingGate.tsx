import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { AlertTriangle, CreditCard, Gauge, Lock, ShieldAlert, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useSubscription } from "@/hooks/use-subscription";
import { useCompany } from "@/hooks/use-company";
import { accessStateHelp, accessStateLabel, formatFrDate } from "@/lib/plans";
import { classifyBillingError } from "@/lib/billing-errors";

/* ------------------------------------------------------------------ *
 * Types                                                               *
 * ------------------------------------------------------------------ */

type QuotaKind = "pv" | "members";

type GateDialog =
  | { kind: "subscription"; state: string; action?: string | null; auto?: boolean }
  | { kind: "feature"; feature: string; action?: string | null }
  | { kind: "quota"; quota: QuotaKind; action?: string | null }
  | { kind: "suspended"; reason: string; action?: string | null };

type BillingGateApi = {
  /** Écriture métier suspendue pour raison d'abonnement (niveau entreprise). */
  blocked: boolean;
  isLoading: boolean;
  state: string | undefined;
  trialEnd: string | null;
  periodEnd: string | null;
  /** `true` si l'action peut se poursuivre ; sinon la popup s'ouvre. */
  requireWrite: (actionLabel?: string) => boolean;
  openSubscription: (actionLabel?: string) => void;
  openFeature: (featureLabel: string, actionLabel?: string) => void;
  openQuota: (quota: QuotaKind, actionLabel?: string) => void;
  /** Traite une erreur de mutation : `true` si une popup a été affichée. */
  reportError: (err: unknown) => boolean;
};

const Ctx = createContext<BillingGateApi | null>(null);

/** Hors provider (pages publiques), tout est autorisé côté UI : le serveur reste l'autorité. */
const NOOP: BillingGateApi = {
  blocked: false,
  isLoading: false,
  state: undefined,
  trialEnd: null,
  periodEnd: null,
  requireWrite: () => true,
  openSubscription: () => {},
  openFeature: () => {},
  openQuota: () => {},
  reportError: () => false,
};

export function useBillingGate(): BillingGateApi {
  return useContext(Ctx) ?? NOOP;
}

/* ------------------------------------------------------------------ *
 * Copie — matrice état → titre / texte / CTA                          *
 * ------------------------------------------------------------------ */

type Copy = { title: string; body: string; cta: string; secondary: string; tone: "danger" | "warn" };

const PAYMENT_STATES = new Set(["past_due", "unpaid", "incomplete", "incomplete_expired"]);
const ENDED_STATES = new Set(["canceled", "paused"]);

export function subscriptionCopy(state?: string | null): Copy {
  const s = state ?? "blocked";
  if (PAYMENT_STATES.has(s)) {
    return {
      title: "Paiement à régulariser",
      body:
        "Vos données restent accessibles. Les nouvelles créations et modifications sont temporairement suspendues jusqu'à la régularisation de votre abonnement.",
      cta: "Régulariser mon abonnement",
      secondary: "Continuer en lecture seule",
      tone: "danger",
    };
  }
  if (ENDED_STATES.has(s)) {
    return {
      title: "Votre abonnement est terminé",
      body:
        "Vos données sont conservées et restent consultables. Réactivez un abonnement pour retrouver la création et la modification.",
      cta: "Réactiver mon abonnement",
      secondary: "Continuer en lecture seule",
      tone: "danger",
    };
  }
  return {
    title: "Votre essai est terminé",
    body:
      "Vos données restent accessibles, mais la création et la modification sont suspendues. Choisissez une formule pour continuer à utiliser PVIA.",
    cta: "Choisir ma formule",
    secondary: "Continuer en lecture seule",
    tone: "danger",
  };
}

/* ------------------------------------------------------------------ *
 * Provider                                                            *
 * ------------------------------------------------------------------ */

const QUIET_PATHS = ["/billing", "/upgrade-required", "/onboarding", "/account-suspended"];

function isQuietPath(pathname: string): boolean {
  return QUIET_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export function BillingGateProvider({ children }: { children: ReactNode }) {
  const { activeCompanyId } = useCompany();
  const { access, blocked, isLoading, usage, limits, plan } = useSubscription();
  const location = useLocation();
  const [dialog, setDialog] = useState<GateDialog | null>(null);
  const promptedRef = useRef<string | null>(null);

  const quiet = isQuietPath(location.pathname);

  const openSubscription = useCallback(
    (actionLabel?: string) => {
      setDialog({ kind: "subscription", state: access?.state ?? "blocked", action: actionLabel ?? null });
    },
    [access?.state],
  );

  const openFeature = useCallback((featureLabel: string, actionLabel?: string) => {
    setDialog({ kind: "feature", feature: featureLabel, action: actionLabel ?? null });
  }, []);

  const openQuota = useCallback((quota: QuotaKind, actionLabel?: string) => {
    setDialog({ kind: "quota", quota, action: actionLabel ?? null });
  }, []);

  const requireWrite = useCallback(
    (actionLabel?: string) => {
      if (!blocked) return true;
      openSubscription(actionLabel);
      return false;
    },
    [blocked, openSubscription],
  );

  const reportError = useCallback((err: unknown) => {
    const block = classifyBillingError(err);
    if (!block) return false;
    if (block.kind === "subscription") setDialog({ kind: "subscription", state: block.state });
    else if (block.kind === "suspended") setDialog({ kind: "suspended", reason: block.reason });
    else if (block.kind === "quota") setDialog({ kind: "quota", quota: block.quota });
    else setDialog({ kind: "feature", feature: block.feature ?? "Cette fonctionnalité" });
    return true;
  }, []);

  /* Erreurs de mutation captées globalement (voir src/router.tsx). */
  useEffect(() => {
    function onErr(e: Event) {
      reportError((e as CustomEvent).detail);
    }
    window.addEventListener("pvia:mutation-error", onErr as EventListener);
    return () => window.removeEventListener("pvia:mutation-error", onErr as EventListener);
  }, [reportError]);

  /* Rappel à l'entrée en session : une seule fois par entreprise + état. */
  useEffect(() => {
    if (isLoading || !blocked || quiet || !activeCompanyId) return;
    const key = `pvia:billing-prompt:${activeCompanyId}:${access?.state ?? "blocked"}`;
    if (promptedRef.current === key) return;
    promptedRef.current = key;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      /* stockage indisponible : on affiche une fois par montage */
    }
    setDialog({ kind: "subscription", state: access?.state ?? "blocked", auto: true });
  }, [isLoading, blocked, quiet, activeCompanyId, access?.state]);

  /* L'abonnement redevient valide (retour de paiement, resynchro) → on ferme. */
  useEffect(() => {
    if (!blocked && dialog?.kind === "subscription") setDialog(null);
  }, [blocked, dialog?.kind]);

  const api = useMemo<BillingGateApi>(
    () => ({
      blocked: Boolean(blocked),
      isLoading,
      state: access?.state,
      trialEnd: access?.trial_end ?? null,
      periodEnd: access?.current_period_end ?? null,
      requireWrite,
      openSubscription,
      openFeature,
      openQuota,
      reportError,
    }),
    [blocked, isLoading, access?.state, access?.trial_end, access?.current_period_end, requireWrite, openSubscription, openFeature, openQuota, reportError],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      <GateDialogView
        dialog={dialog}
        onClose={() => setDialog(null)}
        access={access}
        usage={usage}
        limits={limits as any}
        plan={plan}
      />
    </Ctx.Provider>
  );
}

/* ------------------------------------------------------------------ *
 * Popup unique — responsive 320 → desktop, scrollable, safe areas      *
 * ------------------------------------------------------------------ */

function GateDialogView({
  dialog,
  onClose,
  access,
  usage,
  limits,
  plan,
}: {
  dialog: GateDialog | null;
  onClose: () => void;
  access: { state?: string; trial_end?: string | null; current_period_end?: string | null } | null;
  usage: { pv_this_period: number; members: number; seats: number };
  limits: { max_pv_per_month?: number | null; max_members?: number | null; display_name?: string | null } | null;
  plan: string;
}) {
  const open = dialog !== null;

  const content = useMemo(() => {
    if (!dialog) return null;

    if (dialog.kind === "suspended") {
      return {
        icon: <ShieldAlert className="h-5 w-5 text-destructive" aria-hidden />,
        title: "Compte suspendu",
        body: "Votre compte est temporairement suspendu. Vos données restent conservées. Contactez le support PVIA pour rétablir l'accès.",
        details: [] as string[],
        primary: { label: "Contacter le support", to: "/parametres" as const },
        secondary: "Fermer",
      };
    }

    if (dialog.kind === "feature") {
      return {
        icon: <Sparkles className="h-5 w-5 text-primary" aria-hidden />,
        title: "Fonctionnalité non incluse",
        body: `« ${dialog.feature} » n'est pas incluse dans votre formule actuelle. Changez de formule pour l'activer.`,
        details: [`Formule actuelle : ${limits?.display_name ?? plan}`],
        primary: { label: "Changer de formule", to: "/billing" as const },
        secondary: "Fermer",
      };
    }

    if (dialog.kind === "quota") {
      const isPv = dialog.quota === "pv";
      const used = isPv ? usage.pv_this_period : usage.seats || usage.members;
      const max = isPv ? limits?.max_pv_per_month : limits?.max_members;
      return {
        icon: <Gauge className="h-5 w-5 text-warning" aria-hidden />,
        title: isPv ? "Quota de PV atteint" : "Nombre d'utilisateurs atteint",
        body: isPv
          ? "Vous avez atteint le nombre de procès-verbaux inclus dans votre formule pour ce mois-ci."
          : "Vous avez atteint le nombre d'utilisateurs inclus dans votre formule.",
        details: [
          `Consommation : ${used}${max != null ? ` / ${max}` : ""}`,
          `Formule actuelle : ${limits?.display_name ?? plan}`,
        ],
        primary: { label: "Passer à la formule supérieure", to: "/billing" as const },
        secondary: "Fermer",
      };
    }

    const copy = subscriptionCopy(dialog.state);
    const details: string[] = [];
    if (dialog.state === "trial_expired" && access?.trial_end) {
      details.push(`Essai terminé le ${formatFrDate(access.trial_end)}`);
      const days = Math.floor((Date.now() - new Date(access.trial_end).getTime()) / 86_400_000);
      if (Number.isFinite(days) && days > 0) {
        details.push(`Accès restreint depuis ${days} jour${days > 1 ? "s" : ""}`);
      }
    }
    if (PAYMENT_STATES.has(dialog.state) && access?.current_period_end) {
      details.push(`Échéance : ${formatFrDate(access.current_period_end)}`);
    }
    if (ENDED_STATES.has(dialog.state) && access?.current_period_end) {
      details.push(`Fin d'accès : ${formatFrDate(access.current_period_end)}`);
    }
    details.push(`Statut : ${accessStateLabel(dialog.state)}`);
    return {
      icon:
        copy.tone === "danger" ? (
          <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden />
        ) : (
          <Lock className="h-5 w-5 text-warning" aria-hidden />
        ),
      title: copy.title,
      body: dialog.action ? `${copy.body}\nAction concernée : ${dialog.action}.` : copy.body,
      details,
      primary: { label: copy.cta, to: "/billing" as const },
      secondary: copy.secondary,
    };
  }, [dialog, access, usage, limits, plan]);

  if (!content) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-h-[min(90dvh,42rem)] w-[calc(100vw-2rem)] max-w-[28rem] overflow-y-auto p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:p-6"
      >
        <DialogHeader className="text-left">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 shrink-0">{content.icon}</span>
            <div className="min-w-0">
              <DialogTitle className="text-base leading-tight sm:text-lg">{content.title}</DialogTitle>
              <DialogDescription className="mt-1 whitespace-pre-line text-sm">{content.body}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {content.details.length > 0 && (
          <ul className="mt-1 space-y-1 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            {content.details.map((d) => (
              <li key={d} className="break-words">
                {d}
              </li>
            ))}
          </ul>
        )}

        <p className="text-xs text-muted-foreground">
          {accessStateHelp(access?.state)}
        </p>

        <DialogFooter className="mt-2 flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" className="min-h-[44px] w-full sm:w-auto" onClick={onClose}>
            {content.secondary}
          </Button>
          <Button asChild className="min-h-[44px] w-full sm:w-auto">
            <Link to={content.primary.to} onClick={onClose}>
              <CreditCard className="mr-2 h-4 w-4" aria-hidden />
              {content.primary.label}
            </Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
