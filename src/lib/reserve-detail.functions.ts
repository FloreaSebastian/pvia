/**
 * Reserve dossier helpers.
 *
 * - listLiftsForReserve(reserveId): all reserve_lift_reports linked to this
 *   reserve via reserve_lift_items, with per-lift comment + PDFs metadata.
 *
 * Scoped: company membership required (RLS via company_members check).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type ReserveLinkedLift = {
  id: string;
  numero: string | null;
  status: string | null;
  signed_at: string | null;
  created_at: string;
  signer_name: string | null;
  signer_role: string | null;
  signer_signed_at: string | null;
  technician_name: string | null;
  validation_mode: string | null;
  client_signed_on_site: boolean | null;
  client_validated_at: string | null;
  client_validated_email: string | null;
  client_rejected_at: string | null;
  client_signature: string | null;
  pdf_url: string | null;
  pdf_internal_url: string | null;
  pdf_client_url: string | null;
  comment: string | null;
};

export const listLiftsForReserve = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ reserveId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: reserve } = await supabaseAdmin
      .from("pv_reserves")
      .select("id,company_id")
      .eq("id", data.reserveId)
      .maybeSingle();
    if (!reserve?.company_id) throw new Error("Réserve introuvable.");

    const { data: member } = await supabaseAdmin
      .from("company_members")
      .select("id")
      .eq("company_id", reserve.company_id)
      .eq("user_id", context.userId)
      .eq("status", "active")
      .maybeSingle();
    if (!member) throw new Error("Accès refusé.");

    const { data: items } = await supabaseAdmin
      .from("reserve_lift_items")
      .select("id,report_id,comment")
      .eq("reserve_id", data.reserveId);

    const reportIds = Array.from(new Set((items ?? []).map((it: any) => it.report_id))).filter(Boolean);
    if (reportIds.length === 0) return { lifts: [] as ReserveLinkedLift[] };

    const { data: reports } = await supabaseAdmin
      .from("reserve_lift_reports")
      .select([
        "id", "numero", "status", "signed_at", "created_at",
        "signer_name", "signer_role", "signer_signed_at",
        "technician_name", "validation_mode", "client_signed_on_site",
        "client_validated_at", "client_validated_email",
        "client_rejected_at", "client_signature",
        "pdf_url", "pdf_internal_url", "pdf_client_url",
      ].join(","))
      .in("id", reportIds)
      .order("created_at", { ascending: false });

    const commentByReport: Record<string, string | null> = {};
    for (const it of (items ?? []) as any[]) {
      if (it.report_id && it.comment && !commentByReport[it.report_id]) {
        commentByReport[it.report_id] = it.comment;
      }
    }

    const lifts: ReserveLinkedLift[] = ((reports ?? []) as any[]).map((r) => ({
      id: r.id,
      numero: r.numero ?? null,
      status: r.status ?? null,
      signed_at: r.signed_at ?? null,
      created_at: r.created_at,
      signer_name: r.signer_name ?? null,
      signer_role: r.signer_role ?? null,
      signer_signed_at: r.signer_signed_at ?? null,
      technician_name: r.technician_name ?? null,
      validation_mode: r.validation_mode ?? null,
      client_signed_on_site: r.client_signed_on_site ?? null,
      client_validated_at: r.client_validated_at ?? null,
      client_validated_email: r.client_validated_email ?? null,
      client_rejected_at: r.client_rejected_at ?? null,
      client_signature: r.client_signature ?? null,
      pdf_url: r.pdf_url ?? null,
      pdf_internal_url: r.pdf_internal_url ?? null,
      pdf_client_url: r.pdf_client_url ?? null,
      comment: commentByReport[r.id] ?? null,
    }));

    return { lifts };
  });
