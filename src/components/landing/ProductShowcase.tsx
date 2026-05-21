import { motion } from "motion/react";
import { Camera, CheckCircle2, MapPin, Wifi, Battery, Signal, PenLine } from "lucide-react";

export function ProductShowcase() {
  return (
    <section className="relative overflow-hidden py-24 sm:py-32">
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-background via-muted/20 to-background" />
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            Conçu pour le terrain
          </span>
          <h2 className="mt-4 text-balance font-display text-3xl font-bold tracking-tight sm:text-4xl">
            Le bureau d'études dans votre poche.
          </h2>
          <p className="mt-4 text-pretty text-muted-foreground sm:text-lg">
            Mode hors-ligne, capture photo, géolocalisation, signature tactile.
            PVIA fonctionne là où vos chantiers vous emmènent.
          </p>
        </div>

        <div className="mt-16 grid items-center gap-12 lg:grid-cols-2">
          <PhoneMockup />
          <FeatureList />
        </div>
      </div>
    </section>
  );
}

function FeatureList() {
  const items = [
    {
      title: "Mode terrain hors-ligne",
      desc: "Continuez à travailler même sans réseau. Synchronisation automatique au retour de connexion.",
    },
    {
      title: "Photos géolocalisées",
      desc: "Chaque réserve est documentée avec photo, coordonnées GPS et horodatage certifié.",
    },
    {
      title: "Signature tactile certifiée",
      desc: "Le client signe directement sur votre tablette. PDF généré et envoyé instantanément.",
    },
    {
      title: "Compatible tous appareils",
      desc: "iPhone, Android, iPad, ordinateur — vos données sont toujours synchronisées.",
    },
  ];

  return (
    <div className="space-y-6">
      {items.map((item, i) => (
        <motion.div
          key={item.title}
          initial={{ opacity: 0, x: 20 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: "-50px" }}
          transition={{ duration: 0.5, delay: i * 0.08 }}
          className="flex gap-4"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-display text-lg font-semibold tracking-tight">{item.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{item.desc}</p>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

function PhoneMockup() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.7 }}
      className="relative mx-auto w-full max-w-sm"
    >
      <div className="absolute -inset-8 -z-10 rounded-[3rem] bg-brand-gradient opacity-20 blur-3xl" />
      <div className="relative rounded-[2.5rem] border-[10px] border-foreground bg-foreground p-1 shadow-2xl">
        <div className="relative overflow-hidden rounded-[2rem] bg-background">
          {/* Status bar */}
          <div className="flex items-center justify-between bg-card px-6 pt-3 pb-2 text-[10px] font-semibold text-foreground">
            <span>9:41</span>
            <span className="flex items-center gap-1">
              <Signal className="h-3 w-3" />
              <Wifi className="h-3 w-3" />
              <Battery className="h-3 w-3" />
            </span>
          </div>

          {/* Header */}
          <div className="border-b border-border bg-card px-5 py-3">
            <div className="text-[10px] font-medium uppercase tracking-wider text-primary">PV en cours</div>
            <div className="mt-0.5 font-display text-sm font-bold tracking-tight">Villa Mercier</div>
            <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
              <MapPin className="h-2.5 w-2.5" /> Cannes · 12 chemin des Pins
            </div>
          </div>

          {/* Photos */}
          <div className="space-y-3 p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Réserve #1 — Joint étanchéité
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[1, 2].map((i) => (
                <div
                  key={i}
                  className="flex aspect-square items-center justify-center rounded-lg bg-gradient-to-br from-muted to-muted/40 ring-1 ring-border"
                >
                  <Camera className="h-5 w-5 text-muted-foreground" />
                </div>
              ))}
            </div>
            <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[11px] text-warning">
              Reprise à prévoir sous 15 jours
            </div>

            {/* Sync indicator */}
            <div className="flex items-center justify-between rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-[11px]">
              <span className="flex items-center gap-1.5 text-success">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
                </span>
                Synchronisé
              </span>
              <span className="text-muted-foreground">il y a 2 sec</span>
            </div>

            {/* Sign button */}
            <button className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-xs font-semibold text-primary-foreground shadow-brand">
              <PenLine className="h-3.5 w-3.5" /> Faire signer le client
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
