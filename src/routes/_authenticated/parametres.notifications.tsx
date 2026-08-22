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
import { isAdminRole } from "@/lib/roles";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/parametres/notifications")({
  component: NotificationsSettings,
  head: () => ({ meta: [{ title: "Notifications — PVIA" }] }),
});

type Device = {
  id: string;
  user_agent: string | null;
  last_seen_at: string;
  created_at: string;
};

function NotificationsSettings() {
  const { activeCompanyId, activeRole } = useCompany();
  const canEditEmails = isAdminRole(activeRole);
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [enabled, setEnabled] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [pendingDevice, setPendingDevice] = useState<Device | null>(null);

  // PV signed email settings
  const getSettingsFn = useServerFn(getPvEmailSettings);
  const updateSettingsFn = useServerFn(updatePvEmailSettings);
  const [sendCompanyCopy, setSendCompanyCopy] = useState(true);
  const [companySignedEmail, setCompanySignedEmail] = useState("");
  const [pvRecipients, setPvRecipients] = useState<string[]>([]);
  const [pvCc, setPvCc] = useState<string[]>([]);
  const [newRecipient, setNewRecipient] = useState("");
  const [newCc, setNewCc] = useState("");
  const [savingPvEmail, setSavingPvEmail] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await listMyPushDevices();
      setDevices(r.devices as Device[]);
    } catch {/* ignore */}
  }, []);

  // Load PV email settings when company changes
  useEffect(() => {
    if (!activeCompanyId) return;
    getSettingsFn({ data: { companyId: activeCompanyId } })
      .then((s) => {
        setSendCompanyCopy(s.send_signed_pv_to_company);
        setCompanySignedEmail(s.company_signed_email ?? "");
        setPvRecipients(s.pv_email_recipients ?? []);
        setPvCc(s.pv_email_cc ?? []);
      })
      .catch(() => { /* keep defaults */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCompanyId]);

  async function savePvEmailSettings() {
    if (!activeCompanyId) return toast.error("Aucune entreprise active.");
    setSavingPvEmail(true);
    try {
      await updateSettingsFn({
        data: {
          companyId: activeCompanyId,
          send_signed_pv_to_company: sendCompanyCopy,
          company_signed_email: companySignedEmail.trim() || null,
          pv_email_recipients: pvRecipients,
          pv_email_cc: pvCc,
        },
      });
      toast.success("Paramètres d'envoi enregistrés.");
    } catch (e: any) {
      toast.error(e?.message || "Échec de l'enregistrement.");
    } finally {
      setSavingPvEmail(false);
    }
  }

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
            aria-label="Activer les notifications sur cet appareil"
            checked={enabled}
            disabled={!supported || loading || permission === "denied"}
            onCheckedChange={(v) => (v ? enable() : disable())}
          />
        </div>
        {enabled && (
          <div className="mt-4">
            <Button variant="outline" className="h-11 w-full sm:w-auto" onClick={testPush} disabled={testing}>
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
                <div className="flex min-w-0 items-center gap-3">
                  <Smartphone className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{label}</div>
                    <div className="text-xs text-muted-foreground">
                      Dernière activité : {new Date(d.last_seen_at).toLocaleString("fr-FR")}
                    </div>
                  </div>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-11 w-11 shrink-0"
                  onClick={() => setPendingDevice(d)}
                  aria-label={`Supprimer l'appareil ${label}`}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card className="p-5">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary/15 text-primary">
            <Mail className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h2 className="font-semibold">Envoi automatique des PV signés</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Définissez qui reçoit automatiquement le PDF signé une fois le PV finalisé.
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-5">
          <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-muted/20 p-3">
            <div>
              <div className="text-sm font-medium">Envoyer une copie à l'entreprise</div>
              <p className="text-xs text-muted-foreground">Le PDF signé est aussi envoyé à votre adresse principale.</p>
            </div>
            <Switch
              aria-label="Envoyer une copie du PV signé à l'entreprise"
              checked={sendCompanyCopy}
              disabled={!canEditEmails}
              onCheckedChange={setSendCompanyCopy}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Email principal entreprise (optionnel)</Label>
            <Input
              type="email"
              value={companySignedEmail}
              onChange={(e) => setCompanySignedEmail(e.target.value)}
              placeholder="archives@monentreprise.fr"
              disabled={!canEditEmails}
              className="h-11"
            />
            <p className="text-[11px] text-muted-foreground">Si vide, l'email de la fiche entreprise sera utilisé.</p>
          </div>

          <EmailList
            label="Destinataires supplémentaires (TO)"
            help="Ces adresses recevront chaque PV signé en plus du client."
            emails={pvRecipients}
            setEmails={setPvRecipients}
            value={newRecipient}
            setValue={setNewRecipient}
            disabled={!canEditEmails}
          />

          <EmailList
            label="Copies (CC)"
            help="Ces adresses recevront chaque PV signé en copie."
            emails={pvCc}
            setEmails={setPvCc}
            value={newCc}
            setValue={setNewCc}
            disabled={!canEditEmails}
          />

          {!canEditEmails && (
            <p className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
              Seuls les administrateurs de l'entreprise peuvent modifier ces destinataires.
            </p>
          )}

          <div className="flex justify-end">
            <Button
              className="h-11 w-full gap-2 sm:w-auto"
              onClick={savePvEmailSettings}
              disabled={savingPvEmail || !canEditEmails}
            >
              {savingPvEmail ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Enregistrer
            </Button>
          </div>
        </div>
      </Card>

      <AlertDialog open={!!pendingDevice} onOpenChange={(o) => !o && setPendingDevice(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cet appareil ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cet appareil ne recevra plus de notifications push. Vous pourrez les réactiver depuis l'appareil concerné.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const id = pendingDevice?.id;
                setPendingDevice(null);
                if (id) removeDevice(id);
              }}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function EmailList({
  label, help, emails, setEmails, value, setValue, disabled,
}: {
  label: string;
  help: string;
  emails: string[];
  setEmails: (e: string[]) => void;
  value: string;
  setValue: (v: string) => void;
  disabled?: boolean;
}) {
  function add() {
    const v = value.trim().toLowerCase();
    if (!v) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      toast.error("Email invalide.");
      return;
    }
    if (emails.includes(v)) {
      toast.message("Email déjà ajouté.");
      return;
    }
    if (emails.length >= 10) {
      toast.error("10 emails maximum.");
      return;
    }
    setEmails([...emails, v]);
    setValue("");
  }
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">{label}</Label>
      <p className="text-[11px] text-muted-foreground">{help}</p>
      <div className="flex flex-wrap gap-2">
        <Input
          type="email"
          inputMode="email"
          autoComplete="email"
          className="h-11 min-w-0 flex-1"
          value={value}
          disabled={disabled}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder="email@exemple.com"
        />
        <Button type="button" variant="outline" className="h-11 shrink-0 gap-1.5" onClick={add} disabled={disabled}>
          <Plus className="h-4 w-4" /> Ajouter
        </Button>
      </div>
      {emails.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {emails.map((e) => (
            <li key={e} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-muted/30 py-1 pl-3 pr-1 text-xs">
              <Mail className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">{e}</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => setEmails(emails.filter((x) => x !== e))}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-full hover:bg-destructive/20 disabled:opacity-40"
                aria-label={`Retirer ${e}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
