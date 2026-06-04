import { Link } from "@tanstack/react-router";
import pviaMark from "@/assets/pvia-mark.png.asset.json";

export function Logo({ withBaseline = false, className = "" }: { withBaseline?: boolean; className?: string }) {
  return (
    <Link to="/" className={`flex items-center gap-2.5 ${className}`}>
      <img
        src={pviaMark.url}
        alt="PVIA"
        className="h-14 w-14 object-contain"
        loading="eager"
        decoding="async"
      />
      <div className="flex flex-col leading-none">
        <span className="font-display text-lg font-bold tracking-tight">
          <span className="text-gradient">PV</span>
          <span className="text-foreground">IA</span>
        </span>
        {withBaseline && (
          <span className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Réception de travaux intelligente
          </span>
        )}
      </div>
    </Link>
  );
}
