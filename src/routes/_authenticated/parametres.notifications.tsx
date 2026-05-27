import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { Bell, BellOff, Smartphone, Trash2, Send, Loader2, Mail, Plus, X, Save } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { isPwaUnsafeHost, urlBase64ToUint8Array, VAPID_PUBLIC_KEY } from "@/lib/pwa";
import { useCompany } from "@/hooks/use-company";
import { subscribePush, unsubscribePush } from "@/lib/push.functions";
import { listMyPushDevices, deleteMyPushDevice } from "@/lib/push-devices.functions";
import { sendTestPush } from "@/lib/notify-pv.functions";
import { getPvEmailSettings, updatePvEmailSettings } from "@/lib/pv-email-settings.functions";
import { useServerFn } from "@tanstack/react-start";

export const Route = createFileRoute("/_authenticated/parametres/notifications")({
  component: NotificationsSettings,
  head: () => ({ meta: [{ title: "Notifications — PVIA" }] }),
});

type Device = {
  id: string;
  endpoint: string;
  user_agent: string | null;
  last_seen_at: string;
  created_at: string;
};

function NotificationsSettings() {
  const { activeCompanyId } = useCompany();
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [enabled, setEnabled] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await listMyPushDevices();
      setDevices(r.devices as Device[]);
    } catch {/* ignore */}
  }, []);

  useEffect(() => {
    const ok =
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      !isPwaUnsafeHost();
    setSupported(ok);
    if (ok) {
      setPermission(Notification.permission);
      navigator.serviceWorker.ready.then((reg) =>
        reg.pushManager.getSubscription().then((s) => setEnabled(!!s)),
      );
      refresh();
    }
  }, [refresh]);

  async function enable() {
    if (!activeCompanyId) {
      toast.error("Sélectionnez d'abord une entreprise.");
      return;
    }
    setLoading(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") {
        toast.error("Permission refusée.");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      });
      const json = sub.toJSON();
      await subscribePush({
        data: {
          companyId: activeCompanyId,
          endpoint: sub.endpoint,
          p256dh: json.keys?.p256dh ?? "",
          auth: json.keys?.auth ?? "",
          userAgent: navigator.userAgent.slice(0, 500),
        },
      });
      setEnabled(true);
      toast.success("Notifications activées sur cet appareil.");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function disable() {
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await unsubscribePush({ data: { endpoint: sub.endpoint } });
        await sub.unsubscribe();
      }
      setEnabled(false);
      toast.success("Notifications désactivées sur cet appareil.");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function removeDevice(id: string) {
    try {
      await deleteMyPushDevice({ data: { id } });
      toast.success("Appareil supprimé.");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function testPush() {
    setTesting(true);
    try {
      const r = await sendTestPush();
      if (r.sent > 0) toast.success(`Notification envoyée à ${r.sent} appareil(s).`);
      else toast.warning("Aucun appareil enregistré n'a pu être joint.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 lg:p-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Recevez des alertes push sur cet appareil pour ne rien manquer (PV, signatures, réserves, équipe…).
        </p>
      </header>

      <Card className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex gap-3">
            <div className={`grid h-11 w-11 place-items-center rounded-xl ${enabled ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
              {enabled ? <Bell className="h-5 w-5" /> : <BellOff className="h-5 w-5" />}
            </div>
            <div>
              <div className="font-semibold">Notifications sur cet appareil</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {!supported && "Non supporté sur ce navigateur ou en preview Lovable."}
                {supported && permission === "denied" && "Permission refusée — autorisez les notifications dans les réglages du navigateur."}
                {supported && permission !== "denied" && (enabled ? "Actives" : "Désactivées")}
              </div>
            </div>
          </div>
          <Switch
            checked={enabled}
            disabled={!supported || loading || permission === "denied"}
            onCheckedChange={(v) => (v ? enable() : disable())}
          />
        </div>
        {enabled && (
          <div className="mt-4">
            <Button size="sm" variant="outline" onClick={testPush} disabled={testing}>
              {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              Envoyer une notification test
            </Button>
          </div>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="font-semibold">Appareils enregistrés</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Les appareils sur lesquels vous recevez actuellement des notifications.
        </p>
        <ul className="mt-4 divide-y divide-border">
          {devices.length === 0 && (
            <li className="py-6 text-center text-sm text-muted-foreground">Aucun appareil enregistré.</li>
          )}
          {devices.map((d) => {
            const ua = d.user_agent ?? "Appareil inconnu";
            const label =
              /iPhone|iPad/.test(ua) ? "iPhone / iPad"
              : /Android/.test(ua) ? "Android"
              : /Macintosh/.test(ua) ? "Mac"
              : /Windows/.test(ua) ? "Windows"
              : "Appareil";
            return (
              <li key={d.id} className="flex items-center justify-between gap-3 py-3">
                <div className="flex items-center gap-3">
                  <Smartphone className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <div className="text-sm font-medium">{label}</div>
                    <div className="text-xs text-muted-foreground">
                      Dernière activité : {new Date(d.last_seen_at).toLocaleString("fr-FR")}
                    </div>
                  </div>
                </div>
                <Button size="icon" variant="ghost" onClick={() => removeDevice(d.id)} aria-label="Supprimer">
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
