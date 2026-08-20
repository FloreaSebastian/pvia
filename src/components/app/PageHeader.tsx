import * as React from "react";
import { cn } from "@/lib/utils";

type Props = {
  title: React.ReactNode;
  description?: React.ReactNode;
  eyebrow?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumbs?: React.ReactNode;
  className?: string;
  contained?: boolean;
};

/**
 * Standardised page header for the app shell.
 * Provides consistent title typography, eyebrow chip, description, breadcrumbs and right-side actions.
 */
export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  breadcrumbs,
  className,
  contained = true,
}: Props) {
  return (
    <header
      className={cn(
        "min-w-0 border-b border-border/60 bg-background/60",
        contained ? "px-[clamp(0.75rem,3vw,2rem)] py-5 sm:py-6 lg:py-8" : "py-5 sm:py-6",
        className,
      )}
    >
      {breadcrumbs && (
        <div className="mb-3 text-xs text-muted-foreground">{breadcrumbs}</div>
      )}
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div className="min-w-0">
          {eyebrow && (
            <div className="mb-1.5 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary/80">
              {eyebrow}
            </div>
          )}
          <h1 className="break-anywhere font-display text-[clamp(1.25rem,5vw,1.875rem)] font-bold leading-tight tracking-tight text-foreground">
            {title}
          </h1>
          {description && (
            <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {actions && <div className="action-row items-center sm:flex-nowrap">{actions}</div>}
      </div>
    </header>
  );
}
