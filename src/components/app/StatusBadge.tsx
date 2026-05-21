import { CheckCircle2, Clock, FileEdit, AlertCircle, ShieldCheck, type LucideIcon } from "lucide-react";

type Cfg = { label: string; className: string; Icon: LucideIcon };

const map: Record<string, Cfg> = {
  signe: { label: "Signé", className: "bg-emerald-50 text-emerald-700 ring-emerald-200", Icon: CheckCircle2 },
  brouillon: { label: "Brouillon", className: "bg-muted text-muted-foreground ring-border", Icon: FileEdit },
  en_attente: { label: "En attente", className: "bg-amber-50 text-amber-700 ring-amber-200", Icon: Clock },
  ouverte: { label: "Ouverte", className: "bg-rose-50 text-rose-700 ring-rose-200", Icon: AlertCircle },
  levee: { label: "Levée", className: "bg-sky-50 text-sky-700 ring-sky-200", Icon: CheckCircle2 },
  validee: { label: "Validée", className: "bg-emerald-50 text-emerald-700 ring-emerald-200", Icon: ShieldCheck },
};

export function StatusBadge({ status }: { status: string }) {
  const cfg = map[status] ?? {
    label: status,
    className: "bg-muted text-muted-foreground ring-border",
    Icon: FileEdit,
  };
  const Icon = cfg.Icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${cfg.className}`}>
      <Icon className="h-3 w-3" /> {cfg.label}
    </span>
  );
}
