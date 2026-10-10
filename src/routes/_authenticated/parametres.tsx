import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Settings as SettingsIcon,
  Building2,
  Palette,
  Bell,
  Shield,
  Users,
  CreditCard,
  Plug,
  Webhook,
  Sliders,
  Database,
  Search,
  ExternalLink,
  Activity,
  Menu,
  Command as CmdIcon,
  Hash,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetHeader } from "@/components/ui/sheet";
import { SettingsCommand, type SettingsCommandItem } from "@/components/app/SettingsCommand";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { useCompany } from "@/hooks/use-company";
import { allowedSettings, type SettingsEntry } from "@/lib/role-access";

export const Route = createFileRoute("/_authenticated/parametres")({
  component: SettingsLayout,
  head: () => ({ meta: [{ title: "Paramètres — PVIA" }] }),
});

type Item = SettingsEntry & { icon: typeof SettingsIcon };

const ICONS: Record<string, typeof SettingsIcon> = {
  "/parametres": SettingsIcon,
  "/parametres/preferences": Sliders,
  "/parametres/securite": Shield,
  "/parametres/notifications": Bell,
  "/entreprise": Building2,
  "/parametres/branding": Palette,
  "/equipe": Users,
  "/billing": CreditCard,
  "/parametres/numerotation": Hash,
  "/parametres/integrations": Plug,
  "/parametres/api": Webhook,
  "/parametres/audit": Activity,
  "/parametres/donnees": Database,
};

function NavList({
  items,
  path,
  onPick,
  readOnly,
}: {
  items: Item[];
  path: string;
  onPick?: () => void;
  readOnly: boolean;
}) {
  const grouped = items.reduce<Record<string, Item[]>>((acc, it) => {
    (acc[it.group] ||= []).push(it);
    return acc;
  }, {});
  return (
    <nav className="flex flex-col gap-3">
      {Object.entries(grouped).map(([group, list]) => (
        <div key={group}>
          <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            {group}
          </div>
          <div className="flex flex-col gap-0.5 rounded-2xl border border-border bg-card/40 p-2">
            {list.map((it) => {
              const active = it.to === "/parametres" ? path === "/parametres" : path === it.to;
              const Icon = it.icon;
              return (
                <Link
                  key={it.to}
                  to={it.to}
                  onClick={onPick}
                  className={cn(
                    "group flex min-h-11 items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm transition-colors",
                    active
                      ? "bg-primary/10 text-foreground"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <Icon className={cn("h-4 w-4 shrink-0", active && "text-primary")} />
                    <span className="truncate">{it.label}</span>
                  </span>
                  {it.readOnlyForOthers && readOnly && (
                    <span className="shrink-0 text-xs text-muted-foreground">Consultation</span>
                  )}
                  {it.external && (
                    <ExternalLink
                      className="h-3.5 w-3.5 opacity-60"
                      aria-label="Ouvre une autre page"
                    />
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
      {items.length === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-card/40 px-3 py-6 text-center text-xs text-muted-foreground">
          Aucun résultat.
        </div>
      )}
    </nav>
  );
}

function SettingsLayout() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [q, setQ] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const { activeRole, can } = useCompany();
  const readOnly = !can("admin");
  // Liste autorisée unique : desktop, mobile, recherche et palette.
  const ITEMS = useMemo<Item[]>(
    () => allowedSettings(activeRole).map((e) => ({ ...e, icon: ICONS[e.to] ?? SettingsIcon })),
    [activeRole],
  );

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return ITEMS;
    return ITEMS.filter(
      (i) =>
        i.label.toLowerCase().includes(s) ||
        i.desc.toLowerCase().includes(s) ||
        i.group.toLowerCase().includes(s),
    );
  }, [q, ITEMS]);

  const cmdItems: SettingsCommandItem[] = ITEMS.map((i) => ({
    to: i.to,
    label: i.label,
    desc: i.desc,
    group: i.group,
    icon: i.icon,
  }));

  useKeyboardShortcut("mod+k", (e) => {
    e.preventDefault();
    setCmdOpen((o) => !o);
  });

  return (
    <div className="mx-auto w-full max-w-7xl p-4 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] lg:p-8">
      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Paramètres</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {readOnly
              ? "Votre compte personnel et la consultation des réglages de l’entreprise."
              : "Votre compte et l’administration de l’entreprise."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="hidden gap-2 sm:inline-flex"
            onClick={() => setCmdOpen(true)}
          >
            <Search className="h-4 w-4" />
            <span>Rechercher</span>
            <kbd className="ml-1 hidden items-center gap-0.5 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground sm:inline-flex">
              <CmdIcon className="h-3 w-3" /> K
            </kbd>
          </Button>
          {/* Mobile: open sidebar */}
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>
              <Button
                size="icon"
                variant="outline"
                className="h-11 w-11 lg:hidden"
                aria-label="Ouvrir le menu des paramètres"
              >
                <Menu className="h-4 w-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[88vw] max-w-sm overflow-y-auto p-4">
              <SheetHeader className="mb-4 text-left">
                <SheetTitle>Paramètres</SheetTitle>
              </SheetHeader>
              <div className="relative mb-3">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Rechercher…"
                  className="h-9 pl-8"
                />
              </div>
              <NavList
                items={filtered}
                path={path}
                readOnly={readOnly}
                onPick={() => setSheetOpen(false)}
              />
            </SheetContent>
          </Sheet>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* Desktop sidebar */}
        <aside className="hidden lg:sticky lg:top-4 lg:block lg:self-start">
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Rechercher…"
              className="h-9 pl-8"
            />
          </div>
          <NavList items={filtered} path={path} readOnly={readOnly} />
        </aside>

        <section className="min-w-0">
          <Outlet />
        </section>
      </div>

      <SettingsCommand open={cmdOpen} onOpenChange={setCmdOpen} items={cmdItems} />
    </div>
  );
}
