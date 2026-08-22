import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  AlertCircle,
  BarChart3,
  Calendar,
  FileText,
  HardHat,
  LayoutDashboard,
  Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/hooks/use-company";

type Hit = { id: string; label: string; sub?: string | null; to: string; kind: "pv" | "chantier" | "client" };

const PAGES = [
  { to: "/dashboard", label: "Tableau de bord", icon: LayoutDashboard },
  { to: "/pv", label: "Procès-verbaux", icon: FileText },
  { to: "/reserves", label: "Réserves", icon: AlertCircle },
  { to: "/chantiers/calendrier", label: "Calendrier", icon: Calendar },
  { to: "/chantiers", label: "Chantiers", icon: HardHat },
  { to: "/clients", label: "Clients", icon: Users },
  { to: "/statistiques", label: "Statistiques", icon: BarChart3 },
] as const;

/** Échappe les caractères spéciaux du filtre PostgREST `or(...)`. */
function sanitize(term: string) {
  return term.replace(/[%,()*\\]/g, " ").trim();
}

/**
 * Recherche globale du shell (⌘K / Ctrl+K).
 * Les requêtes sont bornées à l'entreprise active ; la RLS reste la garantie
 * finale d'isolation multi-tenant.
 */
export function GlobalSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate();
  const { activeCompanyId } = useCompany();
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);

  // Réinitialisation à la fermeture et au changement d'entreprise (anti-fuite visuelle).
  useEffect(() => {
    if (!open) {
      setTerm("");
      setHits([]);
    }
  }, [open]);
  useEffect(() => {
    setHits([]);
  }, [activeCompanyId]);

  useEffect(() => {
    const q = sanitize(term);
    if (!open || !activeCompanyId || q.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      const like = `%${q}%`;
      const [pv, chantiers, clients] = await Promise.all([
        supabase
          .from("pv")
          .select("id,numero,status")
          .eq("company_id", activeCompanyId)
          .ilike("numero", like)
          .order("created_at", { ascending: false })
          .limit(5),
        supabase
          .from("chantiers")
          .select("id,name,reference,city")
          .eq("company_id", activeCompanyId)
          .or(`name.ilike.${like},reference.ilike.${like}`)
          .limit(5),
        supabase
          .from("clients")
          .select("id,name,company_name,city")
          .eq("company_id", activeCompanyId)
          .is("archived_at", null)
          .or(`name.ilike.${like},company_name.ilike.${like}`)
          .limit(5),
      ]);
      if (cancelled) return;
      const out: Hit[] = [
        ...((pv.data ?? []) as any[]).map((r) => ({
          id: r.id,
          label: r.numero ?? "PV",
          sub: r.status as string | null,
          to: `/pv/${r.id}`,
          kind: "pv" as const,
        })),
        ...((chantiers.data ?? []) as any[]).map((r) => ({
          id: r.id,
          label: r.name as string,
          sub: [r.reference, r.city].filter(Boolean).join(" · ") || null,
          to: `/chantiers/${r.id}`,
          kind: "chantier" as const,
        })),
        ...((clients.data ?? []) as any[]).map((r) => ({
          id: r.id,
          label: (r.company_name || r.name) as string,
          sub: r.city as string | null,
          to: `/clients`,
          kind: "client" as const,
        })),
      ];
      setHits(out);
      setLoading(false);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term, open, activeCompanyId]);

  const groups = useMemo(
    () => ({
      pv: hits.filter((h) => h.kind === "pv"),
      chantier: hits.filter((h) => h.kind === "chantier"),
      client: hits.filter((h) => h.kind === "client"),
    }),
    [hits],
  );

  function go(to: string) {
    onOpenChange(false);
    navigate({ to: to as any });
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        value={term}
        onValueChange={setTerm}
        placeholder="Rechercher un PV, un chantier, un client…"
      />
      <CommandList>
        <CommandEmpty>
          {term.trim().length < 2
            ? "Saisissez au moins 2 caractères."
            : loading
              ? "Recherche…"
              : "Aucun résultat."}
        </CommandEmpty>

        {groups.pv.length > 0 && (
          <CommandGroup heading="Procès-verbaux">
            {groups.pv.map((h) => (
              <CommandItem key={h.id} value={`pv ${h.label}`} onSelect={() => go(h.to)}>
                <FileText className="mr-2 h-4 w-4 text-muted-foreground" />
                <span className="flex-1 truncate">{h.label}</span>
                {h.sub && <span className="ml-2 truncate text-xs text-muted-foreground">{h.sub}</span>}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {groups.chantier.length > 0 && (
          <CommandGroup heading="Chantiers">
            {groups.chantier.map((h) => (
              <CommandItem key={h.id} value={`chantier ${h.label} ${h.sub ?? ""}`} onSelect={() => go(h.to)}>
                <HardHat className="mr-2 h-4 w-4 text-muted-foreground" />
                <span className="flex-1 truncate">{h.label}</span>
                {h.sub && <span className="ml-2 truncate text-xs text-muted-foreground">{h.sub}</span>}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {groups.client.length > 0 && (
          <CommandGroup heading="Clients">
            {groups.client.map((h) => (
              <CommandItem key={h.id} value={`client ${h.label}`} onSelect={() => go(h.to)}>
                <Users className="mr-2 h-4 w-4 text-muted-foreground" />
                <span className="flex-1 truncate">{h.label}</span>
                {h.sub && <span className="ml-2 truncate text-xs text-muted-foreground">{h.sub}</span>}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandGroup heading="Navigation">
          {PAGES.map((p) => {
            const Icon = p.icon;
            return (
              <CommandItem key={p.to} value={`page ${p.label}`} onSelect={() => go(p.to)}>
                <Icon className="mr-2 h-4 w-4 text-muted-foreground" />
                <span className="flex-1">{p.label}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
