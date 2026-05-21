import { Link } from "@tanstack/react-router";
import { ArrowLeft, CloudOff, Wifi, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useFieldQueue } from "@/hooks/use-field-queue";

export function FieldShell({
  title,
  back,
  savedAt,
  children,
  footer,
}: {
  title: string;
  back?: string;
  savedAt?: string | null;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const online = useOnlineStatus();
  const { ops, flushing } = useFieldQueue();
  const pending = ops.length;

  return (
    <div className="-m-4 lg:-m-8 min-h-[calc(100dvh-4rem)] bg-background flex flex-col">
      <header className="sticky top-16 z-10 flex items-center gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        {back ? (
          <Link to={back} className="rounded-full p-2 hover:bg-muted" aria-label="Retour">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        ) : null}
        <div className="flex-1 min-w-0">
          <h1 className="truncate text-base font-semibold">{title}</h1>
          {savedAt ? (
            <p className="text-[11px] text-muted-foreground">
              Sauvegardé à {new Date(savedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5">
          {online ? (
            <Badge variant="secondary" className="gap-1 text-[10px]"><Wifi className="h-3 w-3" /> En ligne</Badge>
          ) : (
            <Badge variant="destructive" className="gap-1 text-[10px]"><CloudOff className="h-3 w-3" /> Hors ligne</Badge>
          )}
          {pending > 0 ? (
            <Badge variant="outline" className="gap-1 text-[10px]">
              {flushing ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              {pending} en attente
            </Badge>
          ) : null}
        </div>
      </header>

      <main className="flex-1 px-4 py-4 pb-32">{children}</main>

      {footer ? (
        <footer className="sticky bottom-0 z-10 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
          {footer}
        </footer>
      ) : null}
    </div>
  );
}
