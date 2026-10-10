import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { isAdminRole, isManageRole, isOwnerRole, type CompanyRoleValue } from "@/lib/roles";
import {
  IDLE_STATE,
  createCompanyController,
  effectiveRole,
  type CompanyCtxState,
  type CompanyCtxStatus,
  type CompanyMembership,
} from "@/lib/company-context";

export type CompanyRole = CompanyRoleValue;
export type Membership = CompanyMembership;

type Ctx = {
  /** true tant que les adhésions ne sont pas confirmées (chargement initial). */
  loading: boolean;
  status: CompanyCtxStatus;
  error: string | null;
  memberships: Membership[];
  activeCompanyId: string | null;
  /** Rôle confirmé ; null pendant chargement/erreur. */
  activeRole: CompanyRole | null;
  setActiveCompanyId: (id: string) => void;
  refresh: () => Promise<void>;
  can: (action: "manage" | "admin" | "owner") => boolean;
};

const CompanyContext = createContext<Ctx | null>(null);
const LS_KEY = "pvia:activeCompany";

function readStoredCompanyId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(LS_KEY);
  } catch {
    return null;
  }
}

function storeCompanyId(id: string): void {
  try {
    window.localStorage.setItem(LS_KEY, id);
  } catch {
    // Le stockage peut être indisponible dans certaines WebView/tablettes.
  }
}

async function fetchMemberships(userId: string) {
  const { data, error } = await supabase
    .from("company_members")
    .select("id,company_id,role,status,company:companies(id,name,logo_url,icon_url)")
    .eq("user_id", userId)
    .eq("status", "active");
  return { data: (data as unknown as Membership[]) ?? null, error };
}

export function CompanyProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [state, setState] = useState<CompanyCtxState>(IDLE_STATE);
  const ctrlRef = useRef<ReturnType<typeof createCompanyController> | null>(null);
  if (!ctrlRef.current) {
    ctrlRef.current = createCompanyController(
      { fetchMemberships, readStored: readStoredCompanyId, store: storeCompanyId },
      setState,
    );
  }
  const ctrl = ctrlRef.current;

  useEffect(() => () => ctrl.dispose(), [ctrl]);

  useEffect(() => {
    if (authLoading) return;
    ctrl.setUser(user?.id ?? null);
  }, [ctrl, user?.id, authLoading]);

  // Retour au premier plan : relecture autorisée des adhésions (révocation, suspension).
  // company_members n'est pas publié en realtime : aucun canal n'est créé.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void ctrl.refresh(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [ctrl]);

  // Un utilisateur différent de celui de l'état n'a jamais accès aux données affichées.
  const scoped: CompanyCtxState =
    state.userId && state.userId === (user?.id ?? null) ? state : IDLE_STATE;
  const activeRole = effectiveRole(scoped);

  const value = useMemo<Ctx>(
    () => ({
      loading: authLoading || scoped.status === "loading" || (scoped.status === "idle" && !!user),
      status: scoped.status,
      error: scoped.error,
      memberships: scoped.status === "ready" ? scoped.memberships : [],
      activeCompanyId: scoped.status === "ready" ? scoped.activeCompanyId : null,
      activeRole,
      setActiveCompanyId: (id: string) => {
        ctrl.select(id);
      },
      refresh: () => ctrl.refresh(false),
      can: (action) => {
        if (!activeRole) return false;
        if (action === "owner") return isOwnerRole(activeRole);
        if (action === "admin") return isAdminRole(activeRole);
        if (action === "manage") return isManageRole(activeRole);
        return false;
      },
    }),
    [authLoading, scoped, user, activeRole, ctrl],
  );

  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
}

export function useCompany() {
  const ctx = useContext(CompanyContext);
  if (!ctx) throw new Error("useCompany must be inside CompanyProvider");
  return ctx;
}
