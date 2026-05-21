import { useEffect, useState } from "react";
import { Bell, CheckCheck, Inbox, FileText, AlertCircle, UserPlus, FileSignature } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/hooks/use-company";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

type Notif = {
  id: string;
  title: string;
  body: string | null;
  type: string;
  read: boolean;
  created_at: string;
};

const iconFor = (type: string) => {
  if (type.startsWith("pv_signed")) return FileSignature;
  if (type.startsWith("pv_")) return FileText;
  if (type.startsWith("reserve_")) return AlertCircle;
  if (type.startsWith("member_")) return UserPlus;
  return Bell;
};

export function NotificationsBell() {
  const { activeCompanyId } = useCompany();
  const [items, setItems] = useState<Notif[]>([]);
  const [open, setOpen] = useState(false);

  async function load() {
    if (!activeCompanyId) return;
    const { data } = await supabase
      .from("notifications")
      .select("id,title,body,type,read,created_at")
      .eq("company_id", activeCompanyId)
      .order("created_at", { ascending: false })
      .limit(15);
    setItems((data ?? []) as Notif[]);
  }

  useEffect(() => {
    load();
    if (!activeCompanyId) return;
    const ch = supabase
      .channel(`notif-${activeCompanyId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `company_id=eq.${activeCompanyId}` },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCompanyId]);

  const unread = items.filter((i) => !i.read).length;

  async function markAllRead() {
    if (!activeCompanyId) return;
    await supabase
      .from("notifications")
      .update({ read: true })
      .eq("company_id", activeCompanyId)
      .eq("read", false);
    load();
  }

  async function markOne(id: string) {
    await supabase.from("notifications").update({ read: true }).eq("id", id);
    load();
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          className="relative rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[360px] p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <p className="text-sm font-semibold">Notifications</p>
            <p className="text-[11px] text-muted-foreground">
              {unread > 0 ? `${unread} non lue${unread > 1 ? "s" : ""}` : "Tout est à jour"}
            </p>
          </div>
          {unread > 0 && (
            <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={markAllRead}>
              <CheckCheck className="h-3.5 w-3.5" /> Tout lire
            </Button>
          )}
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          {items.length === 0 ? (
            <div className="grid place-items-center p-10 text-center">
              <div className="grid h-12 w-12 place-items-center rounded-full bg-muted">
                <Inbox className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="mt-2 text-sm font-medium">Aucune notification</p>
              <p className="text-xs text-muted-foreground">
                Vos PV, réserves et invitations s'afficheront ici.
              </p>
            </div>
          ) : (
            items.map((n) => {
              const Icon = iconFor(n.type);
              return (
                <button
                  key={n.id}
                  onClick={() => markOne(n.id)}
                  className={`flex w-full items-start gap-3 border-b px-4 py-3 text-left transition hover:bg-muted/50 ${n.read ? "opacity-70" : ""}`}
                >
                  <div className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ${n.read ? "bg-muted" : "bg-primary/10 text-primary"}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{n.title}</p>
                    {n.body && <p className="line-clamp-2 text-xs text-muted-foreground">{n.body}</p>}
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: fr })}
                    </p>
                  </div>
                  {!n.read && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" />}
                </button>
              );
            })
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
