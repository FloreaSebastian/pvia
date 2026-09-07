import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  FileText,
  Loader2,
  MapPin,
  MessageSquare,
  Phone,
  Send,
  StickyNote,
} from "lucide-react";
import { toast } from "sonner";
import { SubcontractorShell } from "@/components/subcontractor/SubcontractorShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  addSubcontractorNote,
  getSubcontractorAssignment,
  sendSubcontractorMessage,
  setSubcontractorAssignmentStatus,
  uploadSubcontractorPhoto,
} from "@/lib/subcontractor-portal.functions";
import { INTERVENTION_STATUS_LABELS, MISSION_OPTIONS } from "@/lib/subcontractor-permissions";

export const Route = createFileRoute("/sous-traitant/intervention/$id")({
  component: InterventionPage,
  head: () => ({
    meta: [
      { title: "Intervention — Espace sous-traitant PVIA" },
      {
        name: "description",
        content:
          "Détail de votre intervention : chantier, mission, photos, documents, réserves et échanges avec l'entreprise.",
      },
      { property: "og:title", content: "Intervention — Espace sous-traitant PVIA" },
      { property: "og:description", content: "Suivez et clôturez votre intervention depuis le terrain." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

const NEXT_STATUS: Array<{ value: "confirmed" | "en_route" | "on_site" | "in_progress" | "done"; label: string }> = [
  { value: "confirmed", label: "Confirmer" },
  { value: "en_route", label: "En route" },
  { value: "on_site", label: "Sur site" },
  { value: "in_progress", label: "Démarrer" },
  { value: "done", label: "Terminer" },
];

function InterventionPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const load = useServerFn(getSubcontractorAssignment);
  const setStatus = useServerFn(setSubcontractorAssignmentStatus);
  const sendMessage = useServerFn(sendSubcontractorMessage);
  const addNote = useServerFn(addSubcontractorNote);
  const uploadPhoto = useServerFn(uploadSubcontractorPhoto);

  const [message, setMessage] = useState("");
  const [note, setNote] = useState("");
  const [uploading, setUploading] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["subcontractor-assignment", id],
    queryFn: () => load({ data: { assignmentId: id } }),
    retry: false,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["subcontractor-assignment", id] });
  const perms = (data?.permissions ?? {}) as Record<string, boolean>;

  const mStatus = useMutation({
    mutationFn: (status: (typeof NEXT_STATUS)[number]["value"]) =>
      setStatus({ data: { assignmentId: id, status } }),
    onSuccess: () => {
      toast.success("Statut mis à jour.");
      refresh();
    },
    onError: (e: any) => toast.error(e?.message ?? "Mise à jour impossible."),
  });

  const mMessage = useMutation({
    mutationFn: () => sendMessage({ data: { assignmentId: id, body: message.trim() } }),
    onSuccess: () => {
      setMessage("");
      refresh();
    },
    onError: (e: any) => toast.error(e?.message ?? "Envoi impossible."),
  });

  const mNote = useMutation({
    mutationFn: () => addNote({ data: { assignmentId: id, note: note.trim() } }),
    onSuccess: () => {
      setNote("");
      toast.success("Compte-rendu transmis.");
    },
    onError: (e: any) => toast.error(e?.message ?? "Enregistrement impossible."),
  });

  async function onPickPhoto(file: File) {
    if (!file) return;
    setUploading(true);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i += 1) bin += String.fromCharCode(buf[i]!);
      const contentType = (["image/jpeg", "image/png", "image/webp"] as const).includes(file.type as never)
        ? (file.type as "image/jpeg" | "image/png" | "image/webp")
        : "image/jpeg";
      await uploadPhoto({
        data: {
          assignmentId: id,
          fileName: file.name.slice(0, 200),
          contentType,
          dataBase64: btoa(bin),
          caption: "",
          photoType: "during",
          takenAt: new Date().toISOString(),
        },
      });
      toast.success("Photo envoyée.");
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Envoi de la photo impossible.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <SubcontractorShell>
      <Link
        to="/sous-traitant"
        className="mb-3 inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Mes interventions
      </Link>

      {isLoading ? (
        <div className="flex h-56 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : error || !data ? (
        <Card className="p-5 text-sm text-muted-foreground">
          Cette intervention ne vous est pas accessible.
        </Card>
      ) : (
        <div className="space-y-4">
          <Card className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-lg font-bold tracking-tight">
                {data.chantier?.reference ? `${data.chantier.reference} · ` : ""}
                {data.chantier?.name}
              </h1>
              <Badge variant="secondary">
                {INTERVENTION_STATUS_LABELS[data.assignment.status] ?? data.assignment.status}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {MISSION_OPTIONS.find((m) => m.value === data.assignment.mission)?.label ?? data.assignment.mission}
              {" · "}
              {data.assignment.scheduled_at
                ? new Date(data.assignment.scheduled_at).toLocaleString("fr-FR", {
                    dateStyle: "full",
                    timeStyle: "short",
                  })
                : "à planifier"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Donneur d'ordre : {data.companyName}</p>

            {data.chantier?.address ? (
              <a
                className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-sm text-primary"
                href={`https://maps.google.com/?q=${encodeURIComponent(data.chantier.address)}`}
                target="_blank"
                rel="noreferrer"
              >
                <MapPin className="h-4 w-4" aria-hidden="true" />
                {data.chantier.address}
              </a>
            ) : null}

            {data.client ? (
              <p className="mt-2 flex items-center gap-1.5 text-sm">
                <Phone className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                {data.client.name}
                {data.client.phone ? ` · ${data.client.phone}` : ""}
              </p>
            ) : null}

            {data.assignment.comment ? (
              <p className="mt-3 rounded-lg bg-muted/60 p-3 text-sm">{data.assignment.comment}</p>
            ) : null}
          </Card>

          {perms["assignment.status_update"] && data.assignment.status !== "done" && (
            <Card className="p-4">
              <h2 className="text-sm font-semibold">Suivi de l'intervention</h2>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {NEXT_STATUS.map((s) => (
                  <Button
                    key={s.value}
                    variant={s.value === "done" ? "default" : "outline"}
                    className="h-11"
                    disabled={mStatus.isPending}
                    onClick={() => mStatus.mutate(s.value)}
                  >
                    {s.value === "done" ? (
                      <CheckCircle2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    ) : null}
                    {s.label}
                  </Button>
                ))}
              </div>
            </Card>
          )}

          {perms["chantier.photos.add"] && (
            <Card className="p-4">
              <h2 className="text-sm font-semibold">Photos</h2>
              <label className="mt-3 flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed text-sm font-medium">
                {uploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Camera className="h-4 w-4" aria-hidden="true" />
                )}
                {uploading ? "Envoi…" : "Prendre / ajouter une photo"}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="sr-only"
                  onChange={(e) => e.target.files?.[0] && onPickPhoto(e.target.files[0]!)}
                />
              </label>
              {data.photos.length > 0 && (
                <ul className="mt-3 grid grid-cols-3 gap-2">
                  {data.photos.slice(0, 12).map((p: any) => (
                    <li key={p.id}>
                      {p.signed_url ? (
                        <img
                          src={p.signed_url}
                          alt={p.caption || p.label || "Photo du chantier"}
                          loading="lazy"
                          className="aspect-square w-full rounded-lg object-cover"
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {perms["chantier.documents.view"] && data.documents.length > 0 && (
            <Card className="p-4">
              <h2 className="text-sm font-semibold">Documents</h2>
              <ul className="mt-2 divide-y">
                {data.documents.map((d: any) => (
                  <li key={d.id}>
                    <a
                      href={d.signed_url ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="flex min-h-12 items-center gap-2 text-sm"
                    >
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="truncate">{d.name}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {perms["reserve.view"] && data.reserves.length > 0 && (
            <Card className="p-4">
              <h2 className="text-sm font-semibold">Réserves ({data.reserves.length})</h2>
              <ul className="mt-2 space-y-2">
                {data.reserves.map((r: any) => (
                  <li key={r.id} className="rounded-lg border p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        {r.status}
                      </Badge>
                      {r.due_date ? (
                        <span className="text-xs text-muted-foreground">
                          Échéance {new Date(r.due_date).toLocaleDateString("fr-FR")}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1">{r.description}</p>
                    {r.work_to_execute ? (
                      <p className="mt-1 text-muted-foreground">{r.work_to_execute}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {perms["chantier.notes.add"] && (
            <Card className="p-4">
              <Label htmlFor="sc-note" className="text-sm font-semibold">
                <StickyNote className="mr-1.5 inline h-4 w-4" aria-hidden="true" />
                Compte-rendu
              </Label>
              <Textarea
                id="sc-note"
                rows={3}
                className="mt-2"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Travaux réalisés, points d'attention…"
              />
              <Button
                className="mt-2 h-11 w-full"
                disabled={!note.trim() || mNote.isPending}
                onClick={() => mNote.mutate()}
              >
                {mNote.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Transmettre"}
              </Button>
            </Card>
          )}

          {perms["assignment.message"] && (
            <Card className="p-4">
              <h2 className="text-sm font-semibold">
                <MessageSquare className="mr-1.5 inline h-4 w-4" aria-hidden="true" />
                Échanges
              </h2>
              <ul className="mt-3 space-y-2">
                {data.messages.map((m: any) => (
                  <li
                    key={m.id}
                    className={`rounded-lg p-3 text-sm ${
                      m.author_kind === "company" ? "bg-muted/60" : "bg-primary/10"
                    }`}
                  >
                    <p className="text-xs font-medium text-muted-foreground">
                      {m.author_label} · {new Date(m.created_at).toLocaleString("fr-FR")}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap">{m.body}</p>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex gap-2">
                <Textarea
                  rows={2}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Votre message…"
                  aria-label="Message à l'entreprise"
                />
                <Button
                  className="h-11 w-11 shrink-0 p-0"
                  aria-label="Envoyer"
                  disabled={!message.trim() || mMessage.isPending}
                  onClick={() => mMessage.mutate()}
                >
                  {mMessage.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" aria-hidden="true" />
                  )}
                </Button>
              </div>
            </Card>
          )}
        </div>
      )}
    </SubcontractorShell>
  );
}
