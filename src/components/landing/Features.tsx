import {
  AlertTriangle,
  BarChart3,
  Bell,
  Calendar,
  Camera,
  FileText,
  FileDown,
  History,
  PenLine,
  Smartphone,
  UserSquare2,
  Users,
} from "lucide-react";

const features = [
  { icon: FileText, title: "Procès-verbaux", desc: "Créez et suivez vos PV de réception." },
  { icon: AlertTriangle, title: "Réserves", desc: "Gravité, responsable, statut et levée." },
  { icon: Camera, title: "Photos", desc: "Avant/après, rattachées au chantier." },
  { icon: PenLine, title: "Signature", desc: "Sur place ou à distance par email." },
  { icon: FileDown, title: "PDF automatique", desc: "Document final généré et envoyé." },
  { icon: UserSquare2, title: "Espace client", desc: "Vos clients consultent leurs documents." },
  { icon: Calendar, title: "Planning", desc: "Interventions et réceptions à venir." },
  { icon: Smartphone, title: "Mode terrain", desc: "Tout se fait depuis le téléphone." },
  { icon: Users, title: "Équipe", desc: "Invitez vos collaborateurs, gérez les rôles." },
  { icon: Bell, title: "Notifications", desc: "Restez informé des étapes clés." },
  { icon: History, title: "Historique", desc: "Chaque action reste traçable." },
  { icon: BarChart3, title: "Statistiques", desc: "Une vue claire sur votre activité." },
];

export function Features() {
  return (
    <section id="fonctionnalites" className="scroll-mt-20 py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            Fonctionnalités
          </span>
          <h2 className="mt-3 text-balance font-display text-3xl font-bold tracking-tight sm:text-4xl">
            Tout ce qu'il faut pour vos réceptions
          </h2>
          <p className="mt-4 text-muted-foreground">
            Un seul outil, du premier chantier au dernier PV signé.
          </p>
        </div>

        <ul className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {features.map((f) => (
            <li
              key={f.title}
              className="min-w-0 rounded-xl border border-border bg-card p-4 shadow-elevation-sm transition-colors hover:border-primary/40"
            >
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <f.icon className="h-4 w-4" />
              </span>
              <h3 className="mt-3 text-sm font-semibold tracking-tight text-foreground">
                {f.title}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">{f.desc}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
