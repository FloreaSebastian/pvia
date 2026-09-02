/**
 * Maquettes d'interface PVIA pour la homepage publique.
 *
 * 100 % HTML/CSS (aucune image lourde, aucun layout shift) et uniquement
 * des données fictives — jamais de données client réelles.
 */
import {
  Camera,
  Check,
  CheckCircle2,
  ChevronRight,
  FileText,
  MapPin,
  PenLine,
  Users,
} from "lucide-react";

function Frame({
  children,
  className = "",
  label,
}: {
  children: React.ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <div
      role="img"
      aria-label={label}
      className={`overflow-hidden rounded-2xl border border-border bg-card shadow-elevation-lg ${className}`}
    >
      <div className="flex items-center gap-1.5 border-b border-border/70 bg-muted/50 px-3 py-2">
        <span className="h-2 w-2 rounded-full bg-muted-foreground/30" />
        <span className="h-2 w-2 rounded-full bg-muted-foreground/30" />
        <span className="h-2 w-2 rounded-full bg-muted-foreground/30" />
        <span className="ml-2 truncate text-[10px] font-medium text-muted-foreground">
          app.pvia.fr
        </span>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-background p-2.5">
      <p className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 font-display text-lg font-bold leading-none text-foreground">{value}</p>
    </div>
  );
}

/** Tableau de bord PVIA (données fictives). */
export function DashboardMockup({ className = "" }: { className?: string }) {
  const rows = [
    { ref: "PV-2026-0184", site: "Toiture Villa Dumas", state: "Signé", tone: "success" },
    { ref: "PV-2026-0183", site: "PAC — Résidence Aubier", state: "En attente", tone: "warning" },
    { ref: "PV-2026-0182", site: "Photovoltaïque Roux", state: "2 réserves", tone: "primary" },
  ];
  return (
    <Frame label="Tableau de bord PVIA : indicateurs et derniers procès-verbaux" className={className}>
      <div className="p-3 sm:p-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Kpi label="Chantiers" value="12" />
          <Kpi label="PV du mois" value="28" />
          <Kpi label="Réserves" value="5" />
          <Kpi label="Signés" value="23" />
        </div>

        <div className="mt-3 rounded-lg border border-border">
          <p className="border-b border-border px-3 py-2 text-[11px] font-semibold text-foreground">
            Derniers procès-verbaux
          </p>
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.ref} className="flex min-w-0 items-center gap-2 px-3 py-2">
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-medium text-foreground">{r.site}</p>
                  <p className="truncate text-[10px] text-muted-foreground">{r.ref}</p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold ${
                    r.tone === "success"
                      ? "bg-success/15 text-success"
                      : r.tone === "warning"
                        ? "bg-warning/15 text-warning"
                        : "bg-primary/10 text-primary"
                  }`}
                >
                  {r.state}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Frame>
  );
}

/** Téléphone « mode terrain » (données fictives). */
export function PhoneMockup({
  className = "",
  label = "Application PVIA sur smartphone en mode terrain",
  children,
}: {
  className?: string;
  label?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      role="img"
      aria-label={label}
      className={`w-full max-w-[220px] overflow-hidden rounded-[1.75rem] border-[6px] border-foreground/85 bg-card shadow-elevation-xl ${className}`}
    >
      <div className="flex items-center justify-between bg-foreground/85 px-4 pb-1.5 text-[9px] font-medium text-background">
        <span>9:41</span>
        <span>PVIA</span>
      </div>
      <div className="min-w-0 p-3">{children ?? <FieldContent />}</div>
    </div>
  );
}

function FieldContent() {
  return (
    <>
      <p className="truncate text-[11px] font-semibold text-foreground">Réception — Villa Dumas</p>
      <p className="mt-0.5 flex items-center gap-1 truncate text-[9px] text-muted-foreground">
        <MapPin className="h-2.5 w-2.5 shrink-0" /> 12 rue des Chênes, Aix-en-Provence
      </p>

      <div className="mt-2.5 grid grid-cols-3 gap-1.5">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="grid aspect-square place-items-center rounded-md bg-muted text-muted-foreground"
          >
            <Camera className="h-3.5 w-3.5" />
          </div>
        ))}
      </div>

      <div className="mt-2.5 space-y-1.5">
        <div className="flex min-w-0 items-center gap-1.5 rounded-md border border-border px-2 py-1.5">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
          <span className="truncate text-[9px] text-foreground">Réserve — joint défectueux</span>
        </div>
        <div className="flex min-w-0 items-center gap-1.5 rounded-md border border-border px-2 py-1.5">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
          <span className="truncate text-[9px] text-foreground">Réserve levée — reprise peinture</span>
        </div>
      </div>

      <div className="mt-2.5 rounded-md border border-dashed border-primary/40 bg-primary/5 p-2 text-center">
        <PenLine className="mx-auto h-3.5 w-3.5 text-primary" />
        <p className="mt-1 text-[9px] font-medium text-primary">Signature du client</p>
      </div>
    </>
  );
}

/** Carte flottante discrète (ex. « PV signé »). */
export function FloatingCard({
  label,
  tone = "success",
  className = "",
}: {
  label: string;
  tone?: "success" | "primary";
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none flex items-center gap-1.5 rounded-full border border-border bg-card/95 px-2.5 py-1.5 shadow-elevation-md backdrop-blur ${className}`}
    >
      <CheckCircle2
        className={`h-3.5 w-3.5 shrink-0 ${tone === "success" ? "text-success" : "text-primary"}`}
      />
      <span className="whitespace-nowrap text-[10px] font-semibold text-foreground">{label}</span>
    </div>
  );
}

/** Workflow d'une réserve (fictif). */
export function ReserveMockup({ className = "" }: { className?: string }) {
  const steps = [
    { label: "Réserve ouverte", detail: "Gravité majeure · Lot plomberie", tone: "warning" },
    { label: "Photo avant", detail: "Ajoutée depuis le chantier", tone: "muted" },
    { label: "Assignée", detail: "Karim — conducteur de travaux", tone: "muted" },
    { label: "Photo après", detail: "Reprise réalisée", tone: "muted" },
    { label: "Validée par le client", detail: "Levée confirmée", tone: "success" },
  ];
  return (
    <Frame label="Suivi d'une réserve dans PVIA, de l'ouverture à la validation client" className={className}>
      <ol className="space-y-2 p-3 sm:p-4">
        {steps.map((s, i) => (
          <li key={s.label} className="flex min-w-0 items-start gap-2.5">
            <span
              className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[9px] font-bold ${
                s.tone === "success"
                  ? "bg-success/15 text-success"
                  : s.tone === "warning"
                    ? "bg-warning/15 text-warning"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {s.tone === "success" ? <Check className="h-3 w-3" /> : i + 1}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[11px] font-semibold text-foreground">{s.label}</p>
              <p className="truncate text-[10px] text-muted-foreground">{s.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </Frame>
  );
}

/** Espace client externe (fictif). */
export function ClientSpaceMockup({ className = "" }: { className?: string }) {
  return (
    <Frame label="Espace client PVIA : documents partagés avec le client" className={className}>
      <div className="p-3 sm:p-4">
        <p className="truncate text-[11px] font-semibold text-foreground">Espace client — M. Dumas</p>
        <ul className="mt-2.5 space-y-1.5">
          {[
            { t: "PV de réception — Toiture", s: "Signé le 14/03", icon: FileText },
            { t: "Levée de réserves n°2", s: "À valider", icon: CheckCircle2 },
            { t: "PV de réception — PAC", s: "PDF disponible", icon: FileText },
          ].map((d) => (
            <li
              key={d.t}
              className="flex min-w-0 items-center gap-2 rounded-lg border border-border px-2.5 py-2"
            >
              <d.icon className="h-3.5 w-3.5 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-medium text-foreground">{d.t}</p>
                <p className="truncate text-[10px] text-muted-foreground">{d.s}</p>
              </div>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </li>
          ))}
        </ul>
      </div>
    </Frame>
  );
}

/** Calendrier / planning (fictif). */
export function CalendarMockup({ className = "" }: { className?: string }) {
  const days = ["L", "M", "M", "J", "V", "S", "D"];
  const events: Record<number, { label: string; tone: string }> = {
    3: { label: "Réception Dumas", tone: "primary" },
    5: { label: "Levée réserves", tone: "warning" },
    10: { label: "Pose PAC", tone: "success" },
  };
  return (
    <Frame label="Calendrier PVIA : interventions et réceptions planifiées" className={className}>
      <div className="p-3 sm:p-4">
        <div className="flex min-w-0 items-center justify-between">
          <p className="truncate text-[11px] font-semibold text-foreground">Mars 2026</p>
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Users className="h-3 w-3" /> 4 techniciens
          </span>
        </div>
        <div className="mt-2 grid grid-cols-7 gap-1 text-center">
          {days.map((d, i) => (
            <span key={i} className="text-[9px] font-medium text-muted-foreground">
              {d}
            </span>
          ))}
          {Array.from({ length: 14 }, (_, i) => {
            const ev = events[i];
            return (
              <div
                key={i}
                className={`grid aspect-square place-items-center rounded-md text-[9px] ${
                  ev
                    ? ev.tone === "primary"
                      ? "bg-primary/15 font-semibold text-primary"
                      : ev.tone === "warning"
                        ? "bg-warning/15 font-semibold text-warning"
                        : "bg-success/15 font-semibold text-success"
                    : "bg-muted/60 text-muted-foreground"
                }`}
              >
                {i + 1}
              </div>
            );
          })}
        </div>
        <ul className="mt-2.5 space-y-1">
          {Object.values(events).map((e) => (
            <li key={e.label} className="flex min-w-0 items-center gap-1.5">
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  e.tone === "primary"
                    ? "bg-primary"
                    : e.tone === "warning"
                      ? "bg-warning"
                      : "bg-success"
                }`}
              />
              <span className="truncate text-[10px] text-muted-foreground">{e.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </Frame>
  );
}

/** Statistiques / pilotage (fictif). */
export function StatsMockup({ className = "" }: { className?: string }) {
  const bars = [40, 62, 48, 75, 58, 82, 70];
  return (
    <Frame label="Statistiques PVIA : évolution des procès-verbaux et des réserves" className={className}>
      <div className="p-3 sm:p-4">
        <div className="grid grid-cols-3 gap-2">
          <Kpi label="PV signés" value="23" />
          <Kpi label="En attente" value="4" />
          <Kpi label="Réserves" value="5" />
        </div>
        <div className="mt-3 flex h-24 items-end gap-1.5 rounded-lg border border-border p-2.5">
          {bars.map((h, i) => (
            <span
              key={i}
              className="flex-1 rounded-t-sm bg-primary/70"
              style={{ height: `${h}%` }}
            />
          ))}
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          Comparaison des périodes · exemple d'affichage
        </p>
      </div>
    </Frame>
  );
}

/** Parcours PV → signature → PDF (fictif). */
export function SignatureMockup({ className = "" }: { className?: string }) {
  return (
    <Frame label="Signature d'un procès-verbal et génération du PDF" className={className}>
      <div className="p-3 sm:p-4">
        <div className="rounded-lg border border-border p-3">
          <p className="truncate text-[11px] font-semibold text-foreground">
            PV-2026-0184 — Toiture Villa Dumas
          </p>
          <div className="mt-2 space-y-1">
            {["Objet de la réception", "Réserves (2)", "Photos (6)"].map((l) => (
              <div key={l} className="flex min-w-0 items-center gap-1.5">
                <Check className="h-3 w-3 shrink-0 text-success" />
                <span className="truncate text-[10px] text-muted-foreground">{l}</span>
              </div>
            ))}
          </div>
          <div className="mt-2.5 rounded-md border border-dashed border-primary/40 bg-primary/5 px-2 py-3">
            <svg viewBox="0 0 160 30" className="h-7 w-full text-primary" aria-hidden="true">
              <path
                d="M4 22c14-18 22 6 33-4s16 8 27-6 20 14 33 2 22 4 30-2"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            <p className="mt-1 text-center text-[9px] font-medium text-primary">
              Signature du client
            </p>
          </div>
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {["PDF généré", "Envoyé au client", "Historique tracé"].map((s) => (
            <span
              key={s}
              className="rounded-full bg-success/12 px-2 py-1 text-[9px] font-semibold text-success"
            >
              {s}
            </span>
          ))}
        </div>
      </div>
    </Frame>
  );
}

/** Fiche chantier : tout ce qui est rattaché au dossier (fictif). */
export function ChantierMockup({ className = "" }: { className?: string }) {
  const links = [
    { l: "Client", v: "M. Dumas" },
    { l: "Planning", v: "3 interventions" },
    { l: "Équipe", v: "2 techniciens" },
    { l: "PV", v: "PV-2026-0184" },
    { l: "Réserves", v: "2 ouvertes" },
    { l: "Photos", v: "14" },
    { l: "Documents", v: "5" },
    { l: "Historique", v: "18 événements" },
  ];
  return (
    <Frame label="Fiche chantier PVIA : client, planning, équipe, PV, réserves et documents" className={className}>
      <div className="p-3 sm:p-4">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[11px] font-semibold text-foreground">Toiture Villa Dumas</p>
            <p className="truncate text-[10px] text-muted-foreground">CH0184AZ · Aix-en-Provence</p>
          </div>
          <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[9px] font-semibold text-primary">
            En cours
          </span>
        </div>
        <ul className="mt-3 grid grid-cols-2 gap-1.5">
          {links.map((i) => (
            <li key={i.l} className="min-w-0 rounded-lg border border-border px-2.5 py-1.5">
              <p className="truncate text-[9px] uppercase tracking-wide text-muted-foreground">{i.l}</p>
              <p className="truncate text-[10px] font-medium text-foreground">{i.v}</p>
            </li>
          ))}
        </ul>
      </div>
    </Frame>
  );
}

/** Membres de l'entreprise et rôles (fictif). */
export function TeamMockup({ className = "" }: { className?: string }) {
  const members = [
    { n: "Sophie L.", r: "Owner" },
    { n: "Karim B.", r: "Manager" },
    { n: "Julien P.", r: "Utilisateur" },
    { n: "Invitation en attente", r: "Utilisateur" },
  ];
  return (
    <Frame label="Membres de l'entreprise dans PVIA et rôles associés" className={className}>
      <div className="p-3 sm:p-4">
        <p className="truncate text-[11px] font-semibold text-foreground">Équipe — 4 membres</p>
        <ul className="mt-2.5 space-y-1.5">
          {members.map((m) => (
            <li
              key={m.n}
              className="flex min-w-0 items-center gap-2 rounded-lg border border-border px-2.5 py-2"
            >
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-muted text-[9px] font-semibold text-muted-foreground">
                <Users className="h-3 w-3" />
              </span>
              <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground">
                {m.n}
              </span>
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[9px] font-semibold text-muted-foreground">
                {m.r}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Frame>
  );
}

/** Journal des opérations d'un dossier (fictif). */
export function HistoryMockup({ className = "" }: { className?: string }) {
  const events = [
    { t: "14/03 · 10:06", l: "PDF envoyé au client" },
    { t: "14/03 · 10:05", l: "PV signé par M. Dumas" },
    { t: "14/03 · 09:41", l: "Réserve majeure créée" },
    { t: "14/03 · 09:12", l: "Réception démarrée par Julien P." },
  ];
  return (
    <Frame label="Historique horodaté d'un dossier PVIA" className={className}>
      <ol className="space-y-2 p-3 sm:p-4">
        {events.map((e) => (
          <li key={e.t} className="flex min-w-0 items-start gap-2.5">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
            <div className="min-w-0">
              <p className="truncate text-[11px] font-medium text-foreground">{e.l}</p>
              <p className="truncate text-[10px] text-muted-foreground">{e.t}</p>
            </div>
          </li>
        ))}
      </ol>
    </Frame>
  );
}
