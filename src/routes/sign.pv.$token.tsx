import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import SignaturePad from "react-signature-canvas";
import { useServerFn } from "@tanstack/react-start";
import { getPvByToken, signPvByToken } from "@/lib/sign.functions";
import { getSignedPvPdfPublic } from "@/lib/pdf.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusPill } from "@/components/ui/status-pill";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { Loader2, CheckCircle2, AlertCircle, Building2, MapPin, Camera, Eraser, ShieldCheck, Clock, Download } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/sign/pv/$token")({
  component: SignPage,
  head: () => ({ meta: [{ title: "Signature électronique — PVIA" }] }),
});

type LoadedData = Awaited<ReturnType<typeof getPvByToken>>;

function SignPage() {
  const { token } = Route.useParams();
  const fetchPv = useServerFn(getPvByToken);
  const signPv = useServerFn(signPvByToken);
  const getPdfUrl = useServerFn(getSignedPvPdfPublic);
  const [state, setState] = useState<{ loading: boolean; data: LoadedData | null }>({ loading: true, data: null });
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ pvId: string; downloadKey: string } | null>(null);
  const padRef = useRef<SignaturePad | null>(null);

  useEffect(() => {
    fetchPv({ data: { token } })
      .then((d) => setState({ loading: false, data: d }))
      .catch(() => setState({ loading: false, data: { valid: false, reason: "invalid" } as any }));
  }, [token, fetchPv]);

  if (state.loading) {
    return <Centered><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></Centered>;
  }
  const data = state.data!;
  if (!data.valid) {
    return <ErrorScreen reason={(data as any).reason} pvNumero={(data as any).pvNumero} />;
  }
  if (done) {
    return <SuccessScreen pvId={done.pvId} downloadKey={done.downloadKey} getPdfUrl={getPdfUrl} />;
  }

  const { pv, company, client, chantier, photos, reserves } = data;

  async function handleSign() {
    if (!padRef.current || padRef.current.isEmpty()) {
      toast.error("Veuillez apposer votre signature.");
      return;
    }
    if (!consent) {
      toast.error("Vous devez confirmer avoir pris connaissance du PV.");
      return;
    }
    const signatureDataUrl = padRef.current.getCanvas().toDataURL("image/png");
    setSubmitting(true);
    try {
      const res = await signPv({ data: { token, signatureDataUrl, consent: true } });
      setDone({ pvId: res.pvId, downloadKey: res.downloadKey });
    } catch (e: any) {
      toast.error(e?.message || "Échec de la signature");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-muted/30 to-background pb-16">
      {/* Header */}
      <header className="border-b border-border/60 bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <BrandLogo tagline />
          <StatusPill tone="success" icon={<ShieldCheck />}>Lien sécurisé</StatusPill>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-5 px-6 pt-8">
        {/* Title */}
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary/80">
            Procès-verbal de {pv.type === "reception" ? "réception" : pv.type}
          </p>
          <h1 className="mt-1.5 font-display text-3xl font-bold tracking-tight sm:text-4xl">PV {pv.numero}</h1>
          {pv.expiresAt && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" /> Lien valable jusqu'au {new Date(pv.expiresAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
            </p>
          )}
        </div>

        {/* Parties */}
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <Building2 className="h-3.5 w-3.5" /> Entreprise
            </div>
            <p className="font-semibold">{company?.name}</p>
            {company?.address && <p className="mt-1 text-sm text-muted-foreground">{company.address}</p>}
            {company?.email && <p className="text-sm text-muted-foreground">{company.email}</p>}
            {company?.phone && <p className="text-sm text-muted-foreground">{company.phone}</p>}
            {company?.siret && <p className="mt-1 text-xs text-muted-foreground">SIRET {company.siret}</p>}
          </Card>
          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <Building2 className="h-3.5 w-3.5" /> Client
            </div>
            <p className="font-semibold">{client?.name ?? "—"}</p>
            {client?.address && <p className="mt-1 text-sm text-muted-foreground">{client.address}</p>}
            {client?.email && <p className="text-sm text-muted-foreground">{client.email}</p>}
          </Card>
        </div>

        {/* Chantier */}
        {chantier && (
          <Card className="p-5">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" /> Chantier
            </div>
            <p className="font-semibold">{chantier.name}</p>
            {chantier.address && <p className="mt-1 text-sm text-muted-foreground">{chantier.address}</p>}
          </Card>
        )}

        {/* Description */}
        <Card className="p-5">
          <h3 className="mb-3 text-sm font-semibold">Description des travaux</h3>
          <p className="whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-sm leading-relaxed">{pv.description || "—"}</p>
          {pv.observations && (
            <>
              <h3 className="mt-4 mb-2 text-sm font-semibold">Observations</h3>
              <p className="whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-sm leading-relaxed">{pv.observations}</p>
            </>
          )}
        </Card>

        {/* Photos */}
        {photos.length > 0 && (
          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Camera className="h-4 w-4 text-primary" /> Photos du chantier ({photos.length})
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {photos.map((p) => (
                <a key={p.id} href={p.signedUrl ?? "#"} target="_blank" rel="noreferrer" className="block">
                  <div className="aspect-square overflow-hidden rounded-lg border bg-muted">
                    {p.signedUrl && <img src={p.signedUrl} alt={p.caption ?? ""} className="h-full w-full object-cover" />}
                  </div>
                </a>
              ))}
            </div>
          </Card>
        )}

        {/* Réserves */}
        {reserves.length > 0 && (
          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <AlertCircle className="h-4 w-4 text-warning" /> Réserves ({reserves.length})
            </div>
            <div className="space-y-2">
              {reserves.map((r: any) => (
                <div key={r.id} className="rounded-lg border border-border/60 p-3">
                  <div className="flex items-center gap-2">
                    <StatusPill tone={r.severity === "majeure" ? "destructive" : "warning"} size="sm" dot>{r.severity}</StatusPill>
                    <StatusPill tone={r.status === "levee" || r.status === "validee" ? "success" : "neutral"} size="sm">{r.status}</StatusPill>
                  </div>
                  <p className="mt-2 text-sm">{r.description}</p>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Signature pad */}
        <Card className="p-5">
          <h3 className="mb-3 text-sm font-semibold">Votre signature</h3>
          <div className="rounded-lg border-2 border-dashed border-border bg-background">
            <SignaturePad
              ref={padRef}
              canvasProps={{ className: "w-full h-48 touch-none rounded-lg" }}
              penColor="currentColor"
            />
          </div>
          <div className="mt-2 flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => padRef.current?.clear()} type="button">
              <Eraser className="h-3.5 w-3.5" /> Effacer
            </Button>
          </div>

          <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-muted/40">
            <Checkbox checked={consent} onCheckedChange={(v) => setConsent(!!v)} className="mt-0.5" />
            <span className="text-sm leading-relaxed">
              Je confirme avoir pris connaissance du procès-verbal, des éventuelles réserves et accepte de signer électroniquement ce document. Cette signature a la même valeur juridique qu'une signature manuscrite.
            </span>
          </label>

          <Button onClick={handleSign} disabled={submitting} size="lg" className="mt-4 w-full">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {submitting ? "Signature en cours…" : "Signer le PV"}
          </Button>
        </Card>

        <p className="pt-4 text-center text-xs text-muted-foreground">
          Signature sécurisée propulsée par <strong>PVIA</strong> · Réception de travaux intelligente
        </p>
      </main>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="grid min-h-screen place-items-center bg-muted/30">{children}</div>;
}

function ErrorScreen({ reason, pvNumero }: { reason?: string; pvNumero?: string }) {
  const map: Record<string, { title: string; body: string; icon: any; color: string }> = {
    expired: { title: "Lien expiré", body: "Ce lien de signature a expiré. Contactez l'entreprise pour en recevoir un nouveau.", icon: Clock, color: "text-warning" },
    signed: { title: `PV ${pvNumero ?? ""} déjà signé`, body: "Ce procès-verbal a déjà été signé électroniquement. Aucune action supplémentaire n'est requise.", icon: CheckCircle2, color: "text-success" },
    invalid: { title: "Lien invalide", body: "Ce lien n'est pas reconnu. Vérifiez l'URL ou contactez l'entreprise.", icon: AlertCircle, color: "text-destructive" },
  };
  const m = map[reason ?? "invalid"] ?? map.invalid;
  const Icon = m.icon;
  return (
    <div className="grid min-h-screen place-items-center bg-muted/30 p-6">
      <Card className="max-w-md p-8 text-center shadow-brand">
        <Icon className={`mx-auto h-12 w-12 ${m.color}`} />
        <h2 className="mt-4 font-display text-xl font-bold">{m.title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{m.body}</p>
      </Card>
    </div>
  );
}

function SuccessScreen({
  pvId,
  downloadKey,
  getPdfUrl,
}: {
  pvId: string;
  downloadKey: string;
  getPdfUrl: (opts: { data: { pvId: string; publicKey: string } }) => Promise<{ url: string }>;
}) {
  const [loading, setLoading] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The PDF is generated server-side just after signing — poll briefly until it's ready.
  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    setLoading(true);
    const tick = async () => {
      attempts++;
      try {
        const res = await getPdfUrl({ data: { pvId, publicKey: downloadKey } });
        if (!cancelled) {
          setPdfUrl(res.url);
          setLoading(false);
        }
      } catch (e: any) {
        if (attempts >= 8) {
          if (!cancelled) {
            setError("Le PDF est en cours de génération. Vous pouvez réessayer dans un instant.");
            setLoading(false);
          }
        } else if (!cancelled) {
          setTimeout(tick, 1500);
        }
      }
    };
    tick();
    return () => { cancelled = true; };
  }, [pvId, downloadKey, getPdfUrl]);

  async function retry() {
    setError(null);
    setLoading(true);
    try {
      const res = await getPdfUrl({ data: { pvId, publicKey: downloadKey } });
      setPdfUrl(res.url);
    } catch (e: any) {
      setError("PDF toujours en préparation. Réessayez dans quelques secondes.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-b from-muted/30 to-background p-6">
      <Card className="max-w-md p-8 text-center shadow-brand">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-success/15">
          <CheckCircle2 className="h-9 w-9 text-success" />
        </div>
        <h2 className="mt-4 font-display text-2xl font-bold tracking-tight">Signature enregistrée</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Merci. Le procès-verbal a été signé avec succès. L'entreprise en est informée.
        </p>

        <div className="mt-6">
          {pdfUrl ? (
            <Button asChild size="lg" className="w-full">
              <a href={pdfUrl} target="_blank" rel="noreferrer">
                <Download className="h-4 w-4" /> Télécharger le PV signé
              </a>
            </Button>
          ) : loading ? (
            <Button disabled size="lg" className="w-full">
              <Loader2 className="h-4 w-4 animate-spin" /> Préparation du PDF…
            </Button>
          ) : (
            <Button onClick={retry} size="lg" variant="outline" className="w-full">
              <Download className="h-4 w-4" /> Réessayer le téléchargement
            </Button>
          )}
          {error && <p className="mt-3 text-xs text-warning">{error}</p>}
        </div>

        <p className="mt-6 text-xs text-muted-foreground">PVIA · Réception de travaux intelligente</p>
      </Card>
    </div>
  );
}
