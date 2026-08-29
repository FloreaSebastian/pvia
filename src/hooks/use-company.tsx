import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  isAdminRole,
  isManageRole,
  isOwnerRole,
  type CompanyRoleValue,
} from "@/lib/roles";

export type CompanyRole = CompanyRoleValue;
export type Membership = {
  id: string;
  company_id: string;
  role: CompanyRole;
  status: "active" | "invited" | "suspended";
  company: { id: string; name: string; logo_url: string | null; icon_url: string | null };
};

type Ctx = {
  loading: boolean;
  memberships: Membership[];
  activeCompanyId: string | null;
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

export function CompanyProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [memberships, setMemberships] = useState<Membership[]>([]);
  // Valeur déterministe au SSR et au premier rendu client. La préférence
  // locale est restaurée dans refresh(), après hydratation.
  const [activeCompanyId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    if (!user) {
      setMemberships([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from("company_members")
      .select("id,company_id,role,status,company:companies(id,name,logo_url,icon_url)")
      .eq("user_id", user.id)
      .eq("status", "active");
    const list = ((data as unknown) as Membership[]) ?? [];
    setMemberships(list);
    const preferredCompanyId = activeCompanyId ?? readStoredCompanyId();
    if (list.length && (!preferredCompanyId || !list.find((m) => m.company_id === preferredCompanyId))) {
      const id = list[0].company_id;
      setActiveId(id);
      storeCompanyId(id);
    } else if (preferredCompanyId !== activeCompanyId) {
      setActiveId(preferredCompanyId);
    }
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  function setActiveCompanyId(id: string) {
    setActiveId(id);
    storeCompanyId(id);
  }

  const activeRole = useMemo(
    () => memberships.find((m) => m.company_id === activeCompanyId)?.role ?? null,
    [memberships, activeCompanyId],
  );

  function can(action: "manage" | "admin" | "owner") {
    if (!activeRole) return false;
    if (action === "owner") return isOwnerRole(activeRole);
    if (action === "admin") return isAdminRole(activeRole);
    if (action === "manage") return isManageRole(activeRole);
    return false;
  }

  return (
    <CompanyContext.Provider value={{ loading, memberships, activeCompanyId, activeRole, setActiveCompanyId, refresh, can }}>
      {children}
    </CompanyContext.Provider>
  );
}

export function useCompany() {
  const ctx = useContext(CompanyContext);
  if (!ctx) throw new Error("useCompany must be inside CompanyProvider");
  return ctx;
}
