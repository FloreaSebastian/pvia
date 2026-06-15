import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listEmailTemplates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { EMAIL_TEMPLATES } = await import("./email-registry.server");
    return EMAIL_TEMPLATES.map((t) => ({ ...t }));
  });
