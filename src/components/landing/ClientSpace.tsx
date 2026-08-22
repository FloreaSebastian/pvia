import { SectionTitle } from "@/components/landing/SectionTitle";
import { ClientSpaceMockup } from "@/components/landing/mockups";
import { Check, Lock } from "lucide-react";

const items = [
  "Consulter ses procès-verbaux",
  "Signer lorsque la signature est disponible",
  "Télécharger le PDF",
  "Consulter les levées de réserves",
  "Valider ou refuser une levée quand le workflow le prévoit",
  "Retrouver son historique",
];

export function ClientSpace() {
  return (
    <section id="espace-client" className="scroll-mt-20 bg-muted/30 py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionTitle
          eyebrow="Espace client"
          title="Vos clients suivent aussi leurs documents."
          description="Un espace dédié, séparé de votre espace interne."
        />
        <div className="mt-12 grid items-center gap-8 lg:grid-cols-2 lg:gap-14">
          <ClientSpaceMockup />
          <div className="min-w-0">
            <ul className="space-y-2.5">
              {items.map((i) => (
                <li key={i} className="flex min-w-0 items-start gap-2.5">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                  <span className="min-w-0 text-sm text-foreground/90">{i}</span>
                </li>
              ))}
            </ul>
            <p className="mt-6 flex min-w-0 items-start gap-2.5 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground shadow-elevation-sm">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span className="min-w-0">
                Le client n'accède jamais à l'espace interne de votre entreprise : il ne voit que
                ses propres documents.
              </span>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
