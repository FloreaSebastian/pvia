import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Menu, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Logo } from "@/components/landing/Logo";

const nav: { label: string; href: string }[] = [
  { label: "Fonctionnalités", href: "/fonctionnalites" },
  { label: "Comment ça marche", href: "/comment-ca-marche" },
  { label: "Réserves", href: "/gestion-des-reserves" },
  { label: "Mode terrain", href: "/mode-terrain" },
  { label: "Espace client", href: "/espace-client" },
  { label: "Tarifs", href: "/tarifs" },
];

export function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-colors ${
        scrolled ? "glass border-b border-border/60" : "border-b border-transparent bg-transparent"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <Logo className="min-w-0 shrink" />

        <nav aria-label="Navigation principale" className="hidden items-center gap-6 lg:flex">
          {nav.map((i) => (
            <Link
              key={i.href}
              to={i.href}
              activeProps={{ className: "text-foreground" }}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {i.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          <Button variant="ghost" size="sm" className="min-h-11" asChild>
            <Link to="/login">Connexion</Link>
          </Button>
          <Button size="sm" className="min-h-11 shadow-elevation-md" asChild>
            <Link to="/signup">
              Essayer gratuitement <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>

        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="min-h-11 min-w-11 lg:hidden"
              aria-label="Ouvrir le menu"
            >
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-[min(20rem,88vw)] p-0">
            <SheetHeader className="border-b border-border px-5 py-4 text-left">
              <SheetTitle className="text-base">Menu</SheetTitle>
              <SheetDescription className="text-xs">
                Navigation du site PVIA
              </SheetDescription>
            </SheetHeader>
            <nav aria-label="Navigation mobile" className="flex flex-col gap-1 p-4">
              {nav.map((i) => (
                <SheetClose asChild key={i.href}>
                  <a
                    href={i.href}
                    className="flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-foreground hover:bg-muted"
                  >
                    {i.label}
                  </a>
                </SheetClose>
              ))}
              <div className="mt-3 space-y-2 border-t border-border pt-4">
                <SheetClose asChild>
                  <Button variant="outline" className="min-h-11 w-full" asChild>
                    <Link to="/login">Connexion</Link>
                  </Button>
                </SheetClose>
                <SheetClose asChild>
                  <Button className="min-h-12 w-full" asChild>
                    <Link to="/signup">Essayer gratuitement</Link>
                  </Button>
                </SheetClose>
              </div>
              <p className="px-3 pt-2 text-xs text-muted-foreground">
                14 jours gratuits · Sans engagement
              </p>
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
