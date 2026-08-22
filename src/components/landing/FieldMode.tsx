import { Camera, MapPin, PenLine, Smartphone, AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PhoneMockup } from "@/components/landing/mockups";

const points = [
  { Icon: Camera, label: "Photos prises depuis l'appareil, rattachées au PV." },
  { Icon: AlertTriangle, label: "Réserves créées en quelques secondes, avec gravité et responsable." },
  { Icon: PenLine, label: "Signature du client directement sur place, sur le téléphone." },
  { Icon: MapPin, label: "Adresse et localisation du chantier associées à la réception." },
  { Icon: Smartphone, label: "Interface pensée pour le mobile, utilisable avec des gants ou en plein soleil." },
  { Icon: RefreshCw, label: "Vos saisies sont enregistrées et synchronisées avec le bureau." },
];

export function FieldMode() {
  return (
    <section id="mode-terrain" className="scroll-mt-20 py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <div className="min-w-0">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
              Mode terrain
            </span>
            <h2 className="mt-3 text-balance font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Pensé pour le terrain. Pas seulement pour le bureau.
            </h2>
            <ul className="mt-7 space-y-3.5">
              {points.map(({ Icon, label }) => (
                <li key={label} className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 text-sm text-foreground/90">{label}</span>
                </li>
              ))}
            </ul>
            <Button size="lg" variant="outline" className="mt-8 min-h-12 w-full sm:w-auto" asChild>
              <a href="#fonctionnalites">Découvrir le mode terrain</a>
            </Button>
          </div>

          <div className="flex min-w-0 justify-center">
            <PhoneMockup className="w-[min(220px,70vw)]" />
          </div>
        </div>
      </div>
    </section>
  );
}
