import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const faqs = [
  {
    q: "Le PV est-il juridiquement valable ?",
    a: "Oui. PV Pro respecte la norme NF P03-001 et le règlement eIDAS pour les signatures électroniques. Vos documents ont la même valeur qu'un PV signé manuellement et sont opposables en cas de litige.",
  },
  {
    q: "Peut-on signer sur mobile ou tablette ?",
    a: "Absolument. L'interface est optimisée pour la signature tactile sur smartphone et tablette, y compris en conditions de chantier. Aucune application à installer pour le client.",
  },
  {
    q: "Les photos sont-elles incluses dans le PV ?",
    a: "Oui, vous pouvez joindre un nombre illimité de photos par PV (selon votre plan). Elles sont horodatées, géolocalisées et intégrées automatiquement au PDF final.",
  },
  {
    q: "Peut-on ajouter des réserves ?",
    a: "Bien sûr. Vous pouvez lister les réserves émises par le client, les classer par priorité et suivre leur levée jusqu'à la clôture définitive du chantier.",
  },
  {
    q: "Le PDF est-il généré automatiquement ?",
    a: "Oui. Dès la signature validée, le PDF est généré instantanément avec votre charte graphique, prêt à être archivé et envoyé au client par email.",
  },
  {
    q: "Mes données sont-elles sécurisées ?",
    a: "Vos données sont hébergées en Europe, chiffrées au repos et en transit. Nous sommes conformes RGPD et nos serveurs respectent les standards ISO 27001. Sauvegardes quotidiennes incluses.",
  },
];

export function FAQ() {
  return (
    <section id="faq" className="bg-muted/30 py-24 sm:py-32">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <span className="text-xs font-semibold uppercase tracking-wider text-primary">FAQ</span>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Questions fréquentes
          </h2>
        </div>

        <Accordion type="single" collapsible className="mt-12 space-y-3">
          {faqs.map((f, i) => (
            <AccordionItem
              key={i}
              value={`item-${i}`}
              className="rounded-xl border border-border bg-card px-5 shadow-sm"
            >
              <AccordionTrigger className="py-5 text-left text-base font-medium hover:no-underline">
                {f.q}
              </AccordionTrigger>
              <AccordionContent className="pb-5 text-sm leading-relaxed text-muted-foreground">
                {f.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
