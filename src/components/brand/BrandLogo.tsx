import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import pviaLogo from "@/assets/pvia-logo.png";

type Props = {
  variant?: "default" | "compact" | "mono";
  className?: string;
  withLink?: boolean;
  tagline?: boolean;
};

/**
 * Brand mark for PVIA — official logo + wordmark, premium navy palette.
 * Use `variant="compact"` in dense headers, `variant="mono"` on colored surfaces.
 */
export function BrandLogo({ variant = "default", className, withLink = false, tagline = false }: Props) {
  const isMono = variant === "mono";
  const isCompact = variant === "compact";

  const content = (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <img
        src={pviaLogo}
        alt="PVIA"
        className={cn(
          "object-contain transition-transform group-hover:scale-105",
          isCompact ? "h-7 w-7" : "h-9 w-9",
          isMono && "brightness-0 invert",
        )}
        loading="eager"
        decoding="async"
      />
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
