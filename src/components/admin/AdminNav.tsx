import { Link, useLocation } from "@tanstack/react-router";
import {
  LayoutDashboard, Building2, LifeBuoy, Activity, CheckSquare, ArrowLeft, ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

const items = [
  { to: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/admin/companies", label: "Entreprises", icon: Building2 },
  { to: "/admin/support", label: "Support", icon: LifeBuoy },
  { to: "/admin/monitoring", label: "Monitoring", icon: Activity },
  { to: "/admin/launch-checklist", label: "Launch checklist", icon: CheckSquare },
] as const;

export function AdminNav() {
  const loc = useLocation();
  return (
    <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
      <div className="mb-2 flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-amber-600" />
        <span className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
          Cockpit administration plateforme
        </span>
        <Badge variant="outline" className="ml-auto border-amber-500/40 text-[10px]">Admin PVIA</Badge>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((i) => {
          const active = loc.pathname === i.to || loc.pathname.startsWith(i.to + "/");
          const Icon = i.icon;
          return (
            <Link
              key={i.to}
              to={i.to}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                active ? "bg-foreground text-background" : "bg-background hover:bg-muted"
              }`}
            >
              <Icon className="h-3.5 w-3.5" /> {i.label}
            </Link>
          );
        })}
        <Link
          to="/dashboard"
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Espace entreprise
        </Link>
      </div>
    </div>
  );
}
