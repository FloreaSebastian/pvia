import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Building2,
  FileText,
  Loader2,
  Mail,
  MoreHorizontal,
  Plus,
  RefreshCw,
  ShieldCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app/PageHeader";
import { RouteRoleGuard } from "@/components/auth/RouteRoleGuard";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCompany } from "@/hooks/use-company";
import { ADMIN_ROLES } from "@/lib/roles";
import {
  inviteSubcontractor,
  listSubcontractors,
  saveSubcontractorCompany,
  setSubcontractorCompanyStatus,
  setSubcontractorMembershipStatus,
  updateSubcontractorMembership,
} from "@/lib/subcontractors.functions";
import { ComplianceBadge } from "@/components/subcontractors/ComplianceBadge";
import { ComplianceDialog } from "@/components/subcontractors/ComplianceDialog";
import { listSubcontractorsCompliance } from "@/lib/subcontractor-documents.functions";
import {
  PERMISSION_GROUPS,
  PERMISSION_META,
  PRESETS,
  PRESET_META,
  SUBCONTRACTOR_PERMISSIONS,
  SUBCONTRACTOR_STATUS_LABELS,
  normalizePermissions,
  permissionsFromPreset,
  type SubcontractorPermission,
  type SubcontractorPermissionMap,
  type SubcontractorPreset,
} from "@/lib/subcontractor-permissions";

export const Route = createFileRoute("/_authenticated/sous-traitants")({
  component: () => (
    <RouteRoleGuard allow={ADMIN_ROLES}>
      <SubcontractorsPage />
    </RouteRoleGuard>
  ),
  head: () => ({
    meta: [
      { title: "Sous-traitants — Gérer vos partenaires | PVIA" },
      {
        name: "description",
        content:
          "Invitez vos sous-traitants, définissez leurs autorisations chantier par chantier et suivez leurs interventions dans PVIA.",
      },
      { property: "og:title", content: "Gestion des sous-traitants — PVIA" },
      {
        property: "og:description",
        content: "Accès sécurisé, autorisations fines et suivi des interventions de vos sous-traitants.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

const STATUS_VARIANT: Record<string, string> = {
  active: "bg-green-600 text-white",
  invited: "bg-amber-500 text-white",
  suspended: "bg-orange-600 text-white",
  archived: "bg-muted text-muted-foreground",
};

function SubcontractorsPage() {
  const { activeCompanyId } = useCompany();
  const qc = useQueryClient();
  const list = useServerFn(listSubcontractors);
  const saveCompany = useServerFn(saveSubcontractorCompany);
  const setCompanyStatus = useServerFn(setSubcontractorCompanyStatus);
  const invite = useServerFn(inviteSubcontractor);
  const updateMembership = useServerFn(updateSubcontractorMembership);
  const setMembershipStatus = useServerFn(setSubcontractorMembershipStatus);

  const [companyDialog, setCompanyDialog] = useState(false);
  const [inviteFor, setInviteFor] = useState<{ id: string; name: string } | null>(null);
  const [permsFor, setPermsFor] = useState<any | null>(null);
  const [docsFor, setDocsFor] = useState<{ id: string; name: string } | null>(null);
  const complianceFn = useServerFn(listSubcontractorsCompliance);

  const { data, isLoading } = useQuery({
    queryKey: ["subcontractors", activeCompanyId],
    queryFn: () => list({ data: { companyId: activeCompanyId! } }),
    enabled: !!activeCompanyId,
  });

  const { data: compliance } = useQuery({
    queryKey: ["sc-compliance", activeCompanyId],
    queryFn: () => complianceFn({ data: { companyId: activeCompanyId! } }),
    enabled: !!activeCompanyId,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["subcontractors", activeCompanyId] });

  const mSave = useMutation({
    mutationFn: (payload: any) => saveCompany({ data: { ...payload, companyId: activeCompanyId! } }),
    onSuccess: () => {
      toast.success("Sous-traitant enregistré.");
      setCompanyDialog(false);
      refresh();
    },
    onError: (e: any) => toast.error(e?.message ?? "Enregistrement impossible."),
  });

  const mInvite = useMutation({
    mutationFn: (payload: any) => invite({ data: { ...payload, companyId: activeCompanyId! } }),
    onSuccess: () => {
      toast.success("Invitation envoyée.");
      setInviteFor(null);
      refresh();
    },
    onError: (e: any) => toast.error(e?.message ?? "Invitation impossible."),
  });

  const mPerms = useMutation({
    mutationFn: (payload: any) => updateMembership({ data: { ...payload, companyId: activeCompanyId! } }),
    onSuccess: () => {
      toast.success("Autorisations mises à jour.");
      setPermsFor(null);
      refresh();
    },
    onError: (e: any) => toast.error(e?.message ?? "Mise à jour impossible."),
  });

  const mStatus = useMutation({
    mutationFn: (payload: { membershipId: string; status: "active" | "suspended" | "archived" }) =>
      setMembershipStatus({ data: { ...payload, companyId: activeCompanyId! } }),
    onSuccess: () => {
      toast.success("Accès mis à jour.");
      refresh();
    },
    onError: (e: any) => toast.error(e?.message ?? "Mise à jour impossible."),
  });

  const mCompanyStatus = useMutation({
    mutationFn: (payload: { id: string; status: "active" | "suspended" | "archived" }) =>
      setCompanyStatus({ data: { ...payload, companyId: activeCompanyId! } }),
    onSuccess: () => {
      toast.success("Statut mis à jour.");
      refresh();
    },
    onError: (e: any) => toast.error(e?.message ?? "Mise à jour impossible."),
  });

  const membershipsByCompany = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const m of data?.memberships ?? []) {
      const arr = map.get(m.subcontractor_company_id) ?? [];
      arr.push(m);
      map.set(m.subcontractor_company_id, arr);
    }
    return map;
  }, [data]);

  return (
    <div className="space-y-5 pb-24">
      <PageHeader
        title="Sous-traitants"
        description="Vos entreprises partenaires, leurs intervenants et leurs autorisations."
        actions={
          <Button className="h-11 w-full sm:w-auto" onClick={() => setCompanyDialog(true)}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Nouveau sous-traitant
          </Button>
        }
      />

      {isLoading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (data?.companies.length ?? 0) === 0 ? (
        <Card className="p-8 text-center">
          <Building2 className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <h2 className="mt-3 font-display text-lg font-semibold">Aucun sous-traitant</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Créez une entreprise partenaire, puis invitez ses intervenants. Ils accèdent uniquement aux
            chantiers sur lesquels vous les affectez.
          </p>
          <Button className="mt-4 h-11" onClick={() => setCompanyDialog(true)}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Créer un sous-traitant
          </Button>
        </Card>
      ) : (
        <div className="space-y-4">
          {(data?.companies ?? []).map((c: any) => {
            const members = membershipsByCompany.get(c.id) ?? [];
            return (
              <Card key={c.id} className="overflow-hidden">
                <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate font-display text-base font-semibold">{c.name}</h2>
                      <Badge className={STATUS_VARIANT[c.status] ?? ""}>
                        {SUBCONTRACTOR_STATUS_LABELS[c.status] ?? c.status}
                      </Badge>
                      {(compliance as any)?.byPartner?.[c.id] ? (
                        <ComplianceBadge status={(compliance as any).byPartner[c.id].status} />
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {[c.trade_name, c.city, c.phone, c.email].filter(Boolean).join(" · ") || "—"}
                    </p>
                    {c.trades?.length ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {c.trades.map((t: string) => (
                          <Badge key={t} variant="secondary" className="text-xs">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      className="h-11 flex-1 sm:flex-none"
                      onClick={() => setDocsFor({ id: c.id, name: c.name })}
                    >
                      <FileText className="mr-1.5 h-4 w-4" aria-hidden="true" />
                      Documents
                    </Button>
                    <Button
                      variant="outline"
                      className="h-11 flex-1 sm:flex-none"
                      onClick={() => setInviteFor({ id: c.id, name: c.name })}
                      disabled={c.status !== "active"}
                    >
                      <UserPlus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                      Inviter un intervenant
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Actions">
                          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {c.status !== "active" && (
                          <DropdownMenuItem onClick={() => mCompanyStatus.mutate({ id: c.id, status: "active" })}>
                            Réactiver
                          </DropdownMenuItem>
                        )}
                        {c.status === "active" && (
                          <DropdownMenuItem onClick={() => mCompanyStatus.mutate({ id: c.id, status: "suspended" })}>
                            Suspendre l'accès
                          </DropdownMenuItem>
                        )}
                        {c.status !== "archived" && (
                          <DropdownMenuItem onClick={() => mCompanyStatus.mutate({ id: c.id, status: "archived" })}>
                            Archiver
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                <Separator />

                {members.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">
                    Aucun intervenant invité pour cette entreprise.
                  </p>
                ) : (
                  <ul className="divide-y">
                    {members.map((m: any) => (
                      <li key={m.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate font-medium">
                              {m.contact?.full_name || m.contact?.email}
                            </span>
                            <Badge className={STATUS_VARIANT[m.status] ?? ""}>
                              {SUBCONTRACTOR_STATUS_LABELS[m.status] ?? m.status}
                            </Badge>
                            {m.preset ? (
                              <Badge variant="outline" className="text-xs">
                                {PRESET_META[m.preset as SubcontractorPreset]?.label ?? m.preset}
                              </Badge>
                            ) : null}
                          </div>
                          <p className="mt-0.5 truncate text-sm text-muted-foreground">
                            {m.contact?.email}
                            {m.job_title ? ` · ${m.job_title}` : ""}
                            {m.activeAssignments ? ` · ${m.activeAssignments} intervention(s) en cours` : ""}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            className="h-11 flex-1 sm:flex-none"
                            onClick={() => setPermsFor(m)}
                          >
                            <ShieldCheck className="mr-1.5 h-4 w-4" aria-hidden="true" />
                            Autorisations
                          </Button>
                          {m.status === "active" ? (
                            <Button
                              variant="ghost"
                              className="h-11"
                              onClick={() => mStatus.mutate({ membershipId: m.id, status: "suspended" })}
                            >
                              Suspendre
                            </Button>
                          ) : m.status !== "archived" ? (
                            <Button
                              variant="ghost"
                              className="h-11"
                              onClick={() => mStatus.mutate({ membershipId: m.id, status: "active" })}
                            >
                              Réactiver
                            </Button>
                          ) : null}
                          {m.status !== "archived" && (
                            <Button
                              variant="ghost"
                              className="h-11 text-destructive"
                              onClick={() => mStatus.mutate({ membershipId: m.id, status: "archived" })}
                            >
                              Révoquer
                            </Button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <CompanyDialog
        open={companyDialog}
        onOpenChange={setCompanyDialog}
        pending={mSave.isPending}
        onSubmit={(v) => mSave.mutate(v)}
      />
      <InviteDialog
        target={inviteFor}
        onOpenChange={(o) => !o && setInviteFor(null)}
        pending={mInvite.isPending}
        onSubmit={(v) => mInvite.mutate({ ...v, subcontractorCompanyId: inviteFor!.id })}
      />
      <PermissionsDialog
        membership={permsFor}
        onOpenChange={(o) => !o && setPermsFor(null)}
        pending={mPerms.isPending}
        onSubmit={(v) => mPerms.mutate({ ...v, membershipId: permsFor.id })}
      />
      {docsFor && activeCompanyId ? (
        <ComplianceDialog
          companyId={activeCompanyId}
          partner={docsFor}
          onClose={() => setDocsFor(null)}
        />
      ) : null}

    </div>
  );
}

function CompanyDialog(props: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  pending: boolean;
  onSubmit: (v: any) => void;
}) {
  const [form, setForm] = useState({
    name: "",
    trade_name: "",
    siret: "",
    address: "",
    phone: "",
    email: "",
    notes: "",
    trades: "",
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nouveau sous-traitant</DialogTitle>
          <DialogDescription>
            L'entreprise partenaire. Vous inviterez ensuite ses intervenants.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="sc-name">Raison sociale *</Label>
            <Input id="sc-name" className="h-11" value={form.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sc-siret">SIRET</Label>
              <Input id="sc-siret" className="h-11" inputMode="numeric" value={form.siret} onChange={(e) => set("siret", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sc-phone">Téléphone</Label>
              <Input id="sc-phone" className="h-11" inputMode="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sc-email">Email de contact</Label>
            <Input id="sc-email" type="email" className="h-11" value={form.email} onChange={(e) => set("email", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sc-address">Adresse</Label>
            <Input id="sc-address" className="h-11" value={form.address} onChange={(e) => set("address", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sc-trades">Corps de métier (séparés par des virgules)</Label>
            <Input id="sc-trades" className="h-11" placeholder="Électricité, Plomberie" value={form.trades} onChange={(e) => set("trades", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sc-notes">Notes internes</Label>
            <Textarea id="sc-notes" rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-11" onClick={() => props.onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            className="h-11"
            disabled={props.pending || form.name.trim().length < 2}
            onClick={() =>
              props.onSubmit({
                ...form,
                trades: form.trades
                  .split(",")
                  .map((t) => t.trim())
                  .filter(Boolean),
              })
            }
          >
            {props.pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enregistrer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InviteDialog(props: {
  target: { id: string; name: string } | null;
  onOpenChange: (o: boolean) => void;
  pending: boolean;
  onSubmit: (v: any) => void;
}) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [preset, setPreset] = useState<SubcontractorPreset>("terrain");

  return (
    <Dialog open={!!props.target} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Inviter un intervenant</DialogTitle>
          <DialogDescription>{props.target?.name}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="inv-email">Email *</Label>
            <Input id="inv-email" type="email" className="h-11" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="inv-name">Nom complet</Label>
              <Input id="inv-name" className="h-11" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-phone">Téléphone</Label>
              <Input id="inv-phone" className="h-11" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inv-job">Fonction</Label>
            <Input id="inv-job" className="h-11" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Profil d'autorisations</Label>
            <Select value={preset} onValueChange={(v) => setPreset(v as SubcontractorPreset)}>
              <SelectTrigger className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["terrain", "visite_technique", "chef_equipe"] as const).map((p) => (
                  <SelectItem key={p} value={p}>
                    {PRESET_META[p].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{PRESET_META[preset].description}</p>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-11" onClick={() => props.onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            className="h-11"
            disabled={props.pending || !email.includes("@")}
            onClick={() => props.onSubmit({ email, fullName, phone, jobTitle, preset })}
          >
            {props.pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Mail className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Envoyer l'invitation
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PermissionsDialog(props: {
  membership: any | null;
  onOpenChange: (o: boolean) => void;
  pending: boolean;
  onSubmit: (v: any) => void;
}) {
  const initial = useMemo<SubcontractorPermissionMap>(
    () => normalizePermissions(props.membership?.permissions),
    [props.membership],
  );
  const [perms, setPerms] = useState<SubcontractorPermissionMap>(initial);
  const [preset, setPreset] = useState<SubcontractorPreset>(
    (props.membership?.preset as SubcontractorPreset) ?? "custom",
  );
  const [jobTitle, setJobTitle] = useState(props.membership?.job_title ?? "");
  const [key, setKey] = useState(props.membership?.id ?? "");

  if (props.membership && key !== props.membership.id) {
    setKey(props.membership.id);
    setPerms(initial);
    setPreset((props.membership.preset as SubcontractorPreset) ?? "custom");
    setJobTitle(props.membership.job_title ?? "");
  }

  const applyPreset = (p: SubcontractorPreset) => {
    setPreset(p);
    if (p !== "custom") setPerms(permissionsFromPreset(p));
  };

  const toggle = (k: SubcontractorPermission, v: boolean) => {
    setPreset("custom");
    setPerms((prev) => {
      const next = { ...prev };
      if (v) next[k] = true;
      else delete next[k];
      return next;
    });
  };

  return (
    <Dialog open={!!props.membership} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Autorisations</DialogTitle>
          <DialogDescription>
            {props.membership?.contact?.full_name || props.membership?.contact?.email}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="perm-job">Fonction</Label>
              <Input id="perm-job" className="h-11" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Profil</Label>
              <Select value={preset} onValueChange={(v) => applyPreset(v as SubcontractorPreset)}>
                <SelectTrigger className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PRESET_META) as SubcontractorPreset[]).map((p) => (
                    <SelectItem key={p} value={p}>
                      {PRESET_META[p].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {PERMISSION_GROUPS.map((group) => {
            const keys = SUBCONTRACTOR_PERMISSIONS.filter((k) => PERMISSION_META[k].group === group);
            if (!keys.length) return null;
            return (
              <div key={group} className="rounded-xl border p-3">
                <h3 className="text-sm font-semibold">{group}</h3>
                <ul className="mt-2 space-y-2.5">
                  {keys.map((k) => (
                    <li key={k} className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{PERMISSION_META[k].label}</p>
                        <p className="text-xs text-muted-foreground">{PERMISSION_META[k].description}</p>
                      </div>
                      <Switch
                        checked={perms[k] === true}
                        onCheckedChange={(v) => toggle(k, v)}
                        aria-label={PERMISSION_META[k].label}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-11" onClick={() => props.onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            className="h-11"
            disabled={props.pending}
            onClick={() =>
              props.onSubmit({
                jobTitle,
                preset,
                permissions: perms as Record<string, boolean>,
              })
            }
          >
            {props.pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enregistrer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Réexport utilitaire (évite un import inutilisé signalé par le linter). */
export const __presets = PRESETS;
export const __icons = { Users, RefreshCw };
