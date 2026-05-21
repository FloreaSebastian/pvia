import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import SignaturePad from "react-signature-canvas";
import { Upload, Trash2, Plus, Loader2, Save, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { jsPDF } from "jspdf";

export const Route = createFileRoute("/_authenticated/pv/new")({
  component: NewPv,
  head: () => ({ meta: [{ title: "Nouveau PV — PVIA" }] }),
});

type Photo = { file: File; preview: string; caption: string };
type Reserve = { description: string; severity: "mineure" | "majeure" };

const TYPES = [
  { value: "reception", label: "Réception de travaux" },
  { value: "reception_reserves", label: "Réception avec réserves" },
  { value: "levee_reserves", label: "Levée de réserves" },
];

function NewPv() {
  const navigate = useNavigate();
  const [chantiers, setChantiers] = useState<{ id: string; name: string; client_id: string | null }[]>([]);
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    numero: `PV-${Date.now().toString().slice(-6)}`,
    type: "reception",
    chantier_id: "",
    client_id: "",
    reception_date: new Date().toISOString().slice(0, 10),
    description: "",
    observations: "",
  });
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [reserves, setReserves] = useState<Reserve[]>([]);
  const [newReserve, setNewReserve] = useState<Reserve>({ description: "", severity: "mineure" });

  const clientSigRef = useRef<SignaturePad>(null);
  const companySigRef = useRef<SignaturePad>(null);

  useEffect(() => {
    (async () => {
      const [c, cl] = await Promise.all([
        supabase.from("chantiers").select("id,name,client_id").order("name"),
        supabase.from("clients").select("id,name").order("name"),
      ]);
      setChantiers(c.data ?? []);
      setClients(cl.data ?? []);
    })();
  }, []);

  function onFiles(files: FileList | null) {
    if (!files) return;
    const next = Array.from(files).map((file) => ({ file, preview: URL.createObjectURL(file), caption: "" }));
    setPhotos((p) => [...p, ...next]);
  }

  function addReserve() {
    if (!newReserve.description.trim()) return;
    setReserves((r) => [...r, { ...newReserve }]);
    setNewReserve({ description: "", severity: "mineure" });
  }

  async function generatePdf(numero: string, signs: { client: string | null; company: string | null }) {
    const doc = new jsPDF();
    let y = 20;
    doc.setFontSize(18); doc.text("PROCÈS-VERBAL DE RÉCEPTION", 105, y, { align: "center" });
    y += 8; doc.setFontSize(11); doc.text(`N° ${numero}`, 105, y, { align: "center" });
    y += 12; doc.setFontSize(10);
    doc.text(`Type : ${TYPES.find((t) => t.value === form.type)?.label}`, 14, y); y += 6;
    doc.text(`Date : ${form.reception_date}`, 14, y); y += 6;
    const chant = chantiers.find((c) => c.id === form.chantier_id);
    if (chant) { doc.text(`Chantier : ${chant.name}`, 14, y); y += 6; }
    const cli = clients.find((c) => c.id === form.client_id);
    if (cli) { doc.text(`Client : ${cli.name}`, 14, y); y += 6; }
    y += 4;
    doc.setFont("helvetica", "bold"); doc.text("Description", 14, y); doc.setFont("helvetica", "normal"); y += 6;
    doc.text(doc.splitTextToSize(form.description || "—", 180), 14, y); y += Math.max(8, doc.splitTextToSize(form.description || "—", 180).length * 5);
    y += 4;
    doc.setFont("helvetica", "bold"); doc.text("Observations", 14, y); doc.setFont("helvetica", "normal"); y += 6;
    doc.text(doc.splitTextToSize(form.observations || "—", 180), 14, y); y += Math.max(8, doc.splitTextToSize(form.observations || "—", 180).length * 5);
    if (reserves.length) {
      y += 4; doc.setFont("helvetica", "bold"); doc.text("Réserves", 14, y); doc.setFont("helvetica", "normal"); y += 6;
      reserves.forEach((r, i) => { doc.text(`${i + 1}. [${r.severity}] ${r.description}`, 14, y); y += 6; });
    }
    if (y > 220) { doc.addPage(); y = 20; }
    y += 10; doc.setFont("helvetica", "bold"); doc.text("Signatures", 14, y); y += 8;
    doc.setFont("helvetica", "normal");
    doc.text("Client :", 14, y); doc.text("Entreprise :", 110, y); y += 4;
    if (signs.client) doc.addImage(signs.client, "PNG", 14, y, 70, 30);
    if (signs.company) doc.addImage(signs.company, "PNG", 110, y, 70, 30);
    return doc.output("blob");
  }

  async function onSave(status: "brouillon" | "signe") {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Non connecté");

      const clientSig = status === "signe" && !clientSigRef.current?.isEmpty() ? clientSigRef.current!.toDataURL("image/png") : null;
      const companySig = status === "signe" && !companySigRef.current?.isEmpty() ? companySigRef.current!.toDataURL("image/png") : null;

      if (status === "signe" && (!clientSig || !companySig)) {
        toast.error("Les deux signatures sont requises pour valider.");
        setSaving(false); return;
      }

      // Generate PDF
      const pdfBlob = await generatePdf(form.numero, { client: clientSig, company: companySig });
      const pdfPath = `${user.id}/pv/${form.numero}-${Date.now()}.pdf`;
      const up = await supabase.storage.from("pv-assets").upload(pdfPath, pdfBlob, { contentType: "application/pdf" });
      if (up.error) throw up.error;

      // Insert PV
      const { data: pvIns, error } = await supabase.from("pv").insert({
        owner_id: user.id,
        numero: form.numero,
        type: form.type,
        status,
        reception_date: form.reception_date,
        chantier_id: form.chantier_id || null,
        client_id: form.client_id || null,
        description: form.description,
        observations: form.observations,
        client_signature: clientSig,
        company_signature: companySig,
        signed_at: status === "signe" ? new Date().toISOString() : null,
        pdf_url: pdfPath,
      }).select("id").single();
      if (error) throw error;

      // Upload photos
      for (const p of photos) {
        const path = `${user.id}/photos/${pvIns.id}/${Date.now()}-${p.file.name}`;
        const u = await supabase.storage.from("pv-assets").upload(path, p.file);
        if (!u.error) {
          await supabase.from("pv_photos").insert({ pv_id: pvIns.id, owner_id: user.id, url: path, caption: p.caption });
        }
      }
      // Insert reserves
      if (reserves.length) {
        await supabase.from("pv_reserves").insert(reserves.map((r) => ({ pv_id: pvIns.id, owner_id: user.id, ...r })));
      }

      toast.success(status === "signe" ? "PV signé et enregistré" : "Brouillon enregistré");
      navigate({ to: "/pv" });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Nouveau procès-verbal</h1>
          <p className="text-sm text-muted-foreground">Remplissez les informations, ajoutez photos et signatures.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" disabled={saving} onClick={() => onSave("brouillon")}><Save className="h-4 w-4" /> Brouillon</Button>
          <Button disabled={saving} onClick={() => onSave("signe")}>{saving && <Loader2 className="h-4 w-4 animate-spin" />} Valider & générer PDF</Button>
        </div>
      </div>

      <Card className="p-6 space-y-4">
        <h3 className="font-semibold">Informations générales</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><Label>N° de PV</Label><Input value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} /></div>
          <div>
            <Label>Type</Label>
            <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Chantier</Label>
            <Select value={form.chantier_id || "none"} onValueChange={(v) => setForm({ ...form, chantier_id: v === "none" ? "" : v, client_id: chantiers.find(c => c.id === v)?.client_id ?? form.client_id })}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent><SelectItem value="none">—</SelectItem>{chantiers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Client</Label>
            <Select value={form.client_id || "none"} onValueChange={(v) => setForm({ ...form, client_id: v === "none" ? "" : v })}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent><SelectItem value="none">—</SelectItem>{clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2"><Label>Date de réception</Label><Input type="date" value={form.reception_date} onChange={(e) => setForm({ ...form, reception_date: e.target.value })} /></div>
        </div>
        <div><Label>Description des travaux</Label><Textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
        <div><Label>Observations</Label><Textarea rows={3} value={form.observations} onChange={(e) => setForm({ ...form, observations: e.target.value })} /></div>
      </Card>

      <Card className="p-6 space-y-4">
        <div className="flex items-center justify-between"><h3 className="font-semibold">Photos du chantier</h3><span className="text-xs text-muted-foreground">{photos.length} photo(s)</span></div>
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-muted/50 p-8 text-sm text-muted-foreground hover:border-primary">
          <Upload className="h-4 w-4" /> Ajouter des photos
          <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />
        </label>
        {photos.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-3">
            {photos.map((p, i) => (
              <div key={i} className="group relative overflow-hidden rounded-lg border border-border">
                <img src={p.preview} alt="" className="aspect-square w-full object-cover" />
                <button type="button" onClick={() => setPhotos(photos.filter((_, j) => j !== i))} className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-md bg-background/80"><X className="h-3 w-3" /></button>
                <Input placeholder="Légende" className="rounded-none border-0 border-t" value={p.caption} onChange={(e) => { const c = [...photos]; c[i].caption = e.target.value; setPhotos(c); }} />
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-6 space-y-4">
        <h3 className="font-semibold">Réserves</h3>
        <div className="flex gap-2">
          <Input placeholder="Description de la réserve" value={newReserve.description} onChange={(e) => setNewReserve({ ...newReserve, description: e.target.value })} />
          <Select value={newReserve.severity} onValueChange={(v) => setNewReserve({ ...newReserve, severity: v as "mineure" | "majeure" })}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="mineure">Mineure</SelectItem><SelectItem value="majeure">Majeure</SelectItem></SelectContent>
          </Select>
          <Button type="button" onClick={addReserve}><Plus className="h-4 w-4" /></Button>
        </div>
        {reserves.length > 0 && (
          <ul className="space-y-2">
            {reserves.map((r, i) => (
              <li key={i} className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
                <span className="flex items-center gap-2"><Badge variant={r.severity === "majeure" ? "destructive" : "secondary"}>{r.severity}</Badge>{r.description}</span>
                <Button size="icon" variant="ghost" onClick={() => setReserves(reserves.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-6">
        <h3 className="font-semibold">Signatures</h3>
        <p className="mt-1 text-xs text-muted-foreground">Signez avec le doigt ou la souris pour valider le PV.</p>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div>
            <Label>Signature du client</Label>
            <div className="mt-1 rounded-lg border border-border bg-muted/30">
              <SignaturePad ref={clientSigRef} canvasProps={{ className: "w-full h-40 rounded-lg" }} />
            </div>
            <Button variant="ghost" size="sm" onClick={() => clientSigRef.current?.clear()} className="mt-2">Effacer</Button>
          </div>
          <div>
            <Label>Signature entreprise</Label>
            <div className="mt-1 rounded-lg border border-border bg-muted/30">
              <SignaturePad ref={companySigRef} canvasProps={{ className: "w-full h-40 rounded-lg" }} />
            </div>
            <Button variant="ghost" size="sm" onClick={() => companySigRef.current?.clear()} className="mt-2">Effacer</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
