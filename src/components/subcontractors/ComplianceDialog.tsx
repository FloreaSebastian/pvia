/**
 * Dossier administratif d'un sous-traitant : pièces, échéances et règles.
 *
 * L'UI ne calcule aucun statut : elle affiche le résultat renvoyé par le
 * serveur. Aucune mention de conformité légale — uniquement « vos règles ».
 */
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Archive, Download, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ComplianceBadge } from "./ComplianceBadge";
import {
  DOCUMENT_STATUS_LABELS,
  DOC_TYPE_META,
  SUBCONTRACTOR_DOC_TYPES,
  docTypeLabel,
  formatFrDate,
  type SubcontractorDocType,
} from "@/lib/subcontractor-compliance";
import {
  archiveSubcontractorDocument,
  getSubcontractorDocumentUrl,
  listSubcontractorDocuments,
  saveSubcontractorDocumentRule,
  uploadSubcontractorDocument,
} from "@/lib/subcontractor-documents.functions";

const MAX_MB = 10;

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(new Error("Lecture du fichier impossible."));
    r.readAsDataURL(file);
  });
}

export function ComplianceDialog({
  companyId,
  partner,
  onClose,
}: {
  companyId: string;
  partner: { id: string; name: string };
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const listFn = useServerFn(listSubcontractorDocuments);
  const uploadFn = useServerFn(uploadSubcontractorDocument);
  const archiveFn = useServerFn(archiveSubcontractorDocument);
  const urlFn = useServerFn(getSubcontractorDocumentUrl);
  const ruleFn = useServerFn(saveSubcontractorDocumentRule);

  const key = ["sc-documents", companyId, partner.id];
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => listFn({ data: { companyId, subcontractorCompanyId: partner.id } }),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ["sc-compliance", companyId] });
  };

  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState<SubcontractorDocType>("decennale");
  const [label, setLabel] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [notes, setNotes] = useState("");
  const [replaceId, setReplaceId] = useState<string | undefined>();

  const mUpload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choisissez un fichier.");
      if (file.size > MAX_MB * 1024 * 1024) throw new Error(`Fichier trop volumineux (max ${MAX_MB} Mo).`);
      return uploadFn({
        data: {
          companyId,
          subcontractorCompanyId: partner.id,
          docType,
          label,
          filename: file.name,
          fileBase64: await toBase64(file),
          issueDate,
          expiryDate,
          isRequired: true,
          isBlocking: false,
          notes,
          replaceDocumentId: replaceId,
        },
      });
    },
    onSuccess: () => {
      toast.success(replaceId ? "Pièce remplacée." : "Pièce ajoutée.");
      setFile(null);
      setLabel("");
      setIssueDate("");
      setExpiryDate("");
      setNotes("");
      setReplaceId(undefined);
      if (fileRef.current) fileRef.current.value = "";
      refresh();
    },
    onError: (e: any) => toast.error(e?.message ?? "Envoi impossible."),
  });

  const mArchive = useMutation({
    mutationFn: (documentId: string) => archiveFn({ data: { companyId, documentId } }),
    onSuccess: () => {
      toast.success("Pièce archivée.");
      refresh();
    },
    onError: (e: any) => toast.error(e?.message ?? "Archivage impossible."),
  });

  const mRule = useMutation({
    mutationFn: (p: { docType: SubcontractorDocType; isRequired: boolean; isBlocking: boolean }) =>
      ruleFn({ data: { companyId, subcontractorCompanyId: partner.id, ...p } }),
    onSuccess: () => {
      toast.success("Règle enregistrée.");
      refresh();
    },
    onError: (e: any) => toast.error(e?.message ?? "Enregistrement impossible."),
  });

  const open = async (documentId: string) => {
    try {
      const r: any = await urlFn({ data: { companyId, documentId } });
      window.open(r.url, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      toast.error(e?.message ?? "Consultation impossible.");
    }
  };

  const activeDocs = useMemo(
    () => (data?.documents ?? []).filter((d: any) => !d.archived_at),
    [data],
  );
  const archivedDocs = useMemo(
    () => (data?.documents ?? []).filter((d: any) => d.archived_at),
    [data],
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] w-[calc(100vw-1.5rem)] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Documents & conformité — {partner.name}</DialogTitle>
          <DialogDescription>
            Suivi des pièces administratives selon les règles définies par votre entreprise. PVIA ne
            certifie aucune conformité légale.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              {data?.summary ? <ComplianceBadge status={data.summary.status as any} /> : null}
              {data?.summary?.nextExpiry ? (
                <span className="text-sm text-muted-foreground">
                  Prochaine échéance : {data.summary.nextExpiry.label} le{" "}
                  {formatFrDate(data.summary.nextExpiry.date)}
                </span>
              ) : null}
            </div>

            {/* État par type de pièce */}
            <ul className="divide-y rounded-lg border">
              {(data?.summary?.lines ?? []).map((l: any) => (
                <li key={l.docType} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium">{l.label}</span>
                      <Badge variant="outline" className="text-xs">
                        {DOCUMENT_STATUS_LABELS[l.status as keyof typeof DOCUMENT_STATUS_LABELS]}
                      </Badge>
                      {l.blocking ? (
                        <Badge variant="secondary" className="text-xs">
                          Bloquante
                        </Badge>
                      ) : l.required ? (
                        <Badge variant="secondary" className="text-xs">
                          Requise
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {l.expiryDate ? `Valable jusqu'au ${formatFrDate(l.expiryDate)}` : "Sans date d'échéance"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      className="h-11"
                      onClick={() =>
                        mRule.mutate({ docType: l.docType, isRequired: !l.required, isBlocking: l.blocking })
                      }
                    >
                      {l.required ? "Rendre facultative" : "Rendre requise"}
                    </Button>
                    <Button
                      variant="outline"
                      className="h-11"
                      onClick={() =>
                        mRule.mutate({ docType: l.docType, isRequired: true, isBlocking: !l.blocking })
                      }
                    >
                      {l.blocking ? "Ne plus bloquer" : "Rendre bloquante"}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>

            {/* Pièces déposées */}
            <div>
              <h3 className="font-display text-sm font-semibold">Pièces déposées</h3>
              {activeDocs.length === 0 ? (
                <p className="mt-1 text-sm text-muted-foreground">Aucune pièce déposée.</p>
              ) : (
                <ul className="mt-2 divide-y rounded-lg border">
                  {activeDocs.map((d: any) => (
                    <li key={d.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <span className="truncate font-medium">{docTypeLabel(d.doc_type, d.label)}</span>
                        <p className="mt-0.5 truncate text-sm text-muted-foreground">
                          {d.original_filename} · déposée le {formatFrDate(d.uploaded_at)}
                          {d.expiry_date ? ` · échéance ${formatFrDate(d.expiry_date)}` : ""}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" className="h-11" onClick={() => open(d.id)}>
                          <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
                          Consulter
                        </Button>
                        <Button
                          variant="outline"
                          className="h-11"
                          onClick={() => {
                            setReplaceId(d.id);
                            setDocType(d.doc_type);
                            fileRef.current?.click();
                          }}
                        >
                          Remplacer
                        </Button>
                        <Button
                          variant="ghost"
                          className="h-11"
                          onClick={() => mArchive.mutate(d.id)}
                          aria-label={`Archiver ${docTypeLabel(d.doc_type, d.label)}`}
                        >
                          <Archive className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {archivedDocs.length > 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  {archivedDocs.length} pièce(s) archivée(s) conservée(s) pour l'historique.
                </p>
              ) : null}
            </div>

            <Separator />

            {/* Dépôt */}
            <div className="space-y-3">
              <h3 className="font-display text-sm font-semibold">
                {replaceId ? "Remplacer une pièce" : "Ajouter une pièce"}
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="sc-doc-type">Type de pièce</Label>
                  <Select value={docType} onValueChange={(v) => setDocType(v as SubcontractorDocType)}>
                    <SelectTrigger id="sc-doc-type" className="h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SUBCONTRACTOR_DOC_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {DOC_TYPE_META[t].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="sc-doc-label">Intitulé (facultatif)</Label>
                  <Input
                    id="sc-doc-label"
                    className="h-11"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="Ex. Décennale 2026"
                  />
                </div>
                <div>
                  <Label htmlFor="sc-doc-issue">Date d'émission</Label>
                  <Input
                    id="sc-doc-issue"
                    type="date"
                    className="h-11"
                    value={issueDate}
                    onChange={(e) => setIssueDate(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="sc-doc-expiry">Date d'échéance</Label>
                  <Input
                    id="sc-doc-expiry"
                    type="date"
                    className="h-11"
                    value={expiryDate}
                    onChange={(e) => setExpiryDate(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="sc-doc-notes">Note interne (facultatif)</Label>
                <Textarea
                  id="sc-doc-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                />
              </div>
              <div>
                <Label htmlFor="sc-doc-file">Fichier (PDF, JPG ou PNG — {MAX_MB} Mo max)</Label>
                <Input
                  id="sc-doc-file"
                  ref={fileRef}
                  type="file"
                  accept="application/pdf,image/jpeg,image/png"
                  className="h-11"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                {file ? <p className="mt-1 text-sm text-muted-foreground">{file.name}</p> : null}
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" className="h-11 w-full sm:w-auto" onClick={onClose}>
            Fermer
          </Button>
          <Button
            className="h-11 w-full sm:w-auto"
            onClick={() => mUpload.mutate()}
            disabled={mUpload.isPending || !file}
          >
            {mUpload.isPending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Upload className="mr-1.5 h-4 w-4" aria-hidden="true" />
            )}
            {replaceId ? "Remplacer la pièce" : "Ajouter la pièce"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
