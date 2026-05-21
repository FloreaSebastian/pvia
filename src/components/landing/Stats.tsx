import { motion, useInView, useMotionValue, useTransform, animate } from "motion/react";
import { useEffect, useRef } from "react";

const stats = [
  { value: 87, suffix: "%", label: "Gain de temps administratif" },
  { value: 64, suffix: "%", label: "Réduction des litiges" },
  { value: 100, suffix: "%", label: "Documents centralisés" },
  { value: 3, suffix: " min", label: "Signature sur chantier" },
];

function Counter({ to, suffix }: { to: number; suffix: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-50px" });
  const mv = useMotionValue(0);
  const display = useTransform(mv, (v) => Math.round(v).toString());

  useEffect(() => {
    if (inView) {
      const controls = animate(mv, to, { duration: 1.4, ease: "easeOut" });
      return () => controls.stop();
    }
  }, [inView, mv, to]);

  return (
    <span ref={ref} className="inline-flex items-baseline">
      <motion.span>{display}</motion.span>
      <span>{suffix}</span>
    </span>
  );
}

export function Stats() {
  return (
    <section className="bg-foreground py-20 text-background sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Des résultats concrets pour les pros du BTP
          </h2>
          <p className="mt-4 text-background/70">
            Les bénéfices mesurés par les entreprises qui utilisent PV Pro au quotidien.
          </p>
        </div>

        <div className="mt-14 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="text-center">
              <div className="text-4xl font-semibold tracking-tight sm:text-5xl">
                <Counter to={s.value} suffix={s.suffix} />
              </div>
              <div className="mt-2 text-sm text-background/70">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
