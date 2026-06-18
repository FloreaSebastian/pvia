/**
 * Reserve Lift Workflow popup — Phase 1 refactor.
 *
 * - Single intervenant signature (auto-filled from session — name, role, email)
 * - "Constat initial" read-only step replaces the old "Photos avant" step:
 *   the photos taken when the reserve was created (pv_photos.reserve_id) are
 *   shown automatically. Technicians no longer re-shoot the same photos.
 * - Validation mode selector: on-site (client signs in the popup) vs remote
 *   (an email is sent to the client after finalization).
 * - Backward compat: legacy company/technician signature columns are still
 *   populated server-side. OTP for client signature is Phase 2.
 */
import { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import SignaturePad from "react-signature-canvas";
import { useServerFn } from "@tanstack/react-start";
import {
  ChevronLeft, ChevronRight, Loader2, MapPin, MapPinOff, X,
  Camera, FileSignature, Send, Check, Eye, Mail, UserCheck,
} from "lucide-react";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/hooks/use-auth";
import { useCompany } from "@/hooks/use-company";
import { supabase } from "@/integrations/supabase/client";
import { createReserveLift, listReserveLiftPhotos } from "@/lib/reserve-lift.functions";
import { sendOnsiteClientOtp, verifyOnsiteClientOtp } from "@/lib/sign-onsite.functions";
import { fileToBase64 } from "@/lib/file-upload";
import { compressImageFile, PHOTO_BASE64_MAX } from "@/lib/image-compress";
import {
  tryGetGps, buildPhotoEntry, sanitizeExifForUpload, type PhotoEntry,
} from "@/lib/photo-exif";

export type LiftDialogReserve = {
  id: string;
  description: string;
  severity: string;
  status: string;
  priority?: string | null;
  due_date?: string | null;
  work_to_execute?: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pvId: string;
  pvNumero: string;
  reserves: LiftDialogReserve[];
  preselectedReserveId?: string | null;
  chantierLabel?: string | null;
  clientLabel?: string | null;
  clientEmail?: string | null;
  onCompleted?: (reportId: string, numero: string) => void;
};

type StepId =
  | "select"
  | "constat"
  | "intervention"
  | "after"
  | "signer"
  | "mode"
  | "otp"
  | "client"
  | "review";

type InitialPhoto = {
  url: string | null;
  label: string | null;
  takenAt: string | null;
  hasGeo: boolean;
};

const ROLE_LABELS: Record<string, string> = {
  directeur: "Directeur",
  responsable_exploitation: "Responsable d'exploitation",
  conducteur_travaux: "Conducteur de travaux",
  assistant_admin: "Assistant administratif",
  technicien: "Technicien",
};
function prettyRole(r: string | null | undefined): string {
  if (!r) return "Intervenant";
  return ROLE_LABELS[r] ?? r;
}

/**
 * Top-level stable component — defining this INSIDE ReserveLiftWorkflowDialog
 * gave it a new function identity on every render, causing React to unmount
 * and remount the subtree. That unmount/remount made the comment <Textarea>
 * lose focus after each keystroke. Keep this component module-scoped.
 */
function ReserveCard({ r, children }: { r: LiftDialogReserve; children?: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 mb-1">
            <Badge variant={r.severity === "majeure" ? "destructive" : "secondary"} className="text-[10px]">{r.severity}</Badge>
            {r.priority && r.priority !== "normal" && (
              <Badge variant="outline" className="text-[10px]">P. {r.priority}</Badge>
            )}
            {r.due_date && (
              <span className="text-[10px] text-muted-foreground">📅 {new Date(r.due_date).toLocaleDateString("fr-FR")}</span>
            )}
          </div>
          <p className="text-sm leading-snug">{r.description}</p>
          {r.work_to_execute && (
            <p className="mt-1 text-[11px] text-muted-foreground"><span className="font-medium">Travaux prévus :</span> {r.work_to_execute}</p>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}

/**
 * Memoized comment field per reserve — local state keeps every keystroke
 * inside the textarea instead of bubbling up to the dialog and re-rendering
 * the whole step tree. The parent receives the value via a stable callback.
 */
const ReserveInterventionComment = memo(function ReserveInterventionComment({
  reserveId, initialValue, onCommit,
}: { reserveId: string; initialValue: string; onCommit: (rid: string, value: string) => void }) {
  const [value, setValue] = useState(initialValue);
  // Sync if parent resets (e.g. dialog reopened)
  useEffect(() => { setValue(initialValue); }, [initialValue, reserveId]);
  return (
    <Textarea
      rows={3}
      placeholder="Ex. Remplacement du micro-onduleur, contrôle de production et vérification du serrage."
      value={value}
      onChange={(e) => {
        const v = e.target.value;
        setValue(v);
        onCommit(reserveId, v);
      }}
    />
  );
});

type GpsPermission = "pending" | "granted" | "denied" | "unavailable";

export function ReserveLiftWorkflowDialog(props: Props) {
  const {
    open, onOpenChange, pvId, pvNumero, reserves, preselectedReserveId,
    chantierLabel, clientLabel, clientEmail, onCompleted,
  } = props;
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const { activeRole, activeCompanyId } = useCompany();
  const createFn = useServerFn(createReserveLift);
  const listPhotosFn = useServerFn(listReserveLiftPhotos);
  const sendOtpFn = useServerFn(sendOnsiteClientOtp);
  const verifyOtpFn = useServerFn(verifyOnsiteClientOtp);

  // Intervenant identity (auto-filled, read-only)
  const [signerName, setSignerName] = useState("");
  const [signerRole, setSignerRole] = useState<string>("");
  const [signerEmail, setSignerEmail] = useState("");

  // Wizard state
  const [stepIdx, setStepIdx] = useState(0);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [photosAfter, setPhotosAfter] = useState<Record<string, PhotoEntry[]>>({});
  const [initialPhotos, setInitialPhotos] = useState<Record<string, InitialPhoto[]>>({});
  const [loadingInitial, setLoadingInitial] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [validationMode, setValidationMode] = useState<"on_site" | "remote">("remote");

  const signerSigRef = useRef<SignaturePad>(null);
  const clientSigRef = useRef<SignaturePad>(null);
  const [signerSigData, setSignerSigData] = useState<string | null>(null);
  const [clientSigData, setClientSigData] = useState<string | null>(null);
  const [clientConsent, setClientConsent] = useState(false);

  // OTP state (on-site only — Phase 2)
  const [otpEmail, setOtpEmail] = useState("");
  const [otpId, setOtpId] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [otpVerified, setOtpVerified] = useState(false);
  const [otpSending, setOtpSending] = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [otpExpiresAt, setOtpExpiresAt] = useState<string | null>(null);

  // GPS permission state — requested at dialog open
  const [gpsPermission, setGpsPermission] = useState<GpsPermission>("pending");
  const [lastKnownPosition, setLastKnownPosition] = useState<{
    latitude: number; longitude: number; accuracy: number | null;
  } | null>(null);

  // Stable callback for the memoized comment input
  const handleCommentCommit = useCallback((rid: string, value: string) => {
    setComments((c) => (c[rid] === value ? c : { ...c, [rid]: value }));
  }, []);

  // STEPS (dynamic — "otp" + "client" steps only when on_site)
  const STEPS: { id: StepId; label: string; short: string; icon: any }[] = useMemo(() => {
    const base: { id: StepId; label: string; short: string; icon: any }[] = [
      { id: "select",       label: "Réserves",        short: "1", icon: Check },
      { id: "constat",      label: "Constat initial", short: "2", icon: Eye },
      { id: "intervention", label: "Intervention",    short: "3", icon: FileSignature },
      { id: "after",        label: "Photos après",    short: "4", icon: Camera },
      { id: "signer",       label: "Intervenant",     short: "5", icon: UserCheck },
      { id: "mode",         label: "Validation",      short: "6", icon: Mail },
    ];
    if (validationMode === "on_site") {
      base.push({ id: "otp",    label: "Vérif. client",     short: "7", icon: Mail });
      base.push({ id: "client", label: "Signature client",  short: "8", icon: FileSignature });
    }
    base.push({ id: "review", label: "Finalisation", short: String(base.length + 1), icon: Send });
    return base;
  }, [validationMode]);

  // --- Fetch full_name for intervenant on open
  useEffect(() => {
    if (!open || !user?.id) return;
    setSignerEmail(user.email ?? "");
    setSignerRole(activeRole ?? "");
    (async () => {
      const { data: prof } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle();
      setSignerName(prof?.full_name ?? "");
    })();
  }, [open, user?.id, user?.email, activeRole]);

  // Prefill OTP email from client profile when opening
  useEffect(() => {
    if (!open) return;
    if (clientEmail) setOtpEmail(clientEmail);
  }, [open, clientEmail]);

  // Request geolocation immediately when popup opens so the badge and the
  // photo capture flow have a position ready before the user reaches the
  // "Photos après" step.
  useEffect(() => {
    if (!open) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGpsPermission("unavailable");
      return;
    }
    setGpsPermission("pending");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLastKnownPosition({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? null,
        });
        setGpsPermission("granted");
      },
      (err) => {
        setGpsPermission(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable");
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30_000 },
    );
  }, [open]);

  async function handleSendOtp() {
    if (!activeCompanyId) { toast.error("Entreprise active introuvable."); return; }
    const email = otpEmail.trim().toLowerCase();
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) { toast.error("Email client invalide."); return; }
    setOtpSending(true);
    try {
      const res = await sendOtpFn({ data: { companyId: activeCompanyId, email, pvId } });
      setOtpId(res.otpId);
      setOtpExpiresAt(res.expiresAt);
      setOtpVerified(false);
      setOtpCode("");
      toast.success(`Code envoyé à ${email}.`);
    } catch (e: any) {
      toast.error(e?.message || "Envoi du code échoué.");
    } finally {
      setOtpSending(false);
    }
  }

  async function handleVerifyOtp() {
    if (!otpId) { toast.error("Envoyez d'abord un code."); return; }
    if (!/^\d{6}$/.test(otpCode)) { toast.error("Code à 6 chiffres attendu."); return; }
    setOtpVerifying(true);
    try {
      await verifyOtpFn({ data: { otpId, code: otpCode } });
      setOtpVerified(true);
      toast.success("Identité client vérifiée.");
    } catch (e: any) {
      toast.error(e?.message || "Code invalide.");
    } finally {
      setOtpVerifying(false);
    }
  }


  // --- Initial selection
  useEffect(() => {
    if (!open) return;
    if (preselectedReserveId && reserves.some((r) => r.id === preselectedReserveId)) {
      setSelected({ [preselectedReserveId]: true });
    } else if (reserves.length === 1) {
      setSelected({ [reserves[0].id]: true });
    } else {
      setSelected({});
    }
    setStepIdx(0);
  }, [open, preselectedReserveId, reserves]);

  // Cleanup on close
  useEffect(() => {
    if (open) return;
    Object.values(photosAfter).flat().forEach((p) => URL.revokeObjectURL(p.previewUrl));
    setPhotosAfter({});
    setComments({});
    setInitialPhotos({});
    setSignerSigData(null);
    setClientSigData(null);
    setClientConsent(false);
    setValidationMode("remote");
    setOtpEmail("");
    setOtpId(null);
    setOtpCode("");
    setOtpVerified(false);
    setOtpExpiresAt(null);
    setGpsPermission("pending");
    setLastKnownPosition(null);
    setStepIdx(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const selectedReserves = useMemo(
    () => reserves.filter((r) => selected[r.id]),
    [reserves, selected],
  );

  const step = STEPS[stepIdx];

  // Load initial constat photos when entering the constat step (or selection changes)
  useEffect(() => {
    if (!open) return;
    if (step?.id !== "constat") return;
    if (selectedReserves.length === 0) return;
    const missing = selectedReserves.filter((r) => !initialPhotos[r.id]);
    if (missing.length === 0) return;
    setLoadingInitial(true);
    (async () => {
      try {
        const results = await Promise.all(
          missing.map(async (r) => {
            try {
              const res = await listPhotosFn({ data: { reserveId: r.id } });
              const photos = (res?.photos ?? []) as any[];
              const initial: InitialPhoto[] = photos
                .filter((p) => p.photoType === "initial")
                .map((p) => ({
                  url: p.url,
                  label: p.label,
                  takenAt: p.takenAt ?? p.uploadedAt ?? null,
                  hasGeo: p.latitude != null && p.longitude != null,
                }));
              return [r.id, initial] as [string, InitialPhoto[]];
            } catch {
              return [r.id, [] as InitialPhoto[]] as [string, InitialPhoto[]];
            }
          }),
        );
        setInitialPhotos((prev) => {
          const next = { ...prev };
          for (const [rid, list] of results) next[rid] = list;
          return next;
        });
      } finally {
        setLoadingInitial(false);
      }
    })();
  }, [open, step?.id, selectedReserves, initialPhotos, listPhotosFn]);

  // --- After-photo upload
  async function handleAfterFiles(rid: string, files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      // Try to refresh GPS if user previously granted; fall back to last known
      // position; never block the upload if GPS is denied/unavailable.
      let browserGps: { latitude: number | null; longitude: number | null; accuracy: number | null } = {
        latitude: lastKnownPosition?.latitude ?? null,
        longitude: lastKnownPosition?.longitude ?? null,
        accuracy: lastKnownPosition?.accuracy ?? null,
      };
      if (gpsPermission === "granted" || gpsPermission === "pending") {
        const fresh = await tryGetGps();
        if (fresh.latitude !== null && fresh.longitude !== null) {
          browserGps = fresh;
          setLastKnownPosition({
            latitude: fresh.latitude,
            longitude: fresh.longitude,
            accuracy: fresh.accuracy,
          });
          if (gpsPermission !== "granted") setGpsPermission("granted");
        }
      }
      const deviceInfo = typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 400) : "";
      const list = Array.from(files);
      const entries: PhotoEntry[] = [];
      let compressedCount = 0;
      for (const raw of list) {
        try {
          const { file, compressed } = await compressImageFile(raw);
          if (compressed) compressedCount++;
          entries.push(await buildPhotoEntry(file, browserGps, deviceInfo));
        } catch (innerErr: any) {
          // Don't abort the whole batch — fall back to raw file with no GPS.
          console.warn("[lift] photo processing failed, using raw", innerErr);
          entries.push(await buildPhotoEntry(raw, browserGps, deviceInfo));
        }
      }
      if (entries.length === 0) {
        toast.error("Aucune photo n'a pu être ajoutée.");
        return;
      }
      if (compressedCount > 0) toast.success(`${compressedCount} photo(s) optimisée(s).`);
      setPhotosAfter((prev) => ({ ...prev, [rid]: [...(prev[rid] ?? []), ...entries] }));
    } catch (e: any) {
      toast.error(e?.message || "Échec d'import photo.");
    } finally {
      setUploading(false);
    }
  }

  function removeAfter(rid: string, idx: number) {
    setPhotosAfter((prev) => {
      const list = [...(prev[rid] ?? [])];
      const removed = list.splice(idx, 1);
      removed.forEach((e) => URL.revokeObjectURL(e.previewUrl));
      return { ...prev, [rid]: list };
    });
  }

  // --- Validation per step
  function validateStep(id: StepId): { ok: boolean; msg?: string } {
    switch (id) {
      case "select":
        if (selectedReserves.length === 0) return { ok: false, msg: "Sélectionnez au moins une réserve." };
        return { ok: true };
      case "constat":
        return { ok: true };
      case "intervention": {
        const missing = selectedReserves.filter((r) => !(comments[r.id] ?? "").trim());
        if (missing.length > 0) return { ok: false, msg: "Décrivez les travaux réalisés pour chaque réserve." };
        return { ok: true };
      }
      case "after": {
        const missing = selectedReserves.filter((r) => (photosAfter[r.id]?.length ?? 0) === 0);
        if (missing.length > 0) return { ok: false, msg: "Au moins 1 photo APRÈS par réserve sélectionnée." };
        return { ok: true };
      }
      case "signer": {
        if (!signerName.trim()) return { ok: false, msg: "Nom de l'intervenant manquant." };
        const sig = signerSigRef.current && !signerSigRef.current.isEmpty()
          ? signerSigRef.current.toDataURL("image/png") : signerSigData;
        if (!sig) return { ok: false, msg: "Signature intervenant obligatoire." };
        return { ok: true };
      }
      case "mode":
        return { ok: true };
      case "otp": {
        if (validationMode !== "on_site") return { ok: true };
        if (!otpVerified) return { ok: false, msg: "Vérifiez l'identité du client (OTP email)." };
        return { ok: true };
      }
      case "client": {
        if (validationMode !== "on_site") return { ok: true };
        if (!clientConsent) return { ok: false, msg: "Le client doit accepter avant de signer." };
        const sig = clientSigRef.current && !clientSigRef.current.isEmpty()
          ? clientSigRef.current.toDataURL("image/png") : clientSigData;
        if (!sig) return { ok: false, msg: "Signature client obligatoire (sur place)." };
        return { ok: true };
      }
      case "review":
        return { ok: true };
    }
  }

  function persistSigs() {
    if (signerSigRef.current && !signerSigRef.current.isEmpty()) {
      setSignerSigData(signerSigRef.current.toDataURL("image/png"));
    }
    if (clientSigRef.current && !clientSigRef.current.isEmpty()) {
      setClientSigData(clientSigRef.current.toDataURL("image/png"));
    }
  }

  function goNext() {
    persistSigs();
    const v = validateStep(step.id);
    if (!v.ok) { toast.error(v.msg!); return; }
    setStepIdx((i) => Math.min(STEPS.length - 1, i + 1));
  }
  function goPrev() {
    persistSigs();
    setStepIdx((i) => Math.max(0, i - 1));
  }

  // --- Finalize
  async function handleFinalize() {
    persistSigs();
    for (const s of STEPS) {
      const v = validateStep(s.id);
      if (!v.ok) {
        toast.error(v.msg!);
        setStepIdx(STEPS.findIndex((x) => x.id === s.id));
        return;
      }
    }
    const signerSig = signerSigRef.current && !signerSigRef.current.isEmpty()
      ? signerSigRef.current.toDataURL("image/png") : signerSigData;
    const clientSig = validationMode === "on_site"
      ? (clientSigRef.current && !clientSigRef.current.isEmpty()
          ? clientSigRef.current.toDataURL("image/png") : clientSigData)
      : null;
    if (!signerSig) { toast.error("Signature intervenant obligatoire."); return; }

    setSubmitting(true);
    try {
      const items = await Promise.all(
        selectedReserves.map(async (r) => {
          const after = photosAfter[r.id] ?? [];
          const photos = await Promise.all(after.map(async (e) => {
            const base64 = await fileToBase64(e.file);
            if (base64.length > PHOTO_BASE64_MAX) {
              throw new Error("Une photo reste trop volumineuse après compression.");
            }
            return {
              base64,
              mimeType: e.file.type || "image/jpeg",
              fileName: e.file.name,
              photoType: "after" as const,
              latitude: e.latitude,
              longitude: e.longitude,
              accuracy: e.accuracy,
              takenAt: e.takenAt,
              deviceInfo: e.deviceInfo,
              exifMetadata: sanitizeExifForUpload(e.exifMetadata),
            };
          }));
          return { reserveId: r.id, comment: (comments[r.id] ?? "").trim(), photos };
        }),
      );

      const res = await createFn({
        data: {
          pvId,
          status: "signe",
          comment: "",
          requireClientSignature: false,
          items,
          // New intervenant signature (server mirrors it into company_signature for compat).
          // SECURITY (F-03): signer identity (name/role/email) is resolved server-side
          // from the authenticated session — never sent from the client.
          signerSignature: signerSig,
          validationMode,
          clientSignedOnSite: validationMode === "on_site",
          clientSignature: clientSig,
          clientOtpId: validationMode === "on_site" && otpVerified ? otpId : null,
          // Legacy fields kept for back-compat — left null on new flow
          companySignature: null,
          technicianSignature: null,
          technicianName: null,
        },
      });
      if (validationMode === "on_site") {
        toast.success(`Levée ${res.numero} finalisée et signée sur place.`);
      } else {
        toast.success(`Levée ${res.numero} envoyée au client pour validation.`);
      }
      onCompleted?.(res.reportId, res.numero);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message || "Échec de la création de la levée.");
    } finally {
      setSubmitting(false);
    }
  }

  // --- UI parts
  const HeaderInfo = (
    <div className="space-y-1 text-xs text-muted-foreground">
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        <span><span className="font-medium text-foreground">PV :</span> {pvNumero}</span>
        {chantierLabel && <span><span className="font-medium text-foreground">Chantier :</span> {chantierLabel}</span>}
        {clientLabel && <span><span className="font-medium text-foreground">Client :</span> {clientLabel}</span>}
      </div>
    </div>
  );

  const Stepper = (
    <div className="flex items-center gap-1 overflow-x-auto pb-2">
      {STEPS.map((s, idx) => {
        const active = idx === stepIdx;
        const done = idx < stepIdx;
        return (
          <div key={s.id} className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => { persistSigs(); setStepIdx(idx); }}
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                active ? "bg-primary text-primary-foreground"
                : done ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground"
              }`}
            >
              <span className={`grid h-4 w-4 place-items-center rounded-full text-[10px] ${
                active ? "bg-primary-foreground/20" : done ? "bg-primary/20" : "bg-background"
              }`}>{done ? "✓" : s.short}</span>
              <span className="hidden sm:inline">{s.label}</span>
            </button>
            {idx < STEPS.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground/40" />}
          </div>
        );
      })}
    </div>
  );

  // (ReserveCard is defined at module scope to keep it stable across renders.)

  const Body = (
    <div className="space-y-4">
      {HeaderInfo}
      {Stepper}

      {step?.id === "select" && (
        <div className="space-y-2">
          {reserves.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune réserve ouverte à lever.</p>
          ) : reserves.map((r) => (
            <label key={r.id} className="flex items-start gap-2 rounded-md border border-border p-2.5 cursor-pointer hover:bg-muted/50">
              <Checkbox
                checked={!!selected[r.id]}
                onCheckedChange={(v) => setSelected((s) => ({ ...s, [r.id]: !!v }))}
                className="mt-0.5"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 mb-1">
                  <Badge variant={r.severity === "majeure" ? "destructive" : "secondary"} className="text-[10px]">{r.severity}</Badge>
                  <Badge variant="outline" className="text-[10px]">{r.status}</Badge>
                </div>
                <p className="text-sm leading-snug">{r.description}</p>
              </div>
            </label>
          ))}
        </div>
      )}

      {step?.id === "constat" && (
        <div className="space-y-3">
          <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs">
            Ces photos ont été prises lors de la création de la réserve et constituent le
            <span className="font-medium"> constat initial</span>. Aucune modification possible.
          </div>
          {loadingInitial && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Chargement des photos initiales…
            </div>
          )}
          {selectedReserves.map((r) => {
            const list = initialPhotos[r.id] ?? [];
            return (
              <ReserveCard key={r.id} r={r}>
                {list.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground italic">
                    Aucune photo de constat initial trouvée pour cette réserve.
                  </p>
                ) : (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {list.map((p, idx) => (
                      <div key={idx} className="relative overflow-hidden rounded border border-border">
                        {p.url ? (
                          <img src={p.url} alt={p.label ?? ""} className="aspect-square w-full object-cover" />
                        ) : (
                          <div className="aspect-square grid place-items-center bg-muted text-[10px] text-muted-foreground">N/A</div>
                        )}
                        <div className="absolute bottom-1 left-1 right-1 flex items-center justify-between gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[9px] text-white">
                          <span className="truncate">{p.label}</span>
                          {p.hasGeo ? <MapPin className="h-2.5 w-2.5 text-green-300 shrink-0" />
                                    : <MapPinOff className="h-2.5 w-2.5 text-amber-300 shrink-0" />}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ReserveCard>
            );
          })}
        </div>
      )}

      {step?.id === "intervention" && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">Décrivez les travaux réalisés pour chaque réserve.</p>
          {selectedReserves.map((r) => (
            <ReserveCard key={r.id} r={r}>
              <div>
                <Label className="text-xs">Travaux réalisés <span className="text-destructive">*</span></Label>
                <ReserveInterventionComment
                  reserveId={r.id}
                  initialValue={comments[r.id] ?? ""}
                  onCommit={handleCommentCommit}
                />
              </div>
            </ReserveCard>
          ))}
        </div>
      )}

      {step?.id === "after" && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">Photos preuves <span className="font-medium">après intervention</span> (au moins 1 par réserve).</p>
          {selectedReserves.map((r) => {
            const list = photosAfter[r.id] ?? [];
            return (
              <ReserveCard key={r.id} r={r}>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Photos après <span className="text-destructive">*</span></Label>
                    <span className="text-[10px] text-muted-foreground">{list.length} photo(s)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="file" multiple accept="image/png,image/jpeg,image/webp" capture="environment"
                      onChange={(e) => { void handleAfterFiles(r.id, e.target.files); e.target.value = ""; }}
                      className="h-9 text-xs"
                    />
                    {uploading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                  </div>
                  {list.length > 0 && (
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                      {list.map((p, idx) => {
                        const geo = p.latitude !== null && p.longitude !== null;
                        return (
                          <div key={idx} className="relative overflow-hidden rounded border border-border">
                            <img src={p.previewUrl} alt="" className="aspect-square w-full object-cover" />
                            <button type="button" onClick={() => removeAfter(r.id, idx)}
                              className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white hover:bg-black/80"
                              aria-label="Supprimer">
                              <X className="h-3 w-3" />
                            </button>
                            <div className="absolute bottom-1 left-1 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[9px] text-white">
                              {geo ? (
                                <><MapPin className="h-2.5 w-2.5 text-green-300" />{p.accuracy ? `±${Math.round(p.accuracy)}m` : "GPS"}</>
                              ) : (
                                <><MapPinOff className="h-2.5 w-2.5 text-amber-300" />Non géoloc.</>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </ReserveCard>
            );
          })}
        </div>
      )}

      {step?.id === "signer" && (
        <div className="space-y-3 rounded-md border border-border p-3">
          <div>
            <Label className="text-sm">Intervenant</Label>
            <p className="text-[11px] text-muted-foreground">
              Données issues de la session active. Cette signature engage l'auteur de l'intervention.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded border border-border bg-muted/30 px-2 py-1.5">
              <div className="text-[10px] uppercase text-muted-foreground">Nom</div>
              <div className="text-sm font-medium">{signerName || "—"}</div>
            </div>
            <div className="rounded border border-border bg-muted/30 px-2 py-1.5">
              <div className="text-[10px] uppercase text-muted-foreground">Fonction</div>
              <div className="text-sm font-medium">{prettyRole(signerRole)}</div>
            </div>
            <div className="rounded border border-border bg-muted/30 px-2 py-1.5 sm:col-span-2">
              <div className="text-[10px] uppercase text-muted-foreground">Email</div>
              <div className="text-sm font-medium truncate">{signerEmail || "—"}</div>
            </div>
          </div>
          <div>
            <Label className="text-xs">Signature <span className="text-destructive">*</span></Label>
            <div className="rounded-md border border-border bg-background">
              <SignaturePad
                ref={signerSigRef}
                canvasProps={{ className: "w-full h-32" }}
                onEnd={() => {
                  if (signerSigRef.current && !signerSigRef.current.isEmpty()) {
                    setSignerSigData(signerSigRef.current.toDataURL("image/png"));
                  }
                }}
              />
            </div>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs"
              onClick={() => { signerSigRef.current?.clear(); setSignerSigData(null); }}>
              Effacer
            </Button>
          </div>
        </div>
      )}

      {step?.id === "mode" && (
        <div className="space-y-3">
          <div>
            <Label className="text-sm">Mode de validation client</Label>
            <p className="text-[11px] text-muted-foreground">Choisissez comment le client validera la levée.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setValidationMode("on_site")}
              className={`rounded-md border p-3 text-left transition ${
                validationMode === "on_site" ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <UserCheck className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Signature sur place</span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Le client signe directement dans cette popup. Aucun email envoyé.
              </p>
            </button>
            <button
              type="button"
              onClick={() => setValidationMode("remote")}
              className={`rounded-md border p-3 text-left transition ${
                validationMode === "remote" ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <Mail className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Signature à distance</span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Un email est envoyé au client pour qu'il valide depuis son espace.
              </p>
            </button>
          </div>
        </div>
      )}

      {step?.id === "otp" && validationMode === "on_site" && (
        <div className="space-y-3 rounded-md border border-border p-3">
          <div>
            <Label className="text-sm">Vérification d'identité client (OTP email)</Label>
            <p className="text-[11px] text-muted-foreground">
              Un code à 6 chiffres est envoyé au client. Obligatoire avant la signature sur place.
            </p>
          </div>
          <div className="space-y-2">
            <div>
              <Label className="text-xs">Email du client <span className="text-destructive">*</span></Label>
              <div className="flex gap-2">
                <Input
                  type="email" placeholder="client@exemple.fr" value={otpEmail}
                  onChange={(e) => { setOtpEmail(e.target.value); setOtpVerified(false); setOtpId(null); }}
                  disabled={otpSending || otpVerified}
                  className="h-9 text-sm"
                />
                <Button size="sm" type="button" variant="secondary"
                  onClick={handleSendOtp} disabled={otpSending || otpVerified || !otpEmail.trim()}>
                  {otpSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                  {otpId ? "Renvoyer" : "Envoyer le code"}
                </Button>
              </div>
              {otpExpiresAt && !otpVerified && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  Code valable jusqu'à {new Date(otpExpiresAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}.
                </p>
              )}
            </div>
            {otpId && !otpVerified && (
              <div>
                <Label className="text-xs">Code reçu (6 chiffres) <span className="text-destructive">*</span></Label>
                <div className="flex gap-2">
                  <Input
                    inputMode="numeric" pattern="\d{6}" maxLength={6} placeholder="123456"
                    value={otpCode} onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    className="h-9 text-sm tracking-widest font-mono"
                  />
                  <Button size="sm" type="button" onClick={handleVerifyOtp} disabled={otpVerifying || otpCode.length !== 6}>
                    {otpVerifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    Vérifier
                  </Button>
                </div>
              </div>
            )}
            {otpVerified && (
              <div className="rounded border border-green-500/40 bg-green-500/5 px-3 py-2 text-xs text-green-700 dark:text-green-400 flex items-center gap-2">
                <Check className="h-4 w-4" /> Identité vérifiée pour {otpEmail}.
              </div>
            )}
          </div>
        </div>
      )}

      {step?.id === "client" && validationMode === "on_site" && (
        <div className="space-y-3 rounded-md border border-border p-3">
          <div>
            <Label className="text-sm">Signature client (sur place)</Label>
            <p className="text-[11px] text-muted-foreground">
              Le client appose sa signature ci-dessous. IP et horodatage sont enregistrés.
            </p>
          </div>
          <label className="flex items-start gap-2 text-xs">
            <Checkbox checked={clientConsent} onCheckedChange={(v) => setClientConsent(!!v)} className="mt-0.5" />
            <span>
              Le client reconnaît avoir pris connaissance des travaux réalisés et valide la levée des réserves
              listées dans ce document.
            </span>
          </label>
          <div>
            <Label className="text-xs">Signature <span className="text-destructive">*</span></Label>
            <div className="rounded-md border border-border bg-background">
              <SignaturePad
                ref={clientSigRef}
                canvasProps={{ className: "w-full h-32" }}
                onEnd={() => {
                  if (clientSigRef.current && !clientSigRef.current.isEmpty()) {
                    setClientSigData(clientSigRef.current.toDataURL("image/png"));
                  }
                }}
              />
            </div>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs"
              onClick={() => { clientSigRef.current?.clear(); setClientSigData(null); }}>
              Effacer
            </Button>
          </div>
        </div>
      )}

      {step?.id === "review" && (
        <div className="space-y-3">
          <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
            <p className="font-medium mb-1">Récapitulatif</p>
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>• {selectedReserves.length} réserve(s) à lever</li>
              <li>• Photos initiales (constat) : récupérées automatiquement</li>
              <li>• {selectedReserves.reduce((n, r) => n + (photosAfter[r.id]?.length ?? 0), 0)} photo(s) après intervention</li>
              <li>• Intervenant : {signerName || "—"} — {prettyRole(signerRole)}</li>
              <li>• Signature intervenant : {signerSigData ? "✓" : "—"}</li>
              <li>• Mode de validation client : {validationMode === "on_site" ? "Sur place" : "À distance (email)"}</li>
              {validationMode === "on_site" && (
                <>
                  <li>• OTP client vérifié : {otpVerified ? `✓ (${otpEmail})` : "—"}</li>
                  <li>• Signature client : {clientSigData ? "✓" : "—"}</li>
                </>
              )}
            </ul>
          </div>
          <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs">
            {validationMode === "on_site"
              ? "En finalisant, la levée est signée par le client immédiatement, le PDF est généré et le PV est mis à jour."
              : "En finalisant, un PV de levée est généré et le client recevra un email pour valider et signer depuis son espace."}
          </div>
        </div>
      )}
    </div>
  );

  const Footer = (
    <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
      <Button variant="outline" size="sm" onClick={goPrev} disabled={stepIdx === 0 || submitting}>
        <ChevronLeft className="h-4 w-4" /> Précédent
      </Button>
      <span className="text-[11px] text-muted-foreground">Étape {stepIdx + 1} / {STEPS.length}</span>
      {step?.id === "review" ? (
        <Button size="sm" onClick={handleFinalize} disabled={submitting}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Finaliser
        </Button>
      ) : (
        <Button size="sm" onClick={goNext} disabled={submitting}>
          Suivant <ChevronRight className="h-4 w-4" />
        </Button>
      )}
    </div>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[92vh] overflow-y-auto flex flex-col">
          <SheetHeader>
            <SheetTitle>Levée de réserve</SheetTitle>
            <SheetDescription>Workflow guidé pour traiter et valider la levée.</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto py-3">{Body}</div>
          {Footer}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Levée de réserve</DialogTitle>
          <DialogDescription>Workflow guidé pour traiter et valider la levée.</DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto pr-1">{Body}</div>
        {Footer}
      </DialogContent>
    </Dialog>
  );
}
