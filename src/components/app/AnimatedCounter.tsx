import { useEffect, useState } from "react";
import { motion } from "motion/react";

export function AnimatedCounter({ value, duration = 800 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    let raf: number;
    const start = performance.now();
    const from = 0;
    const step = (t: number) => {
      const p = Math.min((t - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(from + (value - from) * eased));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return (
    <motion.span
      key={value}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="tabular-nums"
    >
      {display.toLocaleString("fr-FR")}
    </motion.span>
  );
}
