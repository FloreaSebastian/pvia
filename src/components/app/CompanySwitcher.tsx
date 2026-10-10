import { Building2, Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";
import { useCompany } from "@/hooks/use-company";
import { getCompanyVisualIdentity } from "@/lib/company-visual";
import { roleLabel } from "@/lib/role-access";
import { RoleBadge } from "@/components/app/RoleBadge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function CompanySwitcher() {
  const { memberships, activeCompanyId, setActiveCompanyId, activeRole } = useCompany();
  const [open, setOpen] = useState(false);
  const active = memberships.find((m) => m.company_id === activeCompanyId);
  const activeIcon = getCompanyVisualIdentity(active?.company).displayIconUrl;

  if (!active) return null;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          className="flex min-h-11 w-full items-center gap-2 rounded-lg border border-sidebar-border bg-sidebar-accent/40 px-2.5 py-2 text-left transition hover:bg-sidebar-accent"
          aria-label={`Entreprise active : ${active.company.name}, rôle ${roleLabel(activeRole)}. Changer d'entreprise`}
        >
          <div className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-md bg-primary/15 text-primary">
            {activeIcon ? (
              <img src={activeIcon} alt="" className="h-full w-full object-cover" />
            ) : (
              <Building2 className="h-4 w-4" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold" title={active.company.name}>
              {active.company.name}
            </p>
            <p className="truncate text-xs text-muted-foreground">{roleLabel(activeRole)}</p>
          </div>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        collisionPadding={8}
        className="w-[min(18rem,calc(100vw-1rem))] max-w-[calc(100vw-1rem)]"
      >
        <DropdownMenuLabel className="text-xs">Vos entreprises</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {memberships.map((m) => {
          const icon = getCompanyVisualIdentity(m.company).displayIconUrl;
          const isActive = m.company_id === activeCompanyId;
          return (
            <DropdownMenuItem
              key={m.company_id}
              onSelect={() => setActiveCompanyId(m.company_id)}
              className="min-h-11 cursor-pointer items-start gap-2"
              aria-current={isActive ? "true" : undefined}
            >
              {icon ? (
                <img src={icon} alt="" className="mt-0.5 h-4 w-4 shrink-0 rounded object-cover" />
              ) : (
                <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              )}
              <span className="min-w-0 flex-1">
                <span className="block break-words text-sm [overflow-wrap:anywhere]">
                  {m.company.name}
                </span>
                <RoleBadge role={m.role} long className="mt-1" />
              </span>
              {isActive && (
                <Check
                  className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                  aria-label="Entreprise active"
                />
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
