import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { ArrowLeft, FileSignature, Loader2, RefreshCw } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { sendClientLoginCode, verifyClientLoginCode } from "@/lib/client-auth.functions";
import { toast } from "sonner";

const searchSchema = z.object({
  email: z.string().email().optional(),
});

export const Route = createFileRoute("/client/verify")({
  validateSearch: (s) => searchSchema.parse(s),
  component: ClientVerify,
  head: () => ({
    meta: [
      { title: "Vérification du code — Espace client | PVIA" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function ClientVerify() {
  const { email = "" } = Route.useSearch();
  const navigate = useNavigate();
  const verify = useServerFn(verifyClientLoginCode);
  const resend = useServerFn(sendClientLoginCode);

  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(60);
  const submittedRef = useRef(false);

  // resend cooldown
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // auto-submit when 6 digits
  useEffect(() => {
    if (code.length === 6 && !submittedRef.current && !loading) {
      submittedRef.current = true;
      void submit(code);
    }
  }, [code, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(value: string) {
    if (!email) {
      toast.error("Email manquant. Recommencez la connexion.");
      navigate({ to: "/client/login" });
      return;
    }
    setLoading(true);
    try {
      await verify({ data: { email, code: value } });
      toast.success("Connexion réussie", { description: "Bienvenue dans votre espace." });
      navigate({ to: "/client/dashboard" });
    } catch (err: any) {
      toast.error(err?.message ?? "Code invalide");
      setCode("");
      submittedRef.current = false;
    } finally {
      setLoading(false);
    }
  }

  async function onResend() {
    if (cooldown > 0 || !email) return;
    try {
      await resend({ data: { email } });
      toast.success("Nouveau code envoyé");
      setCooldown(60);
      setCode("");
      submittedRef.current = false;
    } catch (err: any) {
      toast.error(err?.message ?? "Échec de l'envoi");
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-b from-background to-muted/30 px-4 py-12">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-md"
      >
        <Link to="/client/login" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Modifier l'email
        </Link>
        <Card className="border-border/60 p-7 shadow-lg shadow-primary/5">
          <div className="mb-6 flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-foreground">
              <FileSignature className="h-4 w-4" />
            </div>
            <div>
              <div className="text-base font-semibold">Entrez votre code</div>
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
