import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Menu, X, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/landing/Logo";

const nav: { label: string; href: string; to?: string }[] = [
  { label: "Pourquoi PVIA", href: "/#why" },
  { label: "Fonctionnalités", href: "/#features" },
  { label: "Tarifs", href: "/tarifs", to: "/tarifs" },
  { label: "Sécurité", href: "/securite", to: "/securite" },
  { label: "Avis clients", href: "/#testimonials" },
];

export function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all ${
        scrolled ? "glass border-b border-border/60" : "bg-transparent"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Logo withBaseline />

        <nav className="hidden items-center gap-8 lg:flex">
          {nav.map((i) => (
            <a
              key={i.href}
              href={i.href}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {i.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/login">Connexion</Link>
          </Button>
          <Button size="sm" className="shadow-brand" asChild>
            <Link to="/signup">Créer mon premier PV <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link>
          </Button>
        </div>

        <button
          onClick={() => setOpen(!open)}
          className="rounded-md p-2 lg:hidden"
          aria-label="Toggle menu"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open && (
        <div className="border-t border-border/60 bg-background/95 backdrop-blur lg:hidden">
          <div className="space-y-1 px-4 py-4">
            {nav.map((i) => (
              <a
                key={i.href}
                href={i.href}
                onClick={() => setOpen(false)}
                className="block rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {i.label}
              </a>
            ))}
            <div className="flex gap-2 pt-2">
              <Button variant="outline" size="sm" className="flex-1" asChild>
                <Link to="/login">Connexion</Link>
              </Button>
              <Button size="sm" className="flex-1" asChild>
                <Link to="/signup">Essai gratuit</Link>
              </Button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
