/**
 * Import IA des fiches clients.
 *
 * 3 sources possibles : fichier CSV/Excel (parsé côté navigateur en texte CSV),
 * texte collé brut, ou PDF/image (envoyé en multimodal à Gemini).
 *
 * Workflow :
 *  1. L'utilisateur choisit une source et clique "Analyser"
 *  2. `extractClientsFromSource` renvoie un aperçu (avec statut doublon)
 *  3. L'utilisateur édite, désélectionne, ignore les doublons (skip par défaut)
 *  4. `importClientsBatch` insère les lignes restantes
 */
import { useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Upload, FileSpreadsheet, FileText, Image as ImageIcon, Sparkles, AlertTriangle, Building2, User } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import {
  extractClientsFromSource as extractFn,
  importClientsBatch as importFn,
  type ImportClientRow,
} from "@/lib/clients-import.functions";
import { cn } from "@/lib/utils";

type PreviewRow = ImportClientRow & {
  duplicate_reason: "email" | "siret" | null;
  existing_id: string | null;
  _selected: boolean;
};

const MAX_FILE_BYTES = 10 * 1024 * 1024;

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("Lecture du fichier impossible."));
    r.onload = () => resolve(r.result as string);
    r.readAsDataURL(file);
  });
}

function csvFromXlsx(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("Lecture XLSX impossible."));
    r.onload = () => {
      try {
        const wb = XLSX.read(r.result as ArrayBuffer, { type: "array" });
        const first = wb.SheetNames[0];
        if (!first) return resolve("");
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[first]);
        resolve(csv);
      } catch (e) {
        reject(e instanceof Error ? e : new Error("Parsing XLSX échoué."));
      }
    };
    r.readAsArrayBuffer(file);
  });
}

export function ClientsImportDialog({
  open,
  onOpenChange,
  companyId,
  onImported,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companyId: string;
  onImported: () => void;
}) {
  const [tab, setTab] = useState<"file" | "text" | "scan">("file");
  const [text, setText] = useState("");
  const [pastedFileName, setPastedFileName] = useState<string | null>(null);
  const [scanFile, setScanFile] = useState<File | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scanInputRef = useRef<HTMLInputElement>(null);

  const extract = useServerFn(extractFn);
  const importBatch = useServerFn(importFn);

  function reset() {
    setText("");
    setPastedFileName(null);
    setScanFile(null);
    setPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (scanInputRef.current) scanInputRef.current.value = "";
  }

  async function handleSheetFile(file: File) {
    if (file.size > MAX_FILE_BYTES) {
      toast.error("Fichier trop volumineux (max 10 Mo).");
      return;
    }
    try {
      let asText = "";
      const lower = file.name.toLowerCase();
      if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
        asText = await csvFromXlsx(file);
      } else {
        // CSV / TSV / TXT
        asText = await file.text();
        // Normalise via Papa pour gérer séparateur auto
        const parsed = Papa.parse(asText, { skipEmptyLines: true });
        if (parsed.data && parsed.data.length) {
          asText = Papa.unparse(parsed.data as unknown[][]);
        }
      }
      if (!asText.trim()) {
        toast.error("Fichier vide.");
        return;
      }
      setText(asText.slice(0, 200_000));
      setPastedFileName(file.name);
      toast.success(`Chargé : ${file.name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Lecture impossible.");
    }
  }

  async function analyze() {
    if (analyzing) return;
    setAnalyzing(true);
    try {
      let payload: Parameters<typeof extract>[0]["data"];
      if (tab === "scan") {
        if (!scanFile) {
          toast.error("Sélectionnez un PDF ou une image.");
          return;
        }
        if (scanFile.size > MAX_FILE_BYTES) {
          toast.error("Fichier trop volumineux (max 10 Mo).");
          return;
        }
        const dataUrl = await fileToDataUrl(scanFile);
        const mt = scanFile.type;
        if (!["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(mt)) {
          toast.error("Type non supporté (PDF, PNG, JPEG, WEBP).");
          return;
        }
        payload = {
          companyId,
          mode: "file",
          file: { fileName: scanFile.name, mimeType: mt as "application/pdf" | "image/png" | "image/jpeg" | "image/webp", dataUrl },
        };
      } else {
        if (!text.trim()) {
          toast.error("Aucun contenu à analyser.");
          return;
        }
        payload = { companyId, mode: "text", text };
      }
      const { rows } = await extract({ data: payload });
      if (!rows.length) {
        toast.info("Aucune fiche détectée par l'IA.");
        setPreview([]);
        return;
      }
      setPreview(rows.map((r) => ({ ...r, _selected: r.duplicate_reason === null })));
      toast.success(`${rows.length} fiche${rows.length > 1 ? "s" : ""} détectée${rows.length > 1 ? "s" : ""}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Extraction impossible.");
    } finally {
      setAnalyzing(false);
    }
  }

  async function doImport() {
    if (!preview || importing) return;
    const rows = preview
      .filter((r) => r._selected && r.duplicate_reason === null)
      .map(({ _selected, duplicate_reason, existing_id, ...rest }) => rest);
    if (rows.length === 0) {
      toast.info("Aucune fiche à importer.");
      return;
    }
    setImporting(true);
    try {
      const { inserted, skipped, failed, errors } = await importBatch({
        data: { companyId, rows },
      });
      toast.success(
        `${inserted} client${inserted > 1 ? "s" : ""} importé${inserted > 1 ? "s" : ""}` +
          (skipped ? ` · ${skipped} doublon${skipped > 1 ? "s" : ""} ignoré${skipped > 1 ? "s" : ""}` : "") +
          (failed ? ` · ${failed} échec${failed > 1 ? "s" : ""}` : ""),
      );
      if (errors.length) {
        for (const m of errors.slice(0, 3)) toast.error(m);
      }
      onImported();
      onOpenChange(false);
      reset();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import impossible.");
    } finally {
      setImporting(false);
    }
  }

  const counts = useMemo(() => {
    if (!preview) return { selected: 0, dup: 0, total: 0 };
    return {
      total: preview.length,
      dup: preview.filter((r) => r.duplicate_reason !== null).length,
      selected: preview.filter((r) => r._selected && r.duplicate_reason === null).length,
    };
  }, [preview]);

  function updateRow(idx: number, patch: Partial<PreviewRow>) {
    setPreview((p) => {
      if (!p) return p;
      const next = [...p];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> Import IA — Clients
          </DialogTitle>
        </DialogHeader>

        {!preview ? (
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="space-y-4">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="file" className="gap-1.5"><FileSpreadsheet className="h-3.5 w-3.5" /> Fichier</TabsTrigger>
              <TabsTrigger value="text" className="gap-1.5"><FileText className="h-3.5 w-3.5" /> Texte</TabsTrigger>
              <TabsTrigger value="scan" className="gap-1.5"><ImageIcon className="h-3.5 w-3.5" /> PDF / Image</TabsTrigger>
            </TabsList>

            <TabsContent value="file" className="space-y-3">
              <p className="text-sm text-muted-foreground">
                CSV, TSV ou Excel (.xlsx). L'IA mappe automatiquement les colonnes, même mal nommées.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.tsv,.txt,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleSheetFile(f);
                }}
              />
              <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="w-full justify-center gap-2">
                <Upload className="h-4 w-4" /> Choisir un fichier
              </Button>
              {pastedFileName && (
                <p className="text-xs text-muted-foreground">
                  Source : <span className="font-medium text-foreground">{pastedFileName}</span> ({text.length.toLocaleString()} caractères)
                </p>
              )}
            </TabsContent>

            <TabsContent value="text" className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Collez une liste, un export brut, des signatures mail, un carnet d'adresses…
              </p>
              <Textarea
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setPastedFileName(null);
                }}
                placeholder="Jean Dupont, jean@exemple.fr, 06 12 34 56 78&#10;SARL Bâtiment, 12345678901234, contact@batiment.fr…"
                rows={10}
                className="font-mono text-xs"
              />
            </TabsContent>

            <TabsContent value="scan" className="space-y-3">
              <p className="text-sm text-muted-foreground">
                PDF ou image (carte de visite, fiche scannée, capture d'écran). Max 10 Mo.
              </p>
              <input
                ref={scanInputRef}
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => setScanFile(e.target.files?.[0] ?? null)}
              />
              <Button variant="outline" onClick={() => scanInputRef.current?.click()} className="w-full justify-center gap-2">
                <Upload className="h-4 w-4" /> Choisir un PDF ou une image
              </Button>
              {scanFile && (
                <p className="text-xs text-muted-foreground">
                  Source : <span className="font-medium text-foreground">{scanFile.name}</span> ({(scanFile.size / 1024).toFixed(0)} Ko)
                </p>
              )}
            </TabsContent>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
              <Button onClick={analyze} disabled={analyzing} className="shadow-brand gap-1.5">
                <Sparkles className="h-4 w-4" /> {analyzing ? "Analyse…" : "Analyser avec l'IA"}
              </Button>
            </DialogFooter>
          </Tabs>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="secondary">{counts.total} détectées</Badge>
                <Badge variant="default">{counts.selected} à importer</Badge>
                {counts.dup > 0 && (
                  <Badge variant="outline" className="border-amber-500/40 text-amber-600 dark:text-amber-400 gap-1">
                    <AlertTriangle className="h-3 w-3" /> {counts.dup} doublon{counts.dup > 1 ? "s" : ""} ignoré{counts.dup > 1 ? "s" : ""}
                  </Badge>
                )}
              </div>
              <Button variant="ghost" size="sm" onClick={() => setPreview(null)}>← Modifier la source</Button>
            </div>

            <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
              {preview.length === 0 && (
                <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                  Aucune fiche détectée. Reformulez la source ou réessayez avec un autre format.
                </p>
              )}
              {preview.map((r, i) => {
                const isDup = r.duplicate_reason !== null;
                return (
                  <div
                    key={i}
                    className={cn(
                      "rounded-lg border p-3 transition",
                      isDup ? "border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/10 opacity-70" : "border-border bg-card",
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <Checkbox
                        checked={r._selected && !isDup}
                        disabled={isDup}
                        onCheckedChange={(v) => updateRow(i, { _selected: !!v })}
                        className="mt-1"
                      />
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className={cn("gap-1 text-[10px]", r.client_type === "entreprise" ? "border-blue-500/40 text-blue-600 dark:text-blue-400" : "border-emerald-500/40 text-emerald-600 dark:text-emerald-400")}>
                            {r.client_type === "entreprise" ? <Building2 className="h-3 w-3" /> : <User className="h-3 w-3" />}
                            {r.client_type === "entreprise" ? "Entreprise" : "Particulier"}
                          </Badge>
                          {isDup && (
                            <Badge variant="outline" className="border-amber-500/40 text-amber-600 dark:text-amber-400 gap-1">
                              <AlertTriangle className="h-3 w-3" /> Doublon ({r.duplicate_reason === "email" ? "email" : "SIRET"}) — ignoré
                            </Badge>
                          )}
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <div className="space-y-1">
                            <Label className="text-[10px] uppercase text-muted-foreground">Nom</Label>
                            <Input value={r.name} onChange={(e) => updateRow(i, { name: e.target.value })} className="h-8 text-sm" />
                          </div>
                          {r.client_type === "entreprise" && (
                            <div className="space-y-1">
                              <Label className="text-[10px] uppercase text-muted-foreground">Raison sociale</Label>
                              <Input value={r.company_name} onChange={(e) => updateRow(i, { company_name: e.target.value })} className="h-8 text-sm" />
                            </div>
                          )}
                          <div className="space-y-1">
                            <Label className="text-[10px] uppercase text-muted-foreground">Email</Label>
                            <Input value={r.email} onChange={(e) => updateRow(i, { email: e.target.value })} className="h-8 text-sm" />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[10px] uppercase text-muted-foreground">Téléphone</Label>
                            <Input value={r.phone} onChange={(e) => updateRow(i, { phone: e.target.value })} className="h-8 text-sm" />
                          </div>
                          {r.client_type === "entreprise" && (
                            <>
                              <div className="space-y-1">
                                <Label className="text-[10px] uppercase text-muted-foreground">SIRET</Label>
                                <Input value={r.siret} onChange={(e) => updateRow(i, { siret: e.target.value })} className="h-8 text-sm" />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-[10px] uppercase text-muted-foreground">Contact</Label>
                                <Input value={r.contact_name} onChange={(e) => updateRow(i, { contact_name: e.target.value })} className="h-8 text-sm" />
                              </div>
                            </>
                          )}
                          <div className="space-y-1 sm:col-span-2">
                            <Label className="text-[10px] uppercase text-muted-foreground">Adresse</Label>
                            <Input value={r.address_line1} onChange={(e) => updateRow(i, { address_line1: e.target.value })} className="h-8 text-sm" />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[10px] uppercase text-muted-foreground">CP</Label>
                            <Input value={r.postal_code} onChange={(e) => updateRow(i, { postal_code: e.target.value })} className="h-8 text-sm" />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[10px] uppercase text-muted-foreground">Ville</Label>
                            <Input value={r.city} onChange={(e) => updateRow(i, { city: e.target.value })} className="h-8 text-sm" />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
              <Button onClick={doImport} disabled={importing || counts.selected === 0} className="shadow-brand">
                {importing ? "Import…" : `Importer ${counts.selected} client${counts.selected > 1 ? "s" : ""}`}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
