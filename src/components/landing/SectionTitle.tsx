import * as React from "react";
import { cn } from "@/lib/utils";

type Props = {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  align?: "left" | "center";
  className?: string;
};

/** Landing-page section heading — premium SaaS rhythm. */
export function SectionTitle({ eyebrow, title, description, align = "center", className }: Props) {
  return (
    <div
      className={cn(
        "mx-auto max-w-2xl",
        align === "center" ? "text-center" : "text-left",
        className,
      )}
    >
      {eyebrow && (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary shadow-elevation-sm">
          {eyebrow}
        </span>
      )}
      <h2 className="mt-4 font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
        {title}
      </h2>
      {description && (
        <p
          className={cn(
            "mt-3 text-base text-muted-foreground sm:text-lg",
            align === "center" ? "mx-auto" : "",
          )}
        >
          {description}
        </p>
      )}
    </div>
  );
}
