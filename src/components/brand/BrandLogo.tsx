import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import pviaMark from "@/assets/pvia-mark.png.asset.json";
import pviaWordmark from "@/assets/pvia-wordmark.png.asset.json";

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
        src={pviaMark.url}
        alt=""
        aria-hidden="true"
        className={cn(
          "object-contain transition-transform group-hover:scale-105",
          isCompact ? "h-10 w-10" : "h-12 w-12",
          isMono && "brightness-0 invert",
        )}
        loading="eager"
        decoding="async"
      />
      <span className="flex flex-col leading-none">
        <img
          src={pviaWordmark.url}
          alt="PVIA"
          className={cn(
            "object-contain",
            isCompact ? "h-5 w-auto" : "h-6 w-auto",
            isMono && "brightness-0 invert",
          )}
          loading="eager"
          decoding="async"
        />
        {tagline && (
          <span
            className={cn(
              "mt-1 text-[10px] font-medium uppercase tracking-[0.14em]",
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
