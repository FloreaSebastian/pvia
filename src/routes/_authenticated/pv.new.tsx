import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import SignaturePad from "react-signature-canvas";
import { z } from "zod";
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
  Search as SearchIcon,
  UserPlus,
  Hammer,
  Phone,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useCompany } from "@/hooks/use-company";
import { useServerFn } from "@tanstack/react-start";
import { createPv } from "@/lib/pv-create.functions";
import { createClient as createClientFn } from "@/lib/clients.functions";
import { createChantier as createChantierFn } from "@/lib/chantiers.functions";
import { extractWorkReferenceDoc } from "@/lib/work-reference.functions";
import { getCompanyBrandingFn } from "@/lib/branding.functions";
import { getPvNumberingSettings } from "@/lib/pv-numbering.functions";
import { sendOnsiteClientOtp, verifyOnsiteClientOtp } from "@/lib/sign-onsite.functions";
import { fileToBase64 } from "@/lib/file-upload";
import { compressImageFile, PHOTO_BASE64_MAX } from "@/lib/image-compress";
import { tryGetGps, readExif, sanitizeExifForUpload } from "@/lib/photo-exif";
import { ClientTypeSelector, ClientFormFields, EMPTY_CLIENT_FORM, type ClientFormState } from "@/components/clients/ClientTypeForm";
import { getCompanyVisualIdentity } from "@/lib/company-visual";

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
  icon_url?: string | null;
};

const PvNewSearchSchema = z.object({
  chantierId: z.string().uuid().optional(),
  fresh: z.union([z.literal("1"), z.literal(1), z.boolean()]).optional(),
  draft: z.union([z.literal("1"), z.literal(1), z.boolean()]).optional(),
});

export const Route = createFileRoute("/_authenticated/pv/new")({
  component: NewPv,
  validateSearch: (s) => PvNewSearchSchema.parse(s),
  head: () => ({ meta: [{ title: "Créer un PV — PVIA" }] }),
});

type ReservePhoto = {
  file: File;
  preview: string;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  takenAt: string | null;
  deviceInfo: string | null;
  exifMetadata: Record<string, any> | null;
  gpsSource: "browser" | "exif" | "none";
};
type Severity = "mineure" | "majeure" | "bloquante";
type Reserve = {
  nature: string;
  description: string;
  work_to_execute: string;
  severity: Severity;
  due_date: string;
  photos: ReservePhoto[];
};


type WorkRefType = "devis" | "bon_commande" | "marche" | "manuel";

const ID_ENTREPRISE = "entreprise";
const ID_CLIENT = "client";
const ID_CHANTIER = "chantier";
const ID_TRAVAUX = "travaux";
const ID_DECISION = "decision";
const ID_RESERVES = "reserves";
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


  const search = Route.useSearch();
  const createClientFnSrv = useServerFn(createClientFn);
  const createChantierFnSrv = useServerFn(createChantierFn);

  const [stepIdx, setStepIdx] = useState(0);
  const [maxStepIdx, setMaxStepIdx] = useState(0);
  const [newClient, setNewClient] = useState<ClientFormState>(EMPTY_CLIENT_FORM);

  const [chantiers, setChantiers] = useState<{
    id: string; name: string; reference: string | null; client_id: string | null;
    address: string | null; postal_code: string | null; city: string | null;
    start_date: string | null; end_date: string | null;
    status: string | null; progress_percent: number | null;
  }[]>([]);
  const [clients, setClients] = useState<{
    id: string; name: string; email: string | null; phone: string | null;
    address: string | null; address_line1: string | null;
    postal_code: string | null; city: string | null;
  }[]>([]);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [branding, setBranding] = useState<Branding | null>(null);
  const [brandingLoading, setBrandingLoading] = useState(true);
  const [numeroPreview, setNumeroPreview] = useState<string | null>(null);

  // Décision (null = pas encore choisi)
  const [withReserves, setWithReserves] = useState<boolean | null>(null);

  const emptyForm = () => ({
    chantier_id: "",
    client_id: "",
    new_client_name: "",
    new_client_email: "",
    new_client_phone: "",
    new_client_address: "",
    new_client_postal_code: "",
    new_client_city: "",
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

  const [form, setForm] = useState(emptyForm);
  // Photos générales du PV : déprécié — les photos sont désormais liées aux réserves.
  const [reserves, setReserves] = useState<Reserve[]>([]);
  const [newReserve, setNewReserve] = useState<Reserve>({
    nature: "",
    description: "",
    work_to_execute: "",
    severity: "mineure",
    due_date: "",
    photos: [],
  });

  // Clef stable côté brouillon pour rattacher les documents importés avant création du PV.
  const [draftKey] = useState(() => `draft-${crypto.randomUUID()}`);

  // UI state — Client / Chantier steps
  const [clientSearch, setClientSearch] = useState("");
  const [showNewClientForm, setShowNewClientForm] = useState(false);
  const [savingNewClient, setSavingNewClient] = useState(false);
  const [chantierSearch, setChantierSearch] = useState("");
  const [creatingChantier, setCreatingChantier] = useState(false);
  const [usedChantierIds, setUsedChantierIds] = useState<Set<string>>(() => new Set());
  const [newChantierSheetOpen, setNewChantierSheetOpen] = useState(false);
  const [newChantier, setNewChantier] = useState({
    name: "",
    type: "",
    client_id: "",
    address: "",
    postal_code: "",
    city: "",
    start_date: "",
    end_date: "",
    status: "planifie" as "preparation" | "planifie" | "en_cours" | "en_attente" | "receptionne" | "termine",
    description: "",
  });

  // Draft prompt dialog
  const [draftPrompt, setDraftPrompt] = useState<{ open: boolean; savedAt: string | null }>({ open: false, savedAt: null });

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

  async function reloadLists() {
    const companyFilter = activeCompanyId;
    const [c, cl, pvs] = await Promise.all([
      supabase.from("chantiers").select("id,name,reference,client_id,address,postal_code,city,start_date,end_date,status,progress_percent").order("name"),
      supabase.from("clients").select("id,name,email,phone,address,address_line1,postal_code,city,client_type,company_name,siret,siren,contact_name").order("name"),
      companyFilter
        ? supabase.from("pv").select("chantier_id").eq("company_id", companyFilter).not("chantier_id", "is", null)
        : Promise.resolve({ data: [] as { chantier_id: string | null }[] }),
    ]);
    setChantiers((c.data as any) ?? []);
    setClients((cl.data as any) ?? []);
    const ids = new Set<string>();
    for (const row of ((pvs as any).data ?? []) as { chantier_id: string | null }[]) {
      if (row.chantier_id) ids.add(row.chantier_id);
    }
    setUsedChantierIds(ids);
  }

  function restoreDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      if (parsed.form) setForm((f) => ({ ...f, ...parsed.form }));
      if (Array.isArray(parsed.reserves)) {
        setReserves(parsed.reserves.map((r: any) => ({
          nature: r.nature ?? "",
          description: r.description ?? "",
          work_to_execute: r.work_to_execute ?? "",
          severity: r.severity ?? "mineure",
          due_date: r.due_date ?? "",
          photos: [],
        })));
      }
      if (typeof parsed.withReserves === "boolean") setWithReserves(parsed.withReserves);
      return true;
    } catch { return false; }
  }

  function clearDraftStorage() {
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
    setLastSaved(null);
  }

  function resetWizard(opts?: { chantierId?: string }) {
    setForm({ ...emptyForm(), chantier_id: opts?.chantierId ?? "" });
    setReserves([]);
    setWithReserves(null);
    setStepIdx(0);
    setMaxStepIdx(0);
    setSignatureMode(null);
    setClientSignatureDataUrl(null);
    setCompanySignatureDataUrl(null);
    setOnsiteOtpEmail("");
    setOnsiteOtpId(null);
    setOnsiteOtpSent(false);
    setOnsiteOtpVerified(false);
    setOnsiteOtpCode("");
  }

  // Suppress autosave during the initial bootstrap so we don't overwrite the
  // freshly cleared/imported state with the empty form values before decisions.
  const bootstrappedRef = useRef(false);

  // Load chantiers/clients + decide draft strategy from search params
  useEffect(() => {
    void reloadLists();

    // Priority: explicit `fresh` → always start blank, clear stored draft
    if (search.fresh) {
      clearDraftStorage();
      // Drop the `fresh` flag from the URL once consumed
      navigate({ to: "/pv/new", search: search.chantierId ? { chantierId: search.chantierId } : {}, replace: true });
      if (search.chantierId) resetWizard({ chantierId: search.chantierId });
      bootstrappedRef.current = true;
      return;
    }

    // Coming from a chantier card → prefill only that chantier, ignore old draft
    if (search.chantierId) {
      clearDraftStorage();
      resetWizard({ chantierId: search.chantierId });
      bootstrappedRef.current = true;
      return;
    }

    // Explicit `?draft=1` → restore silently
    if (search.draft) {
      restoreDraft();
      bootstrappedRef.current = true;
      return;
    }

    // Default: if a draft exists, ask the user what to do
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        let savedAt: string | null = null;
        try {
          const parsed = JSON.parse(raw);
          savedAt = parsed?._savedAt ?? null;
        } catch { /* ignore */ }
        setDraftPrompt({ open: true, savedAt });
        // Do not bootstrap yet — wait for user choice
        return;
      }
    } catch { /* ignore */ }
    bootstrappedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fetch lists when the active company becomes known (or changes), so
  // we know which chantiers already have a PV without doing it at mount only.
  useEffect(() => {
    if (!activeCompanyId) return;
    void reloadLists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCompanyId]);




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

  // Autosave (skipped until bootstrap finished — avoids overwriting a draft
  // before the restore-prompt is answered, or wiping state after a fresh reset)
  useEffect(() => {
    if (!bootstrappedRef.current) return;
    const t = setTimeout(() => {
      try {
        const persistedReserves = reserves.map((r) => ({ ...r, photos: [] }));
        const savedAt = new Date().toISOString();
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ form, reserves: persistedReserves, withReserves, _savedAt: savedAt }));
        setLastSaved(new Date(savedAt));
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

  // Si le chantier sélectionné possède déjà un PV → on l'écarte et on prévient l'utilisateur.
  useEffect(() => {
    if (form.chantier_id && usedChantierIds.has(form.chantier_id)) {
      toast.error("Ce chantier possède déjà un PV. Un seul PV peut être créé par chantier.");
      setForm((f) => ({ ...f, chantier_id: "" }));
    }
  }, [form.chantier_id, usedChantierIds]);


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

  // Note: l'étape "Photos générales" a été supprimée du workflow.
  // Les photos sont désormais uniquement liées à chaque réserve via addReservePhotos.


  function addReserve() {
    if (!newReserve.description.trim() && !newReserve.nature.trim()) {
      toast.error("Indiquez au moins la nature ou la description de la réserve.");
      return;
    }
    if (newReserve.photos.length === 0) {
      toast.error("Ajoutez au moins une photo pour cette réserve.");
      return;
    }
    setReserves((r) => [...r, { ...newReserve, photos: [...newReserve.photos] }]);
    setNewReserve({ nature: "", description: "", work_to_execute: "", severity: "mineure", due_date: "", photos: [] });
  }

  async function compressAndBuild(files: FileList): Promise<ReservePhoto[]> {
    const out: ReservePhoto[] = [];
    let compressedCount = 0;
    let geoCount = 0;
    const browserGps = await tryGetGps();
    const deviceInfo = typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 480) : "";
    for (const file of Array.from(files)) {
      let finalFile = file;
      try {
        const r = await compressImageFile(file);
        finalFile = r.file;
        if (r.compressed) compressedCount += 1;
      } catch { /* fallback to original */ }
      const exif = await readExif(finalFile);
      let latitude = browserGps.latitude;
      let longitude = browserGps.longitude;
      let accuracy = browserGps.accuracy;
      let gpsSource: ReservePhoto["gpsSource"] = browserGps.latitude !== null ? "browser" : "none";
      if (latitude === null && exif) {
        const exLat = typeof exif.latitude === "number" ? (exif.latitude as number) : null;
        const exLng = typeof exif.longitude === "number" ? (exif.longitude as number) : null;
        if (exLat !== null && exLng !== null) {
          latitude = exLat; longitude = exLng; gpsSource = "exif";
          const hpe = (exif as any).GPSHPositioningError;
          accuracy = typeof hpe === "number" ? hpe : null;
        }
      }
      let takenAt: string | null = null;
      const exifDate = exif?.DateTimeOriginal ?? exif?.CreateDate;
      if (exifDate instanceof Date && !isNaN(exifDate.getTime())) takenAt = exifDate.toISOString();
      else if (typeof exifDate === "string") {
        const d = new Date(exifDate); if (!isNaN(d.getTime())) takenAt = d.toISOString();
      }
      if (latitude !== null) geoCount += 1;
      out.push({
        file: finalFile,
        preview: URL.createObjectURL(finalFile),
        latitude, longitude, accuracy,
        takenAt: takenAt ?? new Date().toISOString(),
        deviceInfo,
        exifMetadata: sanitizeExifForUpload(exif ?? null),
        gpsSource,
      });
    }
    if (compressedCount > 0) {
      toast.success(compressedCount === 1 ? "Photo optimisée" : `${compressedCount} photos optimisées`);
    }
    if (out.length > 0 && geoCount < out.length) {
      toast.info(`${out.length - geoCount} photo${out.length - geoCount > 1 ? "s" : ""} sans géolocalisation`);
    }
    return out;
  }

  async function addReservePhotos(files: FileList | null) {
    if (!files || files.length === 0) return;
    const next = await compressAndBuild(files);
    setNewReserve((r) => ({ ...r, photos: [...r.photos, ...next] }));
  }

  function removeNewReservePhoto(idx: number) {
    setNewReserve((r) => ({ ...r, photos: r.photos.filter((_, i) => i !== idx) }));
  }

  function removeReservePhoto(reserveIdx: number, photoIdx: number) {
    setReserves((rs) =>
      rs.map((r, i) =>
        i === reserveIdx ? { ...r, photos: r.photos.filter((_, j) => j !== photoIdx) } : r,
      ),
    );
  }

  async function addPhotosToExistingReserve(reserveIdx: number, files: FileList | null) {
    if (!files || files.length === 0) return;
    const next = await compressAndBuild(files);
    setReserves((rs) =>
      rs.map((r, i) => (i === reserveIdx ? { ...r, photos: [...r.photos, ...next] } : r)),
    );
  }


  function pickDecision(value: boolean) {
    // Si on bascule de "avec réserves" vers "sans réserve" et qu'il y a déjà des données → confirmation
    if (withReserves === true && value === false && reserves.length > 0) {
      if (!confirm("Passer en réception sans réserve va supprimer les réserves déjà saisies. Confirmer ?")) return;
      setReserves([]);
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

      const amount = form.work_reference_amount.trim()
        ? Number(form.work_reference_amount.replace(",", "."))
        : null;

      // Encode reserve photos client-side. Compression a déjà été appliquée à l'ajout ;
      // on vérifie quand même la taille du base64 final pour ne jamais envoyer
      // une image qui ferait échouer la validation serveur.
      let payloadReserves: any[] = [];
      if (withReserves) {
        for (let ri = 0; ri < reserves.length; ri++) {
          const r = reserves[ri];
          const reserveNum = String(ri + 1).padStart(3, "0");
          const encodedReservePhotos = [];
          for (let pi = 0; pi < r.photos.length; pi++) {
            const p = r.photos[pi];
            const base64 = await fileToBase64(p.file);
            if (base64.length > PHOTO_BASE64_MAX) {
              toast.error(
                `Réserve ${ri + 1} : une photo est trop volumineuse. Veuillez reprendre la photo ou choisir une image plus légère.`,
                { duration: 7000 },
              );
              setSaving(false);
              const idx = STEPS.findIndex((s) => s.id === ID_RESERVES);
              if (idx >= 0) setStepIdx(idx);
              return;
            }
            encodedReservePhotos.push({
              base64,
              mimeType: p.file.type || "image/jpeg",
              fileName: p.file.name,
              kind: "reserve" as const,
              caption: "",
              latitude: p.latitude,
              longitude: p.longitude,
              accuracy: p.accuracy,
              takenAt: p.takenAt,
              deviceInfo: p.deviceInfo,
              exifMetadata: p.exifMetadata,
              photoLabel: `RES-${reserveNum}-CONST-${String(pi + 1).padStart(3, "0")}`,
            });
          }
          payloadReserves.push({
            description: r.description || r.nature,
            severity: r.severity === "bloquante" ? "majeure" as const : r.severity,
            status: "ouverte" as const,
            nature: r.nature,
            work_to_execute: r.work_to_execute,
            due_date: r.due_date || null,
            photos: encodedReservePhotos,
          });
        }
      }

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
          reserves: payloadReserves,
          photos: [],
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
      } else if (e?.code === "PHOTO_TOO_LARGE" || /PHOTO_TOO_LARGE|at most 6000000|trop volumineuse/i.test(e?.message ?? "")) {
        toast.error("Une photo de réserve est trop volumineuse. Veuillez reprendre la photo ou choisir une image plus légère.", { duration: 7000 });
        const idx = STEPS.findIndex((s) => s.id === ID_RESERVES);
        if (idx >= 0) setStepIdx(idx);
      } else if (e?.code === "RESERVE_PHOTO_REQUIRED" || /RESERVE_PHOTO_REQUIRED|au moins une photo/i.test(e?.message ?? "")) {
        toast.error(e?.message || "Chaque réserve doit contenir au moins une photo.");
        const idx = STEPS.findIndex((s) => s.id === ID_RESERVES);
        if (idx >= 0) setStepIdx(idx);

      } else if (e?.code === "CHANTIER_ALREADY_HAS_PV" || /CHANTIER_ALREADY_HAS_PV|déjà un PV/i.test(e?.message ?? "")) {
        toast.error(e?.message || "Ce chantier possède déjà un PV. Un seul PV peut être créé par chantier.");
        await reloadLists();
        setForm((f) => ({ ...f, chantier_id: "" }));
        const idx = STEPS.findIndex((s) => s.id === ID_CHANTIER);
        if (idx >= 0) setStepIdx(idx);
      } else {
        toast.error(e?.message || "Échec de la création.");
      }
    } finally {
      setSaving(false);
    }
  }

  // Validation par étape (par id)
  const stepErrors = useMemo<Record<string, string | null>>(() => {
    const selectedClient = clients.find((c) => c.id === form.client_id);
    const clientName = selectedClient?.name?.trim() || form.new_client_name.trim();
    const clientEmail = (selectedClient?.email ?? "").trim() || form.new_client_email.trim();
    let clientError: string | null = null;
    if (!clientName) clientError = "Veuillez sélectionner ou créer un client avant de continuer.";
    else if (signatureMode === "remote" && !clientEmail) clientError = "Email du client requis pour la signature à distance.";

    const cp = form.chantier_postal_code.trim();
    const cpInvalid = cp.length > 0 && !/^\d{4,5}$/.test(cp);
    let chantierError: string | null = null;
    if (!form.chantier_address.trim() || !form.reception_date) chantierError = "Veuillez renseigner l’adresse et la date de réception du chantier.";
    else if (cpInvalid) chantierError = "Code postal invalide.";
    const travauxOk = form.description.trim().length > 0;
    const decisionOk = withReserves !== null;
    const reservesAllHaveContent = reserves.every((r) => (r.description.trim() || r.nature.trim()));
    const reservesAllHavePhotos = reserves.every((r) => r.photos.length > 0);
    let reservesError: string | null = null;
    if (withReserves) {
      if (reserves.length === 0) reservesError = "Ajoutez au moins une réserve.";
      else if (!reservesAllHaveContent) reservesError = "Chaque réserve doit avoir une description ou une nature.";
      else if (!reservesAllHavePhotos) reservesError = "Chaque réserve doit contenir au moins une photo.";
    }
    const reservesOk = reservesError === null;

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
      [ID_CLIENT]: clientError,
      [ID_CHANTIER]: chantierError,
      [ID_TRAVAUX]: travauxOk ? null : "Description des travaux obligatoire.",
      [ID_DECISION]: decisionOk ? null : "Choisissez avec ou sans réserves.",
      [ID_RESERVES]: reservesError,
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
    const reservesPhotosCount = reserves.reduce((acc, r) => acc + r.photos.length, 0);
    const reservesLineFull = reservesLine + (reservesPhotosCount ? ` · ${reservesPhotosCount} photo${reservesPhotosCount > 1 ? "s" : ""}` : "");
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
      [ID_RESERVES]: reservesLineFull,
      [ID_SIGNATURES]: sigParts.join(" · "),
      [ID_APERCU]: "",
    };
  }, [branding, clients, chantiers, form, withReserves, reserves, signatureMode, companySignatureDataUrl, clientSignatureDataUrl, onsiteOtpVerified, onsiteOtpEmail]);

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
        <div className="flex flex-wrap items-center gap-2">
          {lastSaved && (
            <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex">
              <Cloud className="h-3 w-3 text-success" /> Sauvegardé {lastSaved.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            disabled={saving}
            onClick={() => {
              if (!confirm("Supprimer définitivement ce brouillon ? Le formulaire sera réinitialisé.")) return;
              clearDraftStorage();
              resetWizard();
              toast.success("Brouillon supprimé.");
            }}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" /> Supprimer le brouillon
          </Button>
          <Button variant="outline" disabled={saving} onClick={() => onSave("brouillon")}>
            <Save className="h-4 w-4" /> Enregistrer en brouillon
          </Button>
        </div>
      </div>

      {/* Draft restore prompt — shown on entry if a stored draft exists and no explicit override */}
      <Dialog open={draftPrompt.open} onOpenChange={(o) => { if (!o) { bootstrappedRef.current = true; setDraftPrompt((p) => ({ ...p, open: false })); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Brouillon existant</DialogTitle>
            <DialogDescription>
              Un brouillon de PV est sauvegardé{draftPrompt.savedAt ? ` depuis le ${new Date(draftPrompt.savedAt).toLocaleString("fr-FR")}` : ""}.
              Voulez-vous le reprendre ou commencer un nouveau PV ?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="ghost"
              onClick={() => {
                clearDraftStorage();
                setDraftPrompt({ open: false, savedAt: null });
                bootstrappedRef.current = true;
                toast.success("Brouillon supprimé.");
              }}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" /> Supprimer le brouillon
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                clearDraftStorage();
                resetWizard();
                setDraftPrompt({ open: false, savedAt: null });
                bootstrappedRef.current = true;
              }}
            >
              Nouveau PV vide
            </Button>
            <Button
              onClick={() => {
                restoreDraft();
                setDraftPrompt({ open: false, savedAt: null });
                bootstrappedRef.current = true;
              }}
            >
              Reprendre
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card className="overflow-visible p-0">
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
                <div className="space-y-3">
                  {/* PV reference — compact, with copy */}
                  <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-muted/20 px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-mono text-sm font-semibold tracking-tight text-foreground sm:text-base">
                        {numeroPreview ?? "N° à l'enregistrement"}
                      </span>
                      <Badge variant="outline" className="shrink-0 border-border/60 px-1.5 py-0 text-[10px] font-normal text-muted-foreground">
                        Prévisualisation
                      </Badge>
                    </div>
                    {numeroPreview && (
                      <Button
                        type="button" size="sm" variant="ghost"
                        className="h-7 shrink-0 px-2 text-xs text-muted-foreground hover:text-foreground"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(numeroPreview);
                            toast.success("Référence copiée");
                          } catch { toast.error("Copie impossible"); }
                        }}
                      >
                        <Check className="h-3.5 w-3.5" /> Copier
                      </Button>
                    )}
                  </div>

                  {brandingLoading ? (
                    <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
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
                    <motion.div
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.25 }}
                      className="rounded-xl border border-border bg-card p-3"
                    >
                      <div className="flex items-start gap-2.5">
                        {getCompanyVisualIdentity(branding).displayIconUrl ? (
                          <img
                            src={getCompanyVisualIdentity(branding).displayIconUrl!}
                            alt={branding?.name ?? "Entreprise"}
                            className="h-9 w-9 shrink-0 rounded-md border border-border bg-background object-cover"
                          />
                        ) : (
                          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-border bg-background text-muted-foreground">
                            <Building2 className="h-4 w-4" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <h4 className="break-words text-[15px] font-semibold leading-tight">
                            {branding?.name}
                          </h4>
                          <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                            <ShieldCheck className="h-3 w-3" /> Entreprise vérifiée
                          </div>
                        </div>
                      </div>

                      {/* Identifiants */}
                      {(branding?.siret || branding?.siren) && (
                        <div className="mt-2.5 grid grid-cols-2 gap-1.5 text-[11px]">
                          {branding?.siret && (
                            <div className="rounded-md bg-muted/40 px-2 py-1">
                              <div className="text-[9px] uppercase tracking-wide text-muted-foreground">SIRET</div>
                              <div className="font-mono">{branding.siret}</div>
                            </div>
                          )}
                          {branding?.siren && (
                            <div className="rounded-md bg-muted/40 px-2 py-1">
                              <div className="text-[9px] uppercase tracking-wide text-muted-foreground">SIREN</div>
                              <div className="font-mono">{branding.siren}</div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Contact */}
                      <div className="mt-1.5 grid grid-cols-1 gap-0.5 text-[11px] text-muted-foreground sm:grid-cols-2">
                        {branding?.email && (
                          <div className="flex items-center gap-1.5 break-all">
                            <Mail className="h-3 w-3 shrink-0" /> {branding.email}
                          </div>
                        )}
                        {branding?.phone && (
                          <div className="flex items-center gap-1.5">
                            <Phone className="h-3 w-3 shrink-0" /> {branding.phone}
                          </div>
                        )}
                      </div>

                      {/* Adresse */}
                      {(branding?.address_line1 || branding?.address) && (
                        <div className="mt-2 flex items-start gap-1.5 rounded-md bg-muted/30 px-2 py-1.5 text-[11px] leading-snug">
                          <MapPin className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                          <div className="min-w-0 flex-1 whitespace-normal break-words">
                            {branding.address_line1 ? (
                              <>
                                <div>{branding.address_line1}</div>
                                {branding.address_line2 && <div>{branding.address_line2}</div>}
                                <div className="text-muted-foreground">
                                  {[branding.postal_code, branding.city].filter(Boolean).join(" ")}
                                  {branding.country ? ` · ${branding.country}` : ""}
                                </div>
                              </>
                            ) : (
                              <div>{branding.address}</div>
                            )}
                          </div>
                        </div>
                      )}

                      <div className="mt-2 inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Lock className="h-2.5 w-2.5" /> Informations synchronisées
                      </div>
                    </motion.div>
                  )}
                </div>
              )}


              {currentStep.id === ID_CLIENT && (
                <ClientStep
                  clients={clients}
                  clientObj={clientObj ?? null}
                  form={form}
                  setForm={setForm}
                  clientSearch={clientSearch}
                  setClientSearch={setClientSearch}
                  showNewClientForm={showNewClientForm}
                  setShowNewClientForm={setShowNewClientForm}
                  savingNewClient={savingNewClient}
                  newClient={newClient}
                  setNewClient={setNewClient}
                  signatureMode={signatureMode}
                  onCreateClient={async () => {
                    if (!activeCompanyId) { toast.error("Aucune entreprise active."); return; }
                    const isEnt = newClient.client_type === "entreprise";
                    const requiredName = isEnt ? newClient.company_name.trim() : newClient.name.trim();
                    if (!requiredName) {
                      toast.error(isEnt ? "Le nom de la société est obligatoire." : "Le nom du client est obligatoire.");
                      return;
                    }
                    setSavingNewClient(true);
                    try {
                      const res = await createClientFnSrv({
                        data: { companyId: activeCompanyId, data: newClient },
                      });
                      await reloadLists();
                      setForm((f) => ({
                        ...f,
                        client_id: res.id,
                        new_client_name: "", new_client_email: "", new_client_phone: "",
                        new_client_address: "", new_client_postal_code: "", new_client_city: "",
                      }));
                      setNewClient(EMPTY_CLIENT_FORM);
                      setShowNewClientForm(false);
                      toast.success("Client créé et sélectionné");
                    } catch (e: any) {
                      toast.error(e?.message || "Création du client impossible.");
                    } finally {
                      setSavingNewClient(false);
                    }
                  }}
                />
              )}


              {currentStep.id === ID_CHANTIER && (
                <ChantierStep
                  chantiers={chantiers}
                  chantierObj={chantierObj ?? null}
                  clients={clients}
                  form={form}
                  setForm={setForm}
                  chantierSearch={chantierSearch}
                  setChantierSearch={setChantierSearch}
                  creatingChantier={creatingChantier}
                  onCreateChantierFromAddress={async () => {
                    if (!activeCompanyId) { toast.error("Aucune entreprise active."); return; }
                    if (!form.chantier_address.trim()) { toast.error("L'adresse du chantier est requise."); return; }
                    setCreatingChantier(true);
                    try {
                      const res = await createChantierFnSrv({
                        data: {
                          companyId: activeCompanyId,
                          data: {
                            name: form.chantier_address.trim().slice(0, 200),
                            address_line1: form.chantier_address.trim(),
                            postal_code: form.chantier_postal_code.trim(),
                            city: form.chantier_city.trim(),
                            latitude: form.latitude,
                            longitude: form.longitude,
                            status: "en_cours",
                            client_id: form.client_id || null,
                            start_date: form.reception_date || null,
                          },
                        },
                      });
                      await reloadLists();
                      setForm((f) => ({ ...f, chantier_id: res.id }));
                      toast.success(`Chantier créé (${res.reference}).`);
                    } catch (e: any) {
                      toast.error(e?.message || "Création du chantier impossible.");
                    } finally {
                      setCreatingChantier(false);
                    }
                  }}
                />
              )}


              {currentStep.id === ID_TRAVAUX && (
                <>
                  <SectionHeader icon={ClipboardList} title="Travaux & référence" desc="Devis, bon de commande ou marché à l'origine des travaux." />

                  <WorkReferenceImport
                    companyId={activeCompanyId}
                    draftKey={draftKey}
                    extractFn={extractWorkRefFn}
                    currentValues={{
                      document_type: form.work_reference_type === "manuel" ? "" : form.work_reference_type,
                      document_number: form.work_reference_number,
                      document_date: form.work_reference_date,
                      amount_ttc: form.work_reference_amount,
                      amount_ht: "",
                      vat_amount: "",
                      client_name: form.new_client_name,
                      client_email: form.new_client_email,
                      client_phone: "",
                      chantier_address: form.chantier_address,
                      chantier_postal_code: form.chantier_postal_code,
                      chantier_city: form.chantier_city,
                      description: form.description,
                    }}
                    applyDetected={(updates) => {
                      setForm((f) => {
                        const next = { ...f };
                        for (const [k, v] of Object.entries(updates)) {
                          if (v == null) continue;
                          switch (k) {
                            case "document_type":
                              if (["devis", "bon_commande", "marche"].includes(v))
                                next.work_reference_type = v as WorkRefType;
                              break;
                            case "document_number": next.work_reference_number = String(v); break;
                            case "document_date": next.work_reference_date = String(v); break;
                            case "amount_ttc": next.work_reference_amount = String(v); break;
                            case "client_name": next.new_client_name = String(v); break;
                            case "client_email": next.new_client_email = String(v); break;
                            case "chantier_address": next.chantier_address = String(v); break;
                            case "chantier_postal_code": next.chantier_postal_code = String(v); break;
                            case "chantier_city": next.chantier_city = String(v); break;
                            case "description": next.description = String(v); break;
                            // amount_ht, vat_amount, client_phone: pas de champ formulaire mappé
                          }
                        }
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
                        <Button type="button" onClick={addReserve} disabled={newReserve.photos.length === 0}>
                          <Plus className="h-4 w-4" /> Ajouter la réserve
                        </Button>
                      </div>
                    </div>

                    {/* Photos de la réserve (obligatoires) */}
                    <div className="rounded-lg border border-dashed border-border bg-background/60 p-3 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Camera className="h-4 w-4 text-primary" />
                          <span className="text-sm font-medium">Photos de la réserve</span>
                          <Badge variant="destructive" className="text-[10px]">Obligatoire</Badge>
                        </div>
                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent">
                          <Upload className="h-3.5 w-3.5" /> Ajouter photos
                          <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            multiple
                            className="hidden"
                            onChange={(e) => { addReservePhotos(e.target.files); e.target.value = ""; }}
                          />
                        </label>
                      </div>
                      {newReserve.photos.length === 0 ? (
                        <p className="text-xs text-warning">Ajoutez au moins une photo pour cette réserve.</p>
                      ) : (
                        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                          {newReserve.photos.map((p, i) => (
                            <div key={i} className="relative aspect-square overflow-hidden rounded-md border border-border bg-muted">
                              <img src={p.preview} alt="" className="h-full w-full object-cover" />
                              <div className="absolute left-1 top-1 rounded bg-black/70 px-1 py-0.5 font-mono text-[9px] text-white">
                                CONST-{String(i + 1).padStart(3, "0")}
                              </div>
                              <div className="absolute bottom-1 left-1 rounded bg-black/60 px-1 py-0.5 text-[9px] text-white">
                                {p.latitude !== null ? (p.accuracy ? `GPS ±${Math.round(p.accuracy)}m` : "GPS") : "Non géo."}
                              </div>
                              <button
                                type="button"
                                onClick={() => removeNewReservePhoto(i)}
                                className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-md bg-background/90 shadow"
                                aria-label="Supprimer la photo"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  {reserves.length > 0 ? (
                    <ul className="space-y-2">
                      {reserves.map((r, i) => (
                        <li key={i} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 text-sm shadow-sm">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex flex-1 items-start gap-3">
                              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-muted text-xs font-semibold">{i + 1}</span>
                              <div className="flex-1 min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="font-medium">{r.nature || "Réserve"}</p>
                                  <Badge variant={r.severity === "mineure" ? "secondary" : "destructive"}>{r.severity}</Badge>
                                  {r.due_date && <Badge variant="outline" className="gap-1"><CalendarDays className="h-3 w-3" /> {r.due_date}</Badge>}
                                  <Badge variant="outline" className="gap-1"><Camera className="h-3 w-3" /> {r.photos.length}</Badge>
                                  {r.photos.some((p) => p.latitude !== null) ? (
                                    <Badge variant="outline" className="gap-1 text-emerald-700 border-emerald-300"><MapPin className="h-3 w-3" /> Géolocalisée</Badge>
                                  ) : (
                                    <Badge variant="outline" className="gap-1 text-amber-700 border-amber-300">Non géolocalisée</Badge>
                                  )}
                                </div>
                                {r.description && <p className="mt-1 text-muted-foreground">{r.description}</p>}
                                {r.work_to_execute && <p className="mt-1 text-xs"><span className="font-medium">Travaux :</span> {r.work_to_execute}</p>}
                              </div>
                            </div>
                            <Button size="icon" variant="ghost" onClick={() => setReserves(reserves.filter((_, j) => j !== i))}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 pl-10">
                            {r.photos.map((p, pi) => (
                              <div key={pi} className="relative h-16 w-16 overflow-hidden rounded-md border border-border bg-muted" title={`RES-${String(i + 1).padStart(3, "0")}-CONST-${String(pi + 1).padStart(3, "0")}`}>
                                <img src={p.preview} alt="" className="h-full w-full object-cover" />
                                <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-0.5 text-center font-mono text-[8px] leading-tight text-white">
                                  CONST-{String(pi + 1).padStart(3, "0")}
                                </div>
                                {p.latitude === null && (
                                  <div className="absolute left-0.5 top-0.5 rounded bg-amber-500/90 px-1 text-[8px] font-medium text-white">!</div>
                                )}
                                <button
                                  type="button"
                                  onClick={() => removeReservePhoto(i, pi)}
                                  className="absolute right-0.5 top-0.5 grid h-5 w-5 place-items-center rounded bg-background/90 shadow"
                                  aria-label="Supprimer"
                                >
                                  <X className="h-2.5 w-2.5" />
                                </button>
                              </div>
                            ))}
                            <label className="inline-flex h-16 w-16 cursor-pointer items-center justify-center rounded-md border border-dashed border-border bg-background hover:bg-accent">
                              <Plus className="h-4 w-4 text-muted-foreground" />
                              <input
                                type="file"
                                accept="image/*"
                                capture="environment"
                                multiple
                                className="hidden"
                                onChange={(e) => { addPhotosToExistingReserve(i, e.target.files); e.target.value = ""; }}
                              />
                            </label>
                          </div>
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

        <div className="sticky bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-30 flex items-center justify-between gap-2 border-t border-border bg-background/95 p-3 backdrop-blur supports-[backdrop-filter]:bg-background/75 sm:p-4 lg:static lg:bottom-auto lg:bg-muted/20 lg:backdrop-blur-0">
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

type FieldKey =
  | "document_type"
  | "document_number"
  | "document_date"
  | "amount_ht"
  | "vat_amount"
  | "amount_ttc"
  | "client_name"
  | "client_email"
  | "client_phone"
  | "chantier_address"
  | "chantier_postal_code"
  | "chantier_city"
  | "description";

const FIELD_LABELS: Record<FieldKey, string> = {
  document_type: "Type document",
  document_number: "Numéro document",
  document_date: "Date document",
  amount_ht: "Montant HT",
  vat_amount: "TVA",
  amount_ttc: "Montant TTC",
  client_name: "Nom client",
  client_email: "Email client",
  client_phone: "Téléphone client",
  chantier_address: "Adresse chantier",
  chantier_postal_code: "Code postal",
  chantier_city: "Ville",
  description: "Description travaux",
};

const FIELD_ORDER: FieldKey[] = [
  "document_type", "document_number", "document_date",
  "amount_ht", "vat_amount", "amount_ttc",
  "client_name", "client_email", "client_phone",
  "chantier_address", "chantier_postal_code", "chantier_city",
  "description",
];

// Fields the form cannot write back to (display-only, no apply action).
const READONLY_FIELDS = new Set<FieldKey>(["amount_ht", "vat_amount", "client_phone"]);

function formatDetected(key: FieldKey, raw: unknown): string {
  if (raw == null || raw === "") return "";
  if (key === "document_type") {
    const m: Record<string, string> = {
      devis: "Devis", bon_commande: "Bon de commande",
      marche: "Marché / Contrat", autre: "Autre",
    };
    return m[String(raw)] ?? String(raw);
  }
  if (key === "amount_ht" || key === "vat_amount" || key === "amount_ttc") {
    const n = Number(raw);
    return isNaN(n) ? String(raw) : `${n.toFixed(2)} €`;
  }
  if (key === "description") {
    const s = String(raw);
    return s.length > 140 ? s.slice(0, 140) + "…" : s;
  }
  return String(raw);
}

function WorkReferenceImport(props: {
  companyId: string | null;
  draftKey: string;
  extractFn: (args: { data: any }) => Promise<any>;
  currentValues: Record<FieldKey, string>;
  applyDetected: (updates: Partial<Record<FieldKey, string>>) => void;
}) {
  const { companyId, draftKey, extractFn, currentValues, applyDetected } = props;
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<Record<FieldKey, unknown> | null>(null);
  const [docId, setDocId] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "ok" | "failed">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [appliedSet, setAppliedSet] = useState<Set<FieldKey>>(new Set());
  const [ignoredSet, setIgnoredSet] = useState<Set<FieldKey>>(new Set());

  // Persist applied/ignored choices server-side (debounced).
  const persistChoices = async (applied: Set<FieldKey>, ignored: Set<FieldKey>) => {
    if (!docId) return;
    try {
      const { applyWorkReferenceFields } = await import("@/lib/work-reference.functions");
      await applyWorkReferenceFields({
        data: {
          documentId: docId,
          appliedFields: Array.from(applied),
          ignoredFields: Array.from(ignored),
        },
      });
    } catch {
      // non bloquant
    }
  };

  const handleFile = async (file: File) => {
    if (!companyId) { toast.error("Aucune entreprise active."); return; }
    const allowed = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
    if (!allowed.includes(file.type)) {
      toast.error("Format non supporté. PDF, PNG, JPG ou WebP uniquement."); return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Fichier trop volumineux (max 10 Mo)."); return;
    }
    setBusy(true); setStatus("uploading"); setFileName(file.name);
    setErrorMsg(null); setExtracted(null); setDocId(null);
    setAppliedSet(new Set()); setIgnoredSet(new Set());
    try {
      const base64 = await fileToBase64(file);
      const dataUrl = `data:${file.type || "application/octet-stream"};base64,${base64}`;
      const res = await extractFn({
        data: { companyId, draftKey, fileName: file.name, mimeType: file.type, dataUrl },
      });
      if (res?.document?.id) setDocId(res.document.id);
      if (res?.extracted) {
        const extractedData = res.extracted as Record<FieldKey, unknown>;
        setExtracted(extractedData);
        setConfidence(res.document?.extraction_confidence ?? null);
        setStatus("ok");

        // Auto-fill empty fields immediately (no confirmation required).
        const autoUpdates: Partial<Record<FieldKey, string>> = {};
        const autoApplied = new Set<FieldKey>();
        for (const key of FIELD_ORDER) {
          if (READONLY_FIELDS.has(key)) continue;
          const raw = (extractedData as any)[key];
          if (raw == null || raw === "") continue;
          const current = (currentValues[key] ?? "").trim();
          if (current) continue; // conflict → keep for comparison UI
          autoUpdates[key] = String(raw);
          autoApplied.add(key);
        }
        if (Object.keys(autoUpdates).length > 0) {
          applyDetected(autoUpdates);
          setAppliedSet(autoApplied);
          void persistChoices(autoApplied, new Set());
        }

        const conflicts = FIELD_ORDER.filter((k) => {
          if (READONLY_FIELDS.has(k)) return false;
          const raw = (extractedData as any)[k];
          if (raw == null || raw === "") return false;
          const current = (currentValues[k] ?? "").trim();
          return current && current !== String(raw).trim();
        }).length;

        if (conflicts > 0) {
          toast.success(`Document analysé. ${conflicts} champ(s) déjà rempli(s) à vérifier.`);
        } else {
          toast.success("Document analysé. Champs pré-remplis automatiquement.");
        }
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

  type Row = {
    key: FieldKey;
    label: string;
    current: string;
    detected: string;
    detectedRaw: string;
    readOnly: boolean;
    tone: "neutral" | "fill" | "diff";
  };
  const rows: Row[] = extracted
    ? FIELD_ORDER.flatMap<Row>((key) => {
        const raw = (extracted as any)[key];
        const detected = formatDetected(key, raw);
        if (!detected) return [];
        const current = currentValues[key] ?? "";
        // Only show rows where there is a real conflict (existing value ≠ detected)
        // or read-only display rows. Empty fields are auto-filled silently.
        const isReadOnly = READONLY_FIELDS.has(key);
        const hasConflict = current.trim() && current.trim() !== String(raw).trim();
        if (!isReadOnly && !hasConflict) return [];
        const tone: Row["tone"] = hasConflict ? "diff" : "neutral";
        return [{
          key, label: FIELD_LABELS[key], current, detected,
          detectedRaw: String(raw), readOnly: isReadOnly, tone,
        }];
      })
    : [];

  const replaceOne = (r: Row) => {
    if (r.readOnly) return;
    applyDetected({ [r.key]: r.detectedRaw } as Partial<Record<FieldKey, string>>);
    const a = new Set(appliedSet); a.add(r.key);
    const i = new Set(ignoredSet); i.delete(r.key);
    setAppliedSet(a); setIgnoredSet(i);
    void persistChoices(a, i);
  };
  const ignoreOne = (r: Row) => {
    const i = new Set(ignoredSet); i.add(r.key);
    const a = new Set(appliedSet); a.delete(r.key);
    setAppliedSet(a); setIgnoredSet(i);
    void persistChoices(a, i);
  };

  const applyAll = (mode: "all" | "empty") => {
    const updates: Partial<Record<FieldKey, string>> = {};
    const a = new Set(appliedSet);
    for (const r of rows) {
      if (r.readOnly) continue;
      if (mode === "empty" && r.current.trim()) continue;
      updates[r.key] = r.detectedRaw;
      a.add(r.key);
    }
    applyDetected(updates);
    setAppliedSet(a);
    void persistChoices(a, ignoredSet);
    toast.success(mode === "empty" ? "Champs vides pré-remplis." : "Tous les champs ont été remplacés.");
  };
  const ignoreAll = () => {
    const i = new Set(ignoredSet);
    for (const r of rows) if (!r.readOnly) i.add(r.key);
    setIgnoredSet(i);
    void persistChoices(appliedSet, i);
    toast.message("Toutes les suggestions ont été ignorées.");
  };

  return (
    <Card className="border-dashed bg-muted/30 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Upload className="h-4 w-4 text-primary" />
            Importer un devis, bon de commande ou marché
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            PDF ou image (PNG/JPG/WebP), 10 Mo max. Les champs vides sont remplis automatiquement ; en cas de valeur existante, un comparatif s'affiche.
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
            Le fichier a bien été enregistré, mais aucune donnée n'a pu être extraite. Complétez les champs manuellement.
            {errorMsg && <div className="mt-1 text-xs opacity-70">Code : {errorMsg.slice(0, 120)}</div>}
          </AlertDescription>
        </Alert>
      )}

      {extracted && status === "ok" && rows.length > 0 && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="default" onClick={() => applyAll("empty")}>
              <Check className="mr-1 h-4 w-4" /> Appliquer aux champs vides
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => applyAll("all")}>
              Tout remplacer
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={ignoreAll}>
              Tout ignorer
            </Button>
          </div>

          <div className="overflow-x-auto rounded-md border bg-background">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Champ</th>
                  <th className="px-3 py-2 text-left font-semibold">Valeur actuelle</th>
                  <th className="px-3 py-2 text-left font-semibold">Valeur détectée</th>
                  <th className="px-3 py-2 text-right font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isApplied = appliedSet.has(r.key);
                  const isIgnored = ignoredSet.has(r.key);
                  const bg =
                    isApplied ? "bg-success/5"
                    : isIgnored ? "bg-muted/30 opacity-60"
                    : r.tone === "diff" ? "bg-warning/10"
                    : r.tone === "fill" ? "bg-success/10"
                    : "";
                  return (
                    <tr key={r.key} className={`border-t ${bg}`}>
                      <td className="px-3 py-2 align-top font-medium">{r.label}</td>
                      <td className="px-3 py-2 align-top text-muted-foreground">
                        {r.current.trim() ? r.current : <span className="italic opacity-60">— vide —</span>}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <span className="font-medium">{r.detected}</span>
                        {r.readOnly && (
                          <div className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                            Non modifiable dans le formulaire
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right align-top">
                        {r.readOnly ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : isApplied ? (
                          <span className="inline-flex items-center gap-1 text-xs text-success">
                            <Check className="h-3 w-3" /> Appliqué
                          </span>
                        ) : isIgnored ? (
                          <Button type="button" size="sm" variant="ghost" onClick={() => replaceOne(r)}>
                            Remplacer
                          </Button>
                        ) : (
                          <div className="inline-flex gap-1">
                            <Button type="button" size="sm" variant="default" onClick={() => replaceOne(r)}>
                              Remplacer
                            </Button>
                            <Button type="button" size="sm" variant="ghost" onClick={() => ignoreOne(r)}>
                              Ignorer
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Conflits uniquement : ces champs contiennent déjà une valeur différente du document. Choisissez de remplacer ou d'ignorer. Les champs vides ont été remplis automatiquement.
          </p>
        </div>
      )}
    </Card>
  );
}


/* ────────────────────────────────────────────────────────────────────────── */
/*  Sous-étape — Client signataire                                           */
/* ────────────────────────────────────────────────────────────────────────── */

type ClientRow = {
  id: string; name: string; email: string | null; phone: string | null;
  address: string | null; address_line1: string | null;
  postal_code: string | null; city: string | null;
  client_type?: "particulier" | "entreprise" | null;
  company_name?: string | null; siret?: string | null; siren?: string | null;
  contact_name?: string | null;
};


type ChantierRow = {
  id: string; name: string; reference: string | null; client_id: string | null;
  address: string | null; postal_code: string | null; city: string | null;
  start_date: string | null; end_date: string | null;
  status: string | null; progress_percent: number | null;
};

function ClientStep(props: {
  clients: ClientRow[];
  clientObj: ClientRow | null;
  form: any;
  setForm: React.Dispatch<React.SetStateAction<any>>;
  clientSearch: string;
  setClientSearch: (s: string) => void;
  showNewClientForm: boolean;
  setShowNewClientForm: (b: boolean) => void;
  savingNewClient: boolean;
  newClient: ClientFormState;
  setNewClient: React.Dispatch<React.SetStateAction<ClientFormState>>;
  signatureMode: "remote" | "onsite" | null;
  onCreateClient: () => void;
}) {
  const { clients, clientObj, form, setForm, clientSearch, setClientSearch, showNewClientForm, setShowNewClientForm, savingNewClient, newClient, setNewClient, signatureMode, onCreateClient } = props;

  const q = clientSearch.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return clients.slice(0, 50);
    if (q.length < 2) return clients.slice(0, 50);
    return clients.filter((c) => {
      const hay = [
        c.name, c.company_name, c.email, c.phone, c.city,
        c.siret, c.siren, c.contact_name,
      ].map((v) => (v ?? "").toLowerCase()).join(" | ");
      return hay.includes(q);
    }).slice(0, 50);
  }, [clients, q]);

  const isEntrepriseClient = clientObj?.client_type === "entreprise";
  const displayName = isEntrepriseClient ? (clientObj?.company_name || clientObj?.name) : clientObj?.name;
  const needsEmailForRemote = signatureMode === "remote" && clientObj && !clientObj.email;

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Étape 2/7 · Client</div>
        <h2 className="mt-1 text-lg font-semibold tracking-tight">Client du procès-verbal</h2>
      </div>

      {signatureMode === "remote" && (
        <Badge variant="outline" className="border-amber-300 bg-amber-50 text-[11px] font-normal text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <Mail className="h-3 w-3" /> Email requis pour signature à distance
        </Badge>
      )}

      {clientObj ? (
        <Card className="border-primary/40 bg-primary/5 p-3 sm:p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                {isEntrepriseClient ? (
                  <Building2 className="h-4 w-4 shrink-0 text-primary" />
                ) : (
                  <User className="h-4 w-4 shrink-0 text-primary" />
                )}
                <span className="min-w-0 break-words text-base font-semibold">{displayName}</span>
                <Badge variant="secondary" className="shrink-0 text-[10px]">
                  {isEntrepriseClient ? "Entreprise" : "Particulier"}
                </Badge>
              </div>
              {isEntrepriseClient && clientObj.siret && (
                <div className="text-xs text-muted-foreground">
                  SIRET : <span className="font-mono">{clientObj.siret}</span>
                </div>
              )}
              {isEntrepriseClient && clientObj.contact_name && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <User className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">Contact : {clientObj.contact_name}</span>
                </div>
              )}
              {clientObj.email && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Mail className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{clientObj.email}</span>
                </div>
              )}
              {clientObj.phone && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Phone className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{clientObj.phone}</span>
                </div>
              )}
              {(clientObj.address || clientObj.address_line1 || clientObj.city) && (
                <div className="flex items-start gap-2 text-sm text-muted-foreground">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 break-words">
                    {[clientObj.address_line1 || clientObj.address, [clientObj.postal_code, clientObj.city].filter(Boolean).join(" ")].filter(Boolean).join(" — ")}
                  </span>
                </div>
              )}
            </div>
            <Button size="sm" variant="ghost" onClick={() => setForm((f: any) => ({ ...f, client_id: "" }))}>
              <X className="h-4 w-4" /> Changer
            </Button>
          </div>

          {needsEmailForRemote && (
            <Alert className="mt-3 border-amber-300 bg-amber-50/60 dark:bg-amber-950/30">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertTitle className="text-sm">Email manquant pour signature à distance</AlertTitle>
              <AlertDescription className="text-xs">
                Ce client n'a pas d'email enregistré. Modifiez sa fiche pour permettre l'envoi du lien de signature.
              </AlertDescription>
            </Alert>
          )}
        </Card>
      ) : (
        <Card className="border-dashed border-border bg-muted/20 p-4 text-center text-sm text-muted-foreground">
          Aucun client sélectionné — sélectionnez un client existant ou créez-en un nouveau.
        </Card>
      )}

      {!clientObj && (
        <div className="space-y-3">
          <div className="sticky top-0 z-10 -mx-1 bg-background/95 px-1 py-1 backdrop-blur">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={clientSearch}
                onChange={(e) => setClientSearch(e.target.value)}
                placeholder="Rechercher : nom, société, email, téléphone, SIRET..."
                className="pl-9"
                inputMode="search"
                autoComplete="off"
              />
            </div>
          </div>

          <div className="max-h-[22rem] space-y-2 overflow-y-auto pr-0.5">
            {filtered.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-background p-6 text-center text-sm text-muted-foreground">
                Aucun client trouvé.
              </div>
            ) : (
              <AnimatePresence initial={false}>
                {filtered.map((c, i) => {
                  const ent = c.client_type === "entreprise";
                  const dn = ent ? (c.company_name || c.name) : c.name;
                  return (
                    <motion.button
                      key={c.id}
                      type="button"
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.16, delay: Math.min(i * 0.015, 0.15) }}
                      onClick={() => {
                        setForm((f: any) => ({ ...f, client_id: c.id }));
                        toast.success("Client sélectionné");
                      }}
                      className="block w-full rounded-xl border border-border bg-card p-3 text-left transition hover:border-primary/40 hover:bg-muted/40"
                    >
                      <div className="flex items-start gap-2.5">
                        <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${ent ? "bg-indigo-500/10 text-indigo-600" : "bg-emerald-500/10 text-emerald-600"}`}>
                          {ent ? <Building2 className="h-4 w-4" /> : <User className="h-4 w-4" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="min-w-0 break-words text-sm font-semibold">{dn || "—"}</span>
                            <Badge variant="secondary" className="shrink-0 text-[10px]">{ent ? "Entreprise" : "Particulier"}</Badge>
                          </div>
                          {ent && c.siret && (
                            <div className="mt-0.5 text-[11px] text-muted-foreground">
                              SIRET <span className="font-mono">{c.siret}</span>
                            </div>
                          )}
                          {ent && c.contact_name && (
                            <div className="mt-0.5 text-[11px] text-muted-foreground">Contact : {c.contact_name}</div>
                          )}
                          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                            {[c.email, c.phone, c.city].filter(Boolean).join(" · ") || "—"}
                          </div>
                        </div>
                        <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                      </div>
                    </motion.button>
                  );
                })}
              </AnimatePresence>
            )}
          </div>

          <Button
            type="button"
            variant={showNewClientForm ? "outline" : "default"}
            onClick={() => setShowNewClientForm(!showNewClientForm)}
            className="w-full"
          >
            <UserPlus className="h-4 w-4" />
            {showNewClientForm ? "Annuler" : "Créer un nouveau client"}
          </Button>

          {showNewClientForm && (
            <div className="space-y-3 rounded-xl border border-dashed border-border bg-muted/20 p-3 sm:p-4">
              <div className="space-y-1.5">
                <Label className="text-xs uppercase text-muted-foreground">Type de client</Label>
                <ClientTypeSelector
                  value={newClient.client_type}
                  onChange={(v) => setNewClient({ ...newClient, client_type: v })}
                />
              </div>
              <ClientFormFields form={newClient} setForm={setNewClient} compact />
              <Button
                type="button"
                onClick={onCreateClient}
                disabled={
                  savingNewClient ||
                  (newClient.client_type === "entreprise"
                    ? !newClient.company_name.trim()
                    : !newClient.name.trim())
                }
                className="w-full"
              >
                {savingNewClient ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Enregistrer et sélectionner ce client
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


/* ────────────────────────────────────────────────────────────────────────── */
/*  Sous-étape — Chantier concerné                                           */
/* ────────────────────────────────────────────────────────────────────────── */

function ChantierStep(props: {
  chantiers: ChantierRow[];
  chantierObj: ChantierRow | null;
  clients: ClientRow[];
  form: any;
  setForm: React.Dispatch<React.SetStateAction<any>>;
  chantierSearch: string;
  setChantierSearch: (s: string) => void;
  creatingChantier: boolean;
  onCreateChantierFromAddress: () => void;
}) {
  const { chantiers, chantierObj, clients, form, setForm, chantierSearch, setChantierSearch, creatingChantier, onCreateChantierFromAddress } = props;
  const q = chantierSearch.trim().toLowerCase();
  const clientName = (id: string | null) => {
    const c = clients.find((cl) => cl.id === id);
    if (!c) return "";
    return c.client_type === "entreprise" ? (c.company_name || c.name) : c.name;
  };
  const filtered = useMemo(() => {
    if (!q || q.length < 2) return chantiers.slice(0, 50);
    return chantiers.filter((c) =>
      c.name.toLowerCase().includes(q) ||
      (c.reference ?? "").toLowerCase().includes(q) ||
      (c.address ?? "").toLowerCase().includes(q) ||
      (c.city ?? "").toLowerCase().includes(q) ||
      (c.status ?? "").toLowerCase().includes(q) ||
      clientName(c.client_id).toLowerCase().includes(q),
    ).slice(0, 50);
  }, [chantiers, clients, q]);

  const hasChantier = !!chantierObj;
  const cpInvalid = form.chantier_postal_code && !/^\d{5}$/.test(form.chantier_postal_code.trim());

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Étape 3/7 · Chantier</div>
        <h2 className="mt-1 text-lg font-semibold tracking-tight">Lieu de réception des travaux</h2>
      </div>

      {hasChantier ? (
        <Card className="border-primary/40 bg-primary/5 p-3 sm:p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <Hammer className="h-4 w-4 shrink-0 text-primary" />
                {chantierObj!.reference && (
                  <Badge variant="outline" className="font-mono text-xs">{chantierObj!.reference}</Badge>
                )}
                <span className="min-w-0 break-words text-base font-semibold">{chantierObj!.name}</span>
              </div>
              {chantierObj!.status && (
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="secondary" className="text-xs">{chantierObj!.status}</Badge>
                  {typeof chantierObj!.progress_percent === "number" && (
                    <Badge variant="outline" className="text-xs">Avancement {chantierObj!.progress_percent}%</Badge>
                  )}
                </div>
              )}
              {chantierObj!.address && (
                <div className="flex items-start gap-2 text-sm text-muted-foreground">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 break-words">{[chantierObj!.address, [chantierObj!.postal_code, chantierObj!.city].filter(Boolean).join(" ")].filter(Boolean).join(" — ")}</span>
                </div>
              )}
              {chantierObj!.client_id && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <User className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">Client : {clientName(chantierObj!.client_id)}</span>
                </div>
              )}
              {(chantierObj!.start_date || chantierObj!.end_date) && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">
                    Début {chantierObj!.start_date ?? "—"} · Fin {chantierObj!.end_date ?? "—"}
                  </span>
                </div>
              )}
            </div>
            <Button size="sm" variant="ghost" onClick={() => setForm((f: any) => ({ ...f, chantier_id: "" }))}>
              <X className="h-4 w-4" /> Changer
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="border-dashed border-border bg-muted/20 p-4 text-center text-sm text-muted-foreground">
          Aucun chantier sélectionné — sélectionnez un chantier existant ou créez-en un nouveau.
        </Card>
      )}

      {!hasChantier && (
        <div className="space-y-3">
          <div className="sticky top-0 z-10 -mx-1 bg-background/95 px-1 py-1 backdrop-blur">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={chantierSearch}
                onChange={(e) => setChantierSearch(e.target.value)}
                placeholder="Rechercher : référence, nom, adresse, client..."
                className="pl-9"
                inputMode="search"
                autoComplete="off"
              />
            </div>
          </div>

          <div className="max-h-[22rem] space-y-2 overflow-y-auto pr-0.5">
            {filtered.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-background p-6 text-center text-sm text-muted-foreground">
                Aucun chantier trouvé.
              </div>
            ) : (
              <AnimatePresence initial={false}>
                {filtered.map((c, i) => (
                  <motion.button
                    key={c.id}
                    type="button"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.16, delay: Math.min(i * 0.015, 0.15) }}
                    onClick={() => {
                      setForm((f: any) => ({ ...f, chantier_id: c.id }));
                      toast.success("Chantier sélectionné");
                    }}
                    className="block w-full rounded-xl border border-border bg-card p-3 text-left transition hover:border-primary/40 hover:bg-muted/40"
                  >
                    <div className="flex items-start gap-2.5">
                      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                        <Hammer className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {c.reference && <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">{c.reference}</span>}
                          <span className="min-w-0 break-words text-sm font-semibold">{c.name}</span>
                          {c.status && <Badge variant="secondary" className="shrink-0 text-[10px]">{c.status}</Badge>}
                        </div>
                        {(c.city || c.client_id) && (
                          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                            {[c.city, clientName(c.client_id) && `Client : ${clientName(c.client_id)}`].filter(Boolean).join(" · ")}
                          </div>
                        )}
                        {(c.start_date || c.end_date) && (
                          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                            {c.start_date ?? "—"} → {c.end_date ?? "—"}
                          </div>
                        )}
                      </div>
                      <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                    </div>
                  </motion.button>
                ))}
              </AnimatePresence>
            )}
          </div>
        </div>
      )}

      {/* Adresse de réception (toujours visible — pré-remplie depuis le chantier, modifiable pour le PV) */}
      <div className="space-y-3 rounded-xl border border-border bg-muted/10 p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-medium">Adresse de réception utilisée dans ce PV</div>
          {hasChantier && form.client_id && (
            <Badge variant="outline" className="text-[10px]">Client lié</Badge>
          )}
        </div>
        <Field label="Adresse du chantier *">
          <AddressAutocomplete
            value={form.chantier_address}
            onChange={(v) => setForm((f: any) => ({ ...f, chantier_address: v }))}
            onSelect={(a: AddressValue) => setForm((f: any) => ({
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
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Code postal">
            <Input value={form.chantier_postal_code} onChange={(e) => setForm({ ...form, chantier_postal_code: e.target.value })} placeholder="06400" inputMode="numeric" />
            {cpInvalid && (
              <p className="mt-1 text-[11px] text-amber-600">Code postal invalide (5 chiffres attendus).</p>
            )}
          </Field>
          <Field label="Ville">
            <Input value={form.chantier_city} onChange={(e) => setForm({ ...form, chantier_city: e.target.value })} placeholder="Cannes" />
          </Field>
          <Field label="Date de réception *">
            <Input type="date" value={form.reception_date} onChange={(e) => setForm({ ...form, reception_date: e.target.value })} />
          </Field>
        </div>
        {hasChantier && (
          <p className="text-[11px] text-muted-foreground">
            Cette adresse n'est utilisée que pour ce PV. Pour modifier la fiche chantier, ouvrez-la et utilisez « Modifier ».
          </p>
        )}
        {!hasChantier && (
          <Button
            type="button"
            variant="outline"
            onClick={onCreateChantierFromAddress}
            disabled={creatingChantier || !form.chantier_address.trim()}
            className="w-full sm:w-auto"
          >
            {creatingChantier ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Créer un chantier avec ces informations
          </Button>
        )}
      </div>
    </div>
  );
}



