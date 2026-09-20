import type { ReactNode } from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Panneau contextuel repliable (300–360 px) : réglages de l'étape courante.
 * Le canevas reste prioritaire, le panneau se replie en une colonne d'icône.
 */
export function ContextPanel({
  title,
  action,
  collapsed,
  onToggle,
  children,
}: {
  title: string;
  action: string;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  if (collapsed) {
    return (
      <div className="hidden shrink-0 border-l bg-card p-1 xl:block">
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11"
          aria-label={`Ouvrir les réglages : ${title}`}
          aria-expanded={false}
          onClick={onToggle}
        >
          <PanelRightOpen className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <aside
      aria-label={`Réglages — ${title}`}
      className={cn(
        "flex min-h-0 shrink-0 flex-col border-t bg-card xl:w-[340px] xl:border-l xl:border-t-0",
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{title}</p>
          <p className="truncate text-xs text-muted-foreground">{action}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="hidden h-11 w-11 xl:inline-flex"
          aria-label="Replier les réglages"
          aria-expanded
          onClick={onToggle}
        >
          <PanelRightClose className="h-4 w-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">{children}</div>
    </aside>
  );
}
