import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

type Props = {
  variant?: "default" | "compact" | "mono";
  className?: string;
  withLink?: boolean;
  tagline?: boolean;
};

/**
 * Brand mark for PVIA — text logo with subtle mark, premium navy palette.
 * Use `variant="compact"` in dense headers, `variant="mono"` on colored surfaces.
 */
export function BrandLogo({ variant = "default", className, withLink = false, tagline = false }: Props) {
  const isMono = variant === "mono";
  const isCompact = variant === "compact";

  const content = (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span
        className={cn(
          "relative grid place-items-center rounded-lg shadow-sm transition-transform group-hover:scale-105",
          isCompact ? "h-7 w-7" : "h-9 w-9",
          isMono
            ? "bg-primary-foreground/15 text-primary-foreground ring-1 ring-primary-foreground/20"
            : "bg-brand-gradient text-primary-foreground",
        )}
        aria-hidden
      >
        <svg viewBox="0 0 24 24" className={cn(isCompact ? "h-3.5 w-3.5" : "h-4 w-4")} fill="none">
          <path d="M5 4h9l5 5v11H5z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M14 4v5h5" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M8.5 13.5l2.2 2.2L16 10.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="flex flex-col leading-none">
        <span
          className={cn(
            "font-display font-bold tracking-tight",
            isCompact ? "text-base" : "text-lg",
            isMono ? "text-primary-foreground" : "text-foreground",
          )}
        >
          PVIA
        </span>
        {tagline && (
          <span
            className={cn(
              "mt-0.5 text-[10px] font-medium uppercase tracking-[0.14em]",
              isMono ? "text-primary-foreground/70" : "text-muted-foreground",
            )}
          >
            Réception intelligente
          </span>
        )}
      </span>
    </span>
  );

  if (withLink) {
    return (
      <Link to="/" className="group inline-flex items-center">
        {content}
      </Link>
    );
  }
  return content;
}
