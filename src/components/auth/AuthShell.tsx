import { motion } from "motion/react";
import { Link } from "@tanstack/react-router";
import { ReactNode } from "react";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { ShieldCheck, Star } from "lucide-react";

type AuthShellProps = {
  /** Heading shown on the brand (left) panel */
  brandHeading: ReactNode;
  /** Sub-paragraph under the heading */
  brandSubtitle?: ReactNode;
  /** Optional list of bullet features under the subtitle */
  bullets?: ReactNode[];
  /** Testimonial quote shown above the footer */
  quote?: {
    text: string;
    author: string;
    role: string;
  };
  /** Right panel content (form card) */
  children: ReactNode;
};

const DEFAULT_QUOTE = {
  text: "Nos PV de réception se signent en 3 minutes sur chantier. Plus aucun litige depuis 8 mois.",
  author: "Aurélien M.",
  role: "Gérant — Toitures du Sud",
};

export function AuthShell({
  brandHeading,
  brandSubtitle,
  bullets,
  quote = DEFAULT_QUOTE,
  children,
}: AuthShellProps) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel */}
      <aside className="relative hidden overflow-hidden bg-brand-gradient text-primary-foreground lg:flex lg:flex-col lg:justify-between lg:p-12">
        {/* Grid pattern */}
        <div
          className="absolute inset-0 -z-0 opacity-[0.12]"
          style={{
            backgroundImage:
              "linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)",
            backgroundSize: "56px 56px",
            maskImage: "radial-gradient(ellipse at 30% 40%, black 30%, transparent 80%)",
          }}
        />
        {/* Aurora glow */}
        <div
          className="absolute inset-0 -z-0 opacity-50"
          style={{
            backgroundImage:
              "radial-gradient(circle at 80% 20%, oklch(0.7 0.18 200 / 0.5) 0, transparent 45%), radial-gradient(circle at 20% 90%, oklch(0.55 0.2 320 / 0.4) 0, transparent 45%)",
          }}
        />

        <div className="relative">
          <Link to="/" aria-label="PVIA" className="inline-block transition hover:opacity-90">
            <BrandLogo variant="mono" />
          </Link>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55 }}
          className="relative max-w-md"
        >
          <h2 className="text-balance font-display text-4xl font-bold leading-[1.1] tracking-tight">
            {brandHeading}
          </h2>
          {brandSubtitle && (
            <p className="mt-4 text-pretty text-primary-foreground/85">{brandSubtitle}</p>
          )}
          {bullets && bullets.length > 0 && (
            <ul className="mt-7 space-y-2.5 text-sm text-primary-foreground/85">
              {bullets.map((b, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary-foreground/15">
                    <ShieldCheck className="h-3 w-3" />
                  </span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}

          {/* Testimonial card */}
          <motion.figure
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.15 }}
            className="mt-10 rounded-2xl border border-primary-foreground/15 bg-primary-foreground/[0.06] p-5 backdrop-blur-sm"
          >
            <div className="flex gap-0.5">
              {[0, 1, 2, 3, 4].map((i) => (
                <Star key={i} className="h-3.5 w-3.5 fill-primary-foreground text-primary-foreground" />
              ))}
            </div>
            <blockquote className="mt-3 text-pretty text-sm leading-relaxed text-primary-foreground/95">
              « {quote.text} »
            </blockquote>
            <figcaption className="mt-3 text-xs text-primary-foreground/70">
              <span className="font-semibold text-primary-foreground/90">{quote.author}</span> · {quote.role}
            </figcaption>
          </motion.figure>
        </motion.div>

        <div className="relative flex items-center justify-between text-xs text-primary-foreground/70">
          <span>© 2026 PVIA</span>
          <span className="flex items-center gap-3">
            <span>Hébergé en France 🇫🇷</span>
            <span>RGPD</span>
          </span>
        </div>
      </aside>

      {/* Form panel */}
      <main className="flex items-center justify-center p-6 sm:p-10 lg:p-12">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-md"
        >
          {children}
        </motion.div>
      </main>
    </div>
  );
}
