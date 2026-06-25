import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Building2, Save, Loader2, Lock, RefreshCw, ShieldCheck, Upload, Trash2,
  Phone, Mail, Globe, MapPin, History, AlertTriangle, FileSignature, Receipt,
  FileText, Download, ArrowRight, CheckCircle2, Send,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useCompany } from "@/hooks/use-company";
import { updateCompanyBranding, syncCompanyFromSiren } from "@/lib/branding.functions";
import { uploadCompanyLogo, deleteCompanyVisual } from "@/lib/company-logo.functions";
import { lookupCompanyBySirenOrSiret, type SirenLookupResult } from "@/lib/siren.functions";
import { getCompanyHistory, requestCompanyChange, type CompanyHistoryEntry } from "@/lib/company-page.functions";
import { fileToBase64, validateLogoFile } from "@/lib/file-upload";
import { RouteRoleGuard } from "@/components/auth/RouteRoleGuard";
import { ADMIN_ROLES } from "@/lib/roles";

function GuardedCompanyPage() {
  return (
    <RouteRoleGuard allow={ADMIN_ROLES}>
      <CompanyPage />
    </RouteRoleGuard>
  );
}

export const Route = createFileRoute("/_authenticated/entreprise")({
  component: GuardedCompanyPage,
  head: () => ({ meta: [{ title: "Entreprise — PVIA" }] }),
});

type CompanyData = {
  name: string;
  legal_form: string;
  siren: string;
  siret: string;
  vat_number: string;
  address_line1: string;
  address_line2: string;
  postal_code: string;
  city: string;
  country: string;
  phone: string;
  email: string;
  website: string;
  logo_url: string;
  icon_url: string;
  created_at: string | null;
  company_verified: boolean;
  company_verified_at: string | null;
  company_verification_source: string | null;
};

const emptyCompany: CompanyData = {
  name: "", legal_form: "", siren: "", siret: "", vat_number: "",
  address_line1: "", address_line2: "", postal_code: "", city: "", country: "FR",
  phone: "", email: "", website: "", logo_url: "", icon_url: "",
  created_at: null, company_verified: false, company_verified_at: null, company_verification_source: null,
};

/* ─────────────── Locked field display ─────────────── */
function LockedField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</Label>
        <Lock className="h-3 w-3 shrink-0 text-muted-foreground/70" />
      </div>
      <div className="mt-1 rounded-md border border-dashed border-border/70 bg-muted/40 px-3 py-2 text-sm">
        {value ? <span className="break-words font-medium">{value}</span> : <span className="italic text-muted-foreground">Non renseigné</span>}
      </div>
    </div>
  );
}

/* ─────────────── Page ─────────────── */
function CompanyPage() {
  const { activeCompanyId, can, refresh } = useCompany();
  const editable = can("admin");

  const [loading, setLoading] = useState(true);
  const [company, setCompany] = useState<CompanyData>(emptyCompany);
  const [contact, setContact] = useState({
    phone: "", email: "", website: "", address_line2: "", country: "FR",
  });
  const [savingContact, setSavingContact] = useState(false);
  const [history, setHistory] = useState<CompanyHistoryEntry[]>([]);

  // Sync wizard
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncStep, setSyncStep] = useState<1 | 2 | 3>(1);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncQuery, setSyncQuery] = useState("");
  const [syncPreview, setSyncPreview] = useState<SirenLookupResult | null>(null);

  // Change request
  const [changeOpen, setChangeOpen] = useState(false);
  const [changeBusy, setChangeBusy] = useState(false);
  const [changeNewSiret, setChangeNewSiret] = useState("");
  const [changeReason, setChangeReason] = useState("");

  const saveFn = useServerFn(updateCompanyBranding);
  const uploadFn = useServerFn(uploadCompanyLogo);
  const deleteFn = useServerFn(deleteCompanyVisual);
  const syncFn = useServerFn(syncCompanyFromSiren);
  const lookupFn = useServerFn(lookupCompanyBySirenOrSiret);
  const historyFn = useServerFn(getCompanyHistory);
  const changeFn = useServerFn(requestCompanyChange);

  async function reload() {
    if (!activeCompanyId) return;
    const { data } = await supabase
      .from("companies")
      .select("name,legal_form,siren,siret,vat_number,address_line1,address_line2,postal_code,city,country,phone,email,website,logo_url,icon_url,created_at,company_verified,company_verified_at,company_verification_source")
      .eq("id", activeCompanyId)
      .single();
    if (data) {
      const d = data as any;
      setCompany({
        name: d.name ?? "", legal_form: d.legal_form ?? "",
        siren: d.siren ?? "", siret: d.siret ?? "", vat_number: d.vat_number ?? "",
        address_line1: d.address_line1 ?? "", address_line2: d.address_line2 ?? "",
        postal_code: d.postal_code ?? "", city: d.city ?? "", country: d.country ?? "FR",
        phone: d.phone ?? "", email: d.email ?? "", website: d.website ?? "",
        logo_url: d.logo_url ?? "", icon_url: d.icon_url ?? "",
        created_at: d.created_at ?? null,
        company_verified: !!d.company_verified,
        company_verified_at: d.company_verified_at ?? null,
        company_verification_source: d.company_verification_source ?? null,
      });
      setContact({
        phone: d.phone ?? "", email: d.email ?? "", website: d.website ?? "",
        address_line2: d.address_line2 ?? "", country: d.country ?? "FR",
      });
    }
  }

  useEffect(() => {
    (async () => {
      if (!activeCompanyId) return;
      setLoading(true);
      await reload();
      try {
        const h = await historyFn({ data: { companyId: activeCompanyId, limit: 15 } });
        setHistory(h);
      } catch { /* silencieux */ }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCompanyId]);

  /* ── Save contact (the only editable card) ── */
  async function saveContact() {
    if (!activeCompanyId) return;
    setSavingContact(true);
    try {
      await saveFn({
        data: {
          companyId: activeCompanyId,
          // Champs officiels : on renvoie ceux déjà enregistrés. Le serveur les
          // ignore quand l'entreprise est validée, mais on les passe pour
          // satisfaire le schéma de validation.
          name: company.name,
          legal_form: company.legal_form, siren: company.siren, siret: company.siret,
          vat_number: company.vat_number,
          address_line1: company.address_line1, postal_code: company.postal_code, city: company.city,
          // Champs contact réellement modifiables
          address_line2: contact.address_line2, country: contact.country,
          phone: contact.phone, email: contact.email, website: contact.website,
          logo_url: company.logo_url,
        } as any,
      });
      toast.success("Coordonnées enregistrées.");
      await reload();
      refresh();
    } catch (e: any) {
      toast.error(e?.message || "Échec de l'enregistrement.");
    } finally {
      setSavingContact(false);
    }
  }

  /* ── Identité visuelle (icône + logo) ── */
  async function uploadVisual(file: File, kind: "logo" | "icon") {
    if (!activeCompanyId) return;
    const err = validateLogoFile(file);
    if (err) return toast.error(err);
    try {
      const base64 = await fileToBase64(file);
      const res = await uploadFn({
        data: { companyId: activeCompanyId, fileName: file.name, mimeType: file.type, base64, kind },
      });
      // Warning ergonomique si ratio inattendu (non bloquant).
      try {
        const img = new Image();
        img.onload = () => {
          const r = img.width / img.height;
          if (kind === "icon" && (r < 0.75 || r > 1.33)) {
            toast.warning("Une image carrée est recommandée pour l'icône.");
          } else if (kind === "logo" && r > 0 && r < 1.2) {
            toast.warning("Un visuel horizontal est recommandé pour le logo principal.");
          }
        };
        img.src = res.url;
      } catch { /* ignore */ }
      setCompany((c) => kind === "icon" ? { ...c, icon_url: res.url } : { ...c, logo_url: res.url });
      toast.success(kind === "icon" ? "Icône mise à jour." : "Logo mis à jour.");
      refresh();
    } catch (e: any) {
      toast.error(e?.message || "Échec de l'upload.");
    }
  }

  async function removeVisual(kind: "logo" | "icon") {
    if (!activeCompanyId) return;
    try {
      await deleteFn({ data: { companyId: activeCompanyId, kind } });
      setCompany((c) => kind === "icon" ? { ...c, icon_url: "" } : { ...c, logo_url: "" });
      toast.success(kind === "icon" ? "Icône supprimée." : "Logo supprimé.");
      refresh();
    } catch (e: any) { toast.error(e?.message || "Suppression impossible."); }
  }


  /* ── Sync wizard ── */
  function openSync() {
    // Si l'entreprise a déjà un SIRET, le wizard est verrouillé sur ce SIRET.
    const locked = company.siret || company.siren;
    setSyncQuery(locked || "");
    setSyncPreview(null);
    setSyncStep(1);
    setSyncOpen(true);
  }

  async function runPreview() {
    setSyncBusy(true);
    try {
      const res = await lookupFn({ data: { query: syncQuery } });
      setSyncPreview(res);
      if (res.found) setSyncStep(2);
      else toast.error(res.error);
    } catch (e: any) {
      toast.error(e?.message || "Recherche impossible.");
    } finally { setSyncBusy(false); }
  }

  async function confirmSync() {
    if (!activeCompanyId) return;
    setSyncBusy(true);
    try {
      await syncFn({ data: { companyId: activeCompanyId, query: syncQuery } });
      toast.success("Entreprise synchronisée.");
      setSyncOpen(false);
      await reload();
      const h = await historyFn({ data: { companyId: activeCompanyId, limit: 15 } });
      setHistory(h);
      refresh();
    } catch (e: any) {
      toast.error(e?.message || "Synchronisation impossible.");
    } finally { setSyncBusy(false); }
  }

  /* ── Change request ── */
  async function submitChange() {
    if (!activeCompanyId) return;
    setChangeBusy(true);
    try {
      await changeFn({ data: { companyId: activeCompanyId, newSiret: changeNewSiret.replace(/\s+/g, ""), reason: changeReason } });
      toast.success("Demande envoyée. L'équipe PVIA va prendre contact.");
      setChangeOpen(false); setChangeNewSiret(""); setChangeReason("");
      const h = await historyFn({ data: { companyId: activeCompanyId, limit: 15 } });
      setHistory(h);
    } catch (e: any) {
      toast.error(e?.message || "Envoi impossible.");
    } finally { setChangeBusy(false); }
  }

  const lastSync = useMemo(() => {
    const sync = history.find((h) => h.action === "company.synced_from_siren");
    return sync?.created_at ?? company.company_verified_at ?? null;
  }, [history, company.company_verified_at]);

  if (loading) {
    return (
      <div className="grid h-64 place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const sirenSiretLocked = !!(company.siret || company.siren);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 pb-24">
      {/* Header */}
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wider text-primary">Paramètres</p>
          <h1 className="mt-1 truncate text-2xl font-semibold tracking-tight">Votre entreprise</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Fiche d'identité utilisée sur vos PV, emails, exports et factures.
          </p>
        </div>
        {company.company_verified ? (
          <Badge variant="outline" className="shrink-0 border-emerald-500/40 bg-emerald-50/60 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
            <ShieldCheck className="mr-1 h-3.5 w-3.5" /> Vérifiée
          </Badge>
        ) : (
          <Badge variant="outline" className="shrink-0 border-amber-500/40 bg-amber-50/60 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
            <AlertTriangle className="mr-1 h-3.5 w-3.5" /> À valider
          </Badge>
        )}
      </header>

      {!company.company_verified && (
        <Card className="border-amber-500/40 bg-amber-50/40 p-4 dark:bg-amber-950/20">
          <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
            <ShieldCheck className="h-5 w-5 shrink-0 text-amber-600" />
            <div className="min-w-0">
              <p className="text-sm font-semibold">Votre entreprise n'est pas encore validée.</p>
              <p className="text-xs text-muted-foreground">Validez-la via le registre officiel pour figer ses informations.</p>
            </div>
            {editable && (
              <Button size="sm" className="shrink-0" onClick={openSync}>
                <RefreshCw className="h-3.5 w-3.5" /> Valider
              </Button>
            )}
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ────── LEFT COLUMN ────── */}
        <div className="space-y-6">
          {/* Identité */}
          <Card className="overflow-hidden p-0">
            <div className="bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-5">
              <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4">
                <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl border border-border bg-background shadow-sm sm:h-20 sm:w-20">
                  {company.logo_url
                    ? <img src={company.logo_url} alt="logo" className="h-full w-full object-contain" />
                    : <Building2 className="h-7 w-7 text-muted-foreground" />}
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Entreprise utilisatrice</p>
                  <h2 className="mt-0.5 truncate text-lg font-semibold sm:text-xl">{company.name || "—"}</h2>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {company.company_verified ? (
                      <Badge variant="outline" className="border-emerald-500/40 text-[10px] text-emerald-700 dark:text-emerald-400">
                        <ShieldCheck className="mr-1 h-3 w-3" /> Vérifiée
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-amber-500/40 text-[10px] text-amber-700 dark:text-amber-400">À valider</Badge>
                    )}
                    {company.siret && (
                      <Badge variant="outline" className="font-mono text-[10px]">
                        SIRET {company.siret}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 border-t border-border bg-muted/30 p-4 text-xs sm:grid-cols-2">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Création</p>
                <p className="mt-0.5 font-medium">{company.created_at ? new Date(company.created_at).toLocaleDateString("fr-FR") : "—"}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Validation</p>
                <p className="mt-0.5 font-medium">{company.company_verified_at ? new Date(company.company_verified_at).toLocaleDateString("fr-FR") : "—"}</p>
              </div>
            </div>
          </Card>

          {/* Identité visuelle — Icône + Logo principal */}
          <Card className="p-5">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                <Upload className="h-4 w-4" /> Identité visuelle
              </h2>
            </div>
            <p className="mb-4 text-xs text-muted-foreground">
              Deux visuels distincts, utilisés automatiquement selon le contexte.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <VisualBlock
                title="Icône"
                description="Utilisée pour l'application, les notifications et les petits espaces."
                hint="Carré recommandé · 512×512 · PNG/JPG/WEBP · 2 Mo max."
                url={company.icon_url}
                placeholder={<Building2 className="h-9 w-9 text-muted-foreground" />}
                previewClass="h-24 w-24 rounded-xl"
                editable={editable}
                onUpload={(f) => uploadVisual(f, "icon")}
                onRemove={() => removeVisual("icon")}
              />
              <VisualBlock
                title="Logo principal"
                description="Utilisé sur les PDF, emails, PV et documents officiels."
                hint="Horizontal recommandé · PNG/JPG/WEBP · 2 Mo max."
                url={company.logo_url}
                placeholder={<Building2 className="h-9 w-9 text-muted-foreground" />}
                previewClass="h-24 w-full max-w-[220px] rounded-xl"
                editable={editable}
                onUpload={(f) => uploadVisual(f, "logo")}
                onRemove={() => removeVisual("logo")}
              />
            </div>
            {!company.logo_url && company.icon_url && (
              <p className="mt-3 flex items-start gap-1.5 text-[11px] text-muted-foreground">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" />
                Aucun logo principal — l'icône sera utilisée en repli sur les PDF et emails.
              </p>
            )}
          </Card>


          {/* Informations officielles */}
          <Card className="p-5">
            <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
              <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                <ShieldCheck className="h-4 w-4 text-emerald-600" /> Informations officielles
              </h2>
              {editable && (
                <Button size="sm" variant="outline" className="shrink-0" onClick={openSync}>
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{company.company_verified ? "Resynchroniser" : "Valider via SIRET"}</span>
                </Button>
              )}
            </div>
            <p className="mb-4 text-xs text-muted-foreground">
              {company.company_verified
                ? "Issues du registre officiel SIRENE. Verrouillées définitivement."
                : "Renseignez votre SIRET puis validez pour figer ces informations."}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <LockedField label="Raison sociale" value={company.name} />
              </div>
              <LockedField label="Forme juridique" value={company.legal_form} />
              <LockedField label="TVA intracommunautaire" value={company.vat_number} />
              <LockedField label="SIREN" value={company.siren} />
              <LockedField label="SIRET" value={company.siret} />
              <div className="sm:col-span-2">
                <LockedField
                  label="Adresse du siège"
                  value={[company.address_line1, [company.postal_code, company.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")}
                />
              </div>
            </div>
            {sirenSiretLocked && (
              <p className="mt-4 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Lock className="h-3 w-3" />
                Synchronisé avec le registre officiel
                {lastSync && <> · dernière sync. {new Date(lastSync).toLocaleDateString("fr-FR")}</>}
              </p>
            )}
          </Card>
        </div>

        {/* ────── RIGHT COLUMN ────── */}
        <div className="space-y-6">
          {/* Contact */}
          <Card className="p-5">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                <Phone className="h-4 w-4" /> Coordonnées de contact
              </h2>
            </div>
            <p className="mb-4 text-xs text-muted-foreground">Modifiables à tout moment. Utilisées sur les communications clients.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label className="text-xs">Téléphone</Label>
                <div className="relative mt-1">
                  <Phone className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input disabled={!editable} className="pl-9" value={contact.phone}
                    onChange={(e) => setContact({ ...contact, phone: e.target.value })} placeholder="01 23 45 67 89" />
                </div>
              </div>
              <div>
                <Label className="text-xs">Email</Label>
                <div className="relative mt-1">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input type="email" disabled={!editable} className="pl-9" value={contact.email}
                    onChange={(e) => setContact({ ...contact, email: e.target.value })} placeholder="contact@entreprise.fr" />
                </div>
              </div>
              <div className="sm:col-span-2">
                <Label className="text-xs">Site web</Label>
                <div className="relative mt-1">
                  <Globe className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input disabled={!editable} className="pl-9" placeholder="https://…" value={contact.website}
                    onChange={(e) => setContact({ ...contact, website: e.target.value })} />
                </div>
              </div>
              <div className="sm:col-span-2">
                <Label className="text-xs">Complément d'adresse</Label>
                <div className="relative mt-1">
                  <MapPin className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input disabled={!editable} className="pl-9" placeholder="Bâtiment, étage, BP…" value={contact.address_line2}
                    onChange={(e) => setContact({ ...contact, address_line2: e.target.value })} />
                </div>
              </div>
              <div>
                <Label className="text-xs">Pays</Label>
                <Input disabled={!editable} className="mt-1" value={contact.country}
                  onChange={(e) => setContact({ ...contact, country: e.target.value })} />
              </div>
            </div>
            {editable && (
              <div className="mt-5 flex justify-end">
                <Button onClick={saveContact} disabled={savingContact}>
                  {savingContact ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Enregistrer
                </Button>
              </div>
            )}
          </Card>

          {/* Utilisation */}
          <Card className="p-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              <FileText className="h-4 w-4" /> Utilisation
            </h2>
            <p className="mb-4 text-xs text-muted-foreground">Ces informations sont automatiquement utilisées dans :</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {[
                { icon: FileText, label: "PV" },
                { icon: Mail, label: "Emails" },
                { icon: Download, label: "PDF" },
                { icon: FileSignature, label: "Signature" },
                { icon: Download, label: "Exports" },
                { icon: Receipt, label: "Facturation" },
              ].map((u) => (
                <div key={u.label} className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs">
                  <u.icon className="h-3.5 w-3.5 shrink-0 text-primary" />
                  <span className="truncate font-medium">{u.label}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* Historique */}
          <Card className="p-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              <History className="h-4 w-4" /> Historique
            </h2>
            {history.length === 0 ? (
              <p className="text-xs text-muted-foreground">Aucun évènement enregistré pour l'instant.</p>
            ) : (
              <ol className="space-y-3">
                {history.slice(0, 10).map((h) => (
                  <li key={h.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-3">
                    <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary/60" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{labelFor(h.action)}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {new Date(h.created_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          {/* Cas exceptionnel */}
          {editable && (
            <Card className="border-dashed p-5">
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                <AlertTriangle className="h-4 w-4 text-amber-600" /> Changer d'entreprise
              </h2>
              <p className="text-xs text-muted-foreground">
                Pour des raisons de sécurité, un changement d'entreprise nécessite une intervention manuelle de l'équipe PVIA.
              </p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => setChangeOpen(true)}>
                <Send className="h-3.5 w-3.5" /> Demander un changement
              </Button>
            </Card>
          )}
        </div>
      </div>

      {/* ────── Sync wizard ────── */}
      <Dialog open={syncOpen} onOpenChange={setSyncOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-600" /> Synchronisation officielle
            </DialogTitle>
            <DialogDescription className="text-xs">
              {sirenSiretLocked
                ? "Resynchronisation depuis le SIRET enregistré. Il n'est pas possible de changer d'entreprise."
                : "Validez votre entreprise depuis le registre SIRENE."}
            </DialogDescription>
          </DialogHeader>

          {/* Stepper */}
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
            {[1, 2, 3].map((s) => (
              <div key={s} className={`flex items-center gap-1 ${syncStep >= s ? "text-primary" : ""}`}>
                <span className={`grid h-5 w-5 place-items-center rounded-full text-[10px] ${syncStep >= s ? "bg-primary text-primary-foreground" : "bg-muted"}`}>{s}</span>
                {s === 1 && "Recherche"}{s === 2 && "Comparer"}{s === 3 && "Confirmer"}
                {s < 3 && <ArrowRight className="h-3 w-3 opacity-50" />}
              </div>
            ))}
          </div>

          {syncStep === 1 && (
            <div className="space-y-3">
              <Label className="text-xs">SIREN (9 chiffres) ou SIRET (14 chiffres)</Label>
              <Input
                value={syncQuery}
                disabled={sirenSiretLocked}
                onChange={(e) => setSyncQuery(e.target.value.replace(/\D/g, "").slice(0, 14))}
                inputMode="numeric"
                placeholder="89249214100015"
              />
              {sirenSiretLocked && (
                <p className="text-[11px] text-muted-foreground">
                  <Lock className="mr-1 inline h-3 w-3" />
                  SIRET verrouillé. Pour changer d'entreprise, utilisez « Demander un changement ».
                </p>
              )}
            </div>
          )}

          {syncStep === 2 && syncPreview?.found && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">Comparez les informations actuelles aux informations officielles.</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
                  <p className="text-[10px] font-semibold uppercase text-muted-foreground">Actuel</p>
                  <Diff label="Raison sociale" value={company.name} />
                  <Diff label="Forme juridique" value={company.legal_form} />
                  <Diff label="SIREN" value={company.siren} />
                  <Diff label="SIRET" value={company.siret} />
                  <Diff label="Adresse" value={[company.address_line1, company.postal_code, company.city].filter(Boolean).join(" ")} />
                </div>
                <div className="space-y-2 rounded-lg border border-emerald-500/40 bg-emerald-50/40 p-3 dark:bg-emerald-950/20">
                  <p className="text-[10px] font-semibold uppercase text-emerald-700 dark:text-emerald-400">Officiel</p>
                  <Diff label="Raison sociale" value={syncPreview.name} highlight={syncPreview.name !== company.name} />
                  <Diff label="Forme juridique" value={syncPreview.legal_form ?? ""} highlight={(syncPreview.legal_form ?? "") !== company.legal_form} />
                  <Diff label="SIREN" value={syncPreview.siren} highlight={syncPreview.siren !== company.siren} />
                  <Diff label="SIRET" value={syncPreview.siret ?? ""} highlight={(syncPreview.siret ?? "") !== company.siret} />
                  <Diff
                    label="Adresse"
                    value={[syncPreview.address_line1, syncPreview.postal_code, syncPreview.city].filter(Boolean).join(" ")}
                    highlight={(syncPreview.address_line1 ?? "") !== company.address_line1}
                  />
                </div>
              </div>
            </div>
          )}

          {syncStep === 3 && (
            <div className="space-y-2">
              <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
              <p className="text-center text-sm font-medium">Confirmer la mise à jour ?</p>
              <p className="text-center text-xs text-muted-foreground">
                Les informations officielles seront remplacées par celles du registre SIRENE et verrouillées.
              </p>
            </div>
          )}

          <DialogFooter className="flex-row justify-between sm:justify-between">
            <Button variant="ghost" size="sm" onClick={() => setSyncOpen(false)}>Annuler</Button>
            <div className="flex gap-2">
              {syncStep > 1 && (
                <Button variant="outline" size="sm" onClick={() => setSyncStep((syncStep - 1) as 1 | 2 | 3)} disabled={syncBusy}>
                  Retour
                </Button>
              )}
              {syncStep === 1 && (
                <Button size="sm" onClick={runPreview} disabled={syncBusy || syncQuery.length < 9}>
                  {syncBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Rechercher
                </Button>
              )}
              {syncStep === 2 && (
                <Button size="sm" onClick={() => setSyncStep(3)}>Continuer</Button>
              )}
              {syncStep === 3 && (
                <Button size="sm" onClick={confirmSync} disabled={syncBusy}>
                  {syncBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                  Confirmer
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ────── Change request ────── */}
      <Dialog open={changeOpen} onOpenChange={setChangeOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" /> Demander un changement d'entreprise
            </DialogTitle>
            <DialogDescription className="text-xs">
              Pour des raisons de sécurité, un changement d'entreprise nécessite une intervention de l'équipe PVIA. Aucune modification automatique ne sera réalisée.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs">
              <p><span className="text-muted-foreground">Entreprise actuelle :</span> <span className="font-medium">{company.name}</span></p>
              <p><span className="text-muted-foreground">SIRET actuel :</span> <span className="font-mono font-medium">{company.siret || "—"}</span></p>
            </div>
            <div>
              <Label className="text-xs">Nouveau SIRET souhaité</Label>
              <Input
                inputMode="numeric"
                value={changeNewSiret}
                onChange={(e) => setChangeNewSiret(e.target.value.replace(/\D/g, "").slice(0, 14))}
                placeholder="14 chiffres"
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">Motif</Label>
              <Textarea
                rows={4}
                value={changeReason}
                onChange={(e) => setChangeReason(e.target.value)}
                placeholder="Expliquez pourquoi vous demandez un changement (erreur d'onboarding, fusion, etc.)."
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setChangeOpen(false)}>Annuler</Button>
            <Button onClick={submitChange} disabled={changeBusy || changeNewSiret.length !== 14 || changeReason.trim().length < 20}>
              {changeBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              Envoyer la demande
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Diff({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
      <p className={`truncate text-xs ${highlight ? "font-semibold text-primary" : ""}`}>{value || "—"}</p>
    </div>
  );
}

function VisualBlock({
  title, description, hint, url, placeholder, previewClass, editable, onUpload, onRemove,
}: {
  title: string;
  description: string;
  hint: string;
  url: string;
  placeholder: ReactNode;
  previewClass: string;
  editable: boolean;
  onUpload: (f: File) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-border/60 bg-muted/20 p-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{title}</p>
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{description}</p>
      </div>
      <div className={`grid place-items-center self-start overflow-hidden border border-border bg-background ${previewClass}`}>
        {url
          ? <img src={url} alt={title} className="h-full w-full object-contain" />
          : placeholder}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm" variant="outline" disabled={!editable}>
          <label className="cursor-pointer">
            <Upload className="h-3.5 w-3.5" /> {url ? "Changer" : "Ajouter"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
            />
          </label>
        </Button>
        {url && editable && (
          <Button size="sm" variant="ghost" onClick={onRemove} className="text-destructive hover:text-destructive">
            <Trash2 className="h-3.5 w-3.5" /> Supprimer
          </Button>
        )}
      </div>
      <p className="text-[10.5px] text-muted-foreground">{hint}</p>
    </div>
  );
}


function labelFor(action: string): string {
  switch (action) {
    case "company.created": return "Entreprise créée";
    case "company.verified": return "Entreprise validée";
    case "company.synced_from_siren": return "Synchronisation officielle (SIRENE)";
    case "company.logo_updated": return "Logo principal modifié";
    case "company.logo_deleted": return "Logo principal supprimé";
    case "company.icon_updated": return "Icône modifiée";
    case "company.icon_deleted": return "Icône supprimée";
    case "company.contact_updated": return "Coordonnées modifiées";
    case "company.legal_info_updated": return "Informations légales modifiées";
    case "company.official_fields_update_denied": return "Tentative de modification refusée";
    case "company.siret_change_attempt_blocked": return "Tentative de changement de SIRET bloquée";
    case "company.change_request_submitted": return "Demande de changement envoyée";
    case "onboarding.company_completed": return "Onboarding entreprise complété";
    case "onboarding.completed": return "Onboarding terminé";
    default: return action;
  }
}
