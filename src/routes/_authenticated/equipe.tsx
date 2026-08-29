import { LockedActionButton, useWriteAccess } from "@/components/billing/WriteAccessGate";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Mail,
  Plus,
  Trash2,
  Shield,
  Loader2,
  UserCheck,
  UserX,
  Send,
  XCircle,
  Clock,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useCompany, type CompanyRole } from "@/hooks/use-company";
import { useServerFn } from "@tanstack/react-start";
import { sendInvite } from "@/lib/invites.functions";
import { logUserAction } from "@/lib/audit.functions";
import { ROLE_META, ROLE_ORDER, isOwnerRole, type CompanyRoleValue } from "@/lib/roles";

import { RouteRoleGuard } from "@/components/auth/RouteRoleGuard";
import { ADMIN_ROLES } from "@/lib/roles";

function GuardedTeamPage() {
  return (
    <RouteRoleGuard allow={ADMIN_ROLES}>
      <TeamPage />
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
        content:
          "Gérez les membres de votre entreprise PVIA : invitations, rôles BTP et suspension des accès.",
      },
      { property: "og:title", content: "Équipe & rôles — PVIA" },
      {
        property: "og:description",
        content: "Invitations, rôles BTP et gestion des accès de votre entreprise.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type Member = {
  id: string;
  user_id: string | null;
  role: CompanyRole;
  status: "active" | "invited" | "suspended";
  invited_email: string | null;
  invite_expires_at: string | null;
  created_at: string;
  profile?: { full_name: string | null } | null;
};

// Rôles disponibles à l'invitation / modification (le rôle Directeur ne se distribue pas).
const ASSIGNABLE_ROLES: CompanyRoleValue[] = ROLE_ORDER.filter(
  (r) => r !== "directeur",
);

/** Messages techniques (PostgREST / Postgres) → messages métier lisibles. */
function friendlyError(err: unknown, fallback: string) {
  const raw = (err as { message?: string } | null)?.message ?? "";
  if (!raw) return fallback;
  if (/Directeur/i.test(raw)) return raw; // messages métier déjà en clair (triggers)
  if (/row-level security|permission denied|42501/i.test(raw))
    return "Droits insuffisants pour cette action.";
  if (/duplicate key|unique/i.test(raw))
    return "Cette personne est déjà membre ou déjà invitée.";
  if (/rate|trop de/i.test(raw))
    return "Trop de tentatives, réessayez dans quelques minutes.";
  if (/JWT|token|fetch|network/i.test(raw))
    return "Connexion interrompue, réessayez.";
  return fallback;
}

function RoleBadge({ role }: { role: CompanyRoleValue }) {
  const meta = ROLE_META[role];
  return (
    <Badge className={`gap-1 ${meta.badgeClass}`}>
      <span aria-hidden>{meta.emoji}</span>
      <span>{meta.short}</span>
    </Badge>
  );
}

function StatusBadge({ m }: { m: Member }) {
  const expired =
    m.status === "invited" &&
    !!m.invite_expires_at &&
    new Date(m.invite_expires_at) < new Date();
  if (m.status === "active")
    return (
      <Badge className="bg-success text-success-foreground hover:bg-success/90">
        Actif
      </Badge>
    );
  if (m.status === "suspended") return <Badge variant="destructive">Suspendu</Badge>;
  return (
    <Badge variant="outline" className="gap-1">
      <Clock className="h-3 w-3" aria-hidden />
      {expired ? "Invitation expirée" : "Invitation en attente"}
    </Badge>
  );
}

function TeamPage() {
  const { activeCompanyId, can, activeRole } = useCompany();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<CompanyRoleValue>("technicien");
  const [sending, setSending] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<Member | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<Member | null>(null);
  const sendInviteFn = useServerFn(sendInvite);
  const logAction = useServerFn(logUserAction);

  function memberLabel(m: Member) {
    return m.profile?.full_name || m.invited_email || "Membre";
  }

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setCurrentUserId(data.user?.id ?? null));
  }, []);

  async function load() {
    if (!activeCompanyId) {
      setMembers([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    // Reset immédiat : évite d'afficher les membres de l'entreprise précédente.
    setMembers([]);
    const { data, error } = await supabase
      .from("company_members")
      .select("id,user_id,role,status,invited_email,invite_expires_at,created_at")
      .eq("company_id", activeCompanyId)
      .order("created_at", { ascending: true });
    if (error) {
      setLoading(false);
      toast.error(friendlyError(error, "Impossible de charger l'équipe."));
      return;
    }
    const raw = ((data as unknown) as Member[]) ?? [];
    const ids = raw.map((m) => m.user_id).filter((x): x is string => !!x);
    let profileMap: Record<string, string | null> = {};
    if (ids.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id,full_name")
        .in("id", ids);
      profileMap = Object.fromEntries(
        (profs ?? []).map((p) => [p.id, p.full_name]),
      );
    }
    setMembers(
      raw.map((m) => ({
        ...m,
        profile: m.user_id ? { full_name: profileMap[m.user_id] ?? null } : null,
      })),
    );
    setLoading(false);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCompanyId]);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    if (!activeCompanyId || sending) return;
    const email = inviteEmail.trim().toLowerCase();
    if (!email) return;
    if (isOwnerRole(inviteRole))
      return toast.error("Impossible d'inviter un Directeur d'entreprise.");
    setSending(true);
    try {
      await sendInviteFn({
        data: {
          companyId: activeCompanyId,
          email,
          role: inviteRole as Exclude<CompanyRoleValue, "directeur">,
        },
      });
      toast.success(`Invitation envoyée à ${email}`);
      setInviteOpen(false);
      setInviteEmail("");
      setInviteRole("technicien");
      load();
    } catch (err) {
      toast.error(friendlyError(err, "Échec de l'envoi de l'invitation."));
    } finally {
      setSending(false);
    }
  }

  async function resendInvite(m: Member) {
    if (!activeCompanyId || !m.invited_email || busyId) return;
    setBusyId(m.id);
    try {
      await sendInviteFn({
        data: {
          companyId: activeCompanyId,
          email: m.invited_email,
          role: m.role as Exclude<CompanyRoleValue, "directeur">,
        },
      });
      toast.success(`Invitation renvoyée à ${m.invited_email}`);
      load();
    } catch (err) {
      toast.error(friendlyError(err, "Impossible de renvoyer l'invitation."));
    } finally {
      setBusyId(null);
    }
  }

  async function cancelInvite(m: Member) {
    setBusyId(m.id);
    const { error } = await supabase
      .from("company_members")
      .delete()
      .eq("id", m.id)
      .eq("status", "invited");
    setBusyId(null);
    setConfirmCancel(null);
    if (error) return toast.error(friendlyError(error, "Annulation impossible."));
    toast.success("Invitation annulée");
    if (activeCompanyId) {
      logAction({
        data: {
          companyId: activeCompanyId,
          entityType: "member",
          entityId: m.id,
          action: "member.invite_cancelled",
          oldValues: { email: m.invited_email, role: m.role },
          metadata: { member: memberLabel(m) },
        },
      }).catch(() => {});
    }
    load();
  }

  async function changeRole(id: string, role: CompanyRoleValue) {
    const prev = members.find((m) => m.id === id);
    setBusyId(id);
    const { data: updated, error } = await supabase
      .from("company_members")
      .update({ role })
      .eq("id", id)
      .select("id");
    setBusyId(null);
    if (error) return toast.error(friendlyError(error, "Modification refusée."));
    if (!updated || updated.length === 0)
      return toast.error("Droits insuffisants pour modifier ce membre.");
    toast.success("Rôle modifié");
    if (activeCompanyId && prev) {
      logAction({
        data: {
          companyId: activeCompanyId,
          entityType: "member",
          entityId: id,
          action: "member.role_changed",
          oldValues: { role: prev.role },
          newValues: { role },
          metadata: { member: memberLabel(prev) },
        },
      }).catch(() => {});
    }
    load();
  }

  async function toggleStatus(m: Member) {
    const next = m.status === "suspended" ? "active" : "suspended";
    setBusyId(m.id);
    const { data: updated, error } = await supabase
      .from("company_members")
      .update({ status: next })
      .eq("id", m.id)
      .select("id");
    setBusyId(null);
    if (error) return toast.error(friendlyError(error, "Action refusée."));
    if (!updated || updated.length === 0)
      return toast.error("Droits insuffisants pour modifier ce membre.");
    toast.success(next === "suspended" ? "Membre suspendu" : "Membre réactivé");
    if (activeCompanyId) {
      logAction({
        data: {
          companyId: activeCompanyId,
          entityType: "member",
          entityId: m.id,
          action: next === "suspended" ? "member.suspended" : "member.reactivated",
          oldValues: { status: m.status },
          newValues: { status: next },
          metadata: { member: memberLabel(m), role: m.role },
        },
      }).catch(() => {});
    }
    load();
  }

  async function remove(m: Member) {
    setBusyId(m.id);
    const { data: deleted, error } = await supabase
      .from("company_members")
      .delete()
      .eq("id", m.id)
      .select("id");
    setBusyId(null);
    setConfirmRemove(null);
    if (error) return toast.error(friendlyError(error, "Suppression refusée."));
    if (!deleted || deleted.length === 0)
      return toast.error("Droits insuffisants pour retirer ce membre.");
    toast.success("Membre retiré");
    if (activeCompanyId) {
      logAction({
        data: {
          companyId: activeCompanyId,
          entityType: "member",
          entityId: m.id,
          action: "member.removed",
          oldValues: { role: m.role, status: m.status, email: m.invited_email },
          metadata: { member: memberLabel(m) },
        },
      }).catch(() => {});
    }
    load();
  }

  const isAdmin = can("admin");
  const isDirecteur = isOwnerRole(activeRole);

  /** Droits d'action ligne par ligne (miroir UI des règles serveur/RLS). */
  function rights(m: Member) {
    const isSelf = !!m.user_id && m.user_id === currentUserId;
    const isDirectorMember = isOwnerRole(m.role);
    const isInvite = m.status === "invited" && !m.user_id;
    // Un Directeur n'est modifiable que par un Directeur ; on ne se modifie jamais soi-même.
    const canEdit = isAdmin && !isSelf && (!isDirectorMember || isDirecteur);
    return {
      isSelf,
      isInvite,
      isDirectorMember,
      canEditRole: canEdit && !isInvite && !isDirectorMember,
      canToggle: canEdit && !isInvite,
      canRemove: canEdit && isDirecteur && !isInvite,
      canManageInvite: isAdmin && isInvite,
    };
  }

  function RowActions({ m }: { m: Member }) {
    const r = rights(m);
    const busy = busyId === m.id;
    if (r.isSelf)
      return <span className="text-xs text-muted-foreground">Vous</span>;
    if (!r.canToggle && !r.canRemove && !r.canManageInvite)
      return <span className="text-xs text-muted-foreground">—</span>;
    return (
      <div className="inline-flex items-center gap-0.5">
        {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin text-primary" aria-hidden />}
        {r.canManageInvite && (
          <>
            <Button
              size="icon"
              variant="ghost"
              className="h-11 w-11"
              disabled={busy}
              aria-label={`Renvoyer l'invitation à ${memberLabel(m)}`}
              title="Renvoyer l'invitation"
              onClick={() => resendInvite(m)}
            >
              <Send className="h-4 w-4 text-primary" aria-hidden />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-11 w-11"
              disabled={busy}
              aria-label={`Annuler l'invitation de ${memberLabel(m)}`}
              title="Annuler l'invitation"
              onClick={() => setConfirmCancel(m)}
            >
              <XCircle className="h-4 w-4 text-destructive" aria-hidden />
            </Button>
          </>
        )}
        {r.canToggle && (
          <Button
            size="icon"
            variant="ghost"
            className="h-11 w-11"
            disabled={busy}
            aria-label={
              m.status === "suspended"
                ? `Réactiver ${memberLabel(m)}`
                : `Suspendre ${memberLabel(m)}`
            }
            title={m.status === "suspended" ? "Réactiver" : "Suspendre"}
            onClick={() => toggleStatus(m)}
          >
            {m.status === "suspended" ? (
              <UserCheck className="h-4 w-4 text-success" aria-hidden />
            ) : (
              <UserX className="h-4 w-4 text-warning" aria-hidden />
            )}
          </Button>
        )}
        {r.canRemove && (
          <Button
            size="icon"
            variant="ghost"
            className="h-11 w-11"
            disabled={busy}
            aria-label={`Retirer ${memberLabel(m)} de l'entreprise`}
            title="Retirer de l'entreprise"
            onClick={() => setConfirmRemove(m)}
          >
            <Trash2 className="h-4 w-4 text-destructive" aria-hidden />
          </Button>
        )}
      </div>
    );
  }

  function RoleCell({ m }: { m: Member }) {
    const r = rights(m);
    if (!r.canEditRole) return <RoleBadge role={m.role as CompanyRoleValue} />;
    return (
      <Select
        value={m.role}
        disabled={busyId === m.id}
        onValueChange={(v) => changeRole(m.id, v as CompanyRoleValue)}
      >
        <SelectTrigger className="h-11 w-full min-w-0 sm:w-44" aria-label={`Rôle de ${memberLabel(m)}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ASSIGNABLE_ROLES.map((role) => {
            const meta = ROLE_META[role];
            return (
              <SelectItem key={role} value={role}>
                {meta.emoji} {meta.short}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    );
  }

  function initialsOf(label: string) {
    return (
      label
        .split(/\s+|@/)
        .filter(Boolean)
        .slice(0, 2)
        .map((s) => s[0]?.toUpperCase() ?? "")
        .join("") || "?"
    );
  }

  return (
    <div className="w-full min-w-0 space-y-5 sm:space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-primary">
            Multi-utilisateurs
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">
            Équipe
          </h1>
          <p className="text-sm text-muted-foreground">
            Gérez les membres, les rôles BTP et les accès de votre entreprise.
          </p>
        </div>
        {isAdmin && (writeBlocked ? (
          <LockedActionButton label="Inviter un membre" className="h-11 w-full sm:w-auto">
            Inviter un membre
          </LockedActionButton>
        ) : (
          <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
            <DialogTrigger asChild>
              <Button className="h-11 w-full shadow-brand sm:w-auto">
                <Plus className="h-4 w-4" aria-hidden /> Inviter un membre
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Inviter un membre</DialogTitle>
              </DialogHeader>
              <form onSubmit={invite} className="space-y-4">
                <div>
                  <Label htmlFor="invite-email">Email *</Label>
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
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    À l'inscription avec cet email, l'invitation sera automatiquement acceptée.
                  </p>
                </div>
                <div>
                  <Label htmlFor="invite-role">Rôle</Label>
                  <Select
                    value={inviteRole}
                    onValueChange={(v) => setInviteRole(v as CompanyRoleValue)}
                  >
                    <SelectTrigger id="invite-role" className="h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ASSIGNABLE_ROLES.map((r) => {
                        const m = ROLE_META[r];
                        return (
                          <SelectItem key={r} value={r}>
                            <div>
                              <div className="font-medium">
                                {m.emoji} {m.label}
                              </div>
                              <div className="text-[11px] text-muted-foreground">
                                {m.description}
                              </div>
                            </div>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
                <DialogFooter>
                  <Button
                    type="submit"
                    disabled={sending}
                    className="h-11 w-full shadow-brand sm:w-auto"
                  >
                    {sending ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <Mail className="h-4 w-4" aria-hidden />
                    )}
                    {sending ? "Envoi en cours…" : "Envoyer l'invitation"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {loading ? (
        <Card className="grid h-40 place-items-center">
          <Loader2 className="h-5 w-5 animate-spin text-primary" aria-label="Chargement" />
        </Card>
      ) : members.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Aucun membre pour l'instant.
        </Card>
      ) : (
        <>
          {/* Mobile / écrans étroits : cartes empilées, aucun scroll horizontal */}
          <div className="space-y-3 lg:hidden">
            {members.map((m) => {
              const label = memberLabel(m);
              return (
                <Card key={m.id} className="w-full min-w-0 p-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-gradient text-xs font-semibold text-primary-foreground shadow-sm">
                      {initialsOf(label)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="break-words font-medium leading-tight">{label}</div>
                      {m.invited_email && !m.user_id && (
                        <div className="break-all text-xs text-muted-foreground">
                          {m.invited_email}
                        </div>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <StatusBadge m={m} />
                        {!rights(m).canEditRole && (
                          <RoleBadge role={m.role as CompanyRoleValue} />
                        )}
                      </div>
                    </div>
                  </div>
                  {rights(m).canEditRole && (
                    <div className="mt-3">
                      <RoleCell m={m} />
                    </div>
                  )}
                  <div className="mt-3 flex items-center justify-between gap-2 border-t pt-2">
                    <span className="text-[11px] text-muted-foreground">
                      Ajouté le {new Date(m.created_at).toLocaleDateString("fr-FR")}
                    </span>
                    <RowActions m={m} />
                  </div>
                </Card>
              );
            })}
          </div>

          {/* Desktop : tableau */}
          <Card className="hidden overflow-hidden p-0 lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Membre</TableHead>
                  <TableHead>Rôle</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Ajouté le</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => {
                  const label = memberLabel(m);
                  return (
                    <TableRow key={m.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-gradient text-xs font-semibold text-primary-foreground shadow-sm">
                            {initialsOf(label)}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate font-medium">{label}</div>
                            {m.invited_email && !m.user_id && (
                              <div className="truncate text-xs text-muted-foreground">
                                {m.invited_email}
                              </div>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <RoleCell m={m} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge m={m} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(m.created_at).toLocaleDateString("fr-FR")}
                      </TableCell>
                      <TableCell className="text-right">
                        <RowActions m={m} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        </>
      )}

      <Card className="p-5">
        <div className="flex items-start gap-3">
          <Shield className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0 text-sm">
            <p className="font-semibold">Rôles & permissions</p>
            <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground">
              {ROLE_ORDER.map((r) => {
                const meta = ROLE_META[r];
                return (
                  <li key={r} className="flex items-start gap-2">
                    <span aria-hidden className="mt-px">
                      {meta.emoji}
                    </span>
                    <span className="min-w-0 break-words">
                      <b className="text-foreground">{meta.label}</b> — {meta.description}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </Card>

      <AlertDialog
        open={!!confirmRemove}
        onOpenChange={(o) => !o && setConfirmRemove(null)}
      >
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Retirer ce membre ?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmRemove ? memberLabel(confirmRemove) : ""} perdra immédiatement
              l'accès à cette entreprise. Les documents créés restent conservés.
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

      <AlertDialog
        open={!!confirmCancel}
        onOpenChange={(o) => !o && setConfirmCancel(null)}
      >
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Annuler cette invitation ?</AlertDialogTitle>
            <AlertDialogDescription>
              Le lien envoyé à {confirmCancel?.invited_email ?? "cette adresse"} sera
              immédiatement inutilisable.
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
