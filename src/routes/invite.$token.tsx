import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, CheckCircle2, XCircle, FileSignature } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { getInviteByToken, acceptInviteForCurrentUser } from "@/lib/invites.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/invite/$token")({
  component: InvitePage,
  head: () => ({ meta: [{ title: "Rejoindre PVIA" }] }),
});

type InviteInfo =
  | { valid: true; email: string | null; role: string; companyName: string }
  | { valid: false; reason?: string };

function InvitePage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const getInvite = useServerFn(getInviteByToken);
  const accept = useServerFn(acceptInviteForCurrentUser);

  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getInvite({ data: { token } }).then((r) => setInfo(r as InviteInfo));
  }, [token, getInvite]);

  useEffect(() => {
    // Auto-accept if user already logged in
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (data.user && info && info.valid) {
        try {
          await accept({ data: { token } });
          toast.success(`Bienvenue dans ${info.companyName} !`);
          navigate({ to: "/dashboard" });
        } catch (e: any) {
          toast.error(e.message);
        }
      }
    })();
  }, [info, accept, token, navigate]);

  if (!info) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!info.valid) {
    return (
      <div className="grid min-h-screen place-items-center bg-muted/30 p-6">
        <Card className="w-full max-w-md p-8 text-center">
          <XCircle className="mx-auto h-12 w-12 text-destructive" />
          <h1 className="mt-3 text-xl font-semibold">Invitation invalide</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {info.reason === "expired"
              ? "Cette invitation a expiré. Demandez un nouveau lien à votre administrateur."
              : info.reason === "used"
              ? "Cette invitation a déjà été utilisée."
              : "Lien d'invitation introuvable."}
          </p>
          <Link to="/login">
            <Button className="mt-4 w-full">Se connecter</Button>
          </Link>
        </Card>
      </div>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!info?.valid || !info.email) return;
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email: info.email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/invite/${token}`,
            data: { full_name: fullName, invite_token: token },
          },
        });
        if (error) throw error;
        toast.success("Compte créé. Vérifiez vos emails pour confirmer.");
        navigate({ to: "/login" });
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: info.email,
          password,
        });
        if (error) throw error;
        await accept({ data: { token } });
        toast.success(`Bienvenue dans ${info.companyName} !`);
        navigate({ to: "/dashboard" });
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-br from-muted/30 to-background p-6">
      <Card className="w-full max-w-md p-8">
        <div className="flex items-center gap-2 text-primary">
          <FileSignature className="h-5 w-5" />
          <span className="text-sm font-semibold">PVIA</span>
        </div>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">
          Rejoindre <span className="text-primary">{info.companyName}</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Invitation pour <strong>{info.email}</strong> · rôle <strong>{info.role}</strong>
        </p>

        <div className="mt-6 flex gap-2 rounded-lg bg-muted p-1">
          <button
            type="button"
            onClick={() => setMode("signup")}
            className={`flex-1 rounded-md py-2 text-xs font-medium transition ${mode === "signup" ? "bg-background shadow-sm" : "text-muted-foreground"}`}
          >
            Créer un compte
          </button>
          <button
            type="button"
            onClick={() => setMode("login")}
            className={`flex-1 rounded-md py-2 text-xs font-medium transition ${mode === "login" ? "bg-background shadow-sm" : "text-muted-foreground"}`}
          >
            J'ai déjà un compte
          </button>
        </div>

        <form onSubmit={onSubmit} className="mt-5 space-y-4">
          {mode === "signup" && (
            <div className="space-y-1.5">
              <Label>Nom complet</Label>
              <Input required value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input value={info.email ?? ""} disabled />
          </div>
          <div className="space-y-1.5">
            <Label>Mot de passe</Label>
            <Input type="password" minLength={6} required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {mode === "signup" ? "Créer mon compte et rejoindre" : "Se connecter et rejoindre"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
