import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, Clock, FileUp, Hourglass, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { SubcontractorShell } from "@/components/subcontractor/SubcontractorShell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DOCUMENT_STATUS_LABELS, docTypeLabel, SUBCONTRACTOR_DOC_TYPES } from "@/lib/subcontractor-compliance";
import {
  getMyDocumentUrl,
  listMyCompanies,
  listMyDocuments,
  uploadMyDocument,
} from "@/lib/subcontractor-portal-documents.functions";

export const Route = createFileRoute("/sous-traitant/documents")({
  component: MyDocumentsPage,
  head: () => ({
    meta: [
      { title: "Mes documents — Espace sous-traitant PVIA" },
      {
        name: "description",
        content:
          "Déposez et suivez vos attestations, assurances et habilitations demandées par l'entreprise donneuse d'ordre.",
      },
      { property: "og:title", content: "Mes documents — Espace sous-traitant PVIA" },
      { property: "og:description", content: "Vos pièces administratives et leur statut de validation." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

const STATUS_STYLE: Record<string, { cls: string; Icon: typeof CheckCircle2 }> = {
  valid: { cls: "bg-green-600 text-white", Icon: CheckCircle2 },
  no_expiry: { cls: "bg-green-600 text-white", Icon: CheckCircle2 },
  expiring_soon: { cls: "bg-amber-500 text-white", Icon: Clock },
  expired: { cls: "bg-destructive text-destructive-foreground", Icon: AlertTriangle },
  missing: { cls: "bg-orange-600 text-white", Icon: AlertTriangle },
  pending_review: { cls: "bg-sky-600 text-white", Icon: Hourglass },
  rejected: { cls: "bg-destructive text-destructive-foreground", Icon: XCircle },
};

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("Lecture du fichier impossible."));
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.readAsDataURL(file);
  });
}

function MyDocumentsPage() {
  const qc = useQueryClient();
  const loadCompanies = useServerFn(listMyCompanies);
  const loadDocs = useServerFn(listMyDocuments);
  const upload = useServerFn(uploadMyDocument);
  const openDoc = useServerFn(getMyDocumentUrl);

  const [companyId, setCompanyId] = useState<string>("");
  const companies = useQuery({
    queryKey: ["sc-my-companies"],
    queryFn: () => loadCompanies(),
    retry: false,
  });

  const list = (companies.data?.companies ?? []) as Array<{ companyId: string; companyName: string }>;
  useEffect(() => {
    if (!companyId && list.length > 0) setCompanyId(list[0]!.companyId);
  }, [companyId, list]);

  const docs = useQuery({
    queryKey: ["sc-my-documents", companyId],
    queryFn: () => loadDocs({ data: { companyId } }),
    enabled: !!companyId,
    retry: false,
  });

  const lines = docs.data?.summary.lines ?? [];
  const history = (docs.data?.documents ?? []).filter((d) => d.archived);
  const todo = useMemo(
    () => lines.filter((l) => l.status === "missing" || l.status === "expired" || l.status === "rejected"),
    [lines],
  );

  const fileRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState<string>("");
  const [issueDate, setIssueDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");

  const send = useMutation({
    mutationFn: async () => {
      const file = fileRef.current?.files?.[0];
      if (!file) throw new Error("Choisissez un fichier PDF, JPG ou PNG.");
      if (!docType) throw new Error("Choisissez le type de pièce.");
      if (file.size > 10 * 1024 * 1024) throw new Error("Fichier trop volumineux (10 Mo maximum).");
      return upload({
        data: {
          companyId,
          docType: docType as (typeof SUBCONTRACTOR_DOC_TYPES)[number],
          filename: file.name,
          fileBase64: await toBase64(file),
          issueDate,
          expiryDate,
        },
      });
    },
    onSuccess: () => {
      toast.success("Pièce envoyée. Elle sera vérifiée par l'entreprise.");
      if (fileRef.current) fileRef.current.value = "";
      setIssueDate("");
      setExpiryDate("");
      void qc.invalidateQueries({ queryKey: ["sc-my-documents", companyId] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Envoi impossible."),
  });

  async function view(documentId: string) {
    try {
      const r = await openDoc({ data: { companyId, documentId } });
      window.open(r.url, "_blank", "noopener,noreferrer");
    } catch {
      toast.error("Lien indisponible, réessayez.");
    }
  }

  return (
    <SubcontractorShell title="Mes documents">
      {companies.isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : list.length === 0 ? (
        <Card className="p-4 text-sm text-muted-foreground">
          Aucune entreprise donneuse d'ordre active pour votre compte.
        </Card>
      ) : (
        <div className="space-y-4">
          {list.length > 1 && (
            <div className="space-y-1.5">
              <Label htmlFor="sc-company">Entreprise donneuse d'ordre</Label>
              <Select value={companyId} onValueChange={setCompanyId}>
                <SelectTrigger id="sc-company" className="min-h-11">
                  <SelectValue placeholder="Choisir" />
                </SelectTrigger>
                <SelectContent>
                  {list.map((c) => (
                    <SelectItem key={c.companyId} value={c.companyId}>
                      {c.companyName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {todo.length > 0 && (
            <Card className="border-orange-300 bg-orange-50 p-3 text-sm dark:bg-orange-950/20">
              <p className="font-semibold">À faire ({todo.length})</p>
              <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                {todo.map((l) => (
                  <li key={l.docType}>
                    {l.label} — {DOCUMENT_STATUS_LABELS[l.status]}
                    {l.rejectionReason ? ` : ${l.rejectionReason}` : ""}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card className="space-y-3 p-3">
            <p className="font-semibold">Déposer une pièce</p>
            <div className="space-y-1.5">
              <Label htmlFor="sc-doctype">Type de pièce</Label>
              <Select value={docType} onValueChange={setDocType}>
                <SelectTrigger id="sc-doctype" className="min-h-11">
                  <SelectValue placeholder="Choisir un type" />
                </SelectTrigger>
                <SelectContent>
                  {SUBCONTRACTOR_DOC_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {docTypeLabel(t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="sc-issue">Date d'émission</Label>
                <Input
                  id="sc-issue"
                  type="date"
                  className="min-h-11"
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sc-expiry">Date d'échéance</Label>
                <Input
                  id="sc-expiry"
                  type="date"
                  className="min-h-11"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sc-file">Fichier (PDF, JPG ou PNG — 10 Mo max)</Label>
              <Input
                id="sc-file"
                ref={fileRef}
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                capture="environment"
                className="min-h-11"
              />
            </div>
            <Button
              className="min-h-11 w-full"
              onClick={() => send.mutate()}
              disabled={send.isPending || !companyId}
            >
              {send.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <FileUp className="mr-2 h-4 w-4" aria-hidden="true" />
              )}
              Envoyer la pièce
            </Button>
          </Card>

          <section aria-label="Mes pièces">
            {docs.isLoading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <ul className="space-y-2">
                {lines.map((l) => {
                  const style = STATUS_STYLE[l.status] ?? STATUS_STYLE.missing!;
                  const Icon = style.Icon;
                  return (
                    <li key={l.docType}>
                      <Card className="flex flex-wrap items-center justify-between gap-2 p-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{l.label}</p>
                          <p className="text-xs text-muted-foreground">
                            {l.expiryDate ? `Échéance ${l.expiryDate}` : "Sans échéance"}
                            {l.required ? " · Requise" : ""}
                            {l.blocking ? " · Bloquante" : ""}
                          </p>
                          {l.rejectionReason && (
                            <p className="mt-1 text-xs text-destructive">Motif du refus : {l.rejectionReason}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge className={`${style.cls} gap-1`}>
                            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                            {DOCUMENT_STATUS_LABELS[l.status]}
                          </Badge>
                          {l.documentId && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="min-h-11"
                              onClick={() => view(l.documentId!)}
                            >
                              Voir
                            </Button>
                          )}
                        </div>
                      </Card>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {history.length > 0 && (
            <details className="rounded-lg border bg-background p-3">
              <summary className="min-h-11 cursor-pointer text-sm font-medium">
                Historique des versions ({history.length})
              </summary>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                {history.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">
                      {d.label} — {new Date(d.uploadedAt).toLocaleDateString("fr-FR")}
                    </span>
                    <Button variant="ghost" size="sm" className="min-h-11" onClick={() => view(d.id)}>
                      Voir
                    </Button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </SubcontractorShell>
  );
}
