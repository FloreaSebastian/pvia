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
      className="relative isolate flex min-h-[100svh] items-center overflow-hidden bg-white"
    >
      {/* Background video */}
      <div className="absolute inset-0 -z-20">
        <motion.div
          initial={{ scale: 1.08 }}
          animate={{ scale: 1 }}
          transition={{ duration: 12, ease: "easeOut" }}
          className="h-full w-full"
        >
          <video
            className="h-full w-full object-cover"
            style={{ filter: "brightness(1.15) contrast(1.05) saturate(1.10)" }}
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

      {/* Soft white veil – keeps the video visible */}
      <div
        className="absolute inset-0 -z-10"
        style={{
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.45), rgba(255,255,255,0.65))",
        }}
      />

      <div className="relative mx-auto w-full max-w-6xl px-4 py-28 sm:px-6 sm:py-36 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7 }}
          className="mx-auto max-w-4xl p-8 text-center sm:p-12 lg:p-16"
        >
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="inline-flex items-center gap-2 rounded-full border border-slate-900/10 bg-white/70 px-3 py-1 text-xs font-medium text-slate-700 shadow-sm backdrop-blur"
          >
            <ShieldCheck className="h-3.5 w-3.5 text-slate-700" />
            Conforme BTP · Signature électronique · Export PDF
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1 }}
            className="mt-6 text-balance font-display text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl xl:text-7xl"
            style={{ color: "#0F172A" }}
          >
            Le logiciel de réception de travaux{" "}
            <span className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-600 bg-clip-text text-transparent">
              nouvelle génération.
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="mx-auto mt-6 max-w-2xl text-pretty text-base sm:text-lg"
            style={{ color: "#334155" }}
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
              className="h-12 bg-[#0F172A] px-6 text-white shadow-xl shadow-slate-900/20 transition-all hover:-translate-y-0.5 hover:bg-[#1e293b]"
              asChild
            >
              <Link to="/signup">
                Démarrer gratuitement <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-12 border-slate-900/15 bg-white/70 px-6 text-slate-900 backdrop-blur-md transition-all hover:-translate-y-0.5 hover:bg-white/90 hover:text-slate-900"
            >
              <Play className="mr-1 h-4 w-4" /> Voir une démonstration
            </Button>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.5 }}
            className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-slate-600"
          >
            <span className="flex items-center gap-1.5">
              <span className="flex -space-x-1">
                {[0, 1, 2, 3, 4].map((i) => (
                  <Star key={i} className="h-3.5 w-3.5 fill-warning text-warning" />
                ))}
              </span>
              <span className="font-medium text-slate-900">4,9/5</span>
              <span>· 320 avis vérifiés</span>
            </span>
            <span className="hidden h-3 w-px bg-slate-900/15 sm:block" />
            <span>Gratuit pendant 14 jours · Sans carte bancaire</span>
          </motion.div>
        </motion.div>
      </div>

      {/* Bottom fade into next section */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-b from-transparent to-background" />
    </section>
  );
}
