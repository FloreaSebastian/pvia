import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Menu, X, FileSignature } from "lucide-react";
import { Button } from "@/components/ui/button";

const nav = [
  { label: "Accueil", href: "#hero" },
  { label: "Fonctionnalités", href: "#features" },
  { label: "Démonstration", href: "#demo" },
  { label: "Tarifs", href: "#pricing" },
  { label: "Avis clients", href: "#testimonials" },
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
        <Link to="/" className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <FileSignature className="h-5 w-5" />
          </div>
          <span className="text-base font-semibold tracking-tight">
            PV<span className="text-primary">Pro</span>
          </span>
        </Link>

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
            <a href="#login">Connexion</a>
          </Button>
          <Button size="sm" className="shadow-sm" asChild>
            <a href="#signup">Créer mon PV de réception</a>
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
              <Button variant="outline" size="sm" className="flex-1">
                Connexion
              </Button>
              <Button size="sm" className="flex-1">
                Essai gratuit
              </Button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
