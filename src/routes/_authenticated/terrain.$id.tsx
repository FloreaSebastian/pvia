import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, MapPin, ChevronRight, ChevronLeft, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { FieldShell } from "@/components/field/FieldShell";
import { FieldStepper } from "@/components/field/FieldStepper";
import { FieldPhotoCapture, type FieldPhoto } from "@/components/field/FieldPhotoCapture";
import { FieldReserveQuickAdd, type FieldReserve } from "@/components/field/FieldReserveQuickAdd";
import { FieldSignaturePad } from "@/components/field/FieldSignaturePad";
import { getFieldDraft, saveFieldDraft, signFieldPv } from "@/lib/field.functions";

export const Route = createFileRoute("/_authenticated/terrain/$id")({
  head: () => ({
    meta: [
      { title: "PV terrain — PVIA" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
    ],
  }),
  component: FieldEditorPage,
});

const STEPS = ["Infos", "Photos", "Réserves", "Signature", "Récap"];

function FieldEditorPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();

  const getFn = useServerFn(getFieldDraft);
  const saveFn = useServerFn(saveFieldDraft);
  const signFn = useServerFn(signFieldPv);

  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(1);
  const [pv, setPv] = useState<any>(null);
  const [photos, setPhotos] = useState<FieldPhoto[]>([]);
  const [reserves, setReserves] = useState<FieldReserve[]>([]);

  const [description, setDescription] = useState("");
  const [observations, setObservations] = useState("");
  const [receptionDate, setReceptionDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);

  const [companySig, setCompanySig] = useState<string | null>(null);
  const [clientSig, setClientSig] = useState<string | null>(null);
  const [clientName, setClientName] = useState("");

  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await getFn({ data: { pvId: id } });
        setPv(res.pv);
        setPhotos(res.photos as any);
        setReserves(res.reserves as any);
        setDescription(res.pv?.description ?? "");
        setObservations(res.pv?.observations ?? "");
        if (res.pv?.reception_date) setReceptionDate(res.pv.reception_date);
        if (res.pv?.latitude != null) setLat(res.pv.latitude);
        if (res.pv?.longitude != null) setLng(res.pv.longitude);
        if (res.pv?.company_signature) setCompanySig(res.pv.company_signature);
        if (res.pv?.client_signature) setClientSig(res.pv.client_signature);
        setSavedAt(res.pv?.field_last_saved_at ?? null);
      } catch (e: any) {
        toast.error(e?.message || "Brouillon introuvable");
        navigate({ to: "/terrain" });
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /* Autosave every 5s if dirty */
  const lastSnapRef = useRef<string>("");
  const doSave = useCallback(async () => {
    const snap = JSON.stringify({ description, observations, receptionDate, lat, lng });
    if (snap === lastSnapRef.current) return;
    try {
      const res = await saveFn({
        data: {
          pvId: id,
          patch: {
            description,
            observations,
            reception_date: receptionDate,
            latitude: lat,
            longitude: lng,
          },
        },
      });
      lastSnapRef.current = snap;
      setSavedAt(res.savedAt);
    } catch {
      /* offline — silent */
    }
  }, [description, observations, receptionDate, lat, lng, id, saveFn]);

  useEffect(() => {
    const t = setInterval(doSave, 5000);
    return () => clearInterval(t);
  }, [doSave]);

  useEffect(() => {
    const onBeforeUnload = () => {
      doSave();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [doSave]);

  function getLocation() {
    if (!("geolocation" in navigator)) {
      toast.error("Géolocalisation indisponible");
      return;
    }
    toast.message("Récupération de la position…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude);
        setLng(pos.coords.longitude);
        toast.success("Position enregistrée");
      },
      () => toast.error("Position refusée ou indisponible"),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  async function finalize() {
    if (!companySig) {
      toast.error("Signature entreprise requise");
      setStep(4);
      return;
    }
    if (!clientSig) {
      toast.error("Signature client requise");
      setStep(4);
      return;
    }
    setSigning(true);
    try {
      await doSave();
      await signFn({
        data: {
          pvId: id,
          companySignature: companySig,
          clientSignature: clientSig,
          clientName: clientName || null,
        },
      });
      toast.success("PV signé ✓");
      navigate({ to: "/pv/$id", params: { id } });
    } catch (e: any) {
      toast.error(e?.message || "Échec de la signature");
    } finally {
      setSigning(false);
    }
  }

  if (loading || !pv) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const canPrev = step > 1;
  const canNext = step < STEPS.length;

  return (
    <FieldShell
      title={pv.numero}
      back="/terrain"
      savedAt={savedAt}
      footer={
        <div className="mx-auto flex max-w-2xl gap-2">
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-12 flex-1"
            disabled={!canPrev}
            onClick={() => setStep((s) => Math.max(1, s - 1))}
          >
            <ChevronLeft className="h-4 w-4" /> Précédent
          </Button>
          {canNext ? (
            <Button type="button" size="lg" className="h-12 flex-1" onClick={() => setStep((s) => Math.min(STEPS.length, s + 1))}>
              Suivant <ChevronRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button type="button" size="lg" className="h-12 flex-1" onClick={finalize} disabled={signing}>
              {signing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Finaliser
            </Button>
          )}
        </div>
      }
    >
      <div className="mx-auto max-w-2xl">
        <FieldStepper step={step} total={STEPS.length} labels={STEPS} />

        {step === 1 ? (
          <Card className="space-y-3 p-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Date de réception</label>
              <Input type="date" value={receptionDate} onChange={(e) => setReceptionDate(e.target.value)} className="mt-1 h-11" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Description</label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Objet du PV, contexte du chantier…"
                rows={4}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Observations</label>
              <Textarea
                value={observations}
                onChange={(e) => setObservations(e.target.value)}
                placeholder="Remarques particulières…"
                rows={3}
                className="mt-1"
              />
            </div>
            <div className="rounded-xl border border-border p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Position GPS</span>
                {lat != null && lng != null ? (
                  <span className="text-[11px] text-success">{lat.toFixed(5)}, {lng.toFixed(5)}</span>
                ) : (
                  <span className="text-[11px] text-muted-foreground">Non renseignée</span>
                )}
              </div>
              <Button type="button" variant="outline" size="sm" className="w-full" onClick={getLocation}>
                <MapPin className="h-4 w-4" /> Ajouter position chantier
              </Button>
            </div>
          </Card>
        ) : null}

        {step === 2 ? <FieldPhotoCapture pvId={id} photos={photos} onAdd={(p) => setPhotos((prev) => [...prev, p])} /> : null}

        {step === 3 ? (
          <FieldReserveQuickAdd pvId={id} reserves={reserves} onAdd={(r) => setReserves((prev) => [...prev, r])} />
        ) : null}

        {step === 4 ? (
          <div className="space-y-3">
            <Card className="p-4">
              <label className="text-xs font-medium text-muted-foreground">Nom du client signataire</label>
              <Input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Ex. Jean Dupont" className="mt-1 h-11" />
            </Card>
            <FieldSignaturePad label="Signature entreprise" value={companySig} onChange={setCompanySig} />
            <FieldSignaturePad label="Signature client" value={clientSig} onChange={setClientSig} />
          </div>
        ) : null}

        {step === 5 ? (
          <Card className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Numéro</span>
              <span className="font-medium">{pv.numero}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Date</span>
              <span className="font-medium">{receptionDate}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Photos</span>
              <span className="font-medium">{photos.length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Réserves</span>
              <span className="font-medium">{reserves.length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Signature entreprise</span>
              <span className="font-medium">{companySig ? "✓" : "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Signature client</span>
              <span className="font-medium">{clientSig ? "✓" : "—"}</span>
            </div>
            <p className="pt-2 text-xs text-muted-foreground">
              En cliquant sur « Finaliser », le PV passe au statut <strong>signé</strong> et le PDF final est généré automatiquement.
            </p>
          </Card>
        ) : null}
      </div>
    </FieldShell>
  );
}
