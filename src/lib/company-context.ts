// Contrôleur du contexte entreprise, indépendant de React (testable).
// Règles : état lié à l'utilisateur courant, générations pour ignorer les
// réponses dépassées, erreur ou inconnu = aucun rôle, liste vide = aucune
// entreprise active, préférence stockée seulement pour un membre actif connu.
import type { CompanyRoleValue } from "@/lib/roles";
import { asKnownRole } from "@/lib/role-access";

export type CompanyMembership = {
  id: string;
  company_id: string;
  role: CompanyRoleValue;
  status: "active" | "invited" | "suspended";
  company: { id: string; name: string; logo_url: string | null; icon_url: string | null };
};

export type CompanyCtxStatus = "idle" | "loading" | "ready" | "error";

export type CompanyCtxState = {
  userId: string | null;
  status: CompanyCtxStatus;
  memberships: CompanyMembership[];
  activeCompanyId: string | null;
  error: string | null;
};

export type CompanyCtxDeps = {
  fetchMemberships: (userId: string) => Promise<{ data: CompanyMembership[] | null; error: unknown }>;
  readStored: () => string | null;
  store: (id: string) => void;
};

export const IDLE_STATE: CompanyCtxState = {
  userId: null,
  status: "idle",
  memberships: [],
  activeCompanyId: null,
  error: null,
};

/** Rôle effectif : uniquement quand les adhésions sont confirmées. */
export function effectiveRole(s: CompanyCtxState): CompanyRoleValue | null {
  if (s.status !== "ready" || !s.activeCompanyId) return null;
  const m = s.memberships.find((x) => x.company_id === s.activeCompanyId && x.status === "active");
  return asKnownRole(m?.role ?? null);
}

export function createCompanyController(deps: CompanyCtxDeps, onChange: (s: CompanyCtxState) => void) {
  let state: CompanyCtxState = IDLE_STATE;
  let gen = 0;
  const emit = (next: CompanyCtxState) => {
    state = next;
    onChange(state);
  };

  async function load(userId: string, token: number, background: boolean) {
    if (!background) {
      emit({ userId, status: "loading", memberships: [], activeCompanyId: null, error: null });
    }
    let res: { data: CompanyMembership[] | null; error: unknown };
    try {
      res = await deps.fetchMemberships(userId);
    } catch (e) {
      res = { data: null, error: e ?? new Error("network") };
    }
    if (token !== gen || state.userId !== userId) return; // réponse dépassée / autre utilisateur
    if (res.error) {
      emit({ userId, status: "error", memberships: [], activeCompanyId: null, error: "Impossible de vérifier vos accès entreprise." });
      return;
    }
    const list = (res.data ?? []).filter((m) => m.status === "active" && !!asKnownRole(m.role));
    const current = background ? state.activeCompanyId : null;
    const preferred = current ?? deps.readStored();
    let active: string | null = null;
    if (list.length) {
      active = preferred && list.some((m) => m.company_id === preferred) ? preferred : list[0].company_id;
      deps.store(active);
    }
    emit({ userId, status: "ready", memberships: list, activeCompanyId: active, error: null });
  }

  return {
    get state() {
      return state;
    },
    /** Changement d'utilisateur (connexion, déconnexion, autre compte) : tout est fermé immédiatement. */
    setUser(userId: string | null) {
      if (userId === state.userId && state.status !== "idle") return;
      gen += 1;
      if (!userId) {
        emit(IDLE_STATE);
        return;
      }
      void load(userId, gen, false);
    },
    /** Relecture autorisée. `background` garde les données confirmées pendant la relecture. */
    refresh(background = false) {
      if (!state.userId) return Promise.resolve();
      gen += 1;
      const bg = background && state.status === "ready";
      return load(state.userId, gen, bg);
    },
    /** Choix uniquement parmi les adhésions actives confirmées. */
    select(companyId: string): boolean {
      if (state.status !== "ready") return false;
      if (!state.memberships.some((m) => m.company_id === companyId && m.status === "active")) return false;
      deps.store(companyId);
      emit({ ...state, activeCompanyId: companyId });
      return true;
    },
    dispose() {
      gen += 1;
    },
  };
}
