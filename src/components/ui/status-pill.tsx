import * as React from "react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "info" | "success" | "warning" | "destructive" | "primary";

const toneStyles: Record<Tone, string> = {
  neutral:
    "bg-muted text-muted-foreground ring-1 ring-inset ring-border",
  info:
    "bg-[color:oklch(0.96_0.03_230)] text-[color:oklch(0.32_0.12_230)] ring-1 ring-inset ring-[color:oklch(0.85_0.07_230)] dark:bg-[color:oklch(0.32_0.08_230/_0.35)] dark:text-[color:oklch(0.82_0.1_230)] dark:ring-[color:oklch(0.5_0.12_230/_0.4)]",
  success:
    "bg-[color:oklch(0.95_0.06_152)] text-[color:oklch(0.32_0.12_152)] ring-1 ring-inset ring-[color:oklch(0.82_0.1_152)] dark:bg-[color:oklch(0.3_0.08_152/_0.35)] dark:text-[color:oklch(0.82_0.12_152)] dark:ring-[color:oklch(0.5_0.12_152/_0.4)]",
  warning:
    "bg-[color:oklch(0.96_0.06_70)] text-[color:oklch(0.36_0.13_55)] ring-1 ring-inset ring-[color:oklch(0.85_0.1_65)] dark:bg-[color:oklch(0.3_0.08_60/_0.35)] dark:text-[color:oklch(0.85_0.12_65)] dark:ring-[color:oklch(0.55_0.12_60/_0.4)]",
  destructive:
    "bg-[color:oklch(0.96_0.04_27)] text-[color:oklch(0.4_0.16_27)] ring-1 ring-inset ring-[color:oklch(0.86_0.1_27)] dark:bg-[color:oklch(0.3_0.1_27/_0.35)] dark:text-[color:oklch(0.85_0.14_27)] dark:ring-[color:oklch(0.55_0.16_27/_0.4)]",
  primary:
    "bg-accent text-accent-foreground ring-1 ring-inset ring-[color:oklch(0.86_0.04_258)] dark:ring-[color:oklch(0.45_0.12_258/_0.4)]",
};

type Size = "sm" | "md";
const sizeStyles: Record<Size, string> = {
  sm: "h-5 px-2 text-[11px]",
  md: "h-6 px-2.5 text-xs",
};

export type StatusPillProps = {
  tone?: Tone;
  size?: Size;
  icon?: React.ReactNode;
  dot?: boolean;
  className?: string;
  children: React.ReactNode;
};

/** Premium status pill with semantic tones — used across PV statuses, billing, audit. */
export function StatusPill({
  tone = "neutral",
  size = "md",
  icon,
  dot = false,
  className,
  children,
}: StatusPillProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap",
        toneStyles[tone],
        sizeStyles[size],
        className,
      )}
    >
      {dot && (
        <span
          aria-hidden
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            tone === "success" && "bg-[color:oklch(0.55_0.16_152)]",
            tone === "warning" && "bg-[color:oklch(0.65_0.18_60)]",
            tone === "destructive" && "bg-[color:oklch(0.58_0.22_27)]",
            tone === "info" && "bg-[color:oklch(0.55_0.13_230)]",
            tone === "primary" && "bg-primary",
            tone === "neutral" && "bg-muted-foreground/60",
          )}
        />
      )}
      {icon && <span className="-ml-0.5 inline-flex items-center [&>svg]:h-3 [&>svg]:w-3">{icon}</span>}
      {children}
    </span>
  );
}

/** Convenience: map a PV status string to a StatusPill tone + label. */
export function PvStatusPill({ status, size = "md" }: { status: string; size?: Size }) {
  const map: Record<string, { tone: Tone; label: string }> = {
    brouillon: { tone: "neutral", label: "Brouillon" },
    en_cours: { tone: "info", label: "En cours" },
    envoye: { tone: "info", label: "Envoyé" },
    envoye_au_client: { tone: "info", label: "Envoyé au client" },
    en_attente_signature: { tone: "warning", label: "À signer" },
    signe: { tone: "success", label: "Signé" },
    signe_par_client: { tone: "success", label: "Signé par client" },
    cloture: { tone: "success", label: "Clôturé" },
    refuse: { tone: "destructive", label: "Refusé" },
    annule: { tone: "destructive", label: "Annulé" },
  };
  const entry = map[status] ?? { tone: "neutral" as Tone, label: status };
  return (
    <StatusPill tone={entry.tone} size={size} dot>
      {entry.label}
    </StatusPill>
  );
}
