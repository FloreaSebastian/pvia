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
        "border-b border-border/60 bg-background/60",
        contained ? "px-4 py-6 sm:px-6 lg:px-8 lg:py-8" : "py-6",
        className,
      )}
    >
      {breadcrumbs && (
        <div className="mb-3 text-xs text-muted-foreground">{breadcrumbs}</div>
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {eyebrow && (
            <div className="mb-1.5 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary/80">
              {eyebrow}
            </div>
          )}
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            {title}
          </h1>
          {description && (
            <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">{actions}</div>}
      </div>
    </header>
  );
}
