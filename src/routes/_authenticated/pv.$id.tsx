import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import {
  ArrowLeft,
  Download,
  Trash2,
  CheckCircle2,
  AlertCircle,
  FileText,
  Camera,
  Loader2,
  ChevronRight,
  Send,
  Copy,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { StatusBadge } from "@/components/app/StatusBadge";
import { useServerFn } from "@tanstack/react-start";
import { sendPvToClient } from "@/lib/sign.functions";
import { regeneratePvPdf, getPvPdfSignedUrl } from "@/lib/pdf.functions";

export const Route = createFileRoute("/_authenticated/pv/$id")({
  component: PvDetail,
  head: () => ({ meta: [{ title: "Détail PV — PVIA" }] }),
});


type Pv = {
  id: string;
  numero: string;
  type: string;
  status: string;
  reception_date: string | null;
  created_at: string;
  signed_at: string | null;
  description: string | null;
  observations: string | null;
  client_signature: string | null;
  company_signature: string | null;
  pdf_url: string | null;
  pdf_generated_at: string | null;
  chantier_id: string | null;
  client_id: string | null;
};
type Photo = { id: string; url: string; caption: string | null; signedUrl?: string };
type Reserve = { id: string; description: string; severity: string; status: string };

function PvDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const sendPv = useServerFn(sendPvToClient);
  const regenPdf = useServerFn(regeneratePvPdf);
  const fetchPdfUrl = useServerFn(getPvPdfSignedUrl);
  const [pv, setPv] = useState<Pv | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [reserves, setReserves] = useState<Reserve[]>([]);
  const [chantierName, setChantierName] = useState<string | null>(null);
  const [clientName, setClientName] = useState<string | null>(null);
  const [clientEmail, setClientEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendEmail, setSendEmail] = useState("");
  const [sendingClient, setSendingClient] = useState(false);
  const [lastSignUrl, setLastSignUrl] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);


  const load = useCallback(async () => {
    setLoading(true);
    const { data: pvData, error } = await supabase.from("pv").select("*").eq("id", id).maybeSingle();
    if (error || !pvData) {
      toast.error("PV introuvable");
      navigate({ to: "/pv" });
      return;
    }
    setPv(pvData as Pv);

    const [photosRes, reservesRes] = await Promise.all([
      supabase.from("pv_photos").select("id,url,caption").eq("pv_id", id),
      supabase.from("pv_reserves").select("id,description,severity,status").eq("pv_id", id).order("created_at"),
    ]);
    const ph = (photosRes.data ?? []) as Photo[];
    // Sign URLs for photos
    const signed = await Promise.all(
      ph.map(async (p) => {
        const { data } = await supabase.storage.from("pv-assets").createSignedUrl(p.url, 3600);
        return { ...p, signedUrl: data?.signedUrl };
      }),
    );
    setPhotos(signed);
    setReserves((reservesRes.data ?? []) as Reserve[]);

    if (pvData.chantier_id) {
      const { data: c } = await supabase.from("chantiers").select("name").eq("id", pvData.chantier_id).maybeSingle();
      setChantierName(c?.name ?? null);
    }
    if (pvData.client_id) {
      const { data: cl } = await supabase.from("clients").select("name,email").eq("id", pvData.client_id).maybeSingle();
      setClientName(cl?.name ?? null);
      setClientEmail(cl?.email ?? null);
    }
    setLoading(false);
  }, [id, navigate]);

  useEffect(() => { load(); }, [load]);

  async function changeStatus(status: string) {
    if (!pv) return;
    const patch: { status: string; signed_at?: string | null } = { status };
    if (status === "signe") patch.signed_at = new Date().toISOString();
    const { error } = await supabase.from("pv").update(patch).eq("id", pv.id);
    if (error) return toast.error(error.message);
    toast.success("Statut mis à jour");
    load();
  }

  async function updateReserve(rid: string, status: string) {
    const { error } = await supabase.from("pv_reserves").update({ status }).eq("id", rid);
    if (error) return toast.error(error.message);
    setReserves((rs) => rs.map((r) => (r.id === rid ? { ...r, status } : r)));
    toast.success("Réserve mise à jour");
  }

  async function deleteReserve(rid: string) {
    if (!confirm("Supprimer cette réserve ?")) return;
    const { error } = await supabase.from("pv_reserves").delete().eq("id", rid);
    if (error) return toast.error(error.message);
    setReserves((rs) => rs.filter((r) => r.id !== rid));
  }

  async function downloadPdf() {
    if (!pv) return;
    if (!pv.pdf_url) return toast.error("Aucun PDF disponible. Régénérez-le d'abord.");
    try {
      const { url } = await fetchPdfUrl({ data: { pvId: pv.id } });
      window.open(url, "_blank");
    } catch (e: any) {
      toast.error(e?.message || "PDF indisponible");
    }
  }

  async function handleRegenerate() {
    if (!pv) return;
    setRegenerating(true);
    try {
      await regenPdf({ data: { pvId: pv.id } });
      toast.success("PDF régénéré avec succès");
      load();
    } catch (e: any) {
      toast.error(e?.message || "Échec de la régénération du PDF");
    } finally {
      setRegenerating(false);
    }
  }


  async function deletePv() {
    if (!pv) return;
    if (!confirm("Supprimer définitivement ce PV ainsi que ses photos et réserves ?")) return;
    // delete dependents (RLS scoped to owner)
    await supabase.from("pv_photos").delete().eq("pv_id", pv.id);
    await supabase.from("pv_reserves").delete().eq("pv_id", pv.id);
    const { error } = await supabase.from("pv").delete().eq("id", pv.id);
    if (error) return toast.error(error.message);
    toast.success("PV supprimé");
    navigate({ to: "/pv" });
  }

  async function openSendDialog() {
    if (!pv) return;
    if (pv.client_signature) {
      toast.error("Ce PV est déjà signé par le client.");
      return;
    }
    setSendEmail(clientEmail ?? "");
    setLastSignUrl(null);
    setSendOpen(true);
  }

  async function handleSendToClient() {
    if (!pv) return;
    if (!sendEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(sendEmail)) {
      toast.error("Email client invalide.");
      return;
    }
    setSendingClient(true);
    try {
      const res = await sendPv({ data: { pvId: pv.id, email: sendEmail } });
      setLastSignUrl(res.signUrl);
      toast.success(`Email envoyé à ${sendEmail}`);
      load();
    } catch (e: any) {
      toast.error(e?.message || "Échec de l'envoi");
    } finally {
      setSendingClient(false);
    }
  }

  if (loading || !pv) {
    return (
      <div className="grid h-64 place-items-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Link to="/pv" className="hover:text-foreground">Procès-verbaux</Link>
            <ChevronRight className="h-3 w-3" />
            <span>{pv.numero}</span>
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">PV {pv.numero}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Créé le {new Date(pv.created_at).toLocaleDateString("fr-FR")}
            {pv.signed_at && ` · Signé le ${new Date(pv.signed_at).toLocaleDateString("fr-FR")}`}
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/pv"><Button variant="ghost"><ArrowLeft className="h-4 w-4" /> Retour</Button></Link>
          {!pv.client_signature && (
            <Button onClick={openSendDialog}>
              <Send className="h-4 w-4" /> Envoyer au client pour signature
            </Button>
          )}
          {pv.pdf_url && <Button variant="outline" onClick={downloadPdf}><Download className="h-4 w-4" /> Télécharger PDF</Button>}
          <Button variant="outline" onClick={deletePv}><Trash2 className="h-4 w-4 text-destructive" /> Supprimer</Button>
        </div>
      </div>

      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Envoyer au client pour signature</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Un email professionnel sera envoyé à votre client avec un lien sécurisé pour consulter et signer ce PV en ligne. Aucun compte n'est requis.
            </p>
            <div>
              <Label htmlFor="client-email">Email du client</Label>
              <Input id="client-email" type="email" value={sendEmail} onChange={(e) => setSendEmail(e.target.value)} placeholder="client@exemple.fr" className="mt-1.5" />
            </div>
            {lastSignUrl && (
              <div className="rounded-lg border bg-muted/30 p-3 text-xs">
                <div className="mb-1 font-medium text-foreground">Lien généré (valable 14 jours)</div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate text-muted-foreground">{lastSignUrl}</code>
                  <Button size="icon" variant="ghost" onClick={() => { navigator.clipboard.writeText(lastSignUrl); toast.success("Lien copié"); }}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSendOpen(false)}>Fermer</Button>
            <Button onClick={handleSendToClient} disabled={sendingClient}>
              {sendingClient ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {sendingClient ? "Envoi…" : "Envoyer l'email"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-6 lg:col-span-2 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Informations</h3>
            <div className="flex items-center gap-2">
              <StatusBadge status={pv.status} />
              <Select value={pv.status} onValueChange={changeStatus}>
                <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="brouillon">Brouillon</SelectItem>
                  <SelectItem value="en_attente">En attente</SelectItem>
                  <SelectItem value="signe">Signé</SelectItem>
                  <SelectItem value="archive">Archivé</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 text-sm">
            <Info label="Type">{pv.type}</Info>
            <Info label="Date de réception">{pv.reception_date ? new Date(pv.reception_date).toLocaleDateString("fr-FR") : "—"}</Info>
            <Info label="Chantier">{chantierName ?? "—"}</Info>
            <Info label="Client">{clientName ?? "—"}</Info>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">Description des travaux</p>
            <p className="whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-sm">{pv.description || "—"}</p>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">Observations</p>
            <p className="whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-sm">{pv.observations || "—"}</p>
          </div>
        </Card>

        <Card className="p-6 space-y-4">
          <h3 className="font-semibold">Signatures</h3>
          <SignatureBlock label="Client" data={pv.client_signature} />
          <SignatureBlock label="Entreprise" data={pv.company_signature} />
        </Card>
      </div>

      <Card className="p-6">
        <div className="mb-4 flex items-center gap-2">
          <Camera className="h-4 w-4 text-primary" />
          <h3 className="font-semibold">Photos chantier ({photos.length})</h3>
        </div>
        {photos.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Aucune photo.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {photos.map((p) => (
              <a key={p.id} href={p.signedUrl} target="_blank" rel="noreferrer" className="group block">
                <div className="aspect-square overflow-hidden rounded-lg border border-border bg-muted">
                  {p.signedUrl && <img src={p.signedUrl} alt={p.caption ?? ""} className="h-full w-full object-cover transition-transform group-hover:scale-105" />}
                </div>
                {p.caption && <p className="mt-1 truncate text-xs text-muted-foreground">{p.caption}</p>}
              </a>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-6">
        <div className="mb-4 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-primary" />
          <h3 className="font-semibold">Réserves ({reserves.length})</h3>
        </div>
        {reserves.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Aucune réserve.</p>
        ) : (
          <div className="space-y-2">
            {reserves.map((r) => (
              <div key={r.id} className="flex items-start gap-3 rounded-lg border border-border p-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Badge variant={r.severity === "majeure" ? "destructive" : "secondary"}>{r.severity}</Badge>
                    <StatusBadge status={r.status} />
                  </div>
                  <p className="mt-2 text-sm">{r.description}</p>
                </div>
                <Select value={r.status} onValueChange={(v) => updateReserve(r.id, v)}>
                  <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ouverte">Ouverte</SelectItem>
                    <SelectItem value="levee">Levée</SelectItem>
                    <SelectItem value="validee">Validée</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="icon" variant="ghost" onClick={() => deleteReserve(r.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1">{children}</p>
    </div>
  );
}

function SignatureBlock({ label, data }: { label: string; data: string | null }) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="grid h-24 place-items-center rounded-md border border-dashed border-border bg-muted/30">
        {data ? (
          <img src={data} alt={`Signature ${label}`} className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="text-xs text-muted-foreground">Non signé</span>
        )}
      </div>
    </div>
  );
}
