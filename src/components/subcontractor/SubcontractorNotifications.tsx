import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Bell, BellRing, CheckCheck, Inbox, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { isPwaUnsafeHost, urlBase64ToUint8Array, VAPID_PUBLIC_KEY } from "@/lib/pwa";
import { subscribePush } from "@/lib/push.functions";
import { listMyCompanies } from "@/lib/subcontractor-portal-documents.functions";

/**
 * Centre de notifications de l'espace Sous-traitant (mobile-first).
 *
 * Sécurité : aucune requête ne suppose un tenant. On lit uniquement les
 * notifications dont `user_id` est le compte connecté ; la politique RLS
 * additive `notif_select_subcontractor` ne les rend visibles que pour les
 * entreprises où la relation est ACTIVE et non révoquée. Une révocation rend
 * donc les notifications correspondantes immédiatement invisibles.
 */
type Notif = {
  id: string;
  company_id: string;
  title: string;
  body: string | null;
  type: string;
  read: boolean;
  created_at: string;
};

export function SubcontractorNotifications() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushEnabled, setPushEnabled] = useState<boolean | null>(null);
  const loadCompanies = useServerFn(listMyCompanies);

  const load = useCallback(async (uid: string) => {
    const { data } = await supabase
      .from("notifications")
      .select("id,company_id,title,body,type,read,created_at")
      .eq("user_id", uid)
      .order("created_at", { ascending: false })
      .limit(30);
    setItems((data ?? []) as Notif[]);
  }, []);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled || !data.user) return;
      setUserId(data.user.id);
      load(data.user.id);
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || isPwaUnsafeHost()) {
      setPushEnabled(false);
      return;
    }
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((s) => setPushEnabled(!!s))
      .catch(() => setPushEnabled(false));
  }, []);

  const unread = items.filter((i) => !i.read).length;

  async function markAllRead() {
    if (!userId) return;
    await supabase.from("notifications").update({ read: true }).eq("user_id", userId).eq("read", false);
    load(userId);
  }

  async function markOne(id: string) {
    if (!userId) return;
    await supabase.from("notifications").update({ read: true }).eq("id", id).eq("user_id", userId);
    load(userId);
  }

  /** Activation réelle du push : permission navigateur puis enregistrement serveur. */
  async function enablePush() {
    setPushBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        toast.error("Permission refusée sur cet appareil.");
        return;
      }
      const res = await loadCompanies();
      const companies = res.companies ?? [];
      if (companies.length === 0) {
        toast.error("Aucune entreprise active liée à votre compte.");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
        }));
      const json = sub.toJSON();
      // Un appareil est enregistré pour chaque entreprise où la relation est
      // active : le serveur revérifie chaque tenant, aucun n'est déduit du client.
      for (const c of companies) {
        await subscribePush({
          data: {
            companyId: c.companyId,
            endpoint: sub.endpoint,
            p256dh: json.keys?.p256dh ?? "",
            auth: json.keys?.auth ?? "",
            userAgent: navigator.userAgent.slice(0, 500),
          },
        });
      }
      setPushEnabled(true);
      toast.success("Notifications activées sur cet appareil.");
    } catch (e) {
      toast.error((e as Error).message || "Activation impossible.");
    } finally {
      setPushBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="relative grid h-11 w-11 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
          aria-label={unread > 0 ? `Notifications, ${unread} non lue${unread > 1 ? "s" : ""}` : "Notifications"}
        >
          <Bell className="h-5 w-5" aria-hidden="true" />
          {unread > 0 && (
            <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="flex w-full max-w-sm flex-col gap-0 p-0 sm:max-w-sm">
        <SheetHeader className="border-b px-4 py-3 text-left">
          <SheetTitle className="text-base">Notifications</SheetTitle>
          <SheetDescription className="text-xs">
            {unread > 0 ? `${unread} non lue${unread > 1 ? "s" : ""}` : "Tout est à jour"}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
          {unread > 0 && (
            <Button size="sm" variant="ghost" className="h-9 gap-1 text-xs" onClick={markAllRead}>
              <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" /> Tout lire
            </Button>
          )}
          {pushEnabled === false && (
            <Button size="sm" variant="outline" className="h-9 gap-1 text-xs" onClick={enablePush} disabled={pushBusy}>
              {pushBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <BellRing className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              Activer sur ce téléphone
            </Button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
          {items.length === 0 ? (
            <div className="grid place-items-center p-10 text-center">
              <div className="grid h-12 w-12 place-items-center rounded-full bg-muted">
                <Inbox className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              </div>
              <p className="mt-2 text-sm font-medium">Aucune notification</p>
              <p className="text-xs text-muted-foreground">
                Les validations et relances de vos pièces s'afficheront ici.
              </p>
            </div>
          ) : (
            items.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => markOne(n.id)}
                className={`flex w-full min-h-14 flex-col items-start gap-0.5 border-b px-4 py-3 text-left transition hover:bg-muted/50 ${
                  n.read ? "opacity-70" : ""
                }`}
              >
                <span className="text-sm font-medium">{n.title}</span>
                {n.body && <span className="text-xs text-muted-foreground">{n.body}</span>}
                <span className="text-[10px] text-muted-foreground">
                  {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: fr })}
                </span>
              </button>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
