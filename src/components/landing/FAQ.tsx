import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { TRIAL_DAYS } from "@/lib/plans";

export const faqs = [
  {
    q: "PVIA fonctionne-t-il sur téléphone ?",
    a: "Oui. PVIA s'utilise depuis un téléphone, une tablette ou un ordinateur. Les réceptions, photos, réserves et signatures peuvent être réalisées directement depuis le chantier.",
  },
  {
    q: "Puis-je faire signer un PV directement sur le chantier ?",
    a: "Oui. Le client peut signer sur place, sur votre appareil. La signature à distance par email est également disponible selon votre formule.",
  },
  {
    q: "Comment fonctionne la levée de réserves ?",
    a: "Une réserve est créée avec sa gravité, un responsable et des photos. Après la reprise, vous ajoutez la photo « après » et déclarez la levée. Le client peut ensuite la valider ou la refuser depuis son espace.",
  },
  {
    q: "Mes clients ont-ils accès à PVIA ?",
    a: "Vos clients disposent d'un espace dédié où ils consultent leurs procès-verbaux, téléchargent leurs PDF et suivent les levées de réserves. Ils n'accèdent jamais à l'espace interne de votre entreprise.",
  },
  {
    q: "Puis-je ajouter plusieurs collaborateurs ?",
    a: "Oui. Vous pouvez inviter vos collaborateurs et leur attribuer un rôle. Le nombre d'utilisateurs inclus dépend de votre formule : 1 en Essentiel, jusqu'à 5 en Pro, jusqu'à 20 en Business, illimité en Entreprise.",
  },
  {
    q: "Puis-je changer de formule ?",
    a: "Oui. Vous pouvez changer de formule depuis votre espace de facturation, en mensuel ou en annuel. La facturation annuelle offre deux mois.",
  },
  {
    q: "L'essai est-il gratuit ?",
    a: `Oui. Vous disposez de ${TRIAL_DAYS} jours gratuits, sans engagement, pour tester PVIA sur vos chantiers.`,
  },
];

export function FAQ() {
  return (
    <section id="faq" className="scroll-mt-20 bg-muted/30 py-20 sm:py-28">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">FAQ</span>
          <h2 className="mt-3 text-balance font-display text-3xl font-bold tracking-tight sm:text-4xl">
            Questions fréquentes
          </h2>
        </div>

        <Accordion type="single" collapsible className="mt-10 w-full">
          {faqs.map((f, i) => (
            <AccordionItem key={f.q} value={`item-${i}`}>
              <AccordionTrigger className="min-h-12 text-left text-sm font-semibold sm:text-base">
                {f.q}
              </AccordionTrigger>
              <AccordionContent className="text-sm leading-relaxed text-muted-foreground">
                {f.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
