import { SectionTitle } from "@/components/landing/SectionTitle";
import { SignatureMockup } from "@/components/landing/mockups";
import { FileText, History, Mail, PenLine } from "lucide-react";

const flow = [
  { Icon: PenLine, t: "Signature", d: "Faites signer directement sur place, ou à distance par email." },
  { Icon: FileText, t: "PDF", d: "Un document propre et professionnel est généré automatiquement." },
  { Icon: Mail, t: "Envoi", d: "Le PV est transmis au client, sans ressaisie ni mise en page." },
  { Icon: History, t: "Historique", d: "Retrouvez l'historique des actions liées au PV." },
];

export function SignaturePdf() {
  return (
    <section id="signature" className="scroll-mt-20 py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionTitle
          eyebrow="Signature & PDF"
          title="Du chantier au PV signé, sans ressaisie."
          description="Le document final reprend automatiquement les réserves, les photos et la signature."
        />
        <div className="mt-12 grid items-center gap-8 lg:grid-cols-2 lg:gap-14">
          <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:order-2">
            {flow.map(({ Icon, t, d }) => (
              <div
                key={t}
                className="min-w-0 rounded-xl border border-border bg-card p-4 shadow-elevation-sm"
              >
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-4 w-4" />
                </span>
                <p className="mt-3 text-sm font-semibold text-foreground">{t}</p>
                <p className="mt-1 text-sm text-muted-foreground">{d}</p>
              </div>
            ))}
          </div>
          <div className="min-w-0 lg:order-1">
            <SignatureMockup />
          </div>
        </div>
      </div>
    </section>
  );
}
