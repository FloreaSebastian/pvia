import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listEmailTemplates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { EMAIL_TEMPLATES } = await import("./email-registry.server");
    return EMAIL_TEMPLATES.map((t) => ({
      key: t.key, label: t.label, category: t.category,
      description: t.description, recipient: t.recipient,
      retryable: t.retryable, status: t.status,
      hasPreview: !!t.preview,
    }));
  });

export const previewEmailTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ key: z.string().min(1).max(80) }).parse(i))
  .handler(async ({ data, context }) => {
    // Restrict to platform admins
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: r } = await supabaseAdmin
      .from("user_roles").select("role")
      .eq("user_id", context.userId)
      .in("role", ["admin", "platform_admin"]).maybeSingle();
    if (!r) throw new Error("Accès refusé");

    const { getTemplateByKey } = await import("./email-registry.server");
    const tpl = getTemplateByKey(data.key);
    if (!tpl) throw new Error("Template inconnu");
    if (!tpl.preview) return { subject: "(pas d'aperçu)", html: "<p>Aperçu non disponible pour ce template.</p>" };
    return tpl.preview();
  });
