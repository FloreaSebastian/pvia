import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Shield, Smartphone, Trash2, Loader2, LogOut, KeyRound, History } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCompany } from "@/hooks/use-company";
import { listMyPushDevices, deleteMyPushDevice, wipeMyPushDevices } from "@/lib/push-devices.functions";

export const Route = createFileRoute("/_authenticated/parametres/securite")({
  component: SecuritySettings,
  head: () => ({ meta: [{ title: "Sécurité — Paramètres PVIA" }] }),
});

type Device = { id: string; user_agent: string | null; last_seen_at: string; created_at: string };
type AuditRow = { id: string; action: string; created_at: string; ip_address: string | null };

function SecuritySettings() {
  const { user, signOut } = useAuth();
  const { activeCompanyId } = useCompany();
  const [devices, setDevices] = useState<Device[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [wiping, setWiping] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await listMyPushDevices();
        setDevices(r.devices as Device[]);
      } catch { /* ignore */ }
      if (activeCompanyId && user?.id) {
        const { data } = await supabase
          .from("audit_logs")
          .select("id,action,created_at,ip_address")
          .eq("company_id", activeCompanyId)
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(20);
        setAudit((data ?? []) as AuditRow[]);
      }
      setLoading(false);
    })();
  }, [activeCompanyId, user?.id]);

  async function removeDevice(id: string) {
    try {
      await deleteMyPushDevice({ data: { id } });
      setDevices((d) => d.filter((x) => x.id !== id));
      toast.success("Appareil révoqué.");
    } catch (e) { toast.error((e as Error).message); }
  }

  async function wipeAll() {
    if (!confirm("Révoquer tous les appareils ? Vous ne recevrez plus de notifications jusqu'à réactivation.")) return;
    setWiping(true);
    try { await wipeMyPushDevices(); setDevices([]); toast.success("Tous les appareils ont été révoqués."); }
    catch (e) { toast.error((e as Error).message); }
    finally { setWiping(false); }
  }

  if (loading) {
    return <div className="grid h-40 place-items-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="mb-4 flex items-center gap-2">
          <Shield className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">Authentification</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Stat label="Compte" value={user?.email ?? "—"} />
          <Stat label="Dernière connexion" value={user?.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString("fr-FR") : "—"} />
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" disabled>
            <KeyRound className="mr-2 h-4 w-4" />
            Activer la 2FA <Badge variant="secondary" className="ml-2">Bientôt</Badge>
          </Button>
          <Button variant="outline" size="sm" onClick={() => signOut()}>
            <LogOut className="mr-2 h-4 w-4" />
            Se déconnecter
          </Button>
        </div>
      </Card>

      <Card className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Smartphone className="h-4 w-4 text-primary" />
            <h2 className="font-semibold">Appareils connectés</h2>
          </div>
          <Button size="sm" variant="ghost" onClick={wipeAll} disabled={wiping || devices.length === 0}>
            {wiping ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Tout révoquer
          </Button>
        </div>
        {devices.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-card/40 p-6 text-center text-sm text-muted-foreground">
            Aucun appareil enregistré pour les notifications.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {devices.map((d) => {
              const ua = d.user_agent ?? "";
              const label =
                /iPhone|iPad/.test(ua) ? "iPhone / iPad" :
                /Android/.test(ua) ? "Android" :
                /Macintosh/.test(ua) ? "Mac" :
                /Windows/.test(ua) ? "Windows" : "Appareil";
              return (
                <li key={d.id} className="flex items-center justify-between py-3">
                  <div>
                    <div className="text-sm font-medium">{label}</div>
                    <div className="text-xs text-muted-foreground">
                      Actif le {new Date(d.last_seen_at).toLocaleString("fr-FR")}
                    </div>
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => removeDevice(d.id)} aria-label="Supprimer">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card className="p-6">
        <div className="mb-4 flex items-center gap-2">
          <History className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">Activité récente</h2>
        </div>
        {audit.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-card/40 p-6 text-center text-sm text-muted-foreground">
            Aucun événement récent.
          </p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {audit.map((a) => (
              <li key={a.id} className="flex items-center justify-between py-2.5">
                <span className="font-mono text-xs">{a.action}</span>
                <span className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString("fr-FR")}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card/40 p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-medium">{value}</div>
    </div>
  );
}
