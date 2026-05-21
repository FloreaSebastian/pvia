import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/chantiers")({
  component: ChantiersPage,
  head: () => ({ meta: [{ title: "Chantiers — PV Pro" }] }),
});

type Chantier = { id: string; name: string; address: string | null; type: string | null; status: string; client_id: string | null; start_date: string | null; end_date: string | null; description: string | null };
type Client = { id: string; name: string };

const TYPES = ["BTP", "Rénovation", "Photovoltaïque", "Climatisation", "Plomberie", "Électricité", "Construction"];
const STATUSES = [
  { value: "en_cours", label: "En cours" },
  { value: "termine", label: "Terminé" },
  { value: "receptionne", label: "Réceptionné" },
];

function ChantiersPage() {
  const [items, setItems] = useState<Chantier[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Chantier | null>(null);
  const empty = { name: "", address: "", type: "BTP", status: "en_cours", client_id: "", start_date: "", end_date: "", description: "" };
  const [form, setForm] = useState(empty);

  async function load() {
    const [a, b] = await Promise.all([
      supabase.from("chantiers").select("*").order("created_at", { ascending: false }),
      supabase.from("clients").select("id,name").order("name"),
    ]);
    setItems((a.data as Chantier[]) ?? []);
    setClients((b.data as Client[]) ?? []);
  }
  useEffect(() => { load(); }, []);

  function openNew() { setEditing(null); setForm(empty); setOpen(true); }
  function openEdit(c: Chantier) {
    setEditing(c);
    setForm({
      name: c.name, address: c.address ?? "", type: c.type ?? "BTP", status: c.status,
      client_id: c.client_id ?? "", start_date: c.start_date ?? "", end_date: c.end_date ?? "",
      description: c.description ?? "",
    });
    setOpen(true);
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const payload = {
      ...form,
      owner_id: user.id,
      client_id: form.client_id || null,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
    };
    const res = editing
      ? await supabase.from("chantiers").update(payload).eq("id", editing.id)
      : await supabase.from("chantiers").insert(payload);
    if (res.error) return toast.error(res.error.message);
    toast.success(editing ? "Chantier modifié" : "Chantier créé");
    setOpen(false);
    load();
  }
  async function remove(id: string) {
    if (!confirm("Supprimer ce chantier ?")) return;
    const { error } = await supabase.from("chantiers").delete().eq("id", id);
    if (error) return toast.error(error.message);
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Chantiers</h1>
          <p className="text-sm text-muted-foreground">Tous vos chantiers en un coup d'œil.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button onClick={openNew}><Plus className="h-4 w-4" /> Nouveau chantier</Button></DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>{editing ? "Modifier le chantier" : "Nouveau chantier"}</DialogTitle></DialogHeader>
            <form onSubmit={save} className="space-y-3">
              <div><Label>Nom *</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Type</Label>
                  <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Statut</Label>
                  <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{STATUSES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Client</Label>
                <Select value={form.client_id || "none"} onValueChange={(v) => setForm({ ...form, client_id: v === "none" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="Aucun" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Aucun</SelectItem>
                    {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Adresse</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Début</Label><Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></div>
                <div><Label>Fin prévue</Label><Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></div>
              </div>
              <div><Label>Description</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
              <DialogFooter><Button type="submit">Enregistrer</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow><TableHead>Nom</TableHead><TableHead>Type</TableHead><TableHead>Statut</TableHead><TableHead>Adresse</TableHead><TableHead></TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && <TableRow><TableCell colSpan={5} className="py-12 text-center text-sm text-muted-foreground">Aucun chantier.</TableCell></TableRow>}
            {items.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell><Badge variant="secondary">{c.type}</Badge></TableCell>
                <TableCell><Badge>{STATUSES.find((s) => s.value === c.status)?.label ?? c.status}</Badge></TableCell>
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
