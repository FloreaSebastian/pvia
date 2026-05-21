import { CheckCircle2, Circle, FileText, PenLine, Send, Sparkles } from "lucide-react";

type Step = {
  key: string;
  label: string;
  icon: typeof Circle;
  done: boolean;
  at?: string | null;
  hint?: string;
};

type Props = {
  createdAt: string;
  sentAt?: string | null;
  signedAt?: string | null;
  pdfGeneratedAt?: string | null;
  hasClientSignature: boolean;
};

function fmt(iso?: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleString("fr-FR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Visual progression of a PV: created → sent → signed → PDF generated.
 * Pure presentational — no business logic, no fetches.
 */
export function SignatureTimeline({
  createdAt,
  sentAt,
  signedAt,
  pdfGeneratedAt,
  hasClientSignature,
}: Props) {
  const steps: Step[] = [
    {
      key: "created",
      label: "PV créé",
      icon: Sparkles,
      done: true,
      at: createdAt,
    },
    {
      key: "sent",
      label: "Envoyé au client",
      icon: Send,
      done: !!sentAt || hasClientSignature || !!signedAt,
      at: sentAt,
      hint: !sentAt && !hasClientSignature ? "En attente d'envoi" : undefined,
    },
    {
      key: "signed",
      label: "Signé par le client",
      icon: PenLine,
      done: !!signedAt || hasClientSignature,
      at: signedAt,
      hint: !signedAt && !hasClientSignature ? "Signature en attente" : undefined,
    },
    {
      key: "pdf",
      label: "PDF généré",
      icon: FileText,
      done: !!pdfGeneratedAt,
      at: pdfGeneratedAt,
      hint: !pdfGeneratedAt ? "Sera généré après signature" : undefined,
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const progressPct = ((doneCount - 1) / (steps.length - 1)) * 100;

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h3 className="font-display text-sm font-semibold tracking-tight">Cycle de signature</h3>
          <p className="text-xs text-muted-foreground">
            Étape {doneCount} sur {steps.length}
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold tabular-nums text-primary">
            {Math.round((doneCount / steps.length) * 100)}%
          </div>
        </div>
      </div>

      {/* Desktop: horizontal timeline */}
      <div className="relative hidden sm:block">
        {/* Background rail */}
        <div className="absolute left-4 right-4 top-4 h-px bg-border" />
        {/* Progress rail */}
        <div
          className="absolute left-4 top-4 h-px bg-primary transition-all duration-700"
          style={{ width: `calc((100% - 2rem) * ${progressPct / 100})` }}
        />
        <div className="relative grid grid-cols-4 gap-2">
          {steps.map((s) => {
            const Icon = s.done ? CheckCircle2 : s.icon;
            return (
              <div key={s.key} className="flex flex-col items-center text-center">
                <div
                  className={`relative grid h-8 w-8 place-items-center rounded-full ring-4 ring-card ${
                    s.done
                      ? "bg-primary text-primary-foreground shadow-brand"
                      : "border border-dashed border-border bg-card text-muted-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="mt-2 text-xs font-medium">{s.label}</div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">
                  {fmt(s.at) ?? s.hint ?? "—"}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Mobile: vertical timeline */}
      <ol className="space-y-3 sm:hidden">
        {steps.map((s, i) => {
          const Icon = s.done ? CheckCircle2 : s.icon;
          const isLast = i === steps.length - 1;
          return (
            <li key={s.key} className="relative flex gap-3 pb-1">
              {!isLast && (
                <span
                  className={`absolute left-[15px] top-8 h-full w-px ${
                    s.done ? "bg-primary" : "bg-border"
                  }`}
                />
              )}
              <div
                className={`relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full ${
                  s.done
                    ? "bg-primary text-primary-foreground"
                    : "border border-dashed border-border bg-card text-muted-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
              </div>
              <div className="flex-1 pb-3">
                <div className="text-sm font-medium">{s.label}</div>
                <div className="text-xs text-muted-foreground">
                  {fmt(s.at) ?? s.hint ?? "—"}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
