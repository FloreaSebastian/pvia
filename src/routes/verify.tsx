import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { ArrowLeft, KeyRound, Loader2, MessageSquare, RefreshCw } from "lucide-react";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { z } from "zod";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { supabase } from "@/integrations/supabase/client";
import { sendEnterpriseLoginCode, verifyEnterpriseLoginCode } from "@/lib/enterprise-auth.functions";
import { logUserAuthEvent } from "@/lib/user-auth.functions";
import { assertPasswordFallbackAllowed, getAuthFallbackConfig } from "@/lib/auth-fallback.functions";
import { getRememberMePreference, applyRememberMePreference } from "@/lib/remember-me";
import { toast } from "sonner";

const searchSchema = z.object({
  email: z.string().email().optional(),
});

const FALLBACK_AFTER = 3;
const MAX_OTP_ERRORS = 5;

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
  const resendLoginCode = useServerFn(sendEnterpriseLoginCode);
  const verifyLoginCode = useServerFn(verifyEnterpriseLoginCode);
  const assertPwdAllowed = useServerFn(assertPasswordFallbackAllowed);
  const fetchFallbackCfg = useServerFn(getAuthFallbackConfig);

  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(60);
  const [errorCount, setErrorCount] = useState(0);
  const [otpBlocked, setOtpBlocked] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [pwdLoading, setPwdLoading] = useState(false);
  const [smsEnabled, setSmsEnabled] = useState(false);
  const submittedRef = useRef(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    fetchFallbackCfg()
      .then((c) => setSmsEnabled(!!c?.smsEnabled))
      .catch(() => setSmsEnabled(false));
  }, [fetchFallbackCfg]);

  useEffect(() => {
    if (code.length === 6 && !submittedRef.current && !loading && !otpBlocked) {
      submittedRef.current = true;
      void submit(code);
    }
  }, [code, loading, otpBlocked]); // eslint-disable-line react-hooks/exhaustive-deps

  async function finalizeLogin() {
    const { data: { user } } = await supabase.auth.getUser();
    let isAdmin = false;
    if (user) {
      const { isPlatformAdminEmail } = await import("@/lib/platform-admin");
      if (isPlatformAdminEmail(user.email)) {
        const { data: role } = await supabase.from("user_roles").select("role").eq("user_id", user.id).eq("role", "platform_admin").maybeSingle();
        isAdmin = !!role;
      }
    }
    navigate({ to: isAdmin ? "/admin/dashboard" : "/dashboard" });
  }

  async function submit(value: string) {
    if (!email) {
      toast.error("Email manquant. Recommencez la connexion.");
      navigate({ to: "/login" });
      return;
    }
    setLoading(true);
    let tokenHash: string;
    try {
      const res = await verifyLoginCode({ data: { email, code: value } });
      tokenHash = res.tokenHash;
    } catch (err: any) {
      setLoading(false);
      await logEvent({ data: { action: "user.login_failed", email, metadata: { method: "otp" } } }).catch(() => {});
      const next = errorCount + 1;
      setErrorCount(next);
      const msg = err?.message ?? "Code invalide";
      toast.error(msg);
      if (next >= MAX_OTP_ERRORS || /Trop de tentatives/i.test(msg)) {
        setOtpBlocked(true);
        setShowPassword(true);
      } else if (next >= FALLBACK_AFTER) {
        setShowPassword(true);
      }
      setCode("");
      submittedRef.current = false;
      return;
    }
    const { error } = await supabase.auth.verifyOtp({
      type: "magiclink",
      token_hash: tokenHash,
    });
    setLoading(false);
    if (error) {
      await logEvent({ data: { action: "user.login_failed", email, metadata: { method: "otp", stage: "session" } } }).catch(() => {});
      toast.error("Session impossible à créer. Demandez un nouveau code.");
      setCode("");
      submittedRef.current = false;
      return;
    }
    await logEvent({ data: { action: "user.login_success", email, metadata: { method: "otp" } } }).catch(() => {});
    toast.success("Connexion réussie");
    await finalizeLogin();
  }

  async function onResend() {
    if (cooldown > 0 || !email) return;
    try {
      await resendLoginCode({ data: { email } });
      await logEvent({ data: { action: "user.login_code_sent", email } }).catch(() => {});
      toast.success("Nouveau code envoyé");
      setCooldown(60);
      setCode("");
      submittedRef.current = false;
      setErrorCount(0);
      setOtpBlocked(false);
    } catch (err: any) {
      toast.error(err?.message ?? "Échec de l'envoi");
    }
  }

  async function onPasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) return;
    setPwdLoading(true);
    try {
      await assertPwdAllowed({ data: { email } });
    } catch (err: any) {
      setPwdLoading(false);
      toast.error(err?.message ?? "Trop de tentatives. Réessayez plus tard.");
      return;
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setPwdLoading(false);
    if (error) {
      // Generic message — never reveal whether the account exists.
      await logEvent({
        data: { action: "user.login_password_fallback_failed", email, metadata: { reason: "invalid_credentials" } },
      }).catch(() => {});
      toast.error("Identifiants incorrects.");
      setPassword("");
      return;
    }
    await logEvent({ data: { action: "user.login_password_fallback_success", email } }).catch(() => {});
    toast.success("Connexion réussie");
    await finalizeLogin();
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
              disabled={loading || otpBlocked}
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

          {otpBlocked && (
            <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              Trop de tentatives. Demandez un nouveau code ou utilisez le mot de passe ci-dessous.
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

          {(errorCount >= FALLBACK_AFTER || otpBlocked) && (
            <div className="mt-6 space-y-4 border-t border-border/60 pt-5">
              <div>
                <div className="font-display text-sm font-semibold">
                  Vous n'arrivez pas à recevoir ou valider votre code&nbsp;?
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Choisissez une autre méthode de connexion.
                </p>
              </div>

              {!showPassword && (
                <div className="flex flex-col gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowPassword(true)}
                    className="justify-start gap-2"
                  >
                    <KeyRound className="h-4 w-4" /> Se connecter avec mot de passe
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!smsEnabled}
                    onClick={() => smsEnabled && toast.info("Bientôt disponible.")}
                    className="justify-start gap-2"
                  >
                    <MessageSquare className="h-4 w-4" /> Recevoir un code par SMS
                    {!smsEnabled && (
                      <Badge variant="secondary" className="ml-auto text-[10px]">
                        Bientôt
                      </Badge>
                    )}
                  </Button>
                </div>
              )}

              {showPassword && (
                <form onSubmit={onPasswordSubmit} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="fallback-password" className="text-xs">
                      Mot de passe
                    </Label>
                    <Input
                      id="fallback-password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                      required
                      minLength={6}
                      maxLength={128}
                      disabled={pwdLoading}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Button type="submit" disabled={pwdLoading || !password} className="flex-1">
                      {pwdLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Se connecter"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setShowPassword(false);
                        setPassword("");
                      }}
                      disabled={pwdLoading}
                    >
                      Annuler
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Si vous avez oublié votre mot de passe, demandez un nouveau code par email.
                  </p>
                </form>
              )}
            </div>
          )}
        </Card>
      </motion.div>
    </div>
  );
}
