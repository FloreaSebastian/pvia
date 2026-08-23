import { useCallback, useEffect, useState } from "react";
import { Building2, User, Mail, Phone, MapPin, Navigation, Pencil, Archive, X, Briefcase, FileText, AlertTriangle, History, ExternalLink, ShieldCheck, Send, Loader2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getClientPortalStatus, inviteClientToPortal, type PortalStatus } from "@/lib/client-portal.functions";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from "@/hooks/use-mobile";
import { useCompany } from "@/hooks/use-company";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

type Client = {
  id: string; name: string; email: string | null; phone: string | null;
  address: string | null; address_line1: string | null; postal_code: string | null;
  city: string | null; latitude: number | null; longitude: number | null;
  notes: string | null; client_type: "particulier" | "entreprise" | null;
  company_name: string | null; siret: string | null; siren: string | null;
  vat_number: string | null; naf_code: string | null; contact_name: string | null;
  archived_at: string | null; archived_by: string | null; archive_reason: string | null;
};

type Chantier = { id: string; name: string; reference: string | null; status: string | null; start_date: string | null };
type Pv = { id: string; numero: string | null; status: string | null; created_at: string; reception_date: string | null };
type ReserveCounts = { open: number; lifted: number };

type Props = {
  client: Client | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onEdit: (c: Client) => void;
  onDelete: (id: string) => void;
};

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase() ?? "").join("");
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" }); } catch { return "—"; }
}

function TypeBadge({ type }: { type: Client["client_type"] }) {
  const isEnt = type === "entreprise";
  return (
    <Badge variant="outline" className={cn("gap-1 text-[10px]", isEnt ? "border-blue-500/40 text-blue-600 dark:text-blue-400" : "border-emerald-500/40 text-emerald-600 dark:text-emerald-400")}>
      {isEnt ? <Building2 className="h-3 w-3" /> : <User className="h-3 w-3" />}
      {isEnt ? "Entreprise" : "Particulier"}
    </Badge>
  );
}

function SectionCard({ icon: Icon, title, action, children }: { icon: React.ElementType; title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

const PORTAL_LABEL: Record<PortalStatus["state"], { label: string; help: string; tone: string }> = {
  no_email: {
    label: "Indisponible",
    help: "Ajoutez une adresse email au client pour activer son espace en ligne.",
    tone: "border-border text-muted-foreground",
  },
  not_invited: {
    label: "Non activé",
    help: "Ce client n'a pas encore été invité à consulter ses documents en ligne.",
    tone: "border-border text-muted-foreground",
  },
  invited: {
    label: "Invitation envoyée",
    help: "Le client a reçu son invitation mais ne s'est pas encore connecté.",
    tone: "border-amber-500/40 text-amber-600 dark:text-amber-400",
  },
  active: {
    label: "Compte actif",
    help: "Le client accède à ses documents depuis son espace en ligne.",
    tone: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
  },
  suspended: {
    label: "Accès suspendu",
    help: "L'accès à l'espace client a été suspendu pour ce client.",
    tone: "border-destructive/40 text-destructive",
  },
};

function PortalSection({ clientId, companyId, canManage }: { clientId: string; companyId: string | null; canManage: boolean }) {
  const statusFn = useServerFn(getClientPortalStatus);
  const inviteFn = useServerFn(inviteClientToPortal);
  const [status, setStatus] = useState<PortalStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const refresh = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      setStatus(await statusFn({ data: { companyId, clientId } }));
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [companyId, clientId, statusFn]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function invite() {
    if (!companyId || sending) return;
    setSending(true);
    try {
      const res = await inviteFn({ data: { companyId, clientId } });
      toast.success(res.reinvited ? "Invitation renvoyée" : "Invitation envoyée");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Envoi impossible");
    } finally {
      setSending(false);
    }
  }

  const meta = status ? PORTAL_LABEL[status.state] : null;
  const canInvite = canManage && !!status && status.state !== "no_email" && status.state !== "suspended";

  return (
    <SectionCard icon={ShieldCheck} title="Espace client">
      {loading ? (
        <Skeleton className="h-16 w-full" />
      ) : !status || !meta ? (
        <p className="text-xs italic text-muted-foreground">Statut indisponible.</p>
      ) : (
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={cn("text-[10px]", meta.tone)}>{meta.label}</Badge>
            {status.invitedAt && status.state !== "no_email" && (
              <span className="text-[11px] text-muted-foreground">Invité le {fmtDate(status.invitedAt)}</span>
            )}
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">{meta.help}</p>
          {canInvite && (
            <Button
              size="sm"
              variant={status.state === "not_invited" ? "default" : "outline"}
              className="h-11 w-full gap-1.5 sm:h-9 sm:w-auto"
              onClick={invite}
              disabled={sending}
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {status.state === "not_invited" ? "Inviter à l'espace client" : "Renvoyer l'invitation"}
            </Button>
          )}
        </div>
      )}
    </SectionCard>
  );
}

function ClientDetailContent({ client, onEdit, onDelete, onClose }: { client: Client; onEdit: (c: Client) => void; onDelete: (id: string) => void; onClose: () => void }) {
  const { activeCompanyId, can } = useCompany();
  const isEnt = client.client_type === "entreprise";
  const [loading, setLoading] = useState(true);
  const [chantiers, setChantiers] = useState<Chantier[]>([]);
  const [pvs, setPvs] = useState<Pv[]>([]);
  const [reserves, setReserves] = useState<ReserveCounts>({ open: 0, lifted: 0 });

  const fullAddress = [client.address_line1 || client.address, [client.postal_code, client.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const mapsHref = client.latitude && client.longitude
    ? `https://www.google.com/maps/dir/?api=1&destination=${client.latitude},${client.longitude}`
    : fullAddress ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(fullAddress)}` : null;

  useEffect(() => {
    let cancelled = false;
    if (!activeCompanyId) return;
    setLoading(true);
    (async () => {
      const [chRes, pvRes] = await Promise.all([
        supabase.from("chantiers" as any).select("id,name,reference,status,start_date").eq("company_id", activeCompanyId).eq("client_id", client.id).order("start_date", { ascending: false }).limit(20),
        supabase.from("pv" as any).select("id,numero,status,created_at,reception_date").eq("company_id", activeCompanyId).eq("client_id", client.id).order("created_at", { ascending: false }).limit(20),
      ]);
      if (cancelled) return;
      const ch = (chRes.data as unknown as Chantier[]) ?? [];
      const pv = (pvRes.data as unknown as Pv[]) ?? [];
      setChantiers(ch);
      setPvs(pv);

      if (pv.length > 0) {
        const pvIds = pv.map((p) => p.id);
        const { data: r } = await supabase.from("pv_reserves" as any).select("status").in("pv_id", pvIds);
        if (!cancelled && r) {
          const list = r as unknown as Array<{ status: string | null }>;
          setReserves({
            open: list.filter((x) => x.status !== "levee" && x.status !== "validee").length,
            lifted: list.filter((x) => x.status === "levee" || x.status === "validee").length,
          });
        }
      } else if (!cancelled) {
        setReserves({ open: 0, lifted: 0 });
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [activeCompanyId, client.id]);

  return (
    <div className="flex h-full flex-col">
      {/* Header sticky */}
      <div className="sticky top-0 z-10 flex items-start gap-3 border-b bg-background/95 p-4 backdrop-blur sm:p-6">
        <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-brand-gradient text-base font-semibold text-primary-foreground shadow-brand">
          {initials(client.name) || (isEnt ? <Building2 className="h-6 w-6" /> : <User className="h-6 w-6" />)}
        </div>
        <div className="min-w-0 flex-1">
          <DialogTitle className="truncate text-lg font-semibold leading-tight sm:text-xl">{client.name}</DialogTitle>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <TypeBadge type={client.client_type} />
            {isEnt && client.siret && <span className="font-mono text-[11px] text-muted-foreground">SIRET {client.siret}</span>}
            {client.city && <span className="text-xs text-muted-foreground">· {client.city}</span>}
          </div>
        </div>
        <Button size="icon" variant="ghost" onClick={onClose} className="h-11 w-11 shrink-0 sm:h-9 sm:w-9" aria-label="Fermer"><X className="h-4 w-4" /></Button>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-4 gap-2 border-b p-3 sm:p-4">
        <Button variant="outline" size="sm" disabled={!client.phone} asChild={!!client.phone} className="h-auto min-h-11 flex-col gap-1 py-2">
          {client.phone ? <a href={`tel:${client.phone}`}><Phone className="h-4 w-4" /><span className="text-[10px]">Appeler</span></a> : <span><Phone className="h-4 w-4" /><span className="text-[10px]">Appeler</span></span>}
        </Button>
        <Button variant="outline" size="sm" disabled={!client.email} asChild={!!client.email} className="h-auto min-h-11 flex-col gap-1 py-2">
          {client.email ? <a href={`mailto:${client.email}`}><Mail className="h-4 w-4" /><span className="text-[10px]">Email</span></a> : <span><Mail className="h-4 w-4" /><span className="text-[10px]">Email</span></span>}
        </Button>
        <Button variant="outline" size="sm" disabled={!mapsHref} asChild={!!mapsHref} className="h-auto min-h-11 flex-col gap-1 py-2">
          {mapsHref ? <a href={mapsHref} target="_blank" rel="noreferrer"><Navigation className="h-4 w-4" /><span className="text-[10px]">Itinéraire</span></a> : <span><Navigation className="h-4 w-4" /><span className="text-[10px]">Itinéraire</span></span>}
        </Button>
        <Button variant="outline" size="sm" onClick={() => onEdit(client)} className="h-auto min-h-11 flex-col gap-1 py-2">
          <Pencil className="h-4 w-4" /><span className="text-[10px]">Modifier</span>
        </Button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <SectionCard icon={Mail} title="Coordonnées">
            <dl className="space-y-2 text-sm">
              <div className="flex items-start gap-2"><Mail className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" /><span className="break-all">{client.email || <span className="italic text-muted-foreground">Non renseigné</span>}</span></div>
              <div className="flex items-start gap-2"><Phone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" /><span>{client.phone || <span className="italic text-muted-foreground">Non renseigné</span>}</span></div>
              <div className="flex items-start gap-2"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" /><span>{fullAddress || <span className="italic text-muted-foreground">Adresse non renseignée</span>}</span></div>
            </dl>
          </SectionCard>

          {isEnt && (
            <SectionCard icon={Building2} title="Informations entreprise">
              <dl className="space-y-1.5 text-sm">
                {client.company_name && <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Société</dt><dd className="text-right font-medium">{client.company_name}</dd></div>}
                {client.siret && <div className="flex justify-between gap-2"><dt className="text-muted-foreground">SIRET</dt><dd className="font-mono">{client.siret}</dd></div>}
                {client.siren && <div className="flex justify-between gap-2"><dt className="text-muted-foreground">SIREN</dt><dd className="font-mono">{client.siren}</dd></div>}
                {client.vat_number && <div className="flex justify-between gap-2"><dt className="text-muted-foreground">TVA</dt><dd className="font-mono">{client.vat_number}</dd></div>}
                {client.naf_code && <div className="flex justify-between gap-2"><dt className="text-muted-foreground">APE/NAF</dt><dd className="font-mono">{client.naf_code}</dd></div>}
                {client.contact_name && <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Contact</dt><dd className="font-medium">{client.contact_name}</dd></div>}
              </dl>
            </SectionCard>
          )}

          <SectionCard icon={Briefcase} title={`Chantiers (${chantiers.length})`}>
            {loading ? (
              <div className="space-y-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
            ) : chantiers.length === 0 ? (
              <p className="text-xs italic text-muted-foreground">Aucun chantier lié</p>
            ) : (
              <ul className="space-y-1.5">
                {chantiers.slice(0, 5).map((c) => (
                  <li key={c.id}>
                    <Link to="/chantiers/$id" params={{ id: c.id }} onClick={onClose} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                      <span className="min-w-0 flex-1 truncate">{c.reference && <span className="font-mono text-[10px] text-muted-foreground">{c.reference} </span>}{c.name}</span>
                      <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard icon={FileText} title={`Procès-verbaux (${pvs.length})`}>
            {loading ? (
              <div className="space-y-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
            ) : pvs.length === 0 ? (
              <p className="text-xs italic text-muted-foreground">Aucun PV lié</p>
            ) : (
              <ul className="space-y-1.5">
                {pvs.slice(0, 5).map((p) => (
                  <li key={p.id}>
                    <Link to="/pv/$id" params={{ id: p.id }} onClick={onClose} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                      <span className="min-w-0 flex-1 truncate"><span className="font-mono text-[10px] text-muted-foreground">{p.numero || "—"} </span><span className="text-muted-foreground">· {fmtDate(p.reception_date || p.created_at)}</span></span>
                      <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard icon={AlertTriangle} title="Réserves">
            {loading ? <Skeleton className="h-8 w-full" /> : (
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg border bg-muted/30 p-2 text-center">
                  <p className="text-xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">{reserves.open}</p>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Ouvertes</p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-2 text-center">
                  <p className="text-xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{reserves.lifted}</p>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Levées</p>
                </div>
              </div>
            )}
          </SectionCard>

          <SectionCard icon={History} title="Historique">
            {loading ? <Skeleton className="h-8 w-full" /> : (
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between"><dt className="text-muted-foreground">Dernier PV</dt><dd>{pvs[0] ? fmtDate(pvs[0].reception_date || pvs[0].created_at) : "—"}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Dernier chantier</dt><dd>{chantiers[0]?.start_date ? fmtDate(chantiers[0].start_date) : "—"}</dd></div>
              </dl>
            )}
          </SectionCard>
        </div>

        {client.notes && (
          <Card className="mt-4 p-4">
            <h3 className="mb-2 text-sm font-semibold">Notes</h3>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{client.notes}</p>
          </Card>
        )}
      </div>

      {/* Footer actions */}
      <div className="sticky bottom-0 flex items-center justify-between gap-2 border-t bg-background/95 p-3 backdrop-blur sm:p-4">
        <Button variant="ghost" size="sm" onClick={() => onDelete(client.id)} className="text-destructive hover:text-destructive" disabled={!!client.archived_at}>
          <Archive className="h-4 w-4" /> {client.archived_at ? "Archivé" : "Archiver"}
        </Button>
        <Button size="sm" onClick={() => onEdit(client)} className="shadow-brand">
          <Pencil className="h-4 w-4" /> Modifier
        </Button>
      </div>
    </div>
  );
}

export function ClientDetailDialog({ client, open, onOpenChange, onEdit, onDelete }: Props) {
  const isMobile = useIsMobile();
  if (!client) return null;
  const close = () => onOpenChange(false);

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[92vh] max-h-[92vh] overflow-hidden p-0 [&>button]:hidden">
          <SheetTitle className="sr-only">{client.name}</SheetTitle>
          <ClientDetailContent client={client} onEdit={onEdit} onDelete={onDelete} onClose={close} />
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-hidden p-0 [&>button]:hidden">
        <ClientDetailContent client={client} onEdit={onEdit} onDelete={onDelete} onClose={close} />
      </DialogContent>
    </Dialog>
  );
}
