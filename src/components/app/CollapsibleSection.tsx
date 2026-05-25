import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Card-like section that the user can collapse. Open/closed state is
 * persisted per-user in localStorage under the given `id`.
 */
export function CollapsibleSection({
  id,
  title,
  description,
  icon,
  actions,
  defaultOpen = true,
  children,
  className,
}: {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const storageKey = `pvia.settings.section.${id}`;
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof localStorage === "undefined") return defaultOpen;
    const raw = localStorage.getItem(storageKey);
    if (raw === null) return defaultOpen;
    return raw === "1";
  });

  useEffect(() => {
    try { localStorage.setItem(storageKey, open ? "1" : "0"); } catch { /* noop */ }
  }, [open, storageKey]);

  return (
    <section
      className={cn(
        "rounded-2xl border border-border bg-card text-card-foreground shadow-sm",
        className,
      )}
    >
      <header className="flex items-center gap-3 p-4 sm:p-5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          className="flex flex-1 items-center gap-3 text-left"
        >
          {icon && (
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
              {icon}
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{title}</span>
            {description && (
              <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
            )}
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
              open && "rotate-180",
            )}
          />
        </button>
        {actions && <div className="shrink-0">{actions}</div>}
      </header>
      <div
        id={`${id}-panel`}
        hidden={!open}
        className="border-t border-border/70 px-4 py-5 sm:px-6 sm:py-6"
      >
        {children}
      </div>
    </section>
  );
}
