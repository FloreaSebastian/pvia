import { Sun, Snowflake, Zap, Droplets, PaintRoller, Building2 } from "lucide-react";

const trades = [
  { label: "Photovoltaïque", Icon: Sun },
  { label: "Climatisation", Icon: Snowflake },
  { label: "Électricité", Icon: Zap },
  { label: "Plomberie", Icon: Droplets },
  { label: "Rénovation", Icon: PaintRoller },
  { label: "Construction", Icon: Building2 },
];

export function TradesBar() {
  return (
    <section aria-labelledby="metiers-title" className="border-y border-border/60 bg-muted/30 py-10">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <h2
          id="metiers-title"
          className="text-center text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground"
        >
          Conçu pour tous les métiers du chantier
        </h2>
        <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {trades.map(({ label, Icon }) => (
            <li
              key={label}
              className="flex min-w-0 items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 shadow-elevation-sm"
            >
              <Icon className="h-4 w-4 shrink-0 text-primary" />
              <span className="truncate text-sm font-medium text-foreground">{label}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
