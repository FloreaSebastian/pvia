import { Check } from "lucide-react";

export function Stepper({ step, total, labels }: { step: number; total: number; labels?: readonly string[] }) {
  return (
    <ol className="flex flex-wrap items-center gap-2 text-xs">
      {Array.from({ length: total }).map((_, i) => {
        const n = i + 1;
        const done = n < step;
        const active = n === step;
        return (
          <li key={n} className="flex items-center gap-2">
            <span
              className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[11px] font-semibold ${
                done
                  ? "border-primary bg-primary text-primary-foreground"
                  : active
                  ? "border-primary text-primary"
                  : "border-border text-muted-foreground"
              }`}
            >
              {done ? <Check className="h-3.5 w-3.5" /> : n}
            </span>
            {labels?.[i] && (
              <span className={active ? "font-medium text-foreground" : "text-muted-foreground"}>{labels[i]}</span>
            )}
            {n < total && <span className="h-px w-4 bg-border" />}
          </li>
        );
      })}
    </ol>
  );
}
