import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useCompany } from "@/hooks/use-company";
import { PageHeader } from "@/components/app/PageHeader";

export const Route = createFileRoute("/_authenticated/clients")({
  component: ClientsPage,
  head: () => ({ meta: [{ title: "Clients — PVIA" }] }),
});

type Client = { id: string; name: string; email: string | null; phone: string | null; address: string | null; notes: string | null };

function ClientsPage() {
  const { activeCompanyId, can } = useCompany();
  const [items, setItems] = useState<Client[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", address: "", notes: "" });
  const canWrite = can("manage");

  async function load() {
    if (!activeCompanyId) return;
    const { data } = await supabase
      .from("clients")
      .select("*")
      .eq("company_id", activeCompanyId)
      .order("created_at", { ascending: false });
    setItems((data as Client[]) ?? []);
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activeCompanyId]);

  function openNew() {
    setEditing(null);
    setForm({ name: "", email: "", phone: "", address: "", notes: "" });
    setOpen(true);
  }
  function openEdit(c: Client) {
    setEditing(c);
    setForm({ name: c.name, email: c.email ?? "", phone: c.phone ?? "", address: c.address ?? "", notes: c.notes ?? "" });
    setOpen(true);
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !activeCompanyId) return;
    const payload = { ...form, owner_id: user.id, company_id: activeCompanyId };
    const res = editing
      ? await supabase.from("clients").update(payload).eq("id", editing.id)
      : await supabase.from("clients").insert(payload);
    if (res.error) return toast.error(res.error.message);
    toast.success(editing ? "Client modifié" : "Client créé");
    setOpen(false);
    load();
  }
  async function remove(id: string) {
    if (!confirm("Supprimer ce client ?")) return;
    const { error } = await supabase.from("clients").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Supprimé");
    load();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clients"
        description="Gérez votre carnet d'adresses."
        contained={false}
        className="border-0 bg-transparent px-0 py-0"
        actions={
          canWrite ? (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild><Button onClick={openNew}><Plus className="h-4 w-4" /> Nouveau client</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>{editing ? "Modifier le client" : "Nouveau client"}</DialogTitle></DialogHeader>
                <form onSubmit={save} className="space-y-3">
                  <div><Label>Nom *</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
                    <div><Label>Téléphone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
                  </div>
                  <div><Label>Adresse</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
                  <div><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
                  <DialogFooter><Button type="submit">Enregistrer</Button></DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          ) : null
        }
      />

      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nom</TableHead><TableHead>Email</TableHead><TableHead>Téléphone</TableHead><TableHead>Adresse</TableHead><TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && <TableRow><TableCell colSpan={5} className="py-12 text-center text-sm text-muted-foreground">Aucun client.</TableCell></TableRow>}
            {items.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell>{c.email}</TableCell>
                <TableCell>{c.phone}</TableCell>
                <TableCell className="text-muted-foreground">{c.address}</TableCell>
                <TableCell className="text-right">
                  <Button size="icon" variant="ghost" onClick={() => openEdit(c)}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => remove(c.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
