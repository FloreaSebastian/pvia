import { useEffect, useRef, useState } from "react";
import { Search, Loader2, Building2, User, Check, X, AlertTriangle, MapPin, ShieldCheck } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useServerFn } from "@tanstack/react-start";
import { searchFrenchCompanies, type FrenchCompanyHit } from "@/lib/siren.functions";
import { toast } from "sonner";
import { cn } from "@/lib/utils";


export type ClientFormState = {
  client_type: "particulier" | "entreprise";
  name: string;
  email: string;
  phone: string;
  address: string;
  address_line1: string;
  postal_code: string;
  city: string;
  latitude: number | null;
  longitude: number | null;
  notes: string;
  company_name: string;
  siret: string;
  siren: string;
  vat_number: string;
  naf_code: string;
  contact_name: string;
};

export const EMPTY_CLIENT_FORM: ClientFormState = {
  client_type: "particulier",
  name: "", email: "", phone: "",
  address: "", address_line1: "", postal_code: "", city: "",
  latitude: null, longitude: null, notes: "",
  company_name: "", siret: "", siren: "", vat_number: "", naf_code: "", contact_name: "",
};

export function ClientTypeSelector({
  value, onChange, disabled,
}: { value: "particulier" | "entreprise"; onChange: (v: "particulier" | "entreprise") => void; disabled?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {([
        { v: "particulier" as const, label: "Particulier", icon: User },
        { v: "entreprise" as const, label: "Entreprise", icon: Building2 },
      ]).map(({ v, label, icon: Icon }) => (
        <button
          key={v}
          type="button"
          disabled={disabled}
          onClick={() => onChange(v)}
          className={cn(
            "flex items-center justify-center gap-2 rounded-xl border-2 px-3 py-3 text-sm font-medium transition",
            value === v
              ? "border-primary bg-primary/5 text-foreground"
              : "border-border bg-card text-muted-foreground hover:border-primary/40",
          )}
        >
          <Icon className="h-4 w-4" /> {label}
        </button>
      ))}
    </div>
  );
}

export function ClientFormFields({
  form, setForm, compact = false,
}: {
  form: ClientFormState;
  setForm: (next: ClientFormState) => void;
  compact?: boolean;
}) {
  const [siretQuery, setSiretQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<FrenchCompanyHit[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const searchFn = useServerFn(searchFrenchCompanies);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqIdRef = useRef(0);

  async function runSearch(q: string, { silent = false }: { silent?: boolean } = {}) {
    if (q.length < 3) {
      if (!silent) toast.error("Saisissez au moins 3 caractères.");
      return;
    }
    const myReq = ++reqIdRef.current;
    setSearching(true);
    setSearchError(null);
    try {
      const res = await searchFn({ data: { query: q } });
      if (reqIdRef.current !== myReq) return; // stale
      if (res.ok) {
        setHits(res.hits);
        if (!silent && res.hits.length === 0) toast.info("Aucune entreprise trouvée.");
      } else {
        setHits(null);
        setSearchError(res.error);
      }
    } catch (e) {
      if (reqIdRef.current !== myReq) return;
      setHits(null);
      setSearchError(e instanceof Error ? e.message : "Recherche impossible.");
    } finally {
      if (reqIdRef.current === myReq) setSearching(false);
    }
  }

  // Debounced auto-search ≥3 chars
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = siretQuery.trim();
    setManualMode(false);
    if (q.length < 3) {
      setHits(null);
      setSearchError(null);
      setSearching(false);
      return;
    }
    debounceRef.current = setTimeout(() => { runSearch(q, { silent: true }); }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siretQuery]);



  function pickCompany(h: FrenchCompanyHit) {
    setForm({
      ...form,
      company_name: form.company_name.trim() || h.name,
      name: form.company_name.trim() || h.name,
      siret: h.siret ?? form.siret,
      siren: h.siren || form.siren,
      vat_number: form.vat_number.trim() || (h.vat_number ?? ""),
      naf_code: form.naf_code.trim() || (h.naf_code ?? ""),
      address_line1: form.address_line1.trim() || (h.address_line1 ?? ""),
      postal_code: form.postal_code.trim() || (h.postal_code ?? ""),
      city: form.city.trim() || (h.city ?? ""),
      address: form.address.trim() || [h.address_line1, [h.postal_code, h.city].filter(Boolean).join(" ")]
        .filter(Boolean).join(", "),
    });
    setHits(null);
    toast.success("Informations préremplies.");
  }

  const gridCols = compact ? "sm:grid-cols-2" : "sm:grid-cols-2";

  if (form.client_type === "particulier") {
    return (
      <div className="space-y-3">
        <div><Label>Nom complet *</Label>
          <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Jean Dupont" /></div>
        <div className={`grid gap-3 ${gridCols}`}>
          <div><Label>Email</Label>
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="jean@email.fr" /></div>
          <div><Label>Téléphone</Label>
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="06 12 34 56 78" /></div>
        </div>
        <div><Label>Adresse</Label>
          <Input value={form.address_line1} onChange={(e) => setForm({ ...form, address_line1: e.target.value })} placeholder="12 rue des Lilas" /></div>
        <div className="grid grid-cols-3 gap-3">
          <div><Label>Code postal</Label>
            <Input value={form.postal_code} onChange={(e) => setForm({ ...form, postal_code: e.target.value })} placeholder="06400" /></div>
          <div className="col-span-2"><Label>Ville</Label>
            <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="Cannes" /></div>
        </div>
      </div>
    );
  }

  // Entreprise
  return (
    <div className="space-y-3">
      <Card className="space-y-2 border-dashed bg-muted/30 p-3">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Rechercher une entreprise</Label>
          {searching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            value={siretQuery}
            onChange={(e) => setSiretQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); runSearch(siretQuery.trim()); } }}
            placeholder="SIRET, SIREN ou nom de société (≥ 3 caractères)"
            inputMode="search"
            autoComplete="off"
          />
        </div>

        {searchError && !manualMode && (
          <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-2 text-xs">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
              <span className="break-words">{searchError}</span>
            </div>
            <Button type="button" size="sm" variant="outline" className="h-7 w-full" onClick={() => setManualMode(true)}>
              Saisir manuellement
            </Button>
          </div>
        )}

        {hits && hits.length > 0 && (
          <div className="max-h-72 overflow-y-auto rounded-lg border border-border bg-background">
            <ul className="divide-y divide-border">
              {hits.map((h, i) => (
                <li key={`${h.siren}-${h.siret ?? i}`}>
                  <button
                    type="button"
                    onClick={() => pickCompany(h)}
                    className="block w-full px-3 py-2 text-left hover:bg-muted/50"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="break-words text-sm font-medium">{h.name || "—"}</span>
                      {h.siret && <Badge variant="outline" className="shrink-0 font-mono text-[10px]">{h.siret}</Badge>}
                    </div>
                    <div className="mt-0.5 break-words text-xs text-muted-foreground">
                      {[h.address_line1, [h.postal_code, h.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || "—"}
                      {h.naf_code ? ` · APE ${h.naf_code}` : ""}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex justify-end p-1">
              <Button type="button" size="sm" variant="ghost" onClick={() => setHits(null)}>
                <X className="h-3.5 w-3.5" /> Fermer
              </Button>
            </div>

          </div>
        )}
      </Card>

      <div>
        <Label>Nom société *</Label>
        <Input
          required
          value={form.company_name}
          onChange={(e) => setForm({ ...form, company_name: e.target.value, name: e.target.value })}
          placeholder="ENERVIA"
        />
      </div>
      <div className={`grid gap-3 ${gridCols}`}>
        <div><Label>SIRET</Label>
          <Input value={form.siret} onChange={(e) => setForm({ ...form, siret: e.target.value })} placeholder="14 chiffres" /></div>
        <div><Label>SIREN</Label>
          <Input value={form.siren} onChange={(e) => setForm({ ...form, siren: e.target.value })} placeholder="9 chiffres" /></div>
        <div><Label>TVA intracom.</Label>
          <Input value={form.vat_number} onChange={(e) => setForm({ ...form, vat_number: e.target.value })} placeholder="FR…" /></div>
        <div><Label>Code NAF / APE</Label>
          <Input value={form.naf_code} onChange={(e) => setForm({ ...form, naf_code: e.target.value })} placeholder="4321A" /></div>
      </div>
      <div><Label>Adresse siège</Label>
        <Input value={form.address_line1} onChange={(e) => setForm({ ...form, address_line1: e.target.value })} /></div>
      <div className="grid grid-cols-3 gap-3">
        <div><Label>Code postal</Label>
          <Input value={form.postal_code} onChange={(e) => setForm({ ...form, postal_code: e.target.value })} /></div>
        <div className="col-span-2"><Label>Ville</Label>
          <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
      </div>
      <div className={`grid gap-3 ${gridCols}`}>
        <div><Label>Email</Label>
          <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
        <div><Label>Téléphone</Label>
          <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
      </div>
      <div><Label>Contact principal</Label>
        <Input value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} placeholder="Sebastian Florea" /></div>
      <div className="hidden"><Check className="h-3 w-3" /></div>
    </div>
  );
}
