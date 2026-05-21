export function FieldStepper({ step, total, labels }: { step: number; total: number; labels?: string[] }) {
  return (
    <div className="mb-4 flex items-center gap-2">
      {Array.from({ length: total }).map((_, i) => {
        const active = i + 1 === step;
        const done = i + 1 < step;
        return (
          <div key={i} className="flex flex-1 flex-col items-center gap-1">
            <div
              className={`h-1.5 w-full rounded-full transition-colors ${
                done ? "bg-primary" : active ? "bg-primary/60" : "bg-muted"
              }`}
            />
            {labels?.[i] ? (
              <span className={`text-[10px] ${active ? "font-medium text-foreground" : "text-muted-foreground"}`}>
                {labels[i]}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
