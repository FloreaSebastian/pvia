import { AlertTriangle, CheckCircle2, Clock, FileWarning } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  COMPLIANCE_STATUS_LABELS,
  type ComplianceStatus,
} from "@/lib/subcontractor-compliance";

/** Statut jamais transmis par la seule couleur : icône + texte systématiques. */
export function ComplianceBadge({ status }: { status: ComplianceStatus }) {
  const map: Record<ComplianceStatus, { cls: string; Icon: typeof CheckCircle2 }> = {
    compliant: { cls: "bg-green-600 text-white", Icon: CheckCircle2 },
    expiring_soon: { cls: "bg-amber-500 text-white", Icon: Clock },
    incomplete: { cls: "bg-orange-600 text-white", Icon: FileWarning },
    blocking: { cls: "bg-destructive text-destructive-foreground", Icon: AlertTriangle },
  };
  const { cls, Icon } = map[status];
  return (
    <Badge className={`${cls} gap-1`}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {COMPLIANCE_STATUS_LABELS[status]}
    </Badge>
  );
}
