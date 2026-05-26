import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import SignaturePad from "react-signature-canvas";
import {
  Upload,
  Trash2,
  Plus,
  Loader2,
  Save,
  X,
  ChevronRight,
  ChevronLeft,
  Building2,
  User,
  MapPin,
  ClipboardList,
  Camera,
  AlertTriangle,
  PenLine,
  FileText,
  CheckCircle2,
  Eye,
  Check,
  Cloud,
} from "lucide-react";
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
import { StatusBadge } from "@/components/app/StatusBadge";
import { useCompany } from "@/hooks/use-company";
import { useServerFn } from "@tanstack/react-start";
import { createPv } from "@/lib/pv-create.functions";
import { getCompanyBrandingFn } from "@/lib/branding.functions";
import { fileToBase64 } from "@/lib/file-upload";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { Lock } from "lucide-react";

type Branding = {
  id: string;
  name: string;
  legal_form: string | null;
  siren: string | null;
  siret: string | null;
  address: string | null;
  address_line1: string | null;
  address_line2: string | null;
  postal_code: string | null;
  city: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
  logo_url: string | null;
};

export const Route = createFileRoute("/_authenticated/pv/new")({
  component: NewPv,
  head: () => ({ meta: [{ title: "Créer un PV — PVIA" }] }),
});

type Photo = { file: File; preview: string; caption: string; kind: "avant" | "apres" };
type Reserve = { description: string; severity: "mineure" | "majeure"; status: "ouverte" | "levee" | "validee" };

const TYPES = [
  { value: "reception", label: "Réception de travaux" },
  { value: "reception_reserves", label: "Réception avec réserves" },
  { value: "levee_reserves", label: "Levée de réserves" },
];

const STEPS = [
  { id: 1, label: "Entreprise", icon: Building2 },
  { id: 2, label: "Client", icon: User },
  { id: 3, label: "Chantier", icon: MapPin },
  { id: 4, label: "Travaux", icon: ClipboardList },
  { id: 5, label: "Photos", icon: Camera },
  { id: 6, label: "Réserves", icon: AlertTriangle },
  { id: 7, label: "Signatures", icon: PenLine },
  { id: 8, label: "Aperçu", icon: Eye },
];

const DRAFT_KEY = "pvia:draft:new-pv";

function NewPv() {
  const navigate = useNavigate();
  const { activeCompanyId } = useCompany();
  const createPvFn = useServerFn(createPv);
  const getBrandingFn = useServerFn(getCompanyBrandingFn);
  const [step, setStep] = useState(1);
  const [maxStepReached, setMaxStepReached] = useState(1);
  const [chantiers, setChantiers] = useState<{ id: string; name: string; client_id: string | null; address: string | null }[]>([]);
  const [clients, setClients] = useState<{ id: string; name: string; email: string | null; phone: string | null }[]>([]);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [branding, setBranding] = useState<Branding | null>(null);
  const [brandingLoading, setBrandingLoading] = useState(true);

  const [form, setForm] = useState({
    numero: `PV-${new Date().getFullYear()}-${String(Date.now()).slice(-5)}`,
    type: "reception",
    chantier_id: "",
    client_id: "",
    new_client_name: "",
    new_client_email: "",
    site_address: "",
    reception_date: new Date().toISOString().slice(0, 10),
    description: "",
    observations: "",
    montant: "",
  });
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [reserves, setReserves] = useState<Reserve[]>([]);
  const [newReserve, setNewReserve] = useState<Reserve>({ description: "", severity: "mineure", status: "ouverte" });
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);

  const clientSigRef = useRef<SignaturePad>(null);
  const companySigRef = useRef<SignaturePad>(null);

  // Load chantiers/clients + draft
  useEffect(() => {
    (async () => {
      const [c, cl] = await Promise.all([
        supabase.from("chantiers").select("id,name,client_id,address").order("name"),
        supabase.from("clients").select("id,name,email,phone").order("name"),
      ]);
      setChantiers(c.data ?? []);
      setClients(cl.data ?? []);
    })();

    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.form) setForm((f) => ({ ...f, ...parsed.form }));
        if (parsed.reserves) setReserves(parsed.reserves);
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Autosave (form + reserves only; photos & signatures are not serializable)
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ form, reserves }));
        setLastSaved(new Date());
      } catch {
        /* quota or private mode */
      }
    }, 600);
    return () => clearTimeout(t);
  }, [form, reserves]);

  // Update site address from chantier
  useEffect(() => {
    if (form.chantier_id) {
      const ch = chantiers.find((c) => c.id === form.chantier_id);
      if (ch) {
        setForm((f) => ({
          ...f,
          site_address: ch.address ?? f.site_address,
          client_id: ch.client_id ?? f.client_id,
        }));
      }
    }
  }, [form.chantier_id, chantiers]);

  function onFiles(files: FileList | null, kind: "avant" | "apres") {
    if (!files) return;
    const next = Array.from(files).map((file) => ({
      file,
      preview: URL.createObjectURL(file),
      caption: "",
      kind,
    }));
    setPhotos((p) => [...p, ...next]);
  }

  function addReserve() {
    if (!newReserve.description.trim()) {
      toast.error("Décrivez la réserve avant de l'ajouter.");
      return;
    }
    setReserves((r) => [...r, { ...newReserve }]);
    setNewReserve({ description: "", severity: "mineure", status: "ouverte" });
  }

  function buildPdfDoc(signs: { client: string | null; company: string | null }) {
    const doc = new jsPDF();
    const W = 210;
    let y = 18;

    // Header band
    doc.setFillColor(20, 35, 80);
    doc.rect(0, 0, W, 28, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("PVIA", 14, 14);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text("Réception de travaux intelligente", 14, 20);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text(form.numero, W - 14, 18, { align: "right" });

    doc.setTextColor(20, 20, 20);
    y = 38;

    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.text("PROCÈS-VERBAL DE RÉCEPTION", 105, y, { align: "center" });
    y += 6;
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(110, 110, 110);
    doc.text(TYPES.find((t) => t.value === form.type)?.label ?? "", 105, y, { align: "center" });
    doc.setTextColor(20, 20, 20);
    y += 10;

    // Two-column blocks
    const block = (x: number, title: string, lines: string[]) => {
      doc.setFillColor(245, 247, 252);
      doc.rect(x, y, 88, 6 + lines.length * 5 + 4, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(70, 90, 140);
      doc.text(title.toUpperCase(), x + 3, y + 4.5);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(30, 30, 30);
      lines.forEach((l, i) => doc.text(l || "—", x + 3, y + 11 + i * 5));
    };
    const cli = clients.find((c) => c.id === form.client_id);
    block(14, "Entreprise", [form.company_name, form.company_address, form.company_siret && `SIRET ${form.company_siret}`].filter(Boolean) as string[]);
    block(108, "Client", [cli?.name ?? form.new_client_name, cli?.email ?? form.new_client_email].filter(Boolean) as string[]);
    y += 30;

    const chant = chantiers.find((c) => c.id === form.chantier_id);
    block(14, "Chantier", [chant?.name ?? "—", form.site_address].filter(Boolean) as string[]);
    block(108, "Réception", [`Date : ${form.reception_date}`, form.montant && `Montant : ${form.montant} €`].filter(Boolean) as string[]);
    y += 30;

    // Description
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Description des travaux", 14, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    const desc = doc.splitTextToSize(form.description || "—", 180);
    doc.text(desc, 14, y);
    y += desc.length * 5 + 4;

    // Observations
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Observations", 14, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    const obs = doc.splitTextToSize(form.observations || "—", 180);
    doc.text(obs, 14, y);
    y += obs.length * 5 + 4;

    // Reserves
    if (reserves.length) {
      if (y > 220) { doc.addPage(); y = 20; }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text("Réserves", 14, y);
      y += 6;
      doc.setFontSize(9);
      reserves.forEach((r, i) => {
        doc.setFont("helvetica", "bold");
        doc.text(`${i + 1}. [${r.severity.toUpperCase()} · ${r.status}]`, 14, y);
        doc.setFont("helvetica", "normal");
        const t = doc.splitTextToSize(r.description, 165);
        doc.text(t, 45, y);
        y += Math.max(5, t.length * 5);
      });
      y += 4;
    }

    // Signatures
    if (y > 220) { doc.addPage(); y = 20; }
    y += 6;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Signatures", 14, y);
    y += 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(110, 110, 110);
    doc.text("Client", 14, y);
    doc.text("Entreprise", 110, y);
    doc.setTextColor(20, 20, 20);
    y += 3;
    doc.setDrawColor(220, 220, 230);
    doc.rect(14, y, 80, 30);
    doc.rect(110, y, 80, 30);
    if (signs.client) doc.addImage(signs.client, "PNG", 16, y + 2, 76, 26);
    if (signs.company) doc.addImage(signs.company, "PNG", 112, y + 2, 76, 26);

    return doc;
  }

  async function generatePreview() {
    const doc = buildPdfDoc({ client: null, company: null });
    const url = doc.output("bloburl") as unknown as string;
    setPdfPreviewUrl(url);
  }

  async function onSave(status: "brouillon" | "signe") {
    if (!activeCompanyId) {
      toast.error("Aucune entreprise active.");
      return;
    }
    setSaving(true);
    try {
      // Signatures (data URLs) — required when validating
      const clientSig = status === "signe" && !clientSigRef.current?.isEmpty()
        ? clientSigRef.current!.toDataURL("image/png")
        : null;
      const companySig = status === "signe" && !companySigRef.current?.isEmpty()
        ? companySigRef.current!.toDataURL("image/png")
        : null;
      if (status === "signe" && (!clientSig || !companySig)) {
        toast.error("Les deux signatures sont requises pour valider.");
        setSaving(false);
        return;
      }

      // Encode photos to base64 (server validates mime + size + magic-number)
      const encodedPhotos = await Promise.all(
        photos.map(async (p) => ({
          base64: await fileToBase64(p.file),
          mimeType: p.file.type || "image/jpeg",
          fileName: p.file.name,
          kind: p.kind,
          caption: p.caption || "",
        })),
      );

      const res = await createPvFn({
        data: {
          companyId: activeCompanyId,
          status,
          numero: form.numero,
          type: form.type as any,
          reception_date: form.reception_date,
          chantier_id: form.chantier_id || null,
          client_id: form.client_id || null,
          new_client_name: form.new_client_name,
          new_client_email: form.new_client_email,
          description: form.description,
          observations: form.observations,
          client_signature: clientSig,
          company_signature: companySig,
          reserves: reserves.map((r) => ({
            description: r.description,
            severity: r.severity,
            status: r.status,
          })),
          photos: encodedPhotos,
        },
      });

      localStorage.removeItem(DRAFT_KEY);
      toast.success(
        status === "signe"
          ? "PV signé et archivé avec succès"
          : "Brouillon enregistré",
      );
      navigate({ to: "/pv/$id", params: { id: res.pvId } });
    } catch (e: any) {
      if (e?.code === "PV_QUOTA" || /quota/i.test(e?.message ?? "")) {
        toast.error("Quota PV mensuel atteint ou abonnement requis.", {
          action: {
            label: "Voir les options",
            onClick: () => navigate({ to: "/upgrade-required", search: { reason: "pv_quota" } }),
          },
        });
        navigate({ to: "/upgrade-required", search: { reason: "pv_quota" } });
      } else {
        toast.error(e?.message || "Échec de la création.");
      }
    } finally {
      setSaving(false);
    }
  }

  // Validation per step
  const stepValid = useMemo(() => {
    switch (step) {
      case 1:
        return form.company_name.trim().length > 0;
      case 2:
        return Boolean(form.client_id || form.new_client_name.trim());
      case 3:
        return form.site_address.trim().length > 0 && Boolean(form.reception_date);
      case 4:
        return form.description.trim().length > 0;
      default:
        return true;
    }
  }, [step, form]);

  const progress = (step / STEPS.length) * 100;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Link to="/pv" className="hover:text-foreground">Procès-verbaux</Link>
            <ChevronRight className="h-3 w-3" />
            <span>Nouveau</span>
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Créer un procès-verbal</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Suivez les étapes pour générer un PV professionnel signé électroniquement.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lastSaved && (
            <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex">
              <Cloud className="h-3 w-3 text-success" /> Sauvegardé {lastSaved.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <Button variant="outline" disabled={saving} onClick={() => onSave("brouillon")}>
            <Save className="h-4 w-4" /> Brouillon
          </Button>
        </div>
      </div>

      {/* Progress bar */}
      <Card className="overflow-hidden p-0">
        <div className="border-b border-border bg-gradient-to-b from-muted/40 to-muted/10 p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Étape {step} sur {STEPS.length}
            </span>
            <span className="text-xs font-semibold tabular-nums text-primary">{Math.round(progress)}%</span>
          </div>
          <div className="relative h-1.5 overflow-hidden rounded-full bg-border">
            <motion.div
              className="h-full rounded-full bg-brand-gradient"
              initial={false}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            />
          </div>
          <div className="mt-5 hidden flex-wrap gap-1.5 md:flex">
            {STEPS.map((s) => {
              const Icon = s.icon;
              const done = s.id < step;
              const current = s.id === step;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setStep(s.id)}
                  className={`group inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                    current
                      ? "bg-primary text-primary-foreground shadow-brand"
                      : done
                      ? "bg-success/10 text-success hover:bg-success/15"
                      : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
                  }`}
                >
                  <span
                    className={`grid h-4 w-4 place-items-center rounded-full text-[10px] font-semibold ${
                      current
                        ? "bg-primary-foreground/20"
                        : done
                        ? "bg-success/20"
                        : "bg-background/60"
                    }`}
                  >
                    {done ? <Check className="h-2.5 w-2.5" /> : <Icon className="h-2.5 w-2.5" />}
                  </span>
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Step content */}
        <div className="p-6 sm:p-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.2 }}
              className="space-y-4"
            >
              {step === 1 && (
                <>
                  <SectionHeader icon={Building2} title="Informations entreprise" desc="Vos coordonnées qui apparaîtront sur le PV." />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Numéro de PV"><Input value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} /></Field>
                    <Field label="Type de PV">
                      <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </Field>
                    <Field label="Nom de l'entreprise *"><Input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} placeholder="SARL Toitures du Sud" /></Field>
                    <Field label="SIRET"><Input value={form.company_siret} onChange={(e) => setForm({ ...form, company_siret: e.target.value })} placeholder="123 456 789 00012" /></Field>
                    <div className="sm:col-span-2"><Field label="Adresse de l'entreprise"><Input value={form.company_address} onChange={(e) => setForm({ ...form, company_address: e.target.value })} placeholder="12 rue des Artisans, 06000 Nice" /></Field></div>
                  </div>
                </>
              )}

              {step === 2 && (
                <>
                  <SectionHeader icon={User} title="Informations client" desc="Sélectionnez un client existant ou créez-en un nouveau." />
                  <Field label="Client existant">
                    <Select value={form.client_id || "none"} onValueChange={(v) => setForm({ ...form, client_id: v === "none" ? "" : v })}>
                      <SelectTrigger><SelectValue placeholder="Choisir un client…" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— Nouveau client —</SelectItem>
                        {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Field>
                  {!form.client_id && (
                    <div className="grid gap-4 rounded-xl border border-dashed border-border bg-muted/20 p-4 sm:grid-cols-2">
                      <Field label="Nom du client *"><Input value={form.new_client_name} onChange={(e) => setForm({ ...form, new_client_name: e.target.value })} placeholder="M. et Mme Mercier" /></Field>
                      <Field label="Email"><Input type="email" value={form.new_client_email} onChange={(e) => setForm({ ...form, new_client_email: e.target.value })} placeholder="client@email.com" /></Field>
                    </div>
                  )}
                </>
              )}

              {step === 3 && (
                <>
                  <SectionHeader icon={MapPin} title="Adresse du chantier" desc="Le lieu où la réception est effectuée." />
                  <Field label="Chantier (optionnel)">
                    <Select value={form.chantier_id || "none"} onValueChange={(v) => setForm({ ...form, chantier_id: v === "none" ? "" : v })}>
                      <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— Aucun chantier lié —</SelectItem>
                        {chantiers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Adresse complète du chantier *"><Input value={form.site_address} onChange={(e) => setForm({ ...form, site_address: e.target.value })} placeholder="12 chemin des Pins, 06400 Cannes" /></Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Date de réception *"><Input type="date" value={form.reception_date} onChange={(e) => setForm({ ...form, reception_date: e.target.value })} /></Field>
                    <Field label="Montant des travaux (€)"><Input type="number" inputMode="decimal" value={form.montant} onChange={(e) => setForm({ ...form, montant: e.target.value })} placeholder="18450" /></Field>
                  </div>
                </>
              )}

              {step === 4 && (
                <>
                  <SectionHeader icon={ClipboardList} title="Description des travaux" desc="Détaillez les prestations réalisées et vos observations." />
                  <Field label="Description détaillée *"><Textarea rows={6} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Dépose de l'ancienne couverture, pose membrane EPDM + isolation 200mm, pose couverture tuiles canal..." /></Field>
                  <Field label="Observations complémentaires"><Textarea rows={4} value={form.observations} onChange={(e) => setForm({ ...form, observations: e.target.value })} placeholder="Conditions météo, accès chantier, recommandations d'entretien..." /></Field>
                </>
              )}

              {step === 5 && (
                <>
                  <SectionHeader icon={Camera} title="Photos avant / après" desc="Documentez visuellement le chantier." />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <PhotoUploader label="Photos AVANT" kind="avant" onFiles={onFiles} />
                    <PhotoUploader label="Photos APRÈS" kind="apres" onFiles={onFiles} />
                  </div>
                  {photos.length > 0 && (
                    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
                      {photos.map((p, i) => (
                        <div key={i} className="group relative overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                          <div className="relative">
                            <img src={p.preview} alt="" className="aspect-square w-full object-cover" />
                            <span className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider shadow ${p.kind === "avant" ? "bg-warning text-warning-foreground" : "bg-success text-success-foreground"}`}>
                              {p.kind}
                            </span>
                            <button
                              type="button"
                              onClick={() => setPhotos(photos.filter((_, j) => j !== i))}
                              className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-md bg-background/90 opacity-0 transition-opacity group-hover:opacity-100"
                              aria-label="Supprimer"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          <Input
                            placeholder="Légende…"
                            className="rounded-none border-0 border-t text-xs"
                            value={p.caption}
                            onChange={(e) => {
                              const c = [...photos];
                              c[i].caption = e.target.value;
                              setPhotos(c);
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {step === 6 && (
                <>
                  <SectionHeader icon={AlertTriangle} title="Réserves de chantier" desc="Listez les points à corriger avec leur statut." />
                  <div className="rounded-xl border border-border bg-muted/20 p-4">
                    <div className="grid gap-2 sm:grid-cols-[1fr_140px_140px_auto]">
                      <Input placeholder="Décrire la réserve…" value={newReserve.description} onChange={(e) => setNewReserve({ ...newReserve, description: e.target.value })} />
                      <Select value={newReserve.severity} onValueChange={(v) => setNewReserve({ ...newReserve, severity: v as Reserve["severity"] })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="mineure">Mineure</SelectItem>
                          <SelectItem value="majeure">Majeure</SelectItem>
                        </SelectContent>
                      </Select>
                      <Select value={newReserve.status} onValueChange={(v) => setNewReserve({ ...newReserve, status: v as Reserve["status"] })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ouverte">Ouverte</SelectItem>
                          <SelectItem value="levee">Levée</SelectItem>
                          <SelectItem value="validee">Validée</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button type="button" onClick={addReserve}><Plus className="h-4 w-4" /> Ajouter</Button>
                    </div>
                  </div>
                  {reserves.length > 0 ? (
                    <ul className="space-y-2">
                      {reserves.map((r, i) => (
                        <li key={i} className="flex items-center justify-between rounded-lg border border-border bg-card p-3 text-sm shadow-sm">
                          <div className="flex flex-1 items-center gap-3">
                            <span className="grid h-7 w-7 place-items-center rounded-md bg-muted text-xs font-semibold">{i + 1}</span>
                            <div className="flex-1">
                              <p className="font-medium">{r.description}</p>
                              <div className="mt-1 flex gap-2">
                                <Badge variant={r.severity === "majeure" ? "destructive" : "secondary"}>{r.severity}</Badge>
                                <StatusBadge status={r.status} />
                              </div>
                            </div>
                          </div>
                          <Button size="icon" variant="ghost" onClick={() => setReserves(reserves.filter((_, j) => j !== i))}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
                      Aucune réserve. Le PV sera marqué « sans réserve ».
                    </p>
                  )}
                </>
              )}

              {step === 7 && (
                <>
                  <SectionHeader icon={PenLine} title="Signatures électroniques" desc="Signez avec le doigt ou la souris pour valider le PV." />
                  <div className="grid gap-5 lg:grid-cols-2">
                    <SignatureBox label="Signature du client" innerRef={clientSigRef} />
                    <SignatureBox label="Signature entreprise" innerRef={companySigRef} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Les signatures sont horodatées et stockées de manière sécurisée avec valeur probante.
                  </p>
                </>
              )}

              {step === 8 && (
                <>
                  <SectionHeader icon={Eye} title="Aperçu du document" desc="Vérifiez le PDF avant validation finale." />
                  <div className="rounded-xl border border-border bg-muted/20 p-4">
                    <Button type="button" variant="outline" onClick={generatePreview}>
                      <FileText className="h-4 w-4" /> Générer l'aperçu PDF
                    </Button>
                    {pdfPreviewUrl && (
                      <div className="mt-4 overflow-hidden rounded-lg border border-border bg-background">
                        <iframe src={pdfPreviewUrl} title="Aperçu PV" className="h-[600px] w-full" />
                      </div>
                    )}
                  </div>
                  <div className="rounded-xl border border-success/30 bg-success/10 p-4 text-sm text-success">
                    <p className="flex items-center gap-2 font-semibold"><CheckCircle2 className="h-4 w-4" /> Prêt à valider</p>
                    <p className="mt-1 text-success/80">
                      En cliquant sur « Valider & signer », le PV sera enregistré avec ses signatures, photos et réserves, puis archivé au format PDF.
                    </p>
                  </div>
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Footer navigation */}
        <div className="flex items-center justify-between border-t border-border bg-muted/20 p-4">
          <Button variant="ghost" disabled={step === 1} onClick={() => setStep((s) => s - 1)}>
            <ChevronLeft className="h-4 w-4" /> Précédent
          </Button>
          <div className="text-xs text-muted-foreground">
            {STEPS[step - 1].label}
          </div>
          {step < STEPS.length ? (
            <Button
              disabled={!stepValid}
              onClick={() => setStep((s) => Math.min(STEPS.length, s + 1))}
            >
              Suivant <ChevronRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button disabled={saving} onClick={() => onSave("signe")} className="shadow-brand">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Valider & signer
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}

function SectionHeader({ icon: Icon, title, desc }: { icon: typeof Building2; title: string; desc: string }) {
  return (
    <div className="mb-2 flex items-start gap-3 border-b border-border pb-4">
      <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <h3 className="font-semibold tracking-tight">{title}</h3>
        <p className="text-sm text-muted-foreground">{desc}</p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">{label}</Label>
      {children}
    </div>
  );
}

function PhotoUploader({ label, kind, onFiles }: { label: string; kind: "avant" | "apres"; onFiles: (f: FileList | null, k: "avant" | "apres") => void }) {
  const tone = kind === "avant"
    ? "border-warning/40 bg-warning/5 hover:border-warning"
    : "border-success/40 bg-success/5 hover:border-success";
  return (
    <label className={`group flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-sm transition-all hover:bg-primary/5 ${tone}`}>
      <div className="grid h-10 w-10 place-items-center rounded-full bg-background/70 text-muted-foreground transition group-hover:scale-110 group-hover:text-primary">
        <Upload className="h-5 w-5" />
      </div>
      <span className="font-medium">{label}</span>
      <span className="text-xs text-muted-foreground">JPG, PNG · Sélection multiple</span>
      <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => onFiles(e.target.files, kind)} />
    </label>
  );
}

function SignatureBox({ label, innerRef }: { label: string; innerRef: React.RefObject<SignaturePad | null> }) {
  return (
    <div>
      <Label className="text-xs font-medium">{label}</Label>
      <div className="mt-1 overflow-hidden rounded-xl border border-border bg-gradient-to-br from-muted/40 to-background">
        <SignaturePad ref={innerRef} canvasProps={{ className: "w-full h-44" }} penColor="rgb(20, 35, 80)" />
      </div>
      <Button variant="ghost" size="sm" onClick={() => innerRef.current?.clear()} className="mt-1">
        <Trash2 className="h-3.5 w-3.5" /> Effacer
      </Button>
    </div>
  );
}
