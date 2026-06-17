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
  company: { id: string; name: string; logo_url: string | null };
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

export function CompanyProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [activeCompanyId, setActiveId] = useState<string | null>(
    () => (typeof window !== "undefined" ? localStorage.getItem(LS_KEY) : null),
  );
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
      .select("id,company_id,role,status,company:companies(id,name,logo_url)")
      .eq("user_id", user.id)
      .eq("status", "active");
    const list = ((data as unknown) as Membership[]) ?? [];
    setMemberships(list);
    if (list.length && (!activeCompanyId || !list.find((m) => m.company_id === activeCompanyId))) {
      const id = list[0].company_id;
      setActiveId(id);
      localStorage.setItem(LS_KEY, id);
    }
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  function setActiveCompanyId(id: string) {
    setActiveId(id);
    localStorage.setItem(LS_KEY, id);
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
