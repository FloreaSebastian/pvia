import { Check, CircleDashed, Loader2, AlertCircle } from "lucide-react";
import type { SaveStatus } from "@/hooks/use-autosave";
import { cn } from "@/lib/utils";

export function SaveStatusBadge({
  status,
  lastSavedAt,
  className,
}: {
  status: SaveStatus;
  lastSavedAt?: Date | null;
  className?: string;
}) {
  const map: Record<SaveStatus, { icon: React.ReactNode; label: string; tone: string }> = {
    idle: {
      icon: <Check className="h-3.5 w-3.5" />,
      label: lastSavedAt
        ? `À jour · ${lastSavedAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`
        : "À jour",
      tone: "text-muted-foreground",
    },
    dirty: {
      icon: <CircleDashed className="h-3.5 w-3.5" />,
      label: "Modifications non enregistrées",
      tone: "text-amber-600 dark:text-amber-400",
    },
    saving: {
      icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
      label: "Sauvegarde…",
      tone: "text-muted-foreground",
    },
    saved: {
      icon: <Check className="h-3.5 w-3.5" />,
      label: "Modifications enregistrées",
      tone: "text-emerald-600 dark:text-emerald-400",
    },
    error: {
      icon: <AlertCircle className="h-3.5 w-3.5" />,
      label: "Erreur de sauvegarde",
      tone: "text-destructive",
    },
  };
  const { icon, label, tone } = map[status];
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn("inline-flex items-center gap-1.5 text-xs font-medium", tone, className)}
    >
      {icon}
      <span>{label}</span>
    </span>
  );
}
