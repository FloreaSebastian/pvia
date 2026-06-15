import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { listAdminCompanies } from "@/lib/admin-platform.functions";

import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/companies")({
  component: Page,
  head: () => ({ meta: [{ title: "Admin · Entreprises — PVIA" }] }),
  beforeLoad: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw redirect({ to: "/login" });
    const { isPlatformAdminEmail } = await import("@/lib/platform-admin");
    if (!isPlatformAdminEmail(user.email)) throw redirect({ to: "/admin/forbidden" });
    const { data } = await supabase.from("user_roles").select("role").eq("user_id", user.id).eq("role", "platform_admin").maybeSingle();
    if (!data) throw redirect({ to: "/admin/forbidden" });
  },
});

function Page() {
  const fn = useServerFn(listAdminCompanies);
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<any>("all");

  useEffect(() => {
    setLoading(true);
    fn({ data: { search: search || undefined, status, limit: 100, offset: 0 } })
      .then((r: any) => { setRows(r.companies); setTotal(r.total); })
      .finally(() => setLoading(false));
  }, [fn, search, status]);

  return (
    <div>
      
      <div className="mb-4 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Entreprises</h1>
          <p className="text-sm text-muted-foreground">{total} entreprise(s) inscrites sur PVIA.</p>
        </div>
      </div>

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap gap-2">
          <Input placeholder="Nom, email, SIREN/SIRET…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous statuts</SelectItem>
              <SelectItem value="trial">En essai</SelectItem>
              <SelectItem value="active">Actifs payants</SelectItem>
              <SelectItem value="past_due">Past_due</SelectItem>
              <SelectItem value="canceled">Annulés</SelectItem>
              <SelectItem value="no_sub">Sans abonnement</SelectItem>
              <SelectItem value="onboarding">Onboarding incomplet</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      <Card>
        {loading ? (
          <div className="grid place-items-center p-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Entreprise</TableHead>
                <TableHead>SIREN/SIRET</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right">Membres</TableHead>
                <TableHead className="text-right">PV</TableHead>
                <TableHead>Inscription</TableHead>
                <TableHead>Dernier PV</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link to="/admin/companies/$id" params={{ id: c.id }} className="font-medium hover:underline">{c.name}</Link>
                    <div className="text-xs text-muted-foreground">{c.email ?? "—"}</div>
                  </TableCell>
                  <TableCell className="text-xs">{c.siret ?? c.siren ?? "—"}</TableCell>
                  <TableCell><Badge variant="outline">{c.plan}</Badge></TableCell>
                  <TableCell><Badge>{c.sub_status}</Badge></TableCell>
                  <TableCell className="text-right">{c.member_count}</TableCell>
                  <TableCell className="text-right">{c.pv_count}</TableCell>
                  <TableCell className="text-xs">{new Date(c.created_at).toLocaleDateString("fr-FR")}</TableCell>
                  <TableCell className="text-xs">{c.last_pv_at ? new Date(c.last_pv_at).toLocaleDateString("fr-FR") : "—"}</TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">Aucune entreprise.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
