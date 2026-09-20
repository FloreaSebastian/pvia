import {
  BarChart3,
  Check,
  CircleSlash,
  LayoutGrid,
  MapPin,
  Ruler,
  Sun,
  TriangleAlert,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  STUDIO_STEP_ORDER,
  studioStepStatusLabel,
  type StudioStep,
  type StudioStepId,
} from "@/lib/solar/studio-steps";
import { cn } from "@/lib/utils";

const ICONS: Record<StudioStepId, LucideIcon> = {
  projet: MapPin,
  toiture: Ruler,
  modules: Sun,
  implantation: LayoutGrid,
  electrique: Zap,
  resultats: BarChart3,
};

/**
 * Rail d'étapes persistant : vertical et très compact sur tablette/desktop,
 * bande horizontale défilante sur mobile. Cibles tactiles >= 44 px.
 */
export function StepRail({
  steps,
  activeStep,
  onSelect,
}: {
  steps: StudioStep[];
  activeStep: StudioStepId;
  onSelect: (id: StudioStepId) => void;
}) {
  const ordered = STUDIO_STEP_ORDER.map((id) => steps.find((s) => s.id === id)).filter(
    (s): s is StudioStep => Boolean(s),
  );

  return (
    <nav
      aria-label="Étapes Solar Studio"
      className="flex shrink-0 gap-1 overflow-x-auto border-b bg-card p-1 xl:w-[84px] xl:flex-col xl:overflow-visible xl:border-b-0 xl:border-r xl:py-2"
    >
      {ordered.map((step, index) => {
        const Icon = ICONS[step.id];
        const active = step.id === activeStep;
        const blocked = step.state === "bloque";
        return (
          <button
            key={step.id}
            type="button"
            onClick={() => onSelect(step.id)}
            aria-current={active ? "step" : undefined}
            // L'étape reste consultable (écran d'information) mais son indisponibilité
            // est annoncée sémantiquement et reste visible même quand elle est ouverte.
            aria-disabled={step.disabled ? true : undefined}
            data-state={step.state}
            aria-label={`${index + 1}. ${step.label} — ${studioStepStatusLabel(step.state)} — ${step.hint}`}
            title={`${studioStepStatusLabel(step.state)} — ${step.hint}`}
            className={cn(
              "relative flex min-h-11 min-w-[64px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-md px-2 py-1.5 text-[10px] font-medium transition-colors xl:w-full xl:min-w-0",
              blocked
                ? cn(
                    "text-muted-foreground/60 hover:bg-accent",
                    active && "bg-muted ring-1 ring-inset ring-muted-foreground/40",
                  )
                : active
                  ? "bg-primary text-primary-foreground"
                  : step.state === "termine"
                    ? "text-primary hover:bg-accent"
                    : step.state === "alerte"
                      ? "text-destructive hover:bg-accent"
                      : "text-muted-foreground hover:bg-accent",
            )}
          >
            <Icon className="h-5 w-5" aria-hidden />
            <span className="max-w-full truncate">{step.label}</span>
            {blocked && active && (
              <span className="max-w-full truncate text-[9px] font-normal uppercase tracking-wide">
                Indisponible
              </span>
            )}
            <StateDot state={step.state} />
          </button>
        );
      })}
    </nav>
  );
}

function StateDot({ state }: { state: StudioStep["state"] }) {
  if (state === "termine") return <Check className="absolute right-1 top-1 h-3 w-3" aria-hidden />;
  if (state === "alerte")
    return <TriangleAlert className="absolute right-1 top-1 h-3 w-3" aria-hidden />;
  if (state === "bloque")
    return <CircleSlash className="absolute right-1 top-1 h-3 w-3" aria-hidden />;
  return null;
}
