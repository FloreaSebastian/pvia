import { LockedActionButton, useWriteAccess, useBlockedActionGuard } from "@/components/billing/WriteAccessGate";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Mail,
  Plus,
  Shield,
  Loader2,
  Send,
  Clock,
  MoreHorizontal,
  Search,
  RotateCcw,
  ChevronDown,
  AlertTriangle,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useCompany } from "@/hooks/use-company";
import { useAuth } from "@/hooks/use-auth";
import { useServerFn } from "@tanstack/react-start";
import { sendInvite } from "@/lib/invites.functions";
import { logUserAction } from "@/lib/audit.functions";
import { ROLE_META, ROLE_ORDER, ADMIN_ROLES, type CompanyRoleValue } from "@/lib/roles";
import { ROLE_PROFILES, asKnownRole } from "@/lib/role-access";
import { createScopeGuard, type ScopeGuard } from "@/lib/scope-guard";
import { RoleBadge } from "@/components/app/RoleBadge";
import { RouteRoleGuard } from "@/components/auth/RouteRoleGuard";
import {
  ASSIGNABLE_ROLES,
  canRunAction,
  groupMembers,
  inviteExpired,
  memberIdentity,
  memberRights,
  type TeamAction,
  type TeamMember,
} from "@/lib/team-view";

/**
 * Une instance par (entreprise, utilisateur, rôle) : tout changement démonte
 * l'ancienne page, clôt sa portée et ignore ses dialogues, toasts et réponses.
 */
function ScopedTeamPage() {
  const { activeCompanyId, activeRole } = useCompany();
  const { user } = useAuth();
  return <TeamPage key={`${activeCompanyId ?? "none"}:${user?.id ?? "anon"}:${activeRole ?? "none"}`} />;
}

function GuardedTeamPage() {
  return (
    <RouteRoleGuard allow={ADMIN_ROLES}>
      <ScopedTeamPage />
    </RouteRoleGuard>
  );
}

export const Route = createFileRoute("/_authenticated/equipe")({
  component: GuardedTeamPage,
  head: () => ({
    meta: [
      { title: "Équipe & rôles — PVIA" },
      {
        name: "description",
        content: "Gérez les membres de votre entreprise PVIA : invitations, rôles BTP et suspension des accès.",
      },
      { property: "og:title", content: "Équipe & rôles — PVIA" },
      { property: "og:description", content: "Invitations, rôles BTP et gestion des accès de votre entreprise." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type Member = TeamMember;

/** Messages techniques (PostgREST / Postgres) → messages métier lisibles. */
function friendlyError(err: unknown, fallback: string) {
  const raw = (err as { message?: string } | null)?.message ?? "";
  if (!raw) return fallback;
  if (/Directeur|invitation|Invitation|siège|utilisateurs|déjà|droits/i.test(raw) && raw.length < 200) return raw;
  if (/row-level security|permission denied|42501/i.test(raw)) return "Droits insuffisants pour cette action.";
  if (/duplicate key|unique/i.test(raw)) return "Cette personne est déjà membre ou déjà invitée.";
  if (/rate|trop de/i.test(raw)) return "Trop de tentatives, réessayez dans quelques minutes.";
  if (/JWT|token|fetch|network/i.test(raw)) return "Connexion interrompue, réessayez.";
  return fallback;
}

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR") : "—");

function RoleSelectItems() {
  return (
    <>
      {ASSIGNABLE_ROLES.map((r) => (
        <SelectItem key={r} value={r} className="min-h-11">
          {ROLE_META[r].label}
        </SelectItem>
      ))}
    </>
  );
}

function TeamPage() {
  const { activeCompanyId, activeRole } = useCompany();
  const { user } = useAuth();
  const currentUserId = user?.id ?? null;
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<CompanyRoleValue>("technicien");
  const [sending, setSending] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<Member | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<Member | null>(null);
  const [confirmSuspend, setConfirmSuspend] = useState<Member | null>(null);
  const [roleEdit, setRoleEdit] = useState<{ m: Member; draft: CompanyRoleValue } | null>(null);
  const sendInviteFn = useServerFn(sendInvite);
  const logAction = useServerFn(logUserAction);
  const busyRef = useRef(false);

  const { blocked: writeBlocked, writeKnown } = useWriteAccess();
  const { deny: denyWrite } = useBlockedActionGuard();
  const writeOpen = writeKnown && !writeBlocked;
  const rowCtx = { currentUserId, actorRole: activeRole, writeOpen };
  const isAdmin = !!asKnownRole(activeRole) && (ADMIN_ROLES as readonly string[]).includes(activeRole!);

  const scopeRef = useRef<ScopeGuard | null>(null);
  if (!scopeRef.current) scopeRef.current = createScopeGuard();
  const scope = scopeRef.current;
  useEffect(() => () => scope.dispose(), [scope]);
  const [loadedCompanyId, setLoadedCompanyId] = useState<string | null>(null);
  /** Les mutations n'agissent que sur la liste chargée pour l'entreprise active. */
  const scopeCompanyId = loadedCompanyId && loadedCompanyId === activeCompanyId ? loadedCompanyId : null;

  async function load() {
    const gen = scope.next();
    const companyId = activeCompanyId;
    setLoadedCompanyId(null);
    setLoadError(null);
    if (!companyId) {
      setMembers([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setMembers([]);
    const { data, error } = await supabase
      .from("company_members")
      .select("id,user_id,role,status,invited_email,invite_expires_at,created_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: true });
    if (!scope.isCurrent(gen)) return;
    if (error) {
      setLoading(false);
      setLoadError(friendlyError(error, "Impossible de charger l'équipe."));
      return;
    }
    const raw = (data as unknown as Member[]) ?? [];
    const ids = raw.map((m) => m.user_id).filter((x): x is string => !!x);
    let profileMap: Record<string, string | null> = {};
    if (ids.length) {
      const { data: profs, error: pErr } = await supabase.from("profiles").select("id,full_name").in("id", ids);
      if (!scope.isCurrent(gen)) return;
      if (pErr) {
        setLoading(false);
        setLoadError("Impossible de charger les noms des membres.");
        return;
      }
      profileMap = Object.fromEntries((profs ?? []).map((p) => [p.id, p.full_name]));
    }
    setMembers(raw.map((m) => ({ ...m, profile: m.user_id ? { full_name: profileMap[m.user_id] ?? null } : null })));
    setLoadedCompanyId(companyId);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCompanyId]);

  /** Garde commune : écriture confirmée, portée chargée, action autorisée pour la ligne, pas de double action. */
  function guardAction(action: TeamAction, m: Member, label: string): boolean {
    if (denyWrite(label)) return false;
    if (!scopeCompanyId || busyRef.current) return false;
    const current = members.find((x) => x.id === m.id);
    if (!current || !canRunAction(action, current, rowCtx)) {
      toast.error("Action non autorisée pour ce membre.");
      return false;
    }
    busyRef.current = true;
    setBusyId(m.id);
    return true;
  }
  function release() {
    busyRef.current = false;
    if (scope.alive()) setBusyId(null);
  }
  function audit(entry: {
    companyId: string;
    entityType: string;
    entityId: string;
    action: string;
    oldValues?: Record<string, unknown>;
    newValues?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }) {
    if (!scope.alive()) return;
    logAction({ data: entry as never }).catch(() => {});
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    if (denyWrite("inviter un membre")) return;
    if (!isAdmin || !scopeCompanyId || sending) return;
    const email = inviteEmail.trim().toLowerCase();
    if (!email) return;
    if (!ASSIGNABLE_ROLES.includes(inviteRole)) return toast.error("Rôle non attribuable.");
    const companyId = scopeCompanyId;
    setSending(true);
    try {
      await sendInviteFn({ data: { companyId, email, role: inviteRole as Exclude<CompanyRoleValue, "directeur"> } });
      if (!scope.alive()) return;
      toast.success(`Invitation envoyée à ${email}`);
      setInviteOpen(false);
      setInviteEmail("");
      setInviteRole("technicien");
      load();
    } catch (err) {
      if (!scope.alive()) return;
      toast.error(friendlyError(err, "Échec de l'envoi de l'invitation."));
    } finally {
      if (scope.alive()) setSending(false);
    }
  }

  async function resendInvite(m: Member) {
    if (!m.invited_email || !guardAction("resend", m, "renvoyer une invitation")) return;
    const companyId = scopeCompanyId!;
    try {
      await sendInviteFn({
        data: { companyId, email: m.invited_email, role: m.role as Exclude<CompanyRoleValue, "directeur"> },
      });
      if (!scope.alive()) return;
      toast.success(`Invitation renvoyée à ${m.invited_email}`);
      load();
    } catch (err) {
      if (!scope.alive()) return;
      toast.error(friendlyError(err, "Impossible de renvoyer l'invitation."));
    } finally {
      release();
    }
  }

  async function cancelInvite(m: Member) {
    if (!guardAction("cancel_invite", m, "annuler une invitation")) return;
    const companyId = scopeCompanyId!;
    const { data: rows, error } = await supabase
      .from("company_members")
      .delete()
      .eq("id", m.id)
      .eq("company_id", companyId)
      .eq("status", "invited")
      .is("user_id", null)
      .select("id");
    release();
    if (!scope.alive()) return;
    setConfirmCancel(null);
    if (error) return toast.error(friendlyError(error, "Annulation impossible."));
    if (!rows?.length) return toast.error("Invitation déjà acceptée ou annulée.");
    toast.success("Invitation annulée");
    audit({
      companyId,
      entityType: "member",
      entityId: m.id,
      action: "member.invite_cancelled",
      oldValues: { email: m.invited_email, role: m.role },
    });
    load();
  }

  async function saveRole() {
    if (!roleEdit) return;
    const { m, draft } = roleEdit;
    if (draft === m.role) return setRoleEdit(null);
    if (!ASSIGNABLE_ROLES.includes(draft)) return toast.error("Rôle non attribuable.");
    if (!guardAction("role", m, "modifier le rôle d’un membre")) return;
    const companyId = scopeCompanyId!;
    const { data: updated, error } = await supabase
      .from("company_members")
      .update({ role: draft })
      .eq("id", m.id)
      .eq("company_id", companyId)
      .eq("role", m.role as CompanyRoleValue)
      .select("id");
    release();
    if (!scope.alive()) return;
    if (error) return toast.error(friendlyError(error, "Modification refusée."));
    if (!updated?.length) return toast.error("Le membre a changé entre-temps. Rechargez l'équipe.");
    setRoleEdit(null);
    toast.success(`Rôle modifié : ${ROLE_META[draft].label}`);
    audit({
      companyId,
      entityType: "member",
      entityId: m.id,
      action: "member.role_changed",
      oldValues: { role: m.role },
      newValues: { role: draft },
    });
    load();
  }

  async function setStatus(m: Member, next: "active" | "suspended") {
    const action: TeamAction = next === "suspended" ? "suspend" : "reactivate";
    if (!guardAction(action, m, "suspendre ou réactiver un membre")) return;
    const companyId = scopeCompanyId!;
    const { data: updated, error } = await supabase
      .from("company_members")
      .update({ status: next })
      .eq("id", m.id)
      .eq("company_id", companyId)
      .eq("status", m.status as "active" | "suspended")
      .select("id");
    release();
    if (!scope.alive()) return;
    setConfirmSuspend(null);
    if (error) return toast.error(friendlyError(error, "Action refusée."));
    if (!updated?.length) return toast.error("Le membre a changé entre-temps. Rechargez l'équipe.");
    toast.success(next === "suspended" ? "Membre suspendu" : "Membre réactivé");
    audit({
      companyId,
      entityType: "member",
      entityId: m.id,
      action: next === "suspended" ? "member.suspended" : "member.reactivated",
      oldValues: { status: m.status },
      newValues: { status: next },
      metadata: { role: m.role },
    });
    load();
  }

  async function remove(m: Member) {
    if (!guardAction("remove", m, "retirer un membre")) return;
    const companyId = scopeCompanyId!;
    const { data: deleted, error } = await supabase
      .from("company_members")
      .delete()
      .eq("id", m.id)
      .eq("company_id", companyId)
      .select("id");
    release();
    if (!scope.alive()) return;
    setConfirmRemove(null);
    if (error) return toast.error(friendlyError(error, "Suppression refusée."));
    if (!deleted?.length) return toast.error("Droits insuffisants pour retirer ce membre.");
    toast.success("Membre retiré");
    audit({
      companyId,
      entityType: "member",
      entityId: m.id,
      action: "member.removed",
      oldValues: { role: m.role, status: m.status },
    });
    load();
  }

  const groups = useMemo(() => groupMembers(members, query), [members, query]);
  const now = Date.now();

  function MemberRow({ m }: { m: Member }) {
    const r = memberRights(m, rowCtx);
    const id = memberIdentity(m);
    const busy = busyId === m.id;
    const expired = inviteExpired(m, now);
    const hasMenu = r.canRemove || r.canManageInvite;
    return (
      <li className="flex min-w-0 flex-col gap-3 border-b border-border p-4 last:border-b-0 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div
            aria-hidden
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-secondary text-sm font-semibold text-secondary-foreground"
          >
            {(id.primary.trim()[0] ?? "?").toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="break-words font-medium leading-snug [overflow-wrap:anywhere]">
              {id.primary}
              {r.isSelf && <span className="ml-2 text-xs font-normal text-muted-foreground">(vous)</span>}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <RoleBadge role={m.role} long />
              {m.status === "suspended" && <Badge variant="destructive">Suspendu</Badge>}
              {m.status === "invited" && (
                <Badge variant={expired ? "destructive" : "outline"} className="gap-1 text-xs">
                  <Clock className="h-3 w-3" aria-hidden />
                  {expired ? `Expirée le ${fmtDate(m.invite_expires_at)}` : `Expire le ${fmtDate(m.invite_expires_at)}`}
                </Badge>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {busy && <Loader2 className="h-4 w-4 animate-spin text-primary" aria-label="Action en cours" />}
          {r.canEditRole && (
            <Button variant="outline" size="sm" className="h-11" disabled={busy} onClick={() => setRoleEdit({ m, draft: asKnownRole(m.role) ?? "technicien" })}>
              Modifier le rôle
            </Button>
          )}
          {r.canManageInvite && (
            <Button variant="outline" size="sm" className="h-11" disabled={busy || !!busyId} onClick={() => resendInvite(m)}>
              <Send className="h-4 w-4" aria-hidden /> Renvoyer
            </Button>
          )}
          {r.canToggle &&
            (m.status === "suspended" ? (
              <Button variant="outline" size="sm" className="h-11" disabled={busy} onClick={() => setStatus(m, "active")}>
                Réactiver
              </Button>
            ) : (
              <Button variant="outline" size="sm" className="h-11" disabled={busy} onClick={() => setConfirmSuspend(m)}>
                Suspendre
              </Button>
            ))}
          {hasMenu && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-11 w-11" disabled={busy} aria-label={`Autres actions pour ${id.primary}`}>
                  <MoreHorizontal className="h-4 w-4" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" collisionPadding={8}>
                {r.canManageInvite && (
                  <DropdownMenuItem className="min-h-11 text-destructive" onSelect={() => setConfirmCancel(m)}>
                    Annuler l'invitation
                  </DropdownMenuItem>
                )}
                {r.canRemove && (
                  <DropdownMenuItem className="min-h-11 text-destructive" onSelect={() => setConfirmRemove(m)}>
                    Retirer de l'entreprise
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {!r.isSelf && !r.canEditRole && !r.canToggle && !hasMenu && r.isDirectorMember && (
            <span className="text-xs text-muted-foreground">Modifiable par un Directeur</span>
          )}
        </div>
      </li>
    );
  }

  function Section({ title, list, empty }: { title: string; list: Member[]; empty: string }) {
    return (
      <section aria-label={title} className="min-w-0">
        <h2 className="mb-2 text-sm font-semibold">
          {title} <span className="font-normal text-muted-foreground">({list.length})</span>
        </h2>
        {list.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">{empty}</p>
        ) : (
          <Card className="min-w-0 overflow-hidden p-0">
            <ul>
              {list.map((m) => (
                <MemberRow key={m.id} m={m} />
              ))}
            </ul>
          </Card>
        )}
      </section>
    );
  }

  return (
    <div className="w-full min-w-0 space-y-5 sm:space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-primary">Multi-utilisateurs</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">Équipe</h1>
          <p className="text-sm text-muted-foreground">Gérez les membres, les rôles BTP et les accès de votre entreprise.</p>
        </div>
        {isAdmin &&
          (!writeOpen ? (
            <LockedActionButton label="Inviter un membre" className="h-11 w-full sm:w-auto">
              Inviter un membre
            </LockedActionButton>
          ) : (
            <Button className="h-11 w-full shadow-brand sm:w-auto" disabled={!scopeCompanyId} onClick={() => setInviteOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden /> Inviter un membre
            </Button>
          ))}
      </div>

      {!loading && !loadError && (
        <dl className="grid grid-cols-3 gap-2 sm:max-w-md">
          {[
            ["Actifs", groups.counts.active],
            ["Invitations", groups.counts.invited],
            ["Suspendus", groups.counts.suspended],
          ].map(([label, n]) => (
            <div key={label as string} className="min-w-0 rounded-lg border border-border bg-card p-3">
              <dt className="truncate text-xs text-muted-foreground">{label}</dt>
              <dd className="text-lg font-semibold tabular-nums">{n}</dd>
            </div>
          ))}
        </dl>
      )}

      {loading ? (
        <Card className="grid h-40 place-items-center">
          <Loader2 className="h-5 w-5 animate-spin text-primary" aria-label="Chargement de l'équipe" />
        </Card>
      ) : loadError ? (
        <Card role="alert" className="flex flex-wrap items-center gap-3 border-destructive/40 p-5 text-sm">
          <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden />
          <p className="min-w-0 flex-1">{loadError}</p>
          <Button variant="outline" className="h-11" onClick={() => load()}>
            <RotateCcw className="h-4 w-4" aria-hidden /> Réessayer
          </Button>
        </Card>
      ) : groups.total === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">Aucun membre pour l'instant.</Card>
      ) : (
        <>
          <div className="relative sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              type="search"
              aria-label="Rechercher un membre par nom ou email"
              placeholder="Rechercher nom ou email"
              className="h-11 pl-9"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {groups.noResult ? (
            <Card className="p-6 text-center text-sm text-muted-foreground">
              Aucun membre ne correspond à « {query} ».
              <Button variant="link" className="h-11" onClick={() => setQuery("")}>
                Effacer la recherche
              </Button>
            </Card>
          ) : (
            <div className="space-y-6">
              <Section title="Actifs" list={groups.active} empty="Aucun membre actif dans cette recherche." />
              <Section title="Invitations" list={groups.invited} empty="Aucune invitation en attente." />
              {groups.counts.suspended > 0 && (
                <Section title="Suspendus" list={groups.suspended} empty="Aucun membre suspendu dans cette recherche." />
              )}
            </div>
          )}
        </>
      )}

      <details className="group rounded-lg border border-border bg-card">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 p-4 text-sm font-semibold">
          <Shield className="h-5 w-5 shrink-0 text-primary" aria-hidden />
          <span className="flex-1">Guide des rôles</span>
          <ChevronDown className="h-4 w-4 transition group-open:rotate-180" aria-hidden />
        </summary>
        <div className="px-4 pb-4">
          <p className="text-sm text-muted-foreground">Ce que chaque rôle permet réellement dans PVIA. Le serveur applique les mêmes règles.</p>
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {ROLE_ORDER.map((r) => (
              <li key={r} className="min-w-0 rounded-md border border-border p-3">
                <RoleBadge role={r} long />
                <RoleSummary role={r} />
              </li>
            ))}
          </ul>
        </div>
      </details>

      {/* Invitation */}
      <Dialog open={inviteOpen} onOpenChange={(o) => !sending && setInviteOpen(o)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Inviter un membre</DialogTitle>
            <DialogDescription>La personne reçoit un lien valable 7 jours pour rejoindre l'entreprise.</DialogDescription>
          </DialogHeader>
          <form onSubmit={invite} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                required
                autoComplete="email"
                inputMode="email"
                className="h-11"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="collegue@entreprise.fr"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-role">Rôle</Label>
              <Select value={inviteRole} onValueChange={(v) => asKnownRole(v) && setInviteRole(v as CompanyRoleValue)}>
                <SelectTrigger id="invite-role" className="h-11">
                  <SelectValue>{ROLE_META[inviteRole].label}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <RoleSelectItems />
                </SelectContent>
              </Select>
              <div className="rounded-md border border-border bg-muted/40 p-3">
                <RoleSummary role={inviteRole} />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" className="h-11" disabled={sending} onClick={() => setInviteOpen(false)}>
                Annuler
              </Button>
              <Button type="submit" disabled={sending || !writeOpen} className="h-11 shadow-brand">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Mail className="h-4 w-4" aria-hidden />}
                {sending ? "Envoi en cours…" : "Envoyer l'invitation"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Édition de rôle : rien n'est modifié avant Enregistrer */}
      <Dialog open={!!roleEdit} onOpenChange={(o) => !o && !busyId && setRoleEdit(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Modifier le rôle</DialogTitle>
            <DialogDescription className="break-words [overflow-wrap:anywhere]">
              {roleEdit ? memberIdentity(roleEdit.m).primary : ""}
            </DialogDescription>
          </DialogHeader>
          {roleEdit && (
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground">Rôle actuel :</span>
                <RoleBadge role={roleEdit.m.role} long />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="role-edit">Nouveau rôle</Label>
                <Select
                  value={roleEdit.draft}
                  onValueChange={(v) => {
                    const r = asKnownRole(v);
                    if (r && ASSIGNABLE_ROLES.includes(r)) setRoleEdit({ m: roleEdit.m, draft: r });
                  }}
                >
                  <SelectTrigger id="role-edit" className="h-11">
                    <SelectValue>{ROLE_META[roleEdit.draft].label}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <RoleSelectItems />
                  </SelectContent>
                </Select>
              </div>
              <div className="rounded-md border border-border bg-muted/40 p-3">
                <RoleSummary role={roleEdit.draft} />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-11" disabled={!!busyId} onClick={() => setRoleEdit(null)}>
              Annuler
            </Button>
            <Button
              className="h-11"
              disabled={!!busyId || !roleEdit || roleEdit.draft === roleEdit.m.role || !writeOpen}
              onClick={saveRole}
            >
              {busyId ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmSuspend} onOpenChange={(o) => !o && setConfirmSuspend(null)}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Suspendre ce membre ?</AlertDialogTitle>
            <AlertDialogDescription className="break-words [overflow-wrap:anywhere]">
              {confirmSuspend ? memberIdentity(confirmSuspend).primary : ""} ne pourra plus accéder à cette entreprise
              jusqu'à sa réactivation. Ses documents restent conservés.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => confirmSuspend && setStatus(confirmSuspend, "suspended")}
            >
              Suspendre
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmRemove} onOpenChange={(o) => !o && setConfirmRemove(null)}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Retirer ce membre ?</AlertDialogTitle>
            <AlertDialogDescription className="break-words [overflow-wrap:anywhere]">
              {confirmRemove ? memberIdentity(confirmRemove).primary : ""} perdra immédiatement l'accès à cette entreprise.
              Les documents créés restent conservés.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => confirmRemove && remove(confirmRemove)}
            >
              Retirer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmCancel} onOpenChange={(o) => !o && setConfirmCancel(null)}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Annuler cette invitation ?</AlertDialogTitle>
            <AlertDialogDescription className="break-words [overflow-wrap:anywhere]">
              Le lien envoyé à {confirmCancel?.invited_email ?? "cette adresse"} sera immédiatement inutilisable.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">Conserver</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => confirmCancel && cancelInvite(confirmCancel)}
            >
              Annuler l'invitation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function RoleSummary({ role }: { role: CompanyRoleValue }) {
  const p = ROLE_PROFILES[role];
  return (
    <div className="mt-2 text-sm">
      <p className="font-medium">{p.title}</p>
      <ul className="mt-1 space-y-0.5">
        {p.can.map((t) => (
          <li key={t}>
            <span aria-hidden>✓ </span>
            <span className="sr-only">Autorisé : </span>
            {t}
          </li>
        ))}
        {p.cannot.map((t) => (
          <li key={t} className="text-muted-foreground">
            <span aria-hidden>✕ </span>
            <span className="sr-only">Non autorisé : </span>
            {t}
          </li>
        ))}
      </ul>
    </div>
  );
}
