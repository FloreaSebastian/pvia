import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import SignaturePad from "react-signature-canvas";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Loader2, ArrowLeft, ChevronRight, Save, Send } from "lucide-react";
import { toast } from "sonner";
import { createReserveLift } from "@/lib/reserve-lift.functions";
import { fileToBase64 } from "@/lib/file-upload";

export const Route = createFileRoute("/_authenticated/pv/$id/levee-reserves")({
  component: LeveeReserves,
  head: () => ({ meta: [{ title: "Levée de réserves — PVIA" }] }),
});

type Reserve = { id: string; description: string; severity: string; status: string };

function LeveeReserves() {
  const { id: pvId } = Route.useParams();
  const navigate = useNavigate();
  const createFn = useServerFn(createReserveLift);

  const [pvNumero, setPvNumero] = useState<string>("");
  const [reserves, setReserves] = useState<Reserve[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [itemComment, setItemComment] = useState<Record<string, string>>({});
  const [itemPhotos, setItemPhotos] = useState<Record<string, File[]>>({});
  const [globalComment, setGlobalComment] = useState("");
  const [requireClient, setRequireClient] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const companySigRef = useRef<SignaturePad>(null);
  const clientSigRef = useRef<SignaturePad>(null);

  useEffect(() => {
    (async () => {
      const [pvRes, resRes] = await Promise.all([
        supabase.from("pv").select("numero").eq("id", pvId).maybeSingle(),
        supabase.from("pv_reserves").select("id,description,severity,status").eq("pv_id", pvId).eq("status", "ouverte").order("created_at"),
      ]);
      setPvNumero(pvRes.data?.numero ?? "");
      setReserves((resRes.data ?? []) as Reserve[]);
      setLoading(false);
    })();
  }, [pvId]);

  async function onSubmit(status: "brouillon" | "signe") {
    const ids = Object.keys(selected).filter((id) => selected[id]);
    if (ids.length === 0) return toast.error("Sélectionnez au moins une réserve.");
    if (status === "signe" && companySigRef.current?.isEmpty()) return toast.error("Signature entreprise obligatoire.");
    if (status === "signe" && requireClient && clientSigRef.current?.isEmpty()) return toast.error("Signature client obligatoire.");

    setSaving(true);
    try {
      const items = await Promise.all(
        ids.map(async (rid) => {
          const photos = await Promise.all(
            (itemPhotos[rid] ?? []).map(async (f) => ({
              base64: await fileToBase64(f),
              mimeType: f.type || "image/jpeg",
              fileName: f.name,
            })),
          );
          return { reserveId: rid, comment: itemComment[rid] || "", photos };
        }),
      );
      const res = await createFn({
        data: {
          pvId,
          status,
          comment: globalComment,
          requireClientSignature: requireClient,
          items,
          companySignature: status === "signe" && !companySigRef.current?.isEmpty()
            ? companySigRef.current!.toDataURL("image/png") : null,
          clientSignature: status === "signe" && !clientSigRef.current?.isEmpty()
            ? clientSigRef.current!.toDataURL("image/png") : null,
        },
      });
      toast.success(`Levée ${res.numero} ${status === "signe" ? "signée" : "enregistrée"}.`);
      navigate({ to: "/pv/$id", params: { id: pvId } });
    } catch (e: any) {
      toast.error(e?.message || "Échec de la création.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="grid h-64 place-items-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Link to="/pv" className="hover:text-foreground">PV</Link>
          <ChevronRight className="h-3 w-3" />
          <Link to="/pv/$id" params={{ id: pvId }} className="hover:text-foreground">{pvNumero}</Link>
          <ChevronRight className="h-3 w-3" />
          <span>Levée de réserves</span>
        </div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Créer une levée de réserves</h1>
        <p className="mt-1 text-sm text-muted-foreground">PV {pvNumero} — {reserves.length} réserve(s) ouverte(s)</p>
      </div>

      <Card className="space-y-4 p-6">
        <h2 className="font-semibold">Réserves à lever</h2>
        {reserves.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Aucune réserve ouverte.</p>
        ) : (
          <div className="space-y-3">
            {reserves.map((r) => (
              <div key={r.id} className="space-y-2 rounded-lg border border-border p-3">
                <div className="flex items-start gap-3">
                  <Checkbox checked={!!selected[r.id]} onCheckedChange={(v) => setSelected((s) => ({ ...s, [r.id]: !!v }))} className="mt-1" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{r.description}</p>
                    <p className="text-xs text-muted-foreground">Sévérité : {r.severity}</p>
                  </div>
                </div>
                {selected[r.id] && (
                  <div className="ml-7 space-y-2">
                    <Textarea
                      placeholder="Commentaire de levée (optionnel)…"
                      rows={2}
                      value={itemComment[r.id] ?? ""}
                      onChange={(e) => setItemComment((c) => ({ ...c, [r.id]: e.target.value }))}
                    />
                    <input
                      type="file"
                      multiple
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(e) => setItemPhotos((p) => ({ ...p, [r.id]: Array.from(e.target.files ?? []) }))}
                      className="block w-full text-xs"
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="space-y-3 p-6">
        <Label>Commentaire général</Label>
        <Textarea rows={3} value={globalComment} onChange={(e) => setGlobalComment(e.target.value)} placeholder="Conditions d'intervention, observations…" />
      </Card>

      <Card className="space-y-4 p-6">
        <div className="flex items-center gap-3">
          <Switch checked={requireClient} onCheckedChange={setRequireClient} />
          <Label className="!mt-0">Exiger la signature client</Label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label className="mb-2 block">Signature entreprise *</Label>
            <div className="rounded-lg border border-border bg-background">
              <SignaturePad ref={companySigRef} canvasProps={{ className: "w-full h-32" }} />
            </div>
            <Button variant="ghost" size="sm" onClick={() => companySigRef.current?.clear()}>Effacer</Button>
          </div>
          <div>
            <Label className="mb-2 block">Signature client {requireClient ? "*" : "(optionnelle)"}</Label>
            <div className="rounded-lg border border-border bg-background">
              <SignaturePad ref={clientSigRef} canvasProps={{ className: "w-full h-32" }} />
            </div>
            <Button variant="ghost" size="sm" onClick={() => clientSigRef.current?.clear()}>Effacer</Button>
          </div>
        </div>
      </Card>

      <div className="flex flex-wrap justify-end gap-2">
        <Link to="/pv/$id" params={{ id: pvId }}><Button variant="ghost"><ArrowLeft className="h-4 w-4" /> Annuler</Button></Link>
        <Button variant="outline" disabled={saving} onClick={() => onSubmit("brouillon")}>
          <Save className="h-4 w-4" /> Enregistrer brouillon
        </Button>
        <Button disabled={saving} onClick={() => onSubmit("signe")}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Signer et générer le PDF
        </Button>
      </div>
    </div>
  );
}
