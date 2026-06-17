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
  validateSearch: (s: Record<string, unknown>) => ({
    reserveId: typeof s.reserveId === "string" ? s.reserveId : undefined,
  }),
  head: () => ({ meta: [{ title: "Levée de réserves — PVIA" }] }),
});

type Reserve = { id: string; description: string; severity: string; status: string };

function LeveeReserves() {
  const { id: pvId } = Route.useParams();
  const search = Route.useSearch();
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
        supabase.from("pv_reserves").select("id,description,severity,status").eq("pv_id", pvId).in("status", ["ouverte", "levee"]).order("created_at"),
      ]);
      setPvNumero(pvRes.data?.numero ?? "");
      const rs = (resRes.data ?? []) as Reserve[];
      setReserves(rs);
      // Pre-select reserve from query param
      if (search.reserveId && rs.some((r) => r.id === search.reserveId)) {
        setSelected({ [search.reserveId]: true });
      }
      setLoading(false);
    })();
  }, [pvId, search.reserveId]);

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
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Link to="/pv" className="hover:text-foreground">PV</Link>
          <ChevronRight className="h-3 w-3" />
          <Link to="/pv/$id" params={{ id: pvId }} className="hover:text-foreground">{pvNumero}</Link>
          <ChevronRight className="h-3 w-3" />
          <span>Levée de réserves</span>
        </div>
        <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">Créer une levée de réserves</h1>
        {reserves.length > 0 && (
          <p className="mt-0.5 text-xs text-muted-foreground">PV {pvNumero} · {reserves.length} réserve(s) ouverte(s)</p>
        )}
      </div>

      {reserves.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-8 text-center text-sm text-muted-foreground">
          Aucune réserve ouverte à lever sur ce PV.
          <Link to="/pv/$id" params={{ id: pvId }}><Button variant="outline" size="sm"><ArrowLeft className="h-4 w-4" /> Retour au PV</Button></Link>
        </Card>
      ) : (
        <Card className="space-y-2 p-4">
          <h2 className="text-sm font-semibold">Réserves à lever</h2>
          <div className="space-y-2">
            {reserves.map((r) => (
              <div key={r.id} className="space-y-2 rounded-md border border-border p-2.5">
                <div className="flex items-start gap-2.5">
                  <Checkbox checked={!!selected[r.id]} onCheckedChange={(v) => setSelected((s) => ({ ...s, [r.id]: !!v }))} className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug">{r.description}</p>
                    <p className="mt-0.5 text-[11px] uppercase tracking-wider text-muted-foreground">Sévérité : {r.severity}</p>
                  </div>
                </div>
                {selected[r.id] && (
                  <div className="ml-6 space-y-2">
                    <Textarea
                      placeholder="Intervention réalisée (optionnel)…"
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
        </Card>
      )}

      {reserves.length > 0 && (
        <>
          <Card className="space-y-2 p-4">
            <Label className="text-xs">Commentaire général (optionnel)</Label>
            <Textarea rows={2} value={globalComment} onChange={(e) => setGlobalComment(e.target.value)} placeholder="Conditions d'intervention, observations…" />
          </Card>

          <Card className="space-y-3 p-4">
            <div className="flex items-center gap-2">
              <Switch checked={requireClient} onCheckedChange={setRequireClient} />
              <Label className="!mt-0 text-sm">Exiger la signature client</Label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label className="mb-1.5 block text-xs">Signature entreprise *</Label>
                <div className="rounded-md border border-border bg-background">
                  <SignaturePad ref={companySigRef} canvasProps={{ className: "w-full h-28" }} />
                </div>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => companySigRef.current?.clear()}>Effacer</Button>
              </div>
              {requireClient && (
                <div>
                  <Label className="mb-1.5 block text-xs">Signature client *</Label>
                  <div className="rounded-md border border-border bg-background">
                    <SignaturePad ref={clientSigRef} canvasProps={{ className: "w-full h-28" }} />
                  </div>
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => clientSigRef.current?.clear()}>Effacer</Button>
                </div>
              )}
            </div>
          </Card>

          <div className="sticky bottom-0 -mx-4 flex flex-wrap justify-end gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
            <Link to="/pv/$id" params={{ id: pvId }} className="hidden sm:inline-block"><Button variant="ghost"><ArrowLeft className="h-4 w-4" /> Annuler</Button></Link>
            <Button variant="outline" disabled={saving} onClick={() => onSubmit("brouillon")}>
              <Save className="h-4 w-4" /> Brouillon
            </Button>
            <Button disabled={saving} onClick={() => onSubmit("signe")}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Signer et générer le PDF
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
