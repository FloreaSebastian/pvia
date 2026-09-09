/**
 * Cahiers des charges — espace client.
 *
 * Le client ne voit QUE les cahiers des charges qui lui ont été envoyés
 * (statuts sent/accepted/refused), pour les entreprises avec lesquelles il a
 * une relation active. Les notes internes ne sortent jamais d'ici.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireClientScope, ACCESS_DENIED, companyKey } from "@/lib/client-access.server";

const VISIBLE_STATUSES = ["sent", "accepted", "refused"] as const;

export type ClientStudyRow = {
  id: string;
  reference: string;
  study_type: string;
  status: string;
  title: string | null;
  site_city: string | null;
  sent_at: string | null;
  decision: string | null;
  companyKey: string | null;
  companyName: string | null;
};

/** Liste des cahiers des charges reçus par le client connecté. */
export const getClientStudies = createServerFn({ method: "GET" }).handler(async (): Promise<ClientStudyRow[]> => {
  const scope = await requireClientScope();
  if (scope.clientIds.length === 0) return [];

  const { data } = await supabaseAdmin
    .from("technical_studies")
    .select("id,reference,study_type,status,title,site_city,sent_at,decision,company_id,client_id")
    .in("client_id", scope.clientIds)
    .in("status", VISIBLE_STATUSES as unknown as string[])
    .order("sent_at", { ascending: false })
    .limit(200);

  const rows = ((data ?? []) as Record<string, unknown>[]).filter(
    (r) =>
      !scope.suspendedClientIds.includes(r.client_id as string) &&
      !scope.suspendedCompanyIds.includes(r.company_id as string),
  );

  const companyIds = Array.from(new Set(rows.map((r) => r.company_id as string)));
  const names = new Map<string, string>();
  if (companyIds.length > 0) {
    const { data: companies } = await supabaseAdmin.from("companies").select("id,name").in("id", companyIds);
    for (const c of (companies ?? []) as { id: string; name: string }[]) names.set(c.id, c.name);
  }

  return Promise.all(
    rows.map(async (r) => ({
      id: r.id as string,
      reference: r.reference as string,
      study_type: r.study_type as string,
      status: r.status as string,
      title: (r.title as string | null) ?? null,
      site_city: (r.site_city as string | null) ?? null,
      sent_at: (r.sent_at as string | null) ?? null,
      decision: (r.decision as string | null) ?? null,
      companyKey: await companyKey(r.company_id as string),
      companyName: names.get(r.company_id as string) ?? null,
    })),
  );
});

/** Lien signé court vers le PDF d'un cahier des charges reçu. */
export const getClientStudyPdfUrl = createServerFn({ method: "POST" })
  .inputValidator((i) => z.object({ studyId: z.string().uuid() }).parse(i))
  .handler(async ({ data }): Promise<{ url: string }> => {
    const scope = await requireClientScope();

    const { data: study } = await supabaseAdmin
      .from("technical_studies")
      .select("id,company_id,client_id,status,pdf_path")
      .eq("id", data.studyId)
      .maybeSingle();

    const row = study as Record<string, unknown> | null;
    if (
      !row ||
      !scope.clientIds.includes(row.client_id as string) ||
      scope.suspendedClientIds.includes(row.client_id as string) ||
      scope.suspendedCompanyIds.includes(row.company_id as string) ||
      !(VISIBLE_STATUSES as readonly string[]).includes(row.status as string)
    ) {
      throw new Error(ACCESS_DENIED);
    }
    if (!row.pdf_path) throw new Error("Le document n'est pas encore disponible.");

    const { data: signed } = await supabaseAdmin.storage
      .from("pv-assets")
      .createSignedUrl(row.pdf_path as string, 120);
    if (!signed?.signedUrl) throw new Error("Le document n'est pas encore disponible.");
    return { url: signed.signedUrl };
  });
