import { ReactNode } from "react";
import { Header } from "@/components/landing/Header";
import { Footer } from "@/components/landing/Footer";

interface PublicPageShellProps {
  eyebrow?: string;
  title: string;
  description?: string;
  children: ReactNode;
}

export function PublicPageShell({ eyebrow, title, description, children }: PublicPageShellProps) {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="pt-32 pb-20 sm:pt-40">
        <section className="relative">
          <div className="absolute inset-x-0 top-0 -z-10 h-[420px] bg-radial-fade" />
          <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
            {eyebrow && (
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                {eyebrow}
              </span>
            )}
            <h1 className="mt-3 text-balance font-display text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
              {title}
            </h1>
            {description && (
              <p className="mt-5 text-pretty text-base text-muted-foreground sm:text-lg">
                {description}
              </p>
            )}
          </div>
        </section>

        <section className="mx-auto mt-12 max-w-3xl px-4 sm:px-6 lg:px-8">
          <div className="rounded-2xl border border-border bg-card p-8 shadow-sm sm:p-10">
            <div className="legal-prose text-[15px] leading-relaxed text-foreground/90">
              {children}
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
