import { motion } from "motion/react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ArrowRight, Play, ShieldCheck, PenLine, FileText, CheckCircle2, Camera, MapPin } from "lucide-react";

export function Hero() {
  return (
    <section id="hero" className="relative overflow-hidden pt-32 pb-20 sm:pt-40 sm:pb-28">
      <div className="absolute inset-0 -z-10 bg-radial-fade" />
      <div className="absolute inset-0 -z-10 bg-grid [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl text-center">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-white/60 px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur"
          >
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            Conforme BTP · Signature électronique · Export PDF
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.05 }}
            className="mt-6 text-balance text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl"
          >
            Le procès-verbal de réception de travaux{" "}
            <span className="text-gradient">enfin simple et professionnel.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.1 }}
            className="mx-auto mt-6 max-w-2xl text-pretty text-base text-muted-foreground sm:text-lg"
          >
            Créez, signez et envoyez vos PV de réception en quelques minutes avec photos,
            réserves, signatures électroniques et PDF automatiques.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.15 }}
            className="mt-8 flex flex-wrap items-center justify-center gap-3"
          >
            <Button size="lg" className="h-12 px-6 shadow-lg shadow-primary/25" asChild>
              <Link to="/signup">
                Créer mon premier PV <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" className="h-12 px-6">
              <Play className="mr-1 h-4 w-4" /> Voir une démo
            </Button>
          </motion.div>

          <p className="mt-4 text-xs text-muted-foreground">
            Gratuit pendant 14 jours · Sans carte bancaire
          </p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.25 }}
          className="relative mx-auto mt-16 max-w-5xl"
        >
          <MockupBrowser />
        </motion.div>
      </div>
    </section>
  );
}

function MockupBrowser() {
  return (
    <div className="relative">
      <div className="absolute -inset-x-10 -top-10 bottom-0 -z-10 rounded-[2rem] bg-gradient-to-b from-primary/10 to-transparent blur-2xl" />
      <div className="overflow-hidden rounded-2xl border border-border bg-white shadow-2xl shadow-primary/10 ring-1 ring-black/5">
        <div className="flex items-center gap-1.5 border-b border-border/70 bg-muted/50 px-4 py-3">
          <span className="h-2.5 w-2.5 rounded-full bg-red-400/80" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
          <div className="mx-auto rounded-md bg-background/80 px-3 py-1 text-xs text-muted-foreground">
            app.pvia.fr / chantier / PV-2026-0421
          </div>
        </div>

        <div className="grid grid-cols-12 gap-0">
          <aside className="col-span-3 hidden border-r border-border/70 bg-muted/30 p-4 md:block">
            <div className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Chantiers
            </div>
            {["Villa Mercier — Toiture", "SCI Lumière — Photovoltaïque", "Restaurant L'Atelier", "Résidence Belvédère"].map(
              (n, i) => (
                <div
                  key={n}
                  className={`mb-1 rounded-md px-3 py-2 text-sm ${
                    i === 0
                      ? "bg-primary/10 font-medium text-primary"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {n}
                </div>
              ),
            )}
          </aside>

          <div className="col-span-12 p-6 md:col-span-9">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs font-medium text-primary">PV de réception · #2026-0421</div>
                <h3 className="mt-1 text-xl font-semibold tracking-tight">Villa Mercier — Réfection toiture</h3>
                <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <MapPin className="h-3 w-3" /> 12 chemin des Pins, 06400 Cannes
                </div>
              </div>
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
                Signé
              </span>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3 text-xs">
              <Field label="Maître d'ouvrage" value="M. et Mme Mercier" />
              <Field label="Date de réception" value="21/04/2026" />
              <Field label="Entreprise" value="Toitures du Sud SARL" />
              <Field label="Montant" value="18 450,00 €" />
            </div>

            <div className="mt-6">
              <div className="mb-2 text-xs font-semibold text-foreground">Travaux réalisés</div>
              <div className="space-y-2">
                {["Dépose ancienne couverture", "Pose membrane + isolation 200mm", "Couverture tuiles canal teintées"].map(
                  (t) => (
                    <div key={t} className="flex items-center gap-2 rounded-md border border-border/70 bg-card px-3 py-2 text-sm">
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" /> {t}
                    </div>
                  ),
                )}
              </div>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-2">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="flex aspect-video items-center justify-center rounded-md border border-dashed border-border bg-muted/50"
                >
                  <Camera className="h-5 w-5 text-muted-foreground" />
                </div>
              ))}
            </div>

            <div className="mt-5 flex items-center justify-between rounded-lg border border-border bg-muted/40 p-3">
              <div className="flex items-center gap-2 text-sm">
                <PenLine className="h-4 w-4 text-primary" />
                <span className="font-medium">Signature client</span>
                <span className="text-muted-foreground">— J. Mercier · 21/04 14:32</span>
              </div>
              <button className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">
                <FileText className="mr-1 inline h-3 w-3" /> PDF
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Phone mockup */}
      <motion.div
        initial={{ opacity: 0, x: 30, y: 20 }}
        animate={{ opacity: 1, x: 0, y: 0 }}
        transition={{ duration: 0.6, delay: 0.5 }}
        className="absolute -bottom-8 -right-2 hidden w-48 rounded-2xl border border-border bg-white p-2 shadow-2xl ring-1 ring-black/5 md:block lg:-right-10 lg:w-56"
      >
        <div className="rounded-xl border border-border/70 bg-gradient-to-br from-primary/5 to-transparent p-3">
          <div className="text-[10px] font-medium text-primary">SIGNATURE CLIENT</div>
          <div className="mt-2 rounded-md border border-dashed border-primary/30 bg-white p-3">
            <svg viewBox="0 0 200 60" className="h-12 w-full text-foreground/80">
              <path
                d="M5 40 Q 20 10, 35 35 T 70 30 Q 90 50, 110 25 T 150 35 Q 170 10, 195 30"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <button className="mt-3 w-full rounded-md bg-primary py-2 text-xs font-medium text-primary-foreground">
            Valider
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/70 bg-muted/30 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-medium text-foreground">{value}</div>
    </div>
  );
}
