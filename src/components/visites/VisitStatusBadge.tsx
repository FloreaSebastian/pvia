import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { VISIT_STATUS_META, CONSTRAINT_LEVEL_META, type ConstraintLevel, type VisitStatus } from "@/lib/visites/types";

const TONE_CLASS: Record<string, string> = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  warn: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  success: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  muted: "bg-muted text-muted-foreground",
  danger: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
};

export function VisitStatusBadge({ status, className }: { status: string; className?: string }) {
  const meta = VISIT_STATUS_META[status as VisitStatus] ?? { label: status, tone: "neutral" as const };
  return (
    <Badge variant="secondary" className={cn("border-0 font-medium", TONE_CLASS[meta.tone], className)}>
      {meta.label}
    </Badge>
  );
}

export function ConstraintLevelBadge({ level, className }: { level: string; className?: string }) {
  const meta = CONSTRAINT_LEVEL_META[level as ConstraintLevel] ?? { label: level, tone: "muted" };
  return (
    <Badge variant="secondary" className={cn("border-0 font-medium", TONE_CLASS[meta.tone], className)}>
      {meta.label}
    </Badge>
  );
}
