import { Link } from "@tanstack/react-router";
import pviaMark from "@/assets/pvia-mark.png.asset.json";
import pviaWordmark from "@/assets/pvia-wordmark.png.asset.json";

export function Logo({ withBaseline = false, className = "" }: { withBaseline?: boolean; className?: string }) {
  return (
    <Link to="/" className={`flex items-center gap-2.5 ${className}`}>
      <img
        src={pviaMark.url}
        alt=""
        aria-hidden="true"
        className="h-14 w-14 object-contain"
        loading="eager"
        decoding="async"
      />
      <div className="flex flex-col leading-none">
        <img
          src={pviaWordmark.url}
          alt="PVIA"
          className="h-6 w-auto object-contain"
          loading="eager"
          decoding="async"
        />
        {withBaseline && (
          <span className="mt-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Réception de travaux intelligente
          </span>
        )}
      </div>
    </Link>
  );
}
