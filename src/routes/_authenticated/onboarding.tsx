import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Search, ArrowRight, ArrowLeft, CheckCircle2, Building2, User, Sparkles, Upload } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { FieldStepper } from "@/components/field/FieldStepper";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { getOnboardingStatus, completeProfile, completeCompany } from "@/lib/onboarding.functions";
import { lookupCompanyBySirenOrSiret, type SirenLookupResult } from "@/lib/siren.functions";
import { uploadCompanyLogo } from "@/lib/company-logo.functions";
import { fileToBase64, validateLogoFile } from "@/lib/file-upload";

export const Route = createFileRoute("/_authenticated/onboarding")({
  component: OnboardingPage,
  head: () => ({ meta: [{ title: "Configuration — PVIA" }] }),
});

type ProfileForm = {
  first_name: string;
  last_name: string;
  phone: string;
  job_title: string;
};

type CompanyForm = {
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
};

const STEP_LABELS = ["Bienvenue", "Profil", "Recherche", "Entreprise", "Branding", "Terminé"];

function OnboardingPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const statusFn = useServerFn(getOnboardingStatus);
  const profileFn = useServerFn(completeProfile);
  const companyFn = useServerFn(completeCompany);
  const lookupFn = useServerFn(lookupCompanyBySirenOrSiret);

  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ["onboarding-status", user?.id],
    queryFn: () => statusFn(),
    enabled: !!user,
  });

  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [sourcedFromSiren, setSourcedFromSiren] = useState(false);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupQuery, setLookupQuery] = useState("");

  const [profile, setProfile] = useState<ProfileForm>({
    first_name: "",
    last_name: "",
    phone: "",
    job_title: "",
  });

  const [company, setCompany] = useState<CompanyForm>({
    name: "",
    legal_form: "",
    siren: "",
    siret: "",
    vat_number: "",
    address_line1: "",
    address_line2: "",
    postal_code: "",
    city: "",
    country: "FR",
    phone: "",
    email: "",
    website: "",
    logo_url: "",
  });

  // Pre-populate from auth metadata
  useEffect(() => {
    if (!user) return;
    const meta = (user.user_metadata ?? {}) as Record<string, string>;
    setProfile((p) => ({
      ...p,
      first_name: p.first_name || meta.full_name?.split(" ")[0] || "",
      last_name: p.last_name || meta.full_name?.split(" ").slice(1).join(" ") || "",
    }));
    setCompany((c) => ({
      ...c,
      name: c.name || meta.company_name || "",
      email: c.email || user.email || "",
    }));
  }, [user]);

  // Skip company steps for invited members
  const skipCompany = !!status && !status.needsCompanyStep;

  // If already completed, leave
  useEffect(() => {
    if (status && status.profileComplete && (!status.needsCompanyStep || status.companyComplete)) {
      navigate({ to: "/dashboard" });
    }
  }, [status, navigate]);

  const totalSteps = skipCompany ? 3 : 6;

  async function nextFromProfile() {
    if (!profile.first_name || !profile.last_name || !profile.phone || !profile.job_title) {
      toast.error("Veuillez remplir tous les champs.");
      return;
    }
    setSaving(true);
    try {
      await profileFn({ data: profile });
      toast.success("Profil enregistré");
      await queryClient.invalidateQueries({ queryKey: ["onboarding-status"] });
      if (skipCompany) {
        navigate({ to: "/dashboard" });
      } else {
        setStep(3);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function runLookup() {
    const q = lookupQuery.replace(/\s+/g, "");
    if (!/^\d{9}$|^\d{14}$/.test(q)) {
      setLookupError("Saisissez un SIREN (9 chiffres) ou SIRET (14 chiffres).");
      return;
    }
    setLookupLoading(true);
    setLookupError(null);
    try {
      const res = (await lookupFn({ data: { query: q } })) as SirenLookupResult;
      if (!res.found) {
        setLookupError(res.error);
        return;
      }
      setCompany((c) => ({
        ...c,
        name: res.name || c.name,
        siren: res.siren || c.siren,
        siret: res.siret || c.siret,
        legal_form: res.legal_form || c.legal_form,
        address_line1: res.address_line1 || c.address_line1,
        postal_code: res.postal_code || c.postal_code,
        city: res.city || c.city,
      }));
      setSourcedFromSiren(true);
      toast.success(`${res.name} trouvée`);
      setStep(4);
    } catch (e) {
      setLookupError((e as Error).message);
    } finally {
      setLookupLoading(false);
    }
  }

  function manualEntry() {
    setSourcedFromSiren(false);
    setStep(4);
  }

  async function saveCompany(goNext: boolean) {
    if (!status?.activeCompanyId) {
      toast.error("Aucune entreprise active.");
      return;
    }
    if (!company.name || !company.address_line1 || !company.postal_code || !company.city || (!company.siret && !company.siren)) {
      toast.error("Champs entreprise obligatoires manquants.");
      return;
    }
    setSaving(true);
    try {
      await companyFn({
        data: {
          companyId: status.activeCompanyId,
          name: company.name,
          legal_form: company.legal_form || null,
          siren: company.siren || null,
          siret: company.siret || null,
          vat_number: company.vat_number || null,
          address_line1: company.address_line1,
          address_line2: company.address_line2 || null,
          postal_code: company.postal_code,
          city: company.city,
          country: company.country || "FR",
          phone: company.phone || null,
          email: company.email || null,
          website: company.website || null,
          logo_url: company.logo_url || null,
          sourced_from_siren: sourcedFromSiren,
        },
      });
      toast.success("Entreprise enregistrée");
      await queryClient.invalidateQueries({ queryKey: ["onboarding-status"] });
      if (goNext) setStep(step + 1);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function uploadLogo(file: File) {
    if (!status?.activeCompanyId) return;
    const path = `${status.activeCompanyId}/logo-${Date.now()}-${file.name}`;
    const up = await supabase.storage.from("pv-assets").upload(path, file, { upsert: true });
    if (up.error) return toast.error(up.error.message);
    const { data } = await supabase.storage.from("pv-assets").createSignedUrl(path, 60 * 60 * 24 * 365);
    if (data?.signedUrl) {
      setCompany((c) => ({ ...c, logo_url: data.signedUrl }));
      toast.success("Logo téléversé");
    }
  }

  async function finish() {
    await saveCompany(false);
    await queryClient.invalidateQueries({ queryKey: ["onboarding-status"] });
    navigate({ to: "/dashboard" });
  }

  if (statusLoading || !status) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const progress = Math.round((step / totalSteps) * 100);

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-6">
      <div className="flex items-center justify-between">
        <BrandLogo />
        <button
          onClick={async () => {
            await supabase.auth.signOut();
            navigate({ to: "/login" });
          }}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Se déconnecter
        </button>
      </div>

      <div className="space-y-3">
        <Progress value={progress} />
        <FieldStepper step={step} total={totalSteps} labels={skipCompany ? ["Bienvenue", "Profil", "Terminé"] : STEP_LABELS} />
      </div>

      <Card className="p-8 shadow-brand">
        {step === 1 && (
          <div className="space-y-4 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary">
              <Sparkles className="h-6 w-6" />
            </div>
            <h1 className="font-display text-3xl font-bold">Bienvenue sur PVIA</h1>
            <p className="text-sm text-muted-foreground">
              Quelques informations pour configurer votre espace et vos PV. Cela prend moins de 2 minutes.
            </p>
            <Button className="mt-4" onClick={() => setStep(2)}>
              Commencer <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <User className="h-5 w-5 text-primary" />
              <h2 className="text-xl font-semibold">Votre profil</h2>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Prénom *</Label>
                <Input value={profile.first_name} onChange={(e) => setProfile({ ...profile, first_name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Nom *</Label>
                <Input value={profile.last_name} onChange={(e) => setProfile({ ...profile, last_name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Téléphone *</Label>
                <Input value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} placeholder="06 ..." />
              </div>
              <div className="space-y-1.5">
                <Label>Fonction *</Label>
                <Input value={profile.job_title} onChange={(e) => setProfile({ ...profile, job_title: e.target.value })} placeholder="Gérant, Chef de chantier, ..." />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Email</Label>
                <Input value={user?.email ?? ""} disabled />
              </div>
            </div>
            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={() => setStep(1)}>
                <ArrowLeft className="h-4 w-4" /> Retour
              </Button>
              <Button onClick={nextFromProfile} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                Continuer
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <Search className="h-5 w-5 text-primary" />
              <h2 className="text-xl font-semibold">Trouvons votre entreprise</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              Saisissez votre SIREN (9 chiffres) ou SIRET (14 chiffres). Nous préremplissons automatiquement les informations officielles.
            </p>
            <div className="flex gap-2">
              <Input
                value={lookupQuery}
                onChange={(e) => setLookupQuery(e.target.value)}
                placeholder="552 100 554 ou 552 100 554 00013"
                onKeyDown={(e) => e.key === "Enter" && runLookup()}
              />
              <Button onClick={runLookup} disabled={lookupLoading}>
                {lookupLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Rechercher
              </Button>
            </div>
            {lookupError && (
              <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {lookupError}
              </p>
            )}
            <div className="flex justify-between border-t pt-4">
              <Button variant="ghost" onClick={() => setStep(2)}>
                <ArrowLeft className="h-4 w-4" /> Retour
              </Button>
              <Button variant="outline" onClick={manualEntry}>
                Saisir manuellement <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <Building2 className="h-5 w-5 text-primary" />
              <h2 className="text-xl font-semibold">Informations entreprise</h2>
            </div>
            {sourcedFromSiren && (
              <p className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs text-primary">
                Données préremplies depuis le registre Sirene. Vérifiez et modifiez si nécessaire.
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Raison sociale *</Label>
                <Input value={company.name} onChange={(e) => setCompany({ ...company, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>SIREN</Label>
                <Input value={company.siren} onChange={(e) => setCompany({ ...company, siren: e.target.value.replace(/\s/g, "") })} maxLength={9} />
              </div>
              <div className="space-y-1.5">
                <Label>SIRET</Label>
                <Input value={company.siret} onChange={(e) => setCompany({ ...company, siret: e.target.value.replace(/\s/g, "") })} maxLength={14} />
              </div>
              <div className="space-y-1.5">
                <Label>Forme juridique</Label>
                <Input value={company.legal_form} onChange={(e) => setCompany({ ...company, legal_form: e.target.value })} placeholder="SARL, SAS, ..." />
              </div>
              <div className="space-y-1.5">
                <Label>TVA intracom.</Label>
                <Input value={company.vat_number} onChange={(e) => setCompany({ ...company, vat_number: e.target.value })} placeholder="FR..." />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Adresse *</Label>
                <Input value={company.address_line1} onChange={(e) => setCompany({ ...company, address_line1: e.target.value })} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Complément d'adresse</Label>
                <Input value={company.address_line2} onChange={(e) => setCompany({ ...company, address_line2: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Code postal *</Label>
                <Input value={company.postal_code} onChange={(e) => setCompany({ ...company, postal_code: e.target.value })} maxLength={10} />
              </div>
              <div className="space-y-1.5">
                <Label>Ville *</Label>
                <Input value={company.city} onChange={(e) => setCompany({ ...company, city: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Pays</Label>
                <Input value={company.country} onChange={(e) => setCompany({ ...company, country: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Téléphone</Label>
                <Input value={company.phone} onChange={(e) => setCompany({ ...company, phone: e.target.value })} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Email entreprise</Label>
                <Input type="email" value={company.email} onChange={(e) => setCompany({ ...company, email: e.target.value })} />
              </div>
            </div>
            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={() => setStep(3)}>
                <ArrowLeft className="h-4 w-4" /> Retour
              </Button>
              <Button onClick={() => saveCompany(true)} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                Continuer
              </Button>
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <Upload className="h-5 w-5 text-primary" />
              <h2 className="text-xl font-semibold">Logo & site web</h2>
            </div>
            <p className="text-sm text-muted-foreground">Optionnel — utilisé sur vos PV, emails et l'espace client.</p>
            <div className="flex items-center gap-4">
              <div className="grid h-20 w-20 place-items-center overflow-hidden rounded-xl border border-border bg-muted">
                {company.logo_url ? (
                  <img src={company.logo_url} alt="logo" className="h-full w-full object-contain" />
                ) : (
                  <Building2 className="h-8 w-8 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 space-y-1.5">
                <Label>Logo</Label>
                <Input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Site web</Label>
              <Input value={company.website} onChange={(e) => setCompany({ ...company, website: e.target.value })} placeholder="https://..." />
            </div>
            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={() => setStep(4)}>
                <ArrowLeft className="h-4 w-4" /> Retour
              </Button>
              <Button onClick={() => saveCompany(true)} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                Continuer
              </Button>
            </div>
          </div>
        )}

        {step === 6 && (
          <div className="space-y-4 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-emerald-500/10 text-emerald-600">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <h2 className="font-display text-2xl font-bold">Tout est prêt</h2>
            <p className="text-sm text-muted-foreground">
              Votre espace PVIA est configuré. Vos informations entreprise seront utilisées automatiquement sur vos PV, emails et exports.
            </p>
            <Button onClick={finish} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              Accéder au tableau de bord
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
