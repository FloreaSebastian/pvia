import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export function StickyCTA() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 600);
    onScroll();
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.25 }}
          className="pointer-events-none fixed bottom-5 left-1/2 z-40 -translate-x-1/2"
        >
          <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-border bg-background/90 px-2 py-2 pl-4 shadow-xl shadow-primary/10 backdrop-blur-md">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="hidden text-sm font-medium sm:inline">
              Prêt à digitaliser vos réceptions ?
            </span>
            <Button size="sm" className="rounded-full shadow-md" asChild>
              <Link to="/signup">
                Créer mon premier PV <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
