import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Menu, ArrowRight, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { SOLUTIONS } from "@/components/landing/solutions-data";

type NavLink = { label: string; href: string; desc?: string };

export const PRODUCT_NAV: NavLink[] = [
  { label: "Vue d'ensemble", href: "/fonctionnalites", desc: "Tout ce que couvre PVIA" },
  { label: "PV de réception", href: "/pv-reception", desc: "Du chantier au PDF signé" },
  { label: "Réserves", href: "/gestion-des-reserves", desc: "Suivies jusqu'à la validation" },
  { label: "Mode terrain", href: "/mode-terrain", desc: "Photos et signature sur place" },
  { label: "Planning", href: "/planning-chantier", desc: "Interventions et équipes" },
  { label: "Espace client", href: "/espace-client", desc: "L'expérience de votre client" },
];

export const TRADES_NAV: NavLink[] = SOLUTIONS.map((s) => ({
  label: s.label,
  href: `/solutions/${s.slug}`,
}));

export const SOLUTIONS_NAV: NavLink[] = SOLUTION_PAGES.map((p) => ({
  label: p.navLabel,
  href: `/solutions/${p.slug}`,
  desc: p.navDesc,
  icon: p.navIcon,
  group: p.navGroup,
}));

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

        <nav aria-label="Navigation principale" className="hidden items-center gap-1 lg:flex">
          <NavDropdown label="Produit" items={PRODUCT_NAV} />
          <NavDropdown label="Solutions" items={SOLUTIONS_NAV} footer="/solutions" />
          <TopLink to="/tarifs">Tarifs</TopLink>
          <TopLink to="/pourquoi-pvia">Pourquoi PVIA ?</TopLink>
          <TopLink to="/contact">Contact</TopLink>
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
          <SheetContent side="right" className="flex w-[min(20rem,88vw)] flex-col p-0">
            <SheetHeader className="border-b border-border px-5 py-4 text-left">
              <SheetTitle className="text-base">Menu</SheetTitle>
              <SheetDescription className="text-xs">Navigation du site PVIA</SheetDescription>
            </SheetHeader>

            <nav
              aria-label="Navigation mobile"
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4"
            >
              <MobileGroup title="Produit" items={PRODUCT_NAV} />
              <MobileGroup
                title="Solutions"
                items={[{ label: "Tous les métiers", href: "/solutions" }, ...SOLUTIONS_NAV]}
              />
              <MobileGroup
                title="En savoir plus"
                items={[
                  { label: "Tarifs", href: "/tarifs" },
                  { label: "Pourquoi PVIA ?", href: "/pourquoi-pvia" },
                  { label: "Contact", href: "/contact" },
                  { label: "Sécurité", href: "/securite" },
                ]}
              />
            </nav>

            <div className="space-y-2 border-t border-border p-4">
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
              <p className="text-center text-xs text-muted-foreground">
                14 jours gratuits · Sans engagement
              </p>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}

function TopLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      activeProps={{ className: "text-foreground" }}
      className="flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
    >
      {children}
    </Link>
  );
}

function NavDropdown({
  label,
  items,
  footer,
}: {
  label: string;
  items: NavLink[];
  footer?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex min-h-11 items-center gap-1 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground data-[state=open]:text-foreground"
        >
          {label}
          <ChevronDown aria-hidden className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        {items.map((i) => (
          <DropdownMenuItem key={i.href} asChild>
            <Link to={i.href} className="flex min-h-11 flex-col items-start gap-0.5">
              <span className="text-sm font-medium text-foreground">{i.label}</span>
              {i.desc && <span className="text-xs text-muted-foreground">{i.desc}</span>}
            </Link>
          </DropdownMenuItem>
        ))}
        {footer && (
          <DropdownMenuItem asChild>
            <Link to={footer} className="min-h-11 text-sm font-medium text-primary">
              Tous les métiers
            </Link>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MobileGroup({ title, items }: { title: string; items: NavLink[] }) {
  return (
    <div className="mb-4">
      <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </p>
      <ul>
        {items.map((i) => (
          <li key={i.href}>
            <SheetClose asChild>
              <Link
                to={i.href}
                className="flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-foreground hover:bg-muted"
              >
                {i.label}
              </Link>
            </SheetClose>
          </li>
        ))}
      </ul>
    </div>
  );
}
