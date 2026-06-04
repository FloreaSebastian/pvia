import { motion } from "motion/react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ArrowRight, Play, ShieldCheck, Star } from "lucide-react";
import heroFallback from "@/assets/hero-fallback.jpg";

const HERO_VIDEO_SRC = "/hero-bg.mp4";

export function Hero() {
  return (
    <section
      id="hero"
      className="relative isolate flex min-h-[100svh] items-center overflow-hidden"
    >
      {/* Background video + fallback */}
      <div className="absolute inset-0 -z-20">
        <motion.div
          initial={{ scale: 1.08 }}
          animate={{ scale: 1 }}
          transition={{ duration: 12, ease: "easeOut" }}
          className="h-full w-full"
        >
          <video
            className="h-full w-full object-cover"
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            poster={heroFallback}
            aria-hidden="true"
          >
            <source src={HERO_VIDEO_SRC} type="video/mp4" />
          </video>
        </motion.div>
      </div>

      {/* Overlay for legibility */}
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_center,rgba(10,15,30,0.55),rgba(5,8,20,0.85))]" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-black/40 via-black/55 to-black/80" />

      <div className="relative mx-auto w-full max-w-7xl px-4 py-32 sm:px-6 sm:py-40 lg:px-8">
        <div className="mx-auto max-w-4xl text-center text-white">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium text-white/90 shadow-sm backdrop-blur-md"
          >
            <ShieldCheck className="h-3.5 w-3.5 text-white" />
            Conforme BTP · Signature électronique · Export PDF
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1 }}
            className="mt-6 text-balance font-display text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl xl:text-7xl"
          >
            Le logiciel de réception de travaux{" "}
            <span className="bg-gradient-to-r from-white via-white to-white/70 bg-clip-text text-transparent">
              nouvelle génération.
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="mx-auto mt-6 max-w-2xl text-pretty text-base text-white/80 sm:text-lg"
          >
            Créez, signez, suivez et archivez tous vos procès-verbaux de réception
            en quelques minutes.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.3 }}
            className="mt-10 flex flex-wrap items-center justify-center gap-3"
          >
            <Button
              size="lg"
              className="h-12 border border-white/10 bg-white px-6 text-foreground shadow-2xl shadow-black/30 backdrop-blur hover:bg-white/90"
              asChild
            >
              <Link to="/signup">
                Démarrer gratuitement <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-12 border-white/30 bg-white/10 px-6 text-white backdrop-blur-md hover:bg-white/20 hover:text-white"
            >
              <Play className="mr-1 h-4 w-4" /> Voir une démonstration
            </Button>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.5 }}
            className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-white/70"
          >
            <span className="flex items-center gap-1.5">
              <span className="flex -space-x-1">
                {[0, 1, 2, 3, 4].map((i) => (
                  <Star key={i} className="h-3.5 w-3.5 fill-warning text-warning" />
                ))}
              </span>
              <span className="font-medium text-white">4,9/5</span>
              <span>· 320 avis vérifiés</span>
            </span>
            <span className="hidden h-3 w-px bg-white/20 sm:block" />
            <span>Gratuit pendant 14 jours · Sans carte bancaire</span>
          </motion.div>
        </div>
      </div>

      {/* Bottom fade into next section */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-b from-transparent to-background" />
    </section>
  );
}
