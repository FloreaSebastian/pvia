import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requirePlatformAdmin } from "@/lib/admin-guard.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type LaunchChecklistItem = {
  id: string;
  key: string;
  label: string;
  category: string;
  position: number;
  status: "todo" | "passed" | "failed" | "skipped";
  notes: string | null;
  tested_by: string | null;
  tested_at: string | null;
  created_at: string;
  updated_at: string;
};

export const listLaunchChecklist = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LaunchChecklistItem[]> => {
    await requirePlatformAdmin(context.userId);
    const { data, error } = await supabaseAdmin
      .from("launch_checklist_items")
      .select("*")
      .order("position", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as LaunchChecklistItem[];
  });

export const updateLaunchChecklistItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      id: z.string().uuid(),
      status: z.enum(["todo", "passed", "failed", "skipped"]).optional(),
      notes: z.string().max(4000).nullable().optional(),
    }).parse(input),
  )
  .handler(async ({ context, data }): Promise<LaunchChecklistItem> => {
    await requirePlatformAdmin(context.userId);
    const patch: Record<string, unknown> = {};
    if (data.status !== undefined) {
      patch.status = data.status;
      patch.tested_at = data.status === "todo" ? null : new Date().toISOString();
      patch.tested_by = data.status === "todo" ? null : context.userId;
    }
    if (data.notes !== undefined) patch.notes = data.notes;
    const { data: row, error } = await supabaseAdmin
      .from("launch_checklist_items")
      .update(patch)
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row as LaunchChecklistItem;
  });

export const resetLaunchChecklist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requirePlatformAdmin(context.userId);
    const { error } = await supabaseAdmin
      .from("launch_checklist_items")
      .update({ status: "todo", notes: null, tested_at: null, tested_by: null })
      .neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const exportLaunchChecklistCsv = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ filename: string; csv: string }> => {
    await requirePlatformAdmin(context.userId);
    const { data, error } = await supabaseAdmin
      .from("launch_checklist_items")
      .select("*")
      .order("position", { ascending: true });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as LaunchChecklistItem[];
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ["category", "key", "label", "status", "tested_at", "tested_by", "notes"].join(",");
    const body = rows
      .map((r) =>
        [r.category, r.key, r.label, r.status, r.tested_at ?? "", r.tested_by ?? "", r.notes ?? ""]
          .map(esc)
          .join(","),
      )
      .join("\n");
    return { filename: `pvia-launch-checklist-${new Date().toISOString().slice(0, 10)}.csv`, csv: `${header}\n${body}\n` };
  });
