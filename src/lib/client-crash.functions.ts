import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { recordClientCrash } from "./client-crash.server";

export const reportClientCrash = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      route: z.string().max(500),
      message: z.string().max(2_000),
      stack: z.string().max(12_000).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await recordClientCrash(data, context.userId);
    return { reported: true };
  });