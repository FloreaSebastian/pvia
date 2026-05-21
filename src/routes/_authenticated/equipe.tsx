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

export const Route = createFileRoute("/_authenticated/equipe")({
  component: TeamPage,
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

const ROLES: { value: CompanyRole; label: string; description: string }[] = [
  { value: "owner", label: "Owner", description: "Accès total" },
  { value: "admin", label: "Admin", description: "Tout sauf suppression entreprise" },
  { value: "manager", label: "Manager", description: "Gère PV, clients, chantiers" },
  { value: "user", label: "User", description: "Lecture + création PV" },
];

function TeamPage() {
  const { activeCompanyId, can, activeRole } = useCompany();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<CompanyRole>("user");
  const [sending, setSending] = useState(false);
  const sendInviteFn = useServerFn(sendInvite);

  async function load() {
    if (!activeCompanyId) return;
    setLoading(true);
    const { data } = await supabase
      .from("company_members")
      .select("id,user_id,role,status,invited_email,created_at")
      .eq("company_id", activeCompanyId)
      .order("created_at", { ascending: true });
    const raw = (data as Member[]) ?? [];
    // Fetch profiles separately
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
    if (inviteRole === "owner") return toast.error("Impossible d'inviter un owner.");
    setSending(true);
    try {
      await sendInviteFn({
        data: { companyId: activeCompanyId, email, role: inviteRole as "admin" | "manager" | "user" },
      });
      toast.success(`Invitation envoyée à ${email}`);
      setInviteOpen(false);
      setInviteEmail("");
      setInviteRole("user");
      load();
    } catch (err: any) {
      toast.error(err?.message ?? "Échec de l'envoi de l'invitation");
    } finally {
      setSending(false);
    }
  }


  async function changeRole(id: string, role: CompanyRole) {
    const { error } = await supabase.from("company_members").update({ role }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Rôle modifié");
    load();
  }

  async function toggleStatus(m: Member) {
    const next = m.status === "suspended" ? "active" : "suspended";
    const { error } = await supabase.from("company_members").update({ status: next }).eq("id", m.id);
    if (error) return toast.error(error.message);
    toast.success(next === "suspended" ? "Membre suspendu" : "Membre réactivé");
    load();
  }

  async function remove(m: Member) {
    if (m.role === "owner") return toast.error("Impossible de retirer l'owner.");
    if (!confirm("Retirer ce membre de l'entreprise ?")) return;
    const { error } = await supabase.from("company_members").delete().eq("id", m.id);
    if (error) return toast.error(error.message);
    toast.success("Membre retiré");
    load();
  }

  const isAdmin = can("admin");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-primary">Multi-utilisateurs</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Équipe</h1>
          <p className="text-sm text-muted-foreground">
            Gérez les membres de votre entreprise, leurs rôles et leurs accès.
          </p>
        </div>
        {isAdmin && (
          <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
            <DialogTrigger asChild>
              <Button>
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
                  <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as CompanyRole)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ROLES.filter((r) => r.value !== "owner" || activeRole === "owner").map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          <div>
                            <div className="font-medium">{r.label}</div>
                            <div className="text-[11px] text-muted-foreground">{r.description}</div>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <DialogFooter>
                  <Button type="submit"><Mail className="h-4 w-4" /> Envoyer l'invitation</Button>
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
                  <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                    Aucun membre pour l'instant.
                  </TableCell>
                </TableRow>
              )}
              {members.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>
                    <div className="font-medium">
                      {m.profile?.full_name ?? m.invited_email ?? "Membre"}
                    </div>
                    {m.invited_email && !m.user_id && (
                      <div className="text-xs text-muted-foreground">{m.invited_email}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    {isAdmin && m.role !== "owner" ? (
                      <Select value={m.role} onValueChange={(v) => changeRole(m.id, v as CompanyRole)}>
                        <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {ROLES.filter((r) => r.value !== "owner").map((r) => (
                            <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant="secondary" className="gap-1">
                        <Shield className="h-3 w-3" /> {m.role}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {m.status === "active" && <Badge className="bg-emerald-600">Actif</Badge>}
                    {m.status === "invited" && <Badge variant="outline">Invitation</Badge>}
                    {m.status === "suspended" && <Badge variant="destructive">Suspendu</Badge>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(m.created_at).toLocaleDateString("fr-FR")}
                  </TableCell>
                  <TableCell className="text-right">
                    {isAdmin && m.role !== "owner" && (
                      <>
                        <Button
                          size="icon"
                          variant="ghost"
                          title={m.status === "suspended" ? "Réactiver" : "Suspendre"}
                          onClick={() => toggleStatus(m)}
                        >
                          {m.status === "suspended" ? (
                            <UserCheck className="h-4 w-4 text-emerald-600" />
                          ) : (
                            <UserX className="h-4 w-4 text-amber-600" />
                          )}
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => remove(m)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card className="p-5">
        <div className="flex items-start gap-3">
          <Shield className="mt-0.5 h-5 w-5 text-primary" />
          <div className="text-sm">
            <p className="font-semibold">Rôles & permissions</p>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              <li>• <b className="text-foreground">Owner</b> — accès total, transfert et suppression d'entreprise.</li>
              <li>• <b className="text-foreground">Admin</b> — gère membres, entreprise, données.</li>
              <li>• <b className="text-foreground">Manager</b> — crée et modifie PV, clients, chantiers.</li>
              <li>• <b className="text-foreground">User</b> — lecture + création de PV uniquement.</li>
            </ul>
          </div>
        </div>
      </Card>
    </div>
  );
}
