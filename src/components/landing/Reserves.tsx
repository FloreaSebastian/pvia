import { SectionTitle } from "@/components/landing/SectionTitle";
import { ReserveMockup } from "@/components/landing/mockups";

const highlights = [
  { t: "Gravité", d: "Qualifiez chaque réserve pour prioriser les reprises." },
  { t: "Statut", d: "Ouverte, en cours, levée : l'état est toujours visible." },
  { t: "Assignation", d: "Un responsable identifié pour chaque réserve." },
  { t: "Photos avant/après", d: "La preuve de la reprise reste attachée à la réserve." },
  { t: "Levée", d: "Déclarez la levée depuis le chantier ou depuis le bureau." },
  { t: "Validation client", d: "Le client valide ou refuse la levée depuis son espace." },
];

export function Reserves() {
  return (
    <section id="reserves" className="scroll-mt-20 bg-muted/30 py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionTitle
          eyebrow="Réserves"
          title="Une réserve ne se perd plus dans une conversation."
          description="De l'ouverture à la validation du client, chaque étape est tracée."
        />
        <div className="mt-12 grid items-start gap-8 lg:grid-cols-2 lg:gap-14">
          <ReserveMockup />
          <ul className="grid min-w-0 gap-3 sm:grid-cols-2">
            {highlights.map((h) => (
              <li
                key={h.t}
                className="min-w-0 rounded-xl border border-border bg-card p-4 shadow-elevation-sm"
              >
                <p className="text-sm font-semibold text-foreground">{h.t}</p>
                <p className="mt-1 text-sm text-muted-foreground">{h.d}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
