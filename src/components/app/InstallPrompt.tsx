import { useEffect, useState } from "react";
import { Download, Smartphone, Share, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isIos, isPwaUnsafeHost, isStandalone } from "@/lib/pwa";
import { useServerFn } from "@tanstack/react-start";
import { logUserAction } from "@/lib/audit.functions";

const DISMISS_KEY = "pvia.install.dismissed";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** Floating install prompt — Android Chrome (beforeinstallprompt) + iOS Safari instructions. */
export function InstallPrompt({ companyId }: { companyId?: string | null }) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [installed, setInstalled] = useState(false);
  const log = useServerFn(logUserAction);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isPwaUnsafeHost() || isStandalone()) return;
    if (localStorage.getItem(DISMISS_KEY)) return;

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
      if (companyId) {
        log({
          data: {
            companyId,
            action: "app.install",
            entityType: "pwa",
            metadata: { source: "appinstalled", ua: navigator.userAgent.slice(0, 200) },
          },
        }).catch(() => {});
      }
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    // iOS Safari has no beforeinstallprompt — show manual hint after 4s
    if (isIos()) {
      const t = setTimeout(() => setShowIosHint(true), 4000);
      return () => {
        clearTimeout(t);
        window.removeEventListener("beforeinstallprompt", onPrompt);
        window.removeEventListener("appinstalled", onInstalled);
      };
    }
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [companyId, log]);

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setDeferred(null);
    setShowIosHint(false);
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    if (choice.outcome === "accepted" && companyId) {
      log({
        data: {
          companyId,
          action: "app.install",
          entityType: "pwa",
          metadata: { source: "prompt", ua: navigator.userAgent.slice(0, 200) },
        },
      }).catch(() => {});
    }
    setDeferred(null);
  }

  if (installed || (!deferred && !showIosHint)) return null;

  return (
    <div className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-md rounded-2xl border border-border bg-background/95 p-4 shadow-2xl backdrop-blur-xl supports-[backdrop-filter]:bg-background/80 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <button
        onClick={dismiss}
        className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground hover:bg-muted"
        aria-label="Fermer"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground">
          <Smartphone className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1 pr-6">
          <p className="text-sm font-semibold leading-tight">Installer PVIA</p>
          {deferred ? (
            <>
              <p className="mt-1 text-xs text-muted-foreground">
                Ajoutez l'app à votre écran d'accueil pour un accès rapide hors ligne.
              </p>
              <Button onClick={install} size="sm" className="mt-3 w-full gap-2">
                <Download className="h-4 w-4" /> Installer l'application
              </Button>
            </>
          ) : (
            <div className="mt-1 space-y-1 text-xs text-muted-foreground">
              <p>Sur iPhone, appuyez sur :</p>
              <p className="flex items-center gap-1.5">
                <Share className="h-3.5 w-3.5" /> Partager
                <span className="opacity-50">→</span>
                <Plus className="h-3.5 w-3.5" /> Ajouter à l'écran d'accueil
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
