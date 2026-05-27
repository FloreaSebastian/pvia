import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { ArrowLeft, Loader2, RefreshCw } from "lucide-react";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { z } from "zod";
import { Card } from "@/components/ui/card";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { supabase } from "@/integrations/supabase/client";
import { logUserAuthEvent } from "@/lib/user-auth.functions";
import { toast } from "sonner";

const searchSchema = z.object({
  email: z.string().email().optional(),
});

export const Route = createFileRoute("/verify")({
  validateSearch: (s) => searchSchema.parse(s),
  component: VerifyPage,
  head: () => ({
    meta: [
      { title: "Vérification du code — PVIA" },
      {
        name: "description",
        content:
          "Saisissez le code à 6 chiffres reçu par email pour vérifier votre compte PVIA et accéder à votre espace sécurisé.",
      },
      { property: "og:title", content: "Vérification du code — PVIA" },
      {
        property: "og:description",
        content:
          "Étape de vérification sécurisée par code à usage unique pour accéder à votre compte PVIA.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function VerifyPage() {
  const { email = "" } = Route.useSearch();
  const navigate = useNavigate();
  const logEvent = useServerFn(logUserAuthEvent);

  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(60);
  const submittedRef = useRef(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    if (code.length === 6 && !submittedRef.current && !loading) {
      submittedRef.current = true;
      void submit(code);
    }
  }, [code, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(value: string) {
    if (!email) {
      toast.error("Email manquant. Recommencez la connexion.");
      navigate({ to: "/login" });
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: value,
      type: "email",
    });
    setLoading(false);
    if (error) {
      await logEvent({ data: { action: "user.login_failed", email, metadata: { method: "otp" } } }).catch(() => {});
      toast.error(error.message.includes("expired") ? "Code expiré ou invalide" : "Code invalide");
      setCode("");
      submittedRef.current = false;
      return;
    }
    await logEvent({ data: { action: "user.login_success", email, metadata: { method: "otp" } } }).catch(() => {});
    toast.success("Connexion réussie");
    const { data: { user } } = await supabase.auth.getUser();
    let isAdmin = false;
    if (user) {
      const { data: role } = await supabase.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
      isAdmin = !!role;
    }
    navigate({ to: isAdmin ? "/admin/dashboard" : "/dashboard" });
  }

  async function onResend() {
    if (cooldown > 0 || !email) return;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    await logEvent({ data: { action: "user.login_code_sent", email } }).catch(() => {});
    toast.success("Nouveau code envoyé");
    setCooldown(60);
    setCode("");
    submittedRef.current = false;
  }

  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-b from-background to-muted/30 px-4 py-12">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-md"
      >
        <Link to="/login" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Modifier l'email
        </Link>
        <Card className="border-border/60 p-7 shadow-brand">
          <div className="mb-6 flex items-center gap-3">
            <BrandLogo variant="compact" />
            <div className="border-l border-border/60 pl-3">
              <div className="font-display text-base font-bold">Entrez votre code</div>
              <div className="text-xs text-muted-foreground">
                Envoyé à <span className="font-medium text-foreground">{email || "votre email"}</span>
              </div>
            </div>
          </div>

          <div className="flex justify-center py-2">
            <InputOTP
              maxLength={6}
              value={code}
              onChange={setCode}
              autoFocus
              disabled={loading}
              containerClassName="gap-2"
            >
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
              </InputOTPGroup>
            </InputOTP>
          </div>

          {loading && (
            <div className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Vérification…
            </div>
          )}

          <div className="mt-6 flex items-center justify-between border-t border-border/60 pt-4 text-xs text-muted-foreground">
            <span>Le code expire dans 10 minutes</span>
            <button
              type="button"
              onClick={onResend}
              disabled={cooldown > 0}
              className="inline-flex items-center gap-1 font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
            >
              <RefreshCw className="h-3 w-3" />
              {cooldown > 0 ? `Renvoyer (${cooldown}s)` : "Renvoyer le code"}
            </button>
          </div>
        </Card>
      </motion.div>
    </div>
  );
}
