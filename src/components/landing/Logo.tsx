import { Link } from "@tanstack/react-router";
import pviaLogo from "@/assets/pvia-logo.png";

export function Logo({ withBaseline = false, className = "" }: { withBaseline?: boolean; className?: string }) {
  return (
    <Link to="/" className={`flex items-center gap-2.5 ${className}`}>
      <img
        src={pviaLogo}
        alt="PVIA"
        className="h-10 w-10 object-contain"
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
