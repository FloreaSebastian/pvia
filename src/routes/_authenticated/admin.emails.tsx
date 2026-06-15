import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { listEmailTemplates } from "@/lib/email-admin.functions";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Mail, Loader2 } from "lucide-react";

type T = Awaited<ReturnType<typeof listEmailTemplates>>[number];

export const Route = createFileRoute("/_authenticated/admin/emails")({
  component: Page,
  head: () => ({ meta: [{ title: "Admin · Emails — PVIA" }] }),
  beforeLoad: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw redirect({ to: "/login" });
    const { isPlatformAdminEmail } = await import("@/lib/platform-admin");
    if (!isPlatformAdminEmail(user.email)) throw redirect({ to: "/admin/forbidden" });
  },
});

function StatusBadge({ s }: { s: string }) {
  const map: Record<string, string> = {
    stable: "bg-emerald-100 text-emerald-800 border-emerald-300",
    legacy_inline: "bg-amber-100 text-amber-800 border-amber-300",
    todo: "bg-slate-100 text-slate-700 border-slate-300",
  };
  return <Badge variant="outline" className={map[s] ?? ""}>{s}</Badge>;
}

function Page() {
  const list = useServerFn(listEmailTemplates);
  const [items, setItems] = useState<T[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    list().then(setItems).catch((e) => setErr(e?.message ?? "Erreur"));
  }, [list]);

  if (err) return <div className="p-8 text-destructive">{err}</div>;
  if (!items) return <div className="p-8 flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin"/> Chargement…</div>;

  const byCat = new Map<string, T[]>();
  for (const it of items) {
    const arr = byCat.get(it.category) ?? [];
    arr.push(it); byCat.set(it.category, arr);
  }

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto">
      <Link to="/admin/dashboard" className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:text-foreground mb-4">
        <ArrowLeft className="h-4 w-4"/> Admin
      </Link>
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <Mail className="h-3.5 w-3.5"/> Emails transactionnels
      </div>
      <h1 className="text-2xl md:text-3xl font-bold mt-1">Catalogue centralisé</h1>
      <p className="text-muted-foreground text-sm mt-2 max-w-2xl">
        Source de vérité unique de tous les emails envoyés par PVIA.
        Statut <code>legacy_inline</code> = renderer HTML inline à extraire vers React Email.
      </p>

      <div className="mt-6 space-y-6">
        {Array.from(byCat.entries()).map(([cat, arr]) => (
          <div key={cat}>
            <h2 className="text-lg font-semibold mb-2 capitalize">{cat}</h2>
            <div className="space-y-2">
              {arr.map((t) => (
                <Card key={t.key} className="p-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{t.label}</span>
                        <StatusBadge s={t.status}/>
                        <Badge variant="outline" className="text-xs">{t.recipient}</Badge>
                        {t.retryable && <Badge variant="outline" className="text-xs bg-blue-50">retryable</Badge>}
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">{t.description}</p>
                      <code className="text-[11px] text-muted-foreground">{t.key}</code>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
