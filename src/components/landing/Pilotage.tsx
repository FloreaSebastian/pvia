import { SectionTitle } from "@/components/landing/SectionTitle";
import { StatsMockup } from "@/components/landing/mockups";

const items = [
  { t: "PV récents", d: "Vos derniers procès-verbaux et leur état d'avancement." },
  { t: "Signatures", d: "Ce qui est signé, ce qui reste en attente." },
  { t: "Réserves", d: "Les réserves ouvertes et les levées à valider." },
  { t: "Comparaison de périodes", d: "Comparez votre activité d'une période à l'autre." },
  { t: "Avancement", d: "Suivez la progression de vos chantiers." },
  { t: "Historique", d: "Chaque action reste consultable." },
];

export function Pilotage() {
  return (
    <section id="pilotage" className="scroll-mt-20 bg-muted/30 py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionTitle
          eyebrow="Pilotage"
          title="Gardez une vue claire sur votre activité."
          description="Les indicateurs qui comptent, sans tableau Excel à maintenir."
        />
        <div className="mt-12 grid items-center gap-8 lg:grid-cols-2 lg:gap-14">
          <StatsMockup />
          <ul className="grid min-w-0 gap-3 sm:grid-cols-2">
            {items.map((i) => (
              <li
                key={i.t}
                className="min-w-0 rounded-xl border border-border bg-card p-4 shadow-elevation-sm"
              >
                <p className="text-sm font-semibold text-foreground">{i.t}</p>
                <p className="mt-1 text-sm text-muted-foreground">{i.d}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
