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
  ShieldCheck,
  CalendarDays,
  Lock,
  Send,
  Mail,
  MonitorSmartphone,
  Smartphone,
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
import { useCompany } from "@/hooks/use-company";
import { useServerFn } from "@tanstack/react-start";
import { createPv } from "@/lib/pv-create.functions";
import { extractWorkReferenceDoc } from "@/lib/work-reference.functions";
import { getCompanyBrandingFn } from "@/lib/branding.functions";
import { getPvNumberingSettings } from "@/lib/pv-numbering.functions";
import { sendOnsiteClientOtp, verifyOnsiteClientOtp } from "@/lib/sign-onsite.functions";
import { fileToBase64 } from "@/lib/file-upload";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { AddressAutocomplete, type AddressValue } from "@/components/pv/AddressAutocomplete";

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

type Photo = { file: File; preview: string; caption: string; kind: "avant" | "apres" | "autre" };
type Severity = "mineure" | "majeure" | "bloquante";
type Reserve = {
  nature: string;
  description: string;
  work_to_execute: string;
  severity: Severity;
  due_date: string;
};

type WorkRefType = "devis" | "bon_commande" | "marche" | "manuel";

const ID_ENTREPRISE = "entreprise";
const ID_CLIENT = "client";
const ID_CHANTIER = "chantier";
const ID_TRAVAUX = "travaux";
const ID_DECISION = "decision";
const ID_RESERVES = "reserves";
const ID_PHOTOS = "photos";
const ID_SIGNATURES = "signatures";
const ID_APERCU = "apercu";

type StepDef = { id: string; label: string; icon: typeof Building2 };

const STEPS_BASE: StepDef[] = [
  { id: ID_ENTREPRISE, label: "Entreprise", icon: Building2 },
  { id: ID_CLIENT, label: "Client", icon: User },
  { id: ID_CHANTIER, label: "Chantier", icon: MapPin },
  { id: ID_TRAVAUX, label: "Travaux", icon: ClipboardList },
  { id: ID_DECISION, label: "Décision", icon: ShieldCheck },
];
const STEPS_TAIL_NO_RES: StepDef[] = [
  { id: ID_SIGNATURES, label: "Signatures", icon: PenLine },
  { id: ID_APERCU, label: "Aperçu", icon: Eye },
];
const STEPS_TAIL_WITH_RES: StepDef[] = [
  { id: ID_RESERVES, label: "Réserves", icon: AlertTriangle },
  { id: ID_PHOTOS, label: "Photos", icon: Camera },
  { id: ID_SIGNATURES, label: "Signatures", icon: PenLine },
  { id: ID_APERCU, label: "Aperçu", icon: Eye },
];

const DRAFT_KEY = "pvia:draft:new-pv:v2";

function NewPv() {
  const navigate = useNavigate();
  const { activeCompanyId } = useCompany();
  const createPvFn = useServerFn(createPv);
  const getBrandingFn = useServerFn(getCompanyBrandingFn);
  const getNumberingFn = useServerFn(getPvNumberingSettings);
  const sendOtpFn = useServerFn(sendOnsiteClientOtp);
  const verifyOtpFn = useServerFn(verifyOnsiteClientOtp);
  const extractWorkRefFn = useServerFn(extractWorkReferenceDoc);

  // Clef stable côté brouillon pour rattacher les documents importés avant création du PV.
  const [draftKey] = useState(() => `draft-${crypto.randomUUID()}`);

  const [stepIdx, setStepIdx] = useState(0);
  const [maxStepIdx, setMaxStepIdx] = useState(0);
  const [chantiers, setChantiers] = useState<{ id: string; name: string; client_id: string | null; address: string | null; postal_code: string | null; city: string | null }[]>([]);
  const [clients, setClients] = useState<{ id: string; name: string; email: string | null; phone: string | null }[]>([]);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [branding, setBranding] = useState<Branding | null>(null);
  const [brandingLoading, setBrandingLoading] = useState(true);
  const [numeroPreview, setNumeroPreview] = useState<string | null>(null);

  // Décision (null = pas encore choisi)
  const [withReserves, setWithReserves] = useState<boolean | null>(null);

  const [form, setForm] = useState({
    chantier_id: "",
    client_id: "",
    new_client_name: "",
    new_client_email: "",
    // chantier
    chantier_address: "",
    chantier_postal_code: "",
    chantier_city: "",
    latitude: null as number | null,
    longitude: null as number | null,
    // dates
    reception_date: new Date().toISOString().slice(0, 10),
    // travaux
    work_reference_type: "manuel" as WorkRefType,
    work_reference_number: "",
    work_reference_date: "",
    work_reference_amount: "",
    description: "",
    observations: "",
    // levée
    reserve_completion_delay: "",
    reserve_due_date: "",
  });
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [reserves, setReserves] = useState<Reserve[]>([]);
  const [newReserve, setNewReserve] = useState<Reserve>({
    nature: "",
    description: "",
    work_to_execute: "",
    severity: "mineure",
    due_date: "",
  });

  const clientSigRef = useRef<SignaturePad>(null);
  const companySigRef = useRef<SignaturePad>(null);
  const [clientSignatureDataUrl, setClientSignatureDataUrl] = useState<string | null>(null);
  const [companySignatureDataUrl, setCompanySignatureDataUrl] = useState<string | null>(null);

  // Signature mode + OTP
  const [signatureMode, setSignatureMode] = useState<"remote" | "onsite" | null>(null);
  const [onsiteOtpEmail, setOnsiteOtpEmail] = useState("");
  const [onsiteOtpCode, setOnsiteOtpCode] = useState("");
  const [onsiteOtpId, setOnsiteOtpId] = useState<string | null>(null);
  const [onsiteOtpSent, setOnsiteOtpSent] = useState(false);
  const [onsiteOtpVerified, setOnsiteOtpVerified] = useState(false);
  const [onsiteOtpLoading, setOnsiteOtpLoading] = useState(false);
  const [onsiteOtpCooldown, setOnsiteOtpCooldown] = useState(0);
  const [onsiteOtpError, setOnsiteOtpError] = useState<string | null>(null);
  const [onsiteOtpShowHelp, setOnsiteOtpShowHelp] = useState(false);

  useEffect(() => {
    if (onsiteOtpCooldown <= 0) return;
    const t = setTimeout(() => setOnsiteOtpCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [onsiteOtpCooldown]);

  // Stepper dynamique
  const STEPS = useMemo<StepDef[]>(() => {
    if (withReserves === true) return [...STEPS_BASE, ...STEPS_TAIL_WITH_RES];
    if (withReserves === false) return [...STEPS_BASE, ...STEPS_TAIL_NO_RES];
    // Pas encore choisi → stepper minimal jusqu'à Décision
    return [...STEPS_BASE, { id: ID_SIGNATURES, label: "Signatures", icon: PenLine }, { id: ID_APERCU, label: "Aperçu", icon: Eye }];
  }, [withReserves]);

  const currentStep = STEPS[stepIdx] ?? STEPS[0];

  // Load chantiers/clients + draft
  useEffect(() => {
    (async () => {
      const [c, cl] = await Promise.all([
        supabase.from("chantiers").select("id,name,client_id,address,postal_code,city").order("name"),
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
        if (typeof parsed.withReserves === "boolean") setWithReserves(parsed.withReserves);
      }
    } catch { /* ignore */ }
  }, []);

  // Branding
  useEffect(() => {
    if (!activeCompanyId) { setBrandingLoading(false); return; }
    setBrandingLoading(true);
    getBrandingFn({ data: { companyId: activeCompanyId } })
      .then((b) => setBranding((b as Branding) ?? null))
      .catch(() => setBranding(null))
      .finally(() => setBrandingLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCompanyId]);

  // Numéro PV (aperçu)
  useEffect(() => {
    if (!activeCompanyId) return;
    getNumberingFn({ data: { companyId: activeCompanyId } })
      .then((s: any) => {
        const prefix = s.pv_number_prefix ?? "PV";
        const sep = s.pv_number_separator ?? "-";
        const year = s.pv_number_include_year ? `${new Date().getFullYear()}${sep}` : "";
        const num = String(s.pv_number_next ?? 1).padStart(s.pv_number_digits ?? 5, "0");
        setNumeroPreview(`${prefix}${sep}${year}${num}`);
      })
      .catch(() => setNumeroPreview(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCompanyId]);

  const brandingComplete = useMemo(() => {
    if (!branding) return false;
    const hasAddress = !!(branding.address_line1 || branding.address);
    const hasIdent = !!(branding.siret || branding.siren);
    const hasContact = !!(branding.email || branding.phone);
    return !!branding.name && hasIdent && hasAddress && hasContact;
  }, [branding]);

  // Autosave
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ form, reserves, withReserves }));
        setLastSaved(new Date());
      } catch { /* noop */ }
    }, 600);
    return () => clearTimeout(t);
  }, [form, reserves, withReserves]);

  // Prefill chantier when selected
  useEffect(() => {
    if (form.chantier_id) {
      const ch = chantiers.find((c) => c.id === form.chantier_id);
      if (ch) {
        setForm((f) => ({
          ...f,
          chantier_address: ch.address ?? f.chantier_address,
          chantier_postal_code: ch.postal_code ?? f.chantier_postal_code,
          chantier_city: ch.city ?? f.chantier_city,
          client_id: ch.client_id ?? f.client_id,
        }));
      }
    }
  }, [form.chantier_id, chantiers]);

  // Reset OTP and prefill onsite email when client changes
  useEffect(() => {
    const cl = clients.find((c) => c.id === form.client_id);
    const email = cl?.email || form.new_client_email || "";
    setOnsiteOtpEmail(email);
    setOnsiteOtpId(null);
    setOnsiteOtpSent(false);
    setOnsiteOtpVerified(false);
    setOnsiteOtpCode("");
  }, [form.client_id, form.new_client_email, clients]);

  function onFiles(files: FileList | null, kind: "avant" | "apres" | "autre") {
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
    if (!newReserve.description.trim() && !newReserve.nature.trim()) {
      toast.error("Indiquez au moins la nature ou la description de la réserve.");
      return;
    }
    setReserves((r) => [...r, { ...newReserve }]);
    setNewReserve({ nature: "", description: "", work_to_execute: "", severity: "mineure", due_date: "" });
  }

  function pickDecision(value: boolean) {
    // Si on bascule de "avec réserves" vers "sans réserve" et qu'il y a déjà des données → confirmation
    if (withReserves === true && value === false && (reserves.length > 0 || photos.length > 0)) {
      if (!confirm("Passer en réception sans réserve va supprimer les réserves et photos déjà saisies. Confirmer ?")) return;
      setReserves([]);
      setPhotos([]);
    }
    setWithReserves(value);
  }

  function readSignature(ref: typeof companySigRef, emptyMessage: string): string | null {
    const pad = ref.current;
    if (!pad) {
      toast.error(emptyMessage);
      return null;
    }
    try {
      if (pad.isEmpty()) {
        toast.error(emptyMessage);
        return null;
      }
      return pad.getTrimmedCanvas().toDataURL("image/png");
    } catch {
      toast.error("Impossible d'enregistrer la signature. Réessayez.");
      return null;
    }
  }

  function syncSignature(ref: typeof companySigRef, onSync: (dataUrl: string | null) => void) {
    const pad = ref.current;
    if (!pad) return;
    try {
      onSync(pad.isEmpty() ? null : pad.getTrimmedCanvas().toDataURL("image/png"));
    } catch {
      onSync(null);
    }
  }

  function saveCompanySignature() {
    const dataUrl = readSignature(companySigRef, "Signez dans le cadre entreprise avant de valider la signature.");
    if (!dataUrl) return;
    setCompanySignatureDataUrl(dataUrl);
    toast.success("Signature entreprise enregistrée.");
  }

  function clearCompanySignature() {
    companySigRef.current?.clear();
    setCompanySignatureDataUrl(null);
    toast.message("Signature entreprise effacée.");
  }

  function saveClientSignature() {
    const dataUrl = readSignature(clientSigRef, "Signez dans le cadre client avant de valider la signature.");
    if (!dataUrl) return;
    setClientSignatureDataUrl(dataUrl);
    toast.success("Signature client enregistrée.");
  }

  function clearClientSignature() {
    clientSigRef.current?.clear();
    setClientSignatureDataUrl(null);
    toast.message("Signature client effacée.");
  }

  async function handleSendOtp() {
    if (!activeCompanyId) return toast.error("Aucune entreprise active.");
    if (!onsiteOtpEmail.trim()) return toast.error("Email client requis.");
    if (onsiteOtpCooldown > 0) return;
    setOnsiteOtpLoading(true);
    setOnsiteOtpError(null);
    try {
      const r = await sendOtpFn({
        data: { companyId: activeCompanyId, email: onsiteOtpEmail.trim().toLowerCase() },
      });
      setOnsiteOtpId(r.otpId);
      setOnsiteOtpSent(true);
      setOnsiteOtpVerified(false);
      setOnsiteOtpCode("");
      setOnsiteOtpCooldown(30);
      toast.success("Code envoyé. Pensez à vérifier les spams.");
    } catch (e: any) {
      const msg = e?.message || "Envoi du code impossible.";
      setOnsiteOtpError(msg);
      toast.error(msg);
    } finally {
      setOnsiteOtpLoading(false);
    }
  }

  async function handleVerifyOtp() {
    if (!onsiteOtpId) return toast.error("Envoyez d'abord un code.");
    if (!/^\d{6}$/.test(onsiteOtpCode)) return toast.error("Code à 6 chiffres requis.");
    setOnsiteOtpLoading(true);
    try {
      await verifyOtpFn({ data: { otpId: onsiteOtpId, code: onsiteOtpCode } });
      setOnsiteOtpVerified(true);
      setOnsiteOtpError(null);
      toast.success("Identité client confirmée.");
    } catch (e: any) {
      toast.error(e?.message || "Code invalide.");
    } finally {
      setOnsiteOtpLoading(false);
    }
  }

  async function onSave(action: "brouillon" | "remote" | "onsite") {
    if (!activeCompanyId) return toast.error("Aucune entreprise active.");
    if (withReserves === null) {
      toast.error("Choisissez si le PV est avec ou sans réserves.");
      const idx = STEPS.findIndex((s) => s.id === ID_DECISION);
      if (idx >= 0) setStepIdx(idx);
      return;
    }

    // Client-side guards for final signing
    if (action !== "brouillon") {
      if (!signatureMode) {
        toast.error("Choisissez le mode de signature.");
        const idx = STEPS.findIndex((s) => s.id === ID_SIGNATURES);
        if (idx >= 0) setStepIdx(idx);
        return;
      }
      if (!companySignatureDataUrl) {
        toast.error("Validez la signature entreprise.");
        const idx = STEPS.findIndex((s) => s.id === ID_SIGNATURES);
        if (idx >= 0) setStepIdx(idx);
        return;
      }
      if (action === "onsite") {
        if (!clientSignatureDataUrl) {
          toast.error("Validez la signature client.");
          const idx = STEPS.findIndex((s) => s.id === ID_SIGNATURES);
          if (idx >= 0) setStepIdx(idx);
          return;
        }
        if (!onsiteOtpVerified || !onsiteOtpId) {
          toast.error("Confirmez l'identité du client avec le code OTP.");
          return;
        }
      }
      if (action === "remote") {
        if (!onsiteOtpEmail.trim()) {
          toast.error("Email client requis pour la signature à distance.");
          return;
        }
      }
    }

    setSaving(true);
    try {
      const status: "brouillon" | "signe" | "en_attente" =
        action === "brouillon" ? "brouillon" : action === "onsite" ? "signe" : "en_attente";
      const sigMode: "remote" | "onsite" | null =
        action === "brouillon" ? signatureMode : action;
      const companySig = action === "brouillon" ? null : companySignatureDataUrl;
      const clientSig = action === "onsite" ? clientSignatureDataUrl : null;
      const identityEmail =
        action === "brouillon" ? null : onsiteOtpEmail.trim().toLowerCase() || null;
      const otpId = action === "onsite" ? onsiteOtpId : null;

      const encodedPhotos = withReserves
        ? await Promise.all(photos.map(async (p) => ({
            base64: await fileToBase64(p.file),
            mimeType: p.file.type || "image/jpeg",
            fileName: p.file.name,
            kind: p.kind,
            caption: p.caption || "",
          })))
        : [];

      const amount = form.work_reference_amount.trim()
        ? Number(form.work_reference_amount.replace(",", "."))
        : null;

      const res = await createPvFn({
        data: {
          companyId: activeCompanyId,
          status,
          signature_mode: sigMode,
          client_identity_email: identityEmail,
          client_otp_id: otpId,
          reception_date: form.reception_date,
          chantier_id: form.chantier_id || null,
          client_id: form.client_id || null,
          new_client_name: form.new_client_name,
          new_client_email: form.new_client_email,
          description: form.description,
          observations: form.observations,
          client_signature: clientSig,
          company_signature: companySig,
          reception_with_reserves: withReserves,
          work_reference_type: form.work_reference_type,
          work_reference_number: form.work_reference_number || null,
          work_reference_date: form.work_reference_date || null,
          work_reference_amount: amount !== null && !isNaN(amount) ? amount : null,
          reserve_completion_delay: withReserves ? (form.reserve_completion_delay || null) : null,
          reserve_due_date: withReserves ? (form.reserve_due_date || null) : null,
          chantier_address: form.chantier_address,
          chantier_postal_code: form.chantier_postal_code,
          chantier_city: form.chantier_city,
          reserves: withReserves ? reserves.map((r) => ({
            description: r.description || r.nature,
            severity: r.severity === "bloquante" ? "majeure" : r.severity,
            status: "ouverte" as const,
            nature: r.nature,
            work_to_execute: r.work_to_execute,
            due_date: r.due_date || null,
          })) : [],
          photos: encodedPhotos,
        },
      });

      // Rattache les documents importés (brouillon) au PV désormais créé.
      if (res?.pvId && activeCompanyId) {
        await supabase
          .from("pv_documents")
          .update({ pv_id: res.pvId, draft_key: null })
          .eq("company_id", activeCompanyId)
          .eq("draft_key", draftKey);
      }

      localStorage.removeItem(DRAFT_KEY);
      if (action === "remote" && res.remoteSignEmailStatus === "failed") {
        // PV créé mais email non envoyé : ne pas masquer l'erreur.
        toast.error("PV créé mais email non envoyé. Vous pouvez le renvoyer depuis la fiche PV.", { duration: 8000 });
      } else {
        const msg =
          action === "brouillon" ? "Brouillon enregistré"
          : action === "onsite" ? "PV signé et archivé"
          : "PV créé — lien de signature envoyé au client";
        toast.success(msg);
      }
      navigate({ to: "/pv/$id", params: { id: res.pvId } });
    } catch (e: any) {
      if (e?.code === "PV_QUOTA" || /quota/i.test(e?.message ?? "")) {
        toast.error("Quota PV mensuel atteint ou abonnement requis.");
        navigate({ to: "/upgrade-required", search: { reason: "pv_quota" } });
      } else if (e?.code === "SIGNATURE_REQUIRED" || /SIGNATURE_REQUIRED/i.test(e?.message ?? "")) {
        toast.error("Veuillez signer en tant qu'entreprise avant de valider le PV.");
        const idx = STEPS.findIndex((s) => s.id === ID_SIGNATURES);
        if (idx >= 0) setStepIdx(idx);
      } else if (e?.code === "COMPANY_INCOMPLETE" || /COMPANY_INCOMPLETE|entreprise incomplète/i.test(e?.message ?? "")) {
        toast.error("Fiche entreprise incomplète.");
        setStepIdx(0);
      } else {
        toast.error(e?.message || "Échec de la création.");
      }
    } finally {
      setSaving(false);
    }
  }

  // Validation par étape (par id)
  const stepErrors = useMemo<Record<string, string | null>>(() => {
    const clientOk = !!form.client_id || (form.new_client_name.trim().length > 1);
    const chantierOk = form.chantier_address.trim().length > 0 && !!form.reception_date;
    const travauxOk = form.description.trim().length > 0;
    const decisionOk = withReserves !== null;
    const reservesOk = !withReserves || (reserves.length > 0 && reserves.every((r) => (r.description.trim() || r.nature.trim())));
    // Signatures: mode requis, signature entreprise requise; remote → email client requis;
    // onsite → signature client + OTP vérifié.
    let signaturesError: string | null = null;
    if (!signatureMode) signaturesError = "Choisissez le mode de signature.";
    else if (!companySignatureDataUrl) signaturesError = "Validez la signature entreprise.";
    else if (signatureMode === "remote" && !onsiteOtpEmail.trim()) signaturesError = "Email client requis pour la signature à distance.";
    else if (signatureMode === "onsite" && !clientSignatureDataUrl) signaturesError = "Validez la signature client.";
    else if (signatureMode === "onsite" && !onsiteOtpVerified) signaturesError = "Confirmez l'identité client avec le code OTP.";
    return {
      [ID_ENTREPRISE]: brandingComplete ? null : "Fiche entreprise incomplète.",
      [ID_CLIENT]: clientOk ? null : "Sélectionnez ou créez un client.",
      [ID_CHANTIER]: chantierOk ? null : "Adresse chantier et date obligatoires.",
      [ID_TRAVAUX]: travauxOk ? null : "Description des travaux obligatoire.",
      [ID_DECISION]: decisionOk ? null : "Choisissez avec ou sans réserves.",
      [ID_RESERVES]: reservesOk ? null : "Au moins une réserve avec description.",
      [ID_PHOTOS]: null,
      [ID_SIGNATURES]: signaturesError,
      [ID_APERCU]: signaturesError ? "Complétez les signatures avant d'accéder à l'aperçu." : null,
    };
  }, [brandingComplete, form, withReserves, reserves, signatureMode, companySignatureDataUrl, clientSignatureDataUrl, onsiteOtpEmail, onsiteOtpVerified]);

  // Résumé court par étape — affiché dans le stepper et la checklist finale.
  const stepSummaries = useMemo<Record<string, string>>(() => {
    const cl = clients.find((c) => c.id === form.client_id);
    const ch = chantiers.find((c) => c.id === form.chantier_id);
    const clientLine = cl
      ? `${cl.name}${cl.email ? ` · ${cl.email}` : ""}`
      : form.new_client_name
        ? `${form.new_client_name}${form.new_client_email ? ` · ${form.new_client_email}` : ""}`
        : "";
    const chantierLine = [ch?.name, form.chantier_address, form.chantier_city].filter(Boolean).join(" · ");
    const travauxLine = [
      form.work_reference_number ? `${labelForRefType(form.work_reference_type)} ${form.work_reference_number}` : labelForRefType(form.work_reference_type),
      form.work_reference_amount ? `${form.work_reference_amount} €` : "",
      form.description ? form.description.slice(0, 60) + (form.description.length > 60 ? "…" : "") : "",
    ].filter(Boolean).join(" · ");
    const decisionLine = withReserves === true ? "Réception avec réserves" : withReserves === false ? "Réception sans réserve" : "";
    const reservesLine = reserves.length ? `${reserves.length} réserve${reserves.length > 1 ? "s" : ""}` : "";
    const photosLine = photos.length ? `${photos.length} photo${photos.length > 1 ? "s" : ""}` : "";
    const sigParts: string[] = [];
    if (signatureMode) sigParts.push(signatureMode === "remote" ? "À distance" : "Sur place");
    if (companySignatureDataUrl) sigParts.push("Entreprise ✓");
    if (signatureMode === "onsite" && clientSignatureDataUrl) sigParts.push("Client ✓");
    if (signatureMode === "onsite" && onsiteOtpVerified) sigParts.push("OTP ✓");
    if (signatureMode === "remote" && onsiteOtpEmail) sigParts.push(onsiteOtpEmail);
    return {
      [ID_ENTREPRISE]: branding?.name ?? "",
      [ID_CLIENT]: clientLine,
      [ID_CHANTIER]: chantierLine,
      [ID_TRAVAUX]: travauxLine,
      [ID_DECISION]: decisionLine,
      [ID_RESERVES]: reservesLine,
      [ID_PHOTOS]: photosLine,
      [ID_SIGNATURES]: sigParts.join(" · "),
      [ID_APERCU]: "",
    };
  }, [branding, clients, chantiers, form, withReserves, reserves, photos, signatureMode, companySignatureDataUrl, clientSignatureDataUrl, onsiteOtpVerified, onsiteOtpEmail]);

  const otpStatus: "idle" | "sent" | "verified" | "error" = onsiteOtpVerified
    ? "verified"
    : onsiteOtpError
      ? "error"
      : onsiteOtpSent
        ? "sent"
        : "idle";

  const stepValid = stepErrors[currentStep.id] === null;
  // Index de la première étape invalide — bloque l'accès aux suivantes.
  const firstInvalidIdx = useMemo(() => {
    const i = STEPS.findIndex((s) => stepErrors[s.id] !== null);
    return i === -1 ? STEPS.length : i;
  }, [stepErrors, STEPS]);


  useEffect(() => { setMaxStepIdx((m) => Math.max(m, stepIdx)); }, [stepIdx]);

  function goToStepIdx(target: number) {
    if (target <= stepIdx) { setStepIdx(target); return; }
    for (let i = stepIdx; i < target; i++) {
      const err = stepErrors[STEPS[i].id];
      if (err) { toast.error(err); return; }
    }
    setStepIdx(target);
  }

  const progress = ((stepIdx + 1) / STEPS.length) * 100;

  const clientObj = clients.find((c) => c.id === form.client_id);
  const chantierObj = chantiers.find((c) => c.id === form.chantier_id);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Link to="/pv" className="hover:text-foreground">Procès-verbaux</Link>
            <ChevronRight className="h-3 w-3" />
            <span>Nouveau</span>
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Créer un procès-verbal</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Procès-verbal de réception de travaux — avec ou sans réserves.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lastSaved && (
            <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex">
              <Cloud className="h-3 w-3 text-success" /> Sauvegardé {lastSaved.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <Button variant="outline" disabled={saving} onClick={() => onSave("brouillon")}>
            <Save className="h-4 w-4" /> Enregistrer en brouillon
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-border bg-gradient-to-b from-muted/40 to-muted/10 px-4 py-3 sm:px-5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Étape {stepIdx + 1}/{STEPS.length} · <span className="text-foreground">{currentStep.label}</span>
            </span>
            <span className="text-xs font-semibold tabular-nums text-primary">{Math.round(progress)}%</span>
          </div>
          <div className="relative h-1 overflow-hidden rounded-full bg-border">
            <motion.div className="h-full rounded-full bg-brand-gradient" initial={false} animate={{ width: `${progress}%` }} transition={{ duration: 0.4 }} />
          </div>

          {/* Compact horizontal stepper — desktop */}
          <TooltipProvider delayDuration={150}>
            <div className="mt-3 hidden items-center gap-1 md:flex">
              {STEPS.map((s, i) => {
                const Icon = s.icon;
                const err = stepErrors[s.id];
                const done = i < stepIdx && !err;
                const current = i === stepIdx;
                const locked = i > stepIdx && i > firstInvalidIdx;
                const summary = stepSummaries[s.id];
                const state: "done" | "current" | "blocked" | "locked" | "todo" =
                  done ? "done" : current ? "current" : locked ? "locked" : err ? "blocked" : "todo";
                const dotCls = {
                  done: "bg-success text-success-foreground border-success",
                  current: "bg-primary text-primary-foreground border-primary ring-2 ring-primary/30",
                  blocked: "bg-warning text-warning-foreground border-warning",
                  locked: "bg-muted text-muted-foreground/60 border-border",
                  todo: "bg-background text-muted-foreground border-border",
                }[state];
                return (
                  <div key={s.id} className="flex min-w-0 flex-1 items-center gap-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          disabled={locked}
                          onClick={() => goToStepIdx(i)}
                          className={`group flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors ${locked ? "cursor-not-allowed opacity-60" : "hover:bg-accent/60"}`}
                        >
                          <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[10px] font-bold ${dotCls}`}>
                            {done ? <Check className="h-3 w-3" /> : locked ? <Lock className="h-2.5 w-2.5" /> : <Icon className="h-3 w-3" />}
                          </span>
                          <span className={`hidden truncate text-xs font-medium lg:inline ${current ? "text-foreground" : "text-muted-foreground"}`}>
                            {s.label}
                          </span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-xs">
                        <div className="text-xs font-semibold">{i + 1}. {s.label}</div>
                        {summary && <div className="mt-0.5 text-xs text-muted-foreground">{summary}</div>}
                        {err && <div className="mt-0.5 text-xs text-warning">{err}</div>}
                        {locked && <div className="mt-0.5 text-xs text-muted-foreground">Complétez l'étape précédente d'abord.</div>}
                      </TooltipContent>
                    </Tooltip>
                    {i < STEPS.length - 1 && <span className={`h-px w-2 shrink-0 ${done ? "bg-success" : "bg-border"}`} />}
                  </div>
                );
              })}
            </div>
          </TooltipProvider>

          {/* Mobile stepper compact */}
          <div className="mt-2 md:hidden">
            <div className="flex items-center gap-2 text-xs">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                {(() => { const Icon = currentStep.icon; return <Icon className="h-3 w-3" />; })()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">Étape {stepIdx + 1}/{STEPS.length} — {currentStep.label}</div>
                {stepErrors[currentStep.id] && (
                  <div className="truncate text-warning">{stepErrors[currentStep.id]}</div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="p-4 sm:p-6">

          <AnimatePresence mode="wait">
            <motion.div
              key={currentStep.id}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.2 }}
              className="space-y-4"
            >
              {currentStep.id === ID_ENTREPRISE && (
                <>
                  <SectionHeader icon={Building2} title="Informations entreprise" desc="Issues de votre fiche entreprise — verrouillées." />
                  <div className="rounded-xl border border-border bg-muted/10 px-5 py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                      <div className="font-mono text-base font-semibold tracking-tight text-foreground">
                        N° {numeroPreview ?? "attribué à l'enregistrement"}
                        {numeroPreview && <span className="ml-2 text-[11px] font-sans font-normal text-muted-foreground">(aperçu)</span>}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        <span className="text-foreground">Document :</span> Procès-verbal de réception de travaux
                      </div>
                    </div>
                  </div>

                  {brandingLoading ? (
                    <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/20 p-6 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
                    </div>
                  ) : !brandingComplete ? (
                    <Alert variant="destructive" className="border-destructive/40 bg-destructive/5">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertTitle>Fiche entreprise incomplète</AlertTitle>
                      <AlertDescription className="space-y-3">
                        <p>Nom, SIRET/SIREN, adresse et email/téléphone obligatoires.</p>
                        <Button asChild size="sm"><Link to="/entreprise">Compléter ma fiche</Link></Button>
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <div className="rounded-xl border border-border bg-gradient-to-br from-muted/30 to-background p-5">
                      <div className="flex items-start gap-4">
                        {branding?.logo_url ? (
                          <img src={branding.logo_url} alt={branding.name} className="h-16 w-16 shrink-0 rounded-lg border border-border object-contain bg-background" />
                        ) : (
                          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-lg border border-border bg-background text-muted-foreground">
                            <Building2 className="h-7 w-7" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <h4 className="truncate text-lg font-semibold">{branding?.name}</h4>
                            <Badge variant="secondary" className="gap-1"><Lock className="h-3 w-3" /> Verrouillé</Badge>
                          </div>
                          <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                            <ReadOnlyRow label="SIRET" value={branding?.siret} />
                            <ReadOnlyRow label="SIREN" value={branding?.siren} />
                            <ReadOnlyRow label="Email" value={branding?.email} />
                            <ReadOnlyRow label="Téléphone" value={branding?.phone} />
                            <div className="sm:col-span-2">
                              <ReadOnlyRow label="Adresse" value={
                                branding?.address_line1
                                  ? [branding.address_line1, branding.address_line2, [branding.postal_code, branding.city].filter(Boolean).join(" "), branding.country].filter(Boolean).join(", ")
                                  : branding?.address
                              } />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}

              {currentStep.id === ID_CLIENT && (
                <>
                  <SectionHeader icon={User} title="Informations client" desc="Sélectionnez ou créez le client signataire." />
                  <Field label="Client existant">
                    <Select value={form.client_id || "none"} onValueChange={(v) => setForm({ ...form, client_id: v === "none" ? "" : v })}>
                      <SelectTrigger><SelectValue placeholder="Choisir…" /></SelectTrigger>
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

              {currentStep.id === ID_CHANTIER && (
                <>
                  <SectionHeader icon={MapPin} title="Chantier" desc="Adresse précise du chantier réceptionné." />
                  <Field label="Chantier existant (optionnel)">
                    <Select value={form.chantier_id || "none"} onValueChange={(v) => setForm({ ...form, chantier_id: v === "none" ? "" : v })}>
                      <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— Aucun chantier lié —</SelectItem>
                        {chantiers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Adresse du chantier *">
                    <AddressAutocomplete
                      value={form.chantier_address}
                      onChange={(v) => setForm((f) => ({ ...f, chantier_address: v }))}
                      onSelect={(a: AddressValue) => setForm((f) => ({
                        ...f,
                        chantier_address: a.address,
                        chantier_postal_code: a.postalCode,
                        chantier_city: a.city,
                        latitude: a.latitude,
                        longitude: a.longitude,
                      }))}
                      placeholder="12 chemin des Pins, Cannes…"
                    />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field label="Code postal"><Input value={form.chantier_postal_code} onChange={(e) => setForm({ ...form, chantier_postal_code: e.target.value })} placeholder="06400" /></Field>
                    <Field label="Ville"><Input value={form.chantier_city} onChange={(e) => setForm({ ...form, chantier_city: e.target.value })} placeholder="Cannes" /></Field>
                    <Field label="Date de réception *"><Input type="date" value={form.reception_date} onChange={(e) => setForm({ ...form, reception_date: e.target.value })} /></Field>
                  </div>
                </>
              )}

              {currentStep.id === ID_TRAVAUX && (
                <>
                  <SectionHeader icon={ClipboardList} title="Travaux & référence" desc="Devis, bon de commande ou marché à l'origine des travaux." />

                  <WorkReferenceImport
                    companyId={activeCompanyId}
                    draftKey={draftKey}
                    extractFn={extractWorkRefFn}
                    onApply={(extracted, mode) => {
                      setForm((f) => {
                        const next = { ...f };
                        const apply = <K extends keyof typeof f>(key: K, val: unknown) => {
                          if (val == null || val === "") return;
                          const current = String(f[key] ?? "");
                          if (mode === "empty" && current.trim()) return;
                          (next as any)[key] = String(val);
                        };
                        if (extracted.document_type && ["devis", "bon_commande", "marche"].includes(extracted.document_type)) {
                          if (mode !== "empty" || f.work_reference_type === "manuel") {
                            next.work_reference_type = extracted.document_type as WorkRefType;
                          }
                        }
                        apply("work_reference_number", extracted.document_number);
                        apply("work_reference_date", extracted.document_date);
                        if (extracted.amount_ttc != null) apply("work_reference_amount", extracted.amount_ttc);
                        apply("new_client_name", extracted.client_name);
                        apply("new_client_email", extracted.client_email);
                        apply("chantier_address", extracted.chantier_address);
                        apply("chantier_postal_code", extracted.chantier_postal_code);
                        apply("chantier_city", extracted.chantier_city);
                        apply("description", extracted.description);
                        return next;
                      });
                    }}
                  />

                  <Field label="Type de référence">
                    <div className="grid gap-2 sm:grid-cols-4">
                      {([
                        { v: "devis", l: "Devis" },
                        { v: "bon_commande", l: "Bon de commande" },
                        { v: "marche", l: "Marché / contrat" },
                        { v: "manuel", l: "Saisie manuelle" },
                      ] as { v: WorkRefType; l: string }[]).map((o) => (
                        <button
                          key={o.v}
                          type="button"
                          onClick={() => setForm({ ...form, work_reference_type: o.v })}
                          className={`rounded-lg border px-3 py-2 text-sm font-medium transition-all ${
                            form.work_reference_type === o.v
                              ? "border-primary bg-primary/10 text-primary shadow-brand"
                              : "border-border bg-muted/20 hover:border-primary/40"
                          }`}
                        >
                          {o.l}
                        </button>
                      ))}
                    </div>
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field label={`Numéro ${form.work_reference_type !== "manuel" ? "(recommandé)" : ""}`}>
                      <Input value={form.work_reference_number} onChange={(e) => setForm({ ...form, work_reference_number: e.target.value })} placeholder="D-2025-042" />
                    </Field>
                    <Field label="Date">
                      <Input type="date" value={form.work_reference_date} onChange={(e) => setForm({ ...form, work_reference_date: e.target.value })} />
                    </Field>
                    <Field label="Montant (€)">
                      <Input type="number" inputMode="decimal" value={form.work_reference_amount} onChange={(e) => setForm({ ...form, work_reference_amount: e.target.value })} placeholder="18450" />
                    </Field>
                  </div>
                  <Field label="Description des travaux *">
                    <Textarea rows={5} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Dépose couverture, pose membrane EPDM, isolation 200mm…" />
                  </Field>
                  <Field label="Observations complémentaires">
                    <Textarea rows={3} value={form.observations} onChange={(e) => setForm({ ...form, observations: e.target.value })} placeholder="Conditions météo, accès chantier…" />
                  </Field>
                </>
              )}

              {currentStep.id === ID_DECISION && (
                <>
                  <SectionHeader icon={ShieldCheck} title="Décision de réception" desc="Le procès-verbal est-il prononcé avec réserves ?" />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <DecisionCard
                      active={withReserves === false}
                      onClick={() => pickDecision(false)}
                      icon={<CheckCircle2 className="h-6 w-6" />}
                      title="Sans réserve"
                      desc="Les travaux sont réceptionnés sans réserve. Le PV est définitif."
                      tone="success"
                    />
                    <DecisionCard
                      active={withReserves === true}
                      onClick={() => pickDecision(true)}
                      icon={<AlertTriangle className="h-6 w-6" />}
                      title="Avec réserves"
                      desc="Des réserves sont mentionnées et devront être levées ultérieurement."
                      tone="warning"
                    />
                  </div>
                  {withReserves === true && (
                    <div className="grid gap-4 rounded-xl border border-border bg-muted/20 p-4 sm:grid-cols-2">
                      <Field label="Délai global de réalisation">
                        <Input value={form.reserve_completion_delay} onChange={(e) => setForm({ ...form, reserve_completion_delay: e.target.value })} placeholder="30 jours" />
                      </Field>
                      <Field label="Date limite globale">
                        <Input type="date" value={form.reserve_due_date} onChange={(e) => setForm({ ...form, reserve_due_date: e.target.value })} />
                      </Field>
                    </div>
                  )}
                </>
              )}

              {currentStep.id === ID_RESERVES && (
                <>
                  <SectionHeader icon={AlertTriangle} title="Réserves" desc="Listez chaque réserve avec les travaux à exécuter." />
                  <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Field label="Nature de la réserve">
                        <Input value={newReserve.nature} onChange={(e) => setNewReserve({ ...newReserve, nature: e.target.value })} placeholder="Peinture, étanchéité…" />
                      </Field>
                      <Field label="Gravité">
                        <Select value={newReserve.severity} onValueChange={(v) => setNewReserve({ ...newReserve, severity: v as Severity })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="mineure">Mineure</SelectItem>
                            <SelectItem value="majeure">Majeure</SelectItem>
                            <SelectItem value="bloquante">Bloquante</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                    </div>
                    <Field label="Description / détail">
                      <Textarea rows={2} value={newReserve.description} onChange={(e) => setNewReserve({ ...newReserve, description: e.target.value })} placeholder="Décrire précisément le défaut constaté…" />
                    </Field>
                    <Field label="Travaux à exécuter">
                      <Textarea rows={2} value={newReserve.work_to_execute} onChange={(e) => setNewReserve({ ...newReserve, work_to_execute: e.target.value })} placeholder="Reprendre la peinture, remplacer la pièce…" />
                    </Field>
                    <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                      <Field label="Date limite (optionnel)">
                        <Input type="date" value={newReserve.due_date} onChange={(e) => setNewReserve({ ...newReserve, due_date: e.target.value })} />
                      </Field>
                      <div className="flex items-end">
                        <Button type="button" onClick={addReserve}><Plus className="h-4 w-4" /> Ajouter la réserve</Button>
                      </div>
                    </div>
                  </div>
                  {reserves.length > 0 ? (
                    <ul className="space-y-2">
                      {reserves.map((r, i) => (
                        <li key={i} className="flex items-start justify-between gap-3 rounded-lg border border-border bg-card p-3 text-sm shadow-sm">
                          <div className="flex flex-1 items-start gap-3">
                            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-muted text-xs font-semibold">{i + 1}</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="font-medium">{r.nature || "Réserve"}</p>
                                <Badge variant={r.severity === "mineure" ? "secondary" : "destructive"}>{r.severity}</Badge>
                                {r.due_date && <Badge variant="outline" className="gap-1"><CalendarDays className="h-3 w-3" /> {r.due_date}</Badge>}
                              </div>
                              {r.description && <p className="mt-1 text-muted-foreground">{r.description}</p>}
                              {r.work_to_execute && <p className="mt-1 text-xs"><span className="font-medium">Travaux :</span> {r.work_to_execute}</p>}
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
                      Aucune réserve ajoutée pour le moment.
                    </p>
                  )}
                </>
              )}

              {currentStep.id === ID_PHOTOS && (
                <>
                  <SectionHeader icon={Camera} title="Photos des réserves" desc="Documentez visuellement les réserves (optionnel mais recommandé)." />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <PhotoUploader label="Photos de réserves" kind="autre" onFiles={onFiles} />
                    <PhotoUploader label="Photos avant intervention" kind="avant" onFiles={onFiles} />
                  </div>
                  {photos.length > 0 && (
                    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
                      {photos.map((p, i) => (
                        <div key={i} className="group relative overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                          <div className="relative">
                            <img src={p.preview} alt="" className="aspect-square w-full object-cover" />
                            <span className="absolute left-2 top-2 rounded-full bg-background/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider shadow">{p.kind}</span>
                            <button type="button" onClick={() => setPhotos(photos.filter((_, j) => j !== i))} className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-md bg-background/90 opacity-0 transition-opacity group-hover:opacity-100">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          <Input placeholder="Légende…" className="rounded-none border-0 border-t text-xs" value={p.caption}
                            onChange={(e) => { const c = [...photos]; c[i].caption = e.target.value; setPhotos(c); }} />
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {currentStep.id === ID_SIGNATURES && (
                <>
                  <SectionHeader icon={PenLine} title="Signatures électroniques" desc="Choisissez le mode de signature puis validez la signature entreprise." />

                  {/* Mode selector */}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <ModeCard
                      active={signatureMode === "remote"}
                      onClick={() => setSignatureMode("remote")}
                      icon={<MonitorSmartphone className="h-6 w-6" />}
                      title="Signature à distance"
                      badge="Recommandé"
                      desc="Le client reçoit un lien sécurisé par email et signe depuis son propre appareil."
                    />
                    <ModeCard
                      active={signatureMode === "onsite"}
                      onClick={() => setSignatureMode("onsite")}
                      icon={<Smartphone className="h-6 w-6" />}
                      title="Signature sur place"
                      desc="Le client signe directement sur votre appareil et confirme son identité avec un code reçu par email."
                    />
                  </div>

                  {signatureMode && (
                    <>
                      {/* Company signature (always required) */}
                      <SignatureBox
                        label="Signature entreprise"
                        innerRef={companySigRef}
                        saved={!!companySignatureDataUrl}
                        savedDataUrl={companySignatureDataUrl}
                        savedLabel="Signature entreprise enregistrée"
                        validateLabel="Enregistrer signature entreprise"
                        clearLabel="Effacer"
                        onValidate={saveCompanySignature}
                        onClear={clearCompanySignature}
                        onEnd={() => syncSignature(companySigRef, setCompanySignatureDataUrl)}
                      />

                      {signatureMode === "remote" && (
                        <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
                          <div className="flex items-start gap-3">
                            <Mail className="mt-0.5 h-5 w-5 text-primary" />
                            <div className="flex-1">
                              <h4 className="text-sm font-semibold">Envoi au client</h4>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                Le client recevra un email avec un lien sécurisé pour signer (valable 14 jours).
                              </p>
                            </div>
                          </div>
                          <Field label="Email du client *">
                            <Input
                              type="email"
                              value={onsiteOtpEmail}
                              onChange={(e) => setOnsiteOtpEmail(e.target.value)}
                              placeholder="client@email.com"
                            />
                          </Field>
                        </div>
                      )}

                      {signatureMode === "onsite" && (
                        <>
                          <SignatureBox
                            label="Signature client (sur place)"
                            innerRef={clientSigRef}
                            saved={!!clientSignatureDataUrl}
                            savedDataUrl={clientSignatureDataUrl}
                            savedLabel="Signature client enregistrée"
                            validateLabel="Enregistrer signature client"
                            clearLabel="Effacer"
                            onValidate={saveClientSignature}
                            onClear={clearClientSignature}
                            onEnd={() => syncSignature(clientSigRef, setClientSignatureDataUrl)}
                          />

                          <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
                            <div className="flex items-start gap-3">
                              <ShieldCheck className="mt-0.5 h-5 w-5 text-primary" />
                              <div className="flex-1">
                                <h4 className="text-sm font-semibold">Confirmation d'identité client</h4>
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                  Un code à 6 chiffres est envoyé par email au client pour confirmer son identité.
                                </p>
                              </div>
                              <OtpStatusBadge status={otpStatus} />
                            </div>
                            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                              <Field label="Email du client *">
                                <Input
                                  type="email"
                                  value={onsiteOtpEmail}
                                  onChange={(e) => {
                                    setOnsiteOtpEmail(e.target.value);
                                    setOnsiteOtpVerified(false);
                                    setOnsiteOtpId(null);
                                    setOnsiteOtpSent(false);
                                  }}
                                  placeholder="client@email.com"
                                  disabled={onsiteOtpVerified}
                                />
                              </Field>
                              <div className="flex items-end">
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={handleSendOtp}
                                  disabled={onsiteOtpLoading || !onsiteOtpEmail.trim() || onsiteOtpVerified || onsiteOtpCooldown > 0}
                                >
                                  {onsiteOtpLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                  {onsiteOtpCooldown > 0
                                    ? `Renvoyer dans ${onsiteOtpCooldown}s`
                                    : onsiteOtpSent ? "Renvoyer le code" : "Envoyer le code"}
                                </Button>
                              </div>
                            </div>
                            {onsiteOtpSent && !onsiteOtpVerified && (
                              <>
                                <div className="rounded-md border border-info/30 bg-info/5 px-3 py-2 text-xs text-muted-foreground">
                                  Code envoyé. Vérifiez la boîte de réception et les <strong>spams</strong>. Le code est valable 10 minutes.
                                </div>
                                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                                  <Field label="Code reçu par le client (6 chiffres) *">
                                    <Input
                                      inputMode="numeric"
                                      maxLength={6}
                                      value={onsiteOtpCode}
                                      onChange={(e) => setOnsiteOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                                      placeholder="123456"
                                      className="font-mono tracking-[0.4em] text-center text-lg"
                                    />
                                  </Field>
                                  <div className="flex items-end">
                                    <Button
                                      type="button"
                                      onClick={handleVerifyOtp}
                                      disabled={onsiteOtpLoading || onsiteOtpCode.length !== 6}
                                    >
                                      {onsiteOtpLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                                      Valider le code
                                    </Button>
                                  </div>
                                </div>
                                <div>
                                  <button
                                    type="button"
                                    className="text-xs text-primary underline"
                                    onClick={() => setOnsiteOtpShowHelp((s) => !s)}
                                  >
                                    Le client n'a rien reçu ?
                                  </button>
                                  {onsiteOtpShowHelp && (
                                    <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                                      <li>Vérifier le dossier <strong>spam / courrier indésirable</strong>.</li>
                                      <li>Vérifier que l'adresse email est correcte.</li>
                                      <li>Corriger l'email si besoin puis cliquer <strong>Renvoyer le code</strong> ({onsiteOtpCooldown > 0 ? `${onsiteOtpCooldown}s` : "disponible"}).</li>
                                      <li className="opacity-60">Envoi par SMS — bientôt disponible.</li>
                                    </ul>
                                  )}
                                  {onsiteOtpError && (
                                    <p className="mt-2 text-xs text-destructive">Dernier envoi : {onsiteOtpError}</p>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        </>
                      )}
                    </>
                  )}

                  <p className="text-xs text-muted-foreground">
                    Vous pouvez aussi enregistrer en brouillon et signer plus tard.
                  </p>
                </>
              )}

              {currentStep.id === ID_APERCU && (
                <>
                  <SectionHeader icon={Eye} title="Récapitulatif avant validation" desc="Vérifiez chaque ligne. Tout doit être vert avant signature." />

                  {/* Checklist finale */}
                  <FinalChecklist
                    items={[
                      { label: "Entreprise complète", ok: brandingComplete, hint: stepErrors[ID_ENTREPRISE], stepId: ID_ENTREPRISE },
                      { label: "Client renseigné", ok: !stepErrors[ID_CLIENT], hint: stepErrors[ID_CLIENT], stepId: ID_CLIENT },
                      { label: "Chantier et date renseignés", ok: !stepErrors[ID_CHANTIER], hint: stepErrors[ID_CHANTIER], stepId: ID_CHANTIER },
                      { label: "Travaux décrits", ok: !stepErrors[ID_TRAVAUX], hint: stepErrors[ID_TRAVAUX], stepId: ID_TRAVAUX },
                      { label: "Décision choisie", ok: !stepErrors[ID_DECISION], hint: stepErrors[ID_DECISION], stepId: ID_DECISION },
                      ...(withReserves
                        ? [{ label: "Au moins une réserve renseignée", ok: !stepErrors[ID_RESERVES], hint: stepErrors[ID_RESERVES], stepId: ID_RESERVES }]
                        : []),
                      { label: "Mode signature choisi", ok: !!signatureMode, hint: signatureMode ? null : "Choisissez le mode de signature.", stepId: ID_SIGNATURES },
                      { label: "Signature entreprise validée", ok: !!companySignatureDataUrl, hint: companySignatureDataUrl ? null : "Validez la signature entreprise.", stepId: ID_SIGNATURES },
                      ...(signatureMode === "remote"
                        ? [{ label: "Email client renseigné", ok: !!onsiteOtpEmail.trim(), hint: onsiteOtpEmail.trim() ? null : "Renseignez l'email du client.", stepId: ID_SIGNATURES }]
                        : []),
                      ...(signatureMode === "onsite"
                        ? [
                            { label: "Signature client validée", ok: !!clientSignatureDataUrl, hint: clientSignatureDataUrl ? null : "Validez la signature client.", stepId: ID_SIGNATURES },
                            { label: "Code OTP client validé", ok: onsiteOtpVerified, hint: onsiteOtpVerified ? null : "Confirmez le code client.", stepId: ID_SIGNATURES },
                          ]
                        : []),
                      { label: "PDF généré après signature complète", ok: true, hint: null, info: "Le PDF n'est généré qu'une fois toutes les signatures collectées." },
                      { label: "Email PDF envoyé automatiquement", ok: true, hint: null, info: "Le PDF est envoyé au client et à l'entreprise dès finalisation." },
                    ]}
                    onFix={(id) => { const i = STEPS.findIndex((s) => s.id === id); if (i >= 0) setStepIdx(i); }}
                  />

                  <div className="grid gap-4 sm:grid-cols-2">

                    <RecapBlock title="Entreprise" lines={[branding?.name ?? "—", branding?.siret ? `SIRET ${branding.siret}` : ""]} />
                    <RecapBlock title="Client" lines={[clientObj?.name ?? form.new_client_name, clientObj?.email ?? form.new_client_email]} />
                    <RecapBlock title="Chantier" lines={[chantierObj?.name ?? "—", form.chantier_address, [form.chantier_postal_code, form.chantier_city].filter(Boolean).join(" ")]} />
                    <RecapBlock title="Référence travaux" lines={[
                      labelForRefType(form.work_reference_type),
                      form.work_reference_number ? `N° ${form.work_reference_number}` : "",
                      form.work_reference_date || "",
                      form.work_reference_amount ? `${form.work_reference_amount} €` : "",
                    ]} />
                  </div>
                  <div className={`rounded-xl border p-4 text-sm ${
                    withReserves ? "border-warning/40 bg-warning/10 text-warning-foreground" : "border-success/40 bg-success/10 text-success"
                  }`}>
                    <p className="flex items-center gap-2 font-semibold">
                      {withReserves ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                      {withReserves ? `Réception avec ${reserves.length} réserve${reserves.length > 1 ? "s" : ""}` : "Réception sans réserve"}
                    </p>
                  </div>

                  {/* Signature recap */}
                  <div className="rounded-xl border border-border bg-muted/10 p-4 text-sm space-y-2">
                    <p className="flex items-center gap-2 font-semibold">
                      <PenLine className="h-4 w-4" /> Signature
                    </p>
                    {!signatureMode ? (
                      <p className="text-warning">Aucun mode de signature choisi.</p>
                    ) : (
                      <>
                        <p>Mode : <strong>{signatureMode === "remote" ? "Signature à distance" : "Signature sur place"}</strong></p>
                        <p className={companySignatureDataUrl ? "text-success" : "text-warning"}>
                          Signature entreprise : {companySignatureDataUrl ? "enregistrée ✓" : "manquante"}
                        </p>
                        {signatureMode === "remote" && (
                          <>
                            <p>Email client : {onsiteOtpEmail || <span className="text-warning">manquant</span>}</p>
                            <p className="text-muted-foreground">Statut final : en attente de signature client</p>
                          </>
                        )}
                        {signatureMode === "onsite" && (
                          <>
                            <p className={clientSignatureDataUrl ? "text-success" : "text-warning"}>
                              Signature client : {clientSignatureDataUrl ? "enregistrée ✓" : "manquante"}
                            </p>
                            <p className={onsiteOtpVerified ? "text-success" : "text-warning"}>
                              Identité client : {onsiteOtpVerified ? "confirmée ✓" : "non confirmée"}
                            </p>
                            <p className="text-muted-foreground">Statut final : signé et verrouillé</p>
                          </>
                        )}
                      </>
                    )}
                    {!signatureMode || !companySignatureDataUrl ? (
                      <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setStepIdx(STEPS.findIndex((s) => s.id === ID_SIGNATURES))}>
                        <PenLine className="h-4 w-4" /> Retour aux signatures
                      </Button>
                    ) : null}
                  </div>
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="flex items-center justify-between border-t border-border bg-muted/20 p-4">
          <Button variant="ghost" disabled={stepIdx === 0} onClick={() => setStepIdx((s) => Math.max(0, s - 1))}>
            <ChevronLeft className="h-4 w-4" /> Précédent
          </Button>
          <div className="text-xs text-muted-foreground">{currentStep.label}</div>
          {stepIdx < STEPS.length - 1 ? (
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button disabled={!stepValid} onClick={() => goToStepIdx(stepIdx + 1)}>
                      Suivant <ChevronRight className="h-4 w-4" />
                    </Button>
                  </span>
                </TooltipTrigger>
                {!stepValid && stepErrors[currentStep.id] && (
                  <TooltipContent>{stepErrors[currentStep.id]}</TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          ) : (() => {
            const finalAction: "remote" | "onsite" | null = signatureMode;
            const finalReady =
              !!finalAction &&
              !!companySignatureDataUrl &&
              (finalAction === "remote"
                ? !!onsiteOtpEmail.trim()
                : !!clientSignatureDataUrl && onsiteOtpVerified);
            const finalLabel =
              finalAction === "remote" ? "Créer et envoyer au client"
              : finalAction === "onsite" ? "Signer définitivement le PV"
              : "Choisir le mode de signature";
            const tooltip = !finalAction
              ? "Choisissez le mode de signature."
              : !companySignatureDataUrl
              ? "Validez la signature entreprise."
              : finalAction === "remote"
              ? "Renseignez l'email du client."
              : !clientSignatureDataUrl
              ? "Validez la signature client."
              : !onsiteOtpVerified
              ? "Confirmez l'identité client avec le code OTP."
              : null;
            return (
              <TooltipProvider delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button
                        disabled={saving || !finalReady}
                        onClick={() => finalAction && onSave(finalAction)}
                        className="shadow-brand"
                      >
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : finalAction === "remote" ? <Send className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                        {finalLabel}
                      </Button>
                    </span>
                  </TooltipTrigger>
                  {tooltip && <TooltipContent>{tooltip}</TooltipContent>}
                </Tooltip>
              </TooltipProvider>
            );
          })()}
        </div>
      </Card>
    </div>
  );
}

function labelForRefType(t: WorkRefType): string {
  switch (t) {
    case "devis": return "Devis";
    case "bon_commande": return "Bon de commande";
    case "marche": return "Marché / contrat";
    case "manuel": return "Saisie manuelle";
  }
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

function ReadOnlyRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="truncate text-sm text-foreground">{value || <span className="text-muted-foreground/60">—</span>}</span>
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

function PhotoUploader({ label, kind, onFiles }: { label: string; kind: "avant" | "apres" | "autre"; onFiles: (f: FileList | null, k: "avant" | "apres" | "autre") => void }) {
  return (
    <label className="group flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/10 p-8 text-sm transition-all hover:border-primary/40 hover:bg-primary/5">
      <div className="grid h-10 w-10 place-items-center rounded-full bg-background/70 text-muted-foreground transition group-hover:scale-110 group-hover:text-primary">
        <Upload className="h-5 w-5" />
      </div>
      <span className="font-medium">{label}</span>
      <span className="text-xs text-muted-foreground">JPG, PNG · Sélection multiple</span>
      <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => onFiles(e.target.files, kind)} />
    </label>
  );
}

function SignatureBox({
  label,
  innerRef,
  saved,
  savedDataUrl,
  savedLabel,
  validateLabel,
  clearLabel,
  onValidate,
  onClear,
  onEnd,
}: {
  label: string;
  innerRef: React.RefObject<SignaturePad | null>;
  saved: boolean;
  savedDataUrl: string | null;
  savedLabel: string;
  validateLabel: string;
  clearLabel: string;
  onValidate: () => void;
  onClear: () => void;
  onEnd: () => void;
}) {
  // Mode édition local : tant qu'une signature est sauvegardée, on n'affiche
  // QUE l'aperçu (jamais canvas + image en même temps). Cliquer sur
  // "Modifier la signature" réaffiche le canvas pour redessiner.
  const [editing, setEditing] = useState(false);
  const showCanvas = !saved || editing;
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs font-medium">{label}</Label>
        {saved && !editing && (
          <Badge variant="secondary" className="gap-1 text-[11px]">
            <CheckCircle2 className="h-3 w-3" /> {savedLabel}
          </Badge>
        )}
      </div>
      {showCanvas ? (
        <div className="mt-1 overflow-hidden rounded-xl border border-border bg-gradient-to-br from-muted/40 to-background">
          <SignaturePad ref={innerRef} canvasProps={{ className: "w-full h-44" }} penColor="rgb(20, 35, 80)" onEnd={onEnd} />
        </div>
      ) : (
        <div className="mt-1 rounded-xl border border-border bg-background p-3">
          <img src={savedDataUrl ?? ""} alt={savedLabel} className="mx-auto h-28 w-full object-contain" />
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {showCanvas ? (
          <Button type="button" size="sm" onClick={() => { onValidate(); setEditing(false); }}>
            <Check className="h-3.5 w-3.5" /> {validateLabel}
          </Button>
        ) : (
          <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
            <PenLine className="h-3.5 w-3.5" /> Modifier la signature
          </Button>
        )}
        <Button type="button" variant="ghost" size="sm" onClick={() => { onClear(); setEditing(false); }}>
          <Trash2 className="h-3.5 w-3.5" /> {clearLabel}
        </Button>
      </div>
    </div>
  );
}

function DecisionCard({
  active, onClick, icon, title, desc, tone,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  desc: string;
  tone: "success" | "warning";
}) {
  const activeCls = tone === "success"
    ? "border-success bg-success/10 text-success shadow-brand"
    : "border-warning bg-warning/10 text-warning shadow-brand";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left rounded-xl border-2 p-5 transition-all ${
        active ? activeCls : "border-border bg-muted/10 hover:border-primary/40 hover:bg-primary/5"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${
          tone === "success" ? "bg-success/15 text-success" : "bg-warning/15 text-warning"
        }`}>{icon}</div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h4 className="font-semibold text-foreground">{title}</h4>
            {active && <Check className="h-4 w-4" />}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
        </div>
      </div>
    </button>
  );
}

function RecapBlock({ title, lines }: { title: string; lines: (string | null | undefined)[] }) {
  const filtered = lines.filter((l): l is string => !!l && l.trim().length > 0);
  return (
    <div className="rounded-xl border border-border bg-muted/10 p-4">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{title}</p>
      <div className="mt-2 space-y-0.5 text-sm">
        {filtered.length ? filtered.map((l, i) => <p key={i} className="text-foreground">{l}</p>) : <p className="text-muted-foreground/60">—</p>}
      </div>
    </div>
  );
}

function ModeCard({
  active, onClick, icon, title, desc, badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  desc: string;
  badge?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left rounded-xl border-2 p-5 transition-all ${
        active ? "border-primary bg-primary/10 shadow-brand" : "border-border bg-muted/10 hover:border-primary/40 hover:bg-primary/5"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${active ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>
          {icon}
        </div>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-semibold text-foreground">{title}</h4>
            {badge && <Badge variant="secondary" className="text-[10px]">{badge}</Badge>}
            {active && <Check className="h-4 w-4 text-primary" />}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
        </div>
      </div>
    </button>
  );
}

function OtpStatusBadge({ status }: { status: "idle" | "sent" | "verified" | "error" }) {
  if (status === "verified") {
    return (
      <Badge variant="secondary" className="gap-1 border border-success/40 bg-success/10 text-success">
        <CheckCircle2 className="h-3 w-3" /> Identité confirmée
      </Badge>
    );
  }
  if (status === "sent") {
    return (
      <Badge variant="secondary" className="gap-1 border border-info/40 bg-info/10 text-info">
        <Send className="h-3 w-3" /> Code envoyé
      </Badge>
    );
  }
  if (status === "error") {
    return (
      <Badge variant="destructive" className="gap-1">
        <AlertTriangle className="h-3 w-3" /> Erreur d'envoi
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 text-muted-foreground">
      Code non envoyé
    </Badge>
  );
}

type ChecklistItem = {
  label: string;
  ok: boolean;
  hint: string | null;
  info?: string;
  stepId?: string;
};

function FinalChecklist({ items, onFix }: { items: ChecklistItem[]; onFix: (stepId: string) => void }) {
  const remaining = items.filter((i) => !i.ok && i.stepId).length;
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <CheckCircle2 className="h-4 w-4 text-primary" /> Checklist finale
        </p>
        <span className={`text-xs font-medium ${remaining === 0 ? "text-success" : "text-warning"}`}>
          {remaining === 0 ? "Tout est prêt" : `${remaining} point${remaining > 1 ? "s" : ""} à corriger`}
        </span>
      </div>
      <ul className="space-y-1.5">
        {items.map((it, i) => (
          <li
            key={i}
            className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm ${
              it.ok
                ? "border-success/30 bg-success/5"
                : "border-warning/40 bg-warning/5"
            }`}
          >
            <span
              className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${
                it.ok ? "bg-success text-success-foreground" : "bg-warning text-warning-foreground"
              }`}
            >
              {it.ok ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-medium">{it.label}</div>
              {!it.ok && it.hint && (
                <div className="text-xs text-muted-foreground">{it.hint}</div>
              )}
              {it.ok && it.info && (
                <div className="text-xs text-muted-foreground">{it.info}</div>
              )}
            </div>
            {!it.ok && it.stepId && (
              <Button size="sm" variant="outline" onClick={() => onFix(it.stepId!)}>
                Corriger
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ============================================================
 * Import devis / bon de commande / marché + extraction IA
 * ============================================================ */
type ExtractedRef = {
  document_type?: string | null;
  document_number?: string | null;
  document_date?: string | null;
  amount_ttc?: number | null;
  amount_ht?: number | null;
  vat_amount?: number | null;
  client_name?: string | null;
  client_email?: string | null;
  client_phone?: string | null;
  chantier_address?: string | null;
  chantier_postal_code?: string | null;
  chantier_city?: string | null;
  description?: string | null;
  issuer_company?: string | null;
  confidence?: number | null;
};

function WorkReferenceImport(props: {
  companyId: string | null;
  draftKey: string;
  extractFn: (args: { data: any }) => Promise<any>;
  onApply: (extracted: ExtractedRef, mode: "empty" | "all") => void;
}) {
  const { companyId, draftKey, extractFn, onApply } = props;
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<ExtractedRef | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "ok" | "failed">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    if (!companyId) {
      toast.error("Aucune entreprise active.");
      return;
    }
    const allowed = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
    if (!allowed.includes(file.type)) {
      toast.error("Format non supporté. PDF, PNG, JPG ou WebP uniquement.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Fichier trop volumineux (max 10 Mo).");
      return;
    }
    setBusy(true);
    setStatus("uploading");
    setFileName(file.name);
    setErrorMsg(null);
    setExtracted(null);
    try {
      const dataUrl = await fileToBase64(file);
      const res = await extractFn({
        data: {
          companyId,
          draftKey,
          fileName: file.name,
          mimeType: file.type,
          dataUrl,
        },
      });
      if (res?.extracted) {
        setExtracted(res.extracted as ExtractedRef);
        setConfidence(res.document?.extraction_confidence ?? null);
        setStatus("ok");
        toast.success("Document analysé. Vérifiez les données détectées.");
      } else {
        setStatus("failed");
        setErrorMsg(res?.error ?? "Extraction impossible.");
        toast.warning("Document importé mais extraction automatique impossible.");
      }
    } catch (e) {
      setStatus("failed");
      setErrorMsg((e as Error).message);
      toast.error(`Échec de l'import : ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const rows: Array<{ label: string; value?: string | number | null }> = extracted
    ? [
        { label: "Type", value: extracted.document_type },
        { label: "Numéro", value: extracted.document_number },
        { label: "Date", value: extracted.document_date },
        { label: "Montant TTC (€)", value: extracted.amount_ttc },
        { label: "Montant HT (€)", value: extracted.amount_ht },
        { label: "Client", value: extracted.client_name },
        { label: "Email", value: extracted.client_email },
        { label: "Adresse chantier", value: extracted.chantier_address },
        {
          label: "Code postal / ville",
          value:
            [extracted.chantier_postal_code, extracted.chantier_city].filter(Boolean).join(" ") || null,
        },
        {
          label: "Description",
          value: extracted.description ? extracted.description.slice(0, 200) : null,
        },
      ]
    : [];

  return (
    <Card className="border-dashed bg-muted/30 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Upload className="h-4 w-4 text-primary" />
            Importer un devis, bon de commande ou marché
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            PDF ou image (PNG/JPG/WebP), 10 Mo max. Les champs vides du formulaire seront pré-remplis automatiquement.
          </p>
        </div>
        <label className="cursor-pointer">
          <input
            type="file"
            accept=".pdf,application/pdf,image/png,image/jpeg,image/webp"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
              e.target.value = "";
            }}
          />
          <span className="inline-flex items-center gap-2 rounded-md border border-primary bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {busy ? "Analyse en cours…" : "Choisir un fichier"}
          </span>
        </label>
      </div>

      {fileName && (
        <div className="mt-3 text-xs text-muted-foreground">
          <FileText className="mr-1 inline h-3 w-3" />
          {fileName}
          {status === "ok" && confidence != null && (
            <span className="ml-2 rounded bg-success/10 px-2 py-0.5 text-success">
              Confiance {Math.round(confidence * 100)}%
            </span>
          )}
        </div>
      )}

      {status === "failed" && (
        <Alert variant="default" className="mt-3 border-warning/40 bg-warning/5">
          <AlertTriangle className="h-4 w-4 text-warning" />
          <AlertTitle>Extraction automatique impossible</AlertTitle>
          <AlertDescription>
            Le fichier a bien été enregistré, mais aucune donnée n'a pu être extraite automatiquement. Complétez les champs manuellement.
            {errorMsg && <div className="mt-1 text-xs opacity-70">Code : {errorMsg.slice(0, 120)}</div>}
          </AlertDescription>
        </Alert>
      )}

      {extracted && status === "ok" && (
        <div className="mt-3 space-y-3">
          <div className="rounded-md border bg-background p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Données détectées
            </div>
            <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
              {rows
                .filter((r) => r.value != null && r.value !== "")
                .map((r) => (
                  <div key={r.label} className="flex justify-between gap-3 border-b border-dashed py-1 last:border-b-0">
                    <dt className="text-muted-foreground">{r.label}</dt>
                    <dd className="text-right font-medium">{String(r.value)}</dd>
                  </div>
                ))}
            </dl>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="default"
              onClick={() => {
                onApply(extracted, "empty");
                toast.success("Champs vides pré-remplis.");
              }}
            >
              <Check className="mr-1 h-4 w-4" />
              Appliquer aux champs vides
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                onApply(extracted, "all");
                toast.success("Tous les champs ont été remplacés.");
              }}
            >
              Tout remplacer
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setExtracted(null);
                setStatus("idle");
                setFileName(null);
              }}
            >
              Ignorer
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

