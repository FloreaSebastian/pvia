import { Link } from "@tanstack/react-router";
import { FileSignature } from "lucide-react";

export function Logo({ withBaseline = false, className = "" }: { withBaseline?: boolean; className?: string }) {
  return (
    <Link to="/" className={`flex items-center gap-2.5 ${className}`}>
      <div className="relative grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-md shadow-primary/20">
        <FileSignature className="h-5 w-5" />
        <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-400 ring-2 ring-background" />
      </div>
      <div className="flex flex-col leading-none">
        <span className="text-lg font-bold tracking-tight">
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
