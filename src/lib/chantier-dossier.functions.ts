/**
 * Lot 2 — Dossier chantier
 * Server function loading the extra data the unified "Dossier" tab needs
 * on top of getChantierDetail (photos, reserve lifts, emails).
 * RLS scopes everything to the active company.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getChantierDossier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ companyId: z.string().uuid(), chantierId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: pvRows } = await supabase
      .from("pv")
      .select("id,numero")
      .eq("chantier_id", data.chantierId)
      .eq("company_id", data.companyId);
    const pvIds = (pvRows ?? []).map((p) => p.id);

    if (pvIds.length === 0) {
      return {
        photos: [] as Array<{
          id: string; pv_id: string; reserve_id: string | null; url: string;
          caption: string | null; kind: string | null; photo_label: string | null;
          taken_at: string | null; created_at: string;
        }>,
        liftReports: [] as Array<{
          id: string; numero: string | null; status: string; pv_id: string;
          signed_at: string | null; pdf_url: string | null; created_at: string;
        }>,
        liftItems: [] as Array<{
          id: string; report_id: string; reserve_id: string; comment: string | null;
          new_status: string | null; created_at: string;
        }>,
        liftPhotos: [] as Array<{
          id: string; reserve_lift_item_id: string; reserve_id: string | null;
          photo_url: string; photo_type: string | null; taken_at: string | null;
          created_at: string;
        }>,
        emails: [] as Array<{
          id: string; pv_id: string | null; recipient_email: string; email_type: string;
          subject: string | null; status: string; sent_at: string | null;
          created_at: string; error_message: string | null;
        }>,
      };
    }

    const [photosRes, reportsRes, emailsRes] = await Promise.all([
      supabase
        .from("pv_photos")
        .select("id,pv_id,reserve_id,url,caption,kind,photo_label,taken_at,created_at")
        .in("pv_id", pvIds)
        .order("created_at", { ascending: false })
        .limit(500),
      supabase
        .from("reserve_lift_reports")
        .select("id,numero,status,pv_id,signed_at,pdf_url,created_at")
        .in("pv_id", pvIds)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("email_logs")
        .select("id,pv_id,recipient_email,email_type,subject,status,sent_at,created_at,error_message")
        .eq("company_id", data.companyId)
        .in("pv_id", pvIds)
        .order("created_at", { ascending: false })
        .limit(200),
    ]);

    const reportIds = (reportsRes.data ?? []).map((r) => r.id);
    let liftItems: Array<{
      id: string; report_id: string; reserve_id: string; comment: string | null;
      new_status: string | null; created_at: string;
    }> = [];
    let liftPhotos: Array<{
      id: string; reserve_lift_item_id: string; reserve_id: string | null;
      photo_url: string; photo_type: string | null; taken_at: string | null;
      created_at: string;
    }> = [];
    if (reportIds.length > 0) {
      const itemsRes = await supabase
        .from("reserve_lift_items")
        .select("id,report_id,reserve_id,comment,new_status,created_at")
        .in("report_id", reportIds);
      liftItems = itemsRes.data ?? [];
      const itemIds = liftItems.map((it) => it.id);
      if (itemIds.length > 0) {
        const lpRes = await supabase
          .from("reserve_lift_item_photos")
          .select("id,reserve_lift_item_id,reserve_id,photo_url,photo_type,taken_at,created_at")
          .in("reserve_lift_item_id", itemIds)
          .order("created_at", { ascending: false })
          .limit(500);
        liftPhotos = lpRes.data ?? [];
      }
    }

    return {
      photos: photosRes.data ?? [],
      liftReports: reportsRes.data ?? [],
      liftItems,
      liftPhotos,
      emails: emailsRes.data ?? [],
    };
  });
