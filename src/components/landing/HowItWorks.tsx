import { SectionTitle } from "@/components/landing/SectionTitle";
import {
  CalendarMockup,
  PhoneMockup,
  SignatureMockup,
} from "@/components/landing/mockups";

const steps = [
  {
    n: "01",
    title: "Créez votre chantier",
    desc: "Client, adresse, équipe, dates et informations essentielles. Tout est rattaché au chantier.",
    visual: <CalendarMockup />,
  },
  {
    n: "02",
    title: "Réceptionnez sur le terrain",
    desc: "Photos, réserves, commentaires et signature directement depuis le téléphone.",
    visual: (
      <div className="flex justify-center">
        <PhoneMockup />
      </div>
    ),
  },
  {
    n: "03",
    title: "Envoyez un PV professionnel",
    desc: "Le PDF est généré, envoyé au client et conservé avec tout son historique.",
    visual: <SignatureMockup />,
  },
];

export function HowItWorks() {
  return (
    <section id="comment-ca-marche" className="scroll-mt-20 bg-muted/30 py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionTitle
          eyebrow="Comment ça marche"
          title="Trois étapes, du chantier au PV signé."
          description="Pas de double saisie, pas de document perdu."
        />

        <div className="mt-14 space-y-14 lg:space-y-20">
          {steps.map((s, i) => (
            <div
              key={s.n}
              className="grid items-center gap-8 lg:grid-cols-2 lg:gap-14"
            >
              <div className={`min-w-0 ${i % 2 === 1 ? "lg:order-2" : ""}`}>
                <span className="font-display text-sm font-bold tracking-[0.2em] text-primary">
                  {s.n}
                </span>
                <h3 className="mt-2 text-balance font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                  {s.title}
                </h3>
                <p className="mt-3 text-pretty text-muted-foreground">{s.desc}</p>
              </div>
              <div className={`min-w-0 ${i % 2 === 1 ? "lg:order-1" : ""}`}>{s.visual}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
