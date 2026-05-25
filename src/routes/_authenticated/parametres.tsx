import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Settings as SettingsIcon, Building2, Palette, Bell, Shield, Users, CreditCard,
  Plug, Webhook, Sliders, Database, Search, ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/parametres")({
  component: SettingsLayout,
  head: () => ({ meta: [{ title: "Paramètres — PVIA" }] }),
});

type Item = {
  to: string;
  label: string;
  desc: string;
  icon: typeof SettingsIcon;
  external?: boolean; // true → existing standalone page (will exit the layout)
};

const ITEMS: Item[] = [
  { to: "/parametres",               label: "Général",            desc: "Compte, langue, fuseau", icon: SettingsIcon },
  { to: "/entreprise",               label: "Entreprise",         desc: "Identité légale, SIREN", icon: Building2, external: true },
  { to: "/parametres/branding",      label: "Branding",           desc: "Logo, couleurs, footer", icon: Palette },
  { to: "/parametres/notifications", label: "Notifications",      desc: "Email, push, rappels",   icon: Bell },
  { to: "/parametres/securite",      label: "Sécurité",           desc: "Sessions, appareils",    icon: Shield },
  { to: "/equipe",                   label: "Utilisateurs",       desc: "Membres, rôles, invits", icon: Users, external: true },
  { to: "/billing",                  label: "Facturation",        desc: "Plan, factures, essai",  icon: CreditCard, external: true },
  { to: "/parametres/integrations",  label: "Intégrations",       desc: "Stripe, Resend, Drive",  icon: Plug },
  { to: "/parametres/api",           label: "API & webhooks",     desc: "Clés, endpoints, logs",  icon: Webhook },
  { to: "/parametres/preferences",   label: "Préférences",        desc: "Thème, densité, sons",   icon: Sliders },
  { to: "/parametres/donnees",       label: "Données & exports",  desc: "Export, RGPD, suppr.",   icon: Database },
];

function SettingsLayout() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return ITEMS;
    return ITEMS.filter((i) =>
      i.label.toLowerCase().includes(s) || i.desc.toLowerCase().includes(s),
    );
  }, [q]);

  return (
    <div className="mx-auto w-full max-w-7xl p-4 lg:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Paramètres</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tout le contrôle de PVIA — entreprise, branding, sécurité, intégrations.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Rechercher…"
              className="h-9 pl-8"
            />
          </div>
          <nav className="flex flex-col gap-0.5 rounded-2xl border border-border bg-card/40 p-2">
            {filtered.map((it) => {
              const Active =
                it.to === "/parametres"
                  ? path === "/parametres"
                  : path === it.to;
              const Icon = it.icon;
              return (
                <Link
                  key={it.to}
                  to={it.to as any}
                  className={cn(
                    "group flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm transition-colors",
                    Active
                      ? "bg-primary/10 text-foreground"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <Icon className={cn("h-4 w-4 shrink-0", Active && "text-primary")} />
                    <span className="truncate">{it.label}</span>
                  </span>
                  {it.external && (
                    <ExternalLink className="h-3.5 w-3.5 opacity-60" aria-label="Ouvre une autre page" />
                  )}
                </Link>
              );
            })}
            {filtered.length === 0 && (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                Aucun résultat.
              </div>
            )}
          </nav>
        </aside>

        <section className="min-w-0">
          <Outlet />
        </section>
      </div>
    </div>
  );
}
