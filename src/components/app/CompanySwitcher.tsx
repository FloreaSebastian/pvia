import { Building2, Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";
import { useCompany } from "@/hooks/use-company";
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

  if (!active) return null;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button className="flex w-full items-center gap-2 rounded-lg border border-sidebar-border bg-sidebar-accent/40 px-2.5 py-2 text-left transition hover:bg-sidebar-accent">
          <div className="grid h-7 w-7 place-items-center rounded-md bg-primary/15 text-primary">
            <Building2 className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold">{active.company.name}</p>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{activeRole}</p>
          </div>
          <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-xs">Vos entreprises</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {memberships.map((m) => (
          <DropdownMenuItem
            key={m.company_id}
            onClick={() => setActiveCompanyId(m.company_id)}
            className="cursor-pointer"
          >
            <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="flex-1 truncate">{m.company.name}</span>
            <span className="text-[10px] uppercase text-muted-foreground">{m.role}</span>
            {m.company_id === activeCompanyId && <Check className="h-3.5 w-3.5 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
