import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Mail, Plus, Trash2, Shield, Loader2, UserCheck, UserX } from "lucide-react";
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
  head: () => ({ meta: [{ title: "Équipe — PVIA" }] }),
});

type Member = {
  id: string;
  user_id: string | null;
  role: CompanyRole;
  status: "active" | "invited" | "suspended";
  invited_email: string | null;
  created_at: string;
  profile?: { full_name: string | null } | null;
};

// Rôles disponibles à l'invitation / modification (le rôle Directeur ne se distribue pas).
const ASSIGNABLE_ROLES: CompanyRoleValue[] = ROLE_ORDER.filter(
  (r) => r !== "directeur",
);

function RoleBadge({ role }: { role: CompanyRoleValue }) {
  const meta = ROLE_META[role];
  return (
    <Badge className={`gap-1 ${meta.badgeClass}`}>
      <span aria-hidden>{meta.emoji}</span>
      <span>{meta.short}</span>
    </Badge>
  );
}

function TeamPage() {
  const { activeCompanyId, can, activeRole } = useCompany();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<CompanyRoleValue>("technicien");
  const [sending, setSending] = useState(false);
  const sendInviteFn = useServerFn(sendInvite);
  const logAction = useServerFn(logUserAction);

  function memberLabel(m: Member) {
    return m.profile?.full_name || m.invited_email || "Membre";
  }

  async function load() {
    if (!activeCompanyId) return;
    setLoading(true);
    const { data } = await supabase
      .from("company_members")
      .select("id,user_id,role,status,invited_email,created_at")
      .eq("company_id", activeCompanyId)
      .order("created_at", { ascending: true });
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
    if (!activeCompanyId) return;
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
    } catch (err: any) {
      toast.error(err?.message ?? "Échec de l'envoi de l'invitation");
    } finally {
      setSending(false);
    }
  }

  async function changeRole(id: string, role: CompanyRoleValue) {
    const prev = members.find((m) => m.id === id);
    const { error } = await supabase
      .from("company_members")
      .update({ role })
      .eq("id", id);
    if (error) return toast.error(error.message);
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
    const { error } = await supabase
      .from("company_members")
      .update({ status: next })
      .eq("id", m.id);
    if (error) return toast.error(error.message);
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
    if (isOwnerRole(m.role))
      return toast.error("Impossible de retirer le Directeur d'entreprise.");
    if (!confirm("Retirer ce membre de l'entreprise ?")) return;
    const { error } = await supabase
      .from("company_members")
      .delete()
      .eq("id", m.id);
    if (error) return toast.error(error.message);
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-primary">
            Multi-utilisateurs
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Équipe</h1>
          <p className="text-sm text-muted-foreground">
            Gérez les membres, les rôles BTP et les accès de votre entreprise.
          </p>
        </div>
        {isAdmin && (
          <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
            <DialogTrigger asChild>
              <Button className="shadow-brand">
                <Plus className="h-4 w-4" /> Inviter un membre
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Inviter un membre</DialogTitle>
              </DialogHeader>
              <form onSubmit={invite} className="space-y-4">
                <div>
                  <Label>Email *</Label>
                  <Input
                    type="email"
                    required
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="collegue@entreprise.fr"
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    À l'inscription avec cet email, l'invitation sera automatiquement acceptée.
                  </p>
                </div>
                <div>
                  <Label>Rôle</Label>
                  <Select
                    value={inviteRole}
                    onValueChange={(v) => setInviteRole(v as CompanyRoleValue)}
                  >
                    <SelectTrigger>
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
                  <Button type="submit" disabled={sending} className="shadow-brand">
                    {sending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Mail className="h-4 w-4" />
                    )}
                    {sending ? "Envoi en cours…" : "Envoyer l'invitation"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Card className="overflow-hidden p-0">
        {loading ? (
          <div className="grid h-40 place-items-center">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : (
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
              {members.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    Aucun membre pour l'instant.
                  </TableCell>
                </TableRow>
              )}
              {members.map((m) => {
                const label = m.profile?.full_name ?? m.invited_email ?? "Membre";
                const initials = label
                  .split(/\s+|@/)
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((s) => s[0]?.toUpperCase() ?? "")
                  .join("");
                const isDirectorMember = isOwnerRole(m.role);
                // Un Directeur ne peut être modifié que par un autre Directeur,
                // et son rôle n'est jamais éditable depuis ce tableau.
                const canEditMember = isAdmin && !isDirectorMember;
                return (
                  <TableRow key={m.id} className="group">
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-gradient text-xs font-semibold text-primary-foreground shadow-sm">
                          {initials || "?"}
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
                      {canEditMember ? (
                        <Select
                          value={m.role}
                          onValueChange={(v) =>
                            changeRole(m.id, v as CompanyRoleValue)
                          }
                        >
                          <SelectTrigger className="h-8 w-44">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ASSIGNABLE_ROLES.map((r) => {
                              const meta = ROLE_META[r];
                              return (
                                <SelectItem key={r} value={r}>
                                  {meta.emoji} {meta.short}
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                      ) : (
                        <RoleBadge role={m.role as CompanyRoleValue} />
                      )}
                    </TableCell>
                    <TableCell>
                      {m.status === "active" && (
                        <Badge className="bg-success text-success-foreground hover:bg-success/90">
                          Actif
                        </Badge>
                      )}
                      {m.status === "invited" && (
                        <Badge variant="outline">Invitation</Badge>
                      )}
                      {m.status === "suspended" && (
                        <Badge variant="destructive">Suspendu</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(m.created_at).toLocaleDateString("fr-FR")}
                    </TableCell>
                    <TableCell className="text-right">
                      {canEditMember && (
                        <div className="inline-flex opacity-60 transition group-hover:opacity-100">
                          <Button
                            size="icon"
                            variant="ghost"
                            title={m.status === "suspended" ? "Réactiver" : "Suspendre"}
                            onClick={() => toggleStatus(m)}
                          >
                            {m.status === "suspended" ? (
                              <UserCheck className="h-4 w-4 text-success" />
                            ) : (
                              <UserX className="h-4 w-4 text-warning" />
                            )}
                          </Button>
                          {isDirecteur && (
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => remove(m)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          )}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card className="p-5">
        <div className="flex items-start gap-3">
          <Shield className="mt-0.5 h-5 w-5 text-primary" />
          <div className="text-sm">
            <p className="font-semibold">Rôles & permissions</p>
            <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground">
              {ROLE_ORDER.map((r) => {
                const meta = ROLE_META[r];
                return (
                  <li key={r} className="flex items-start gap-2">
                    <span aria-hidden className="mt-px">
                      {meta.emoji}
                    </span>
                    <span>
                      <b className="text-foreground">{meta.label}</b> — {meta.description}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </Card>
    </div>
  );
}
