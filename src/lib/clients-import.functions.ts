/**
 * Import IA des fiches clients.
 *
 * - `extractClientsFromSource` : pousse un contenu (texte brut, CSV/Excel converti
 *   en texte côté client, ou PDF/image en base64 multimodal) vers Gemini via Lovable
 *   AI Gateway. Retourne une liste de fiches normalisées + statut doublon (email/SIRET
 *   déjà présent côté entreprise).
 * - `importClientsBatch` : insère les fiches validées par l'utilisateur (les
 *   doublons sont systématiquement ignorés côté serveur même s'ils passent le
 *   filtre UI — politique "skip" demandée).
 *
 * Permissions : rôle manager+ (can_manage_company). Audit log à chaque batch.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { writeAuditLog } from "./audit.server";

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_FILE_MIMES = ["application/pdf", "image/png", "image/jpeg", "image/webp"] as const;
const MAX_TEXT_LEN = 200_000;
const MAX_ROWS = 200;

const ClientRowSchema = z.object({
  client_type: z.enum(["particulier", "entreprise"]).default("particulier"),
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().max(255).optional().default(""),
  phone: z.string().trim().max(50).optional().default(""),
  address_line1: z.string().trim().max(300).optional().default(""),
  postal_code: z.string().trim().max(20).optional().default(""),
  city: z.string().trim().max(150).optional().default(""),
  notes: z.string().trim().max(2000).optional().default(""),
  company_name: z.string().trim().max(200).optional().default(""),
  siret: z.string().trim().max(20).optional().default(""),
  siren: z.string().trim().max(20).optional().default(""),
  vat_number: z.string().trim().max(40).optional().default(""),
  naf_code: z.string().trim().max(20).optional().default(""),
  contact_name: z.string().trim().max(200).optional().default(""),
});
export type ImportClientRow = z.infer<typeof ClientRowSchema>;

const ExtractInput = z.object({
  companyId: z.string().uuid(),
  mode: z.enum(["text", "file"]),
  text: z.string().max(MAX_TEXT_LEN).optional(),
  file: z
    .object({
      fileName: z.string().min(1).max(255),
      mimeType: z.enum(ALLOWED_FILE_MIMES),
      dataUrl: z.string().min(8).max(20_000_000),
    })
    .optional(),
});

const ImportInput = z.object({
  companyId: z.string().uuid(),
  rows: z.array(ClientRowSchema).min(1).max(MAX_ROWS),
});

async function assertCanManage(
  supabase: import("@supabase/supabase-js").SupabaseClient<
    import("@/integrations/supabase/types").Database
  >,
  companyId: string,
  userId: string,
) {
  const { data, error } = await supabase.rpc("can_manage_company", {
    _company_id: companyId,
    _user_id: userId,
  });
  if (error) throw new Error("Vérification des droits impossible.");
  if (data !== true) throw new Error("Droits insuffisants.");
}

function normalizeEmail(e: string | null | undefined) {
  return (e ?? "").trim().toLowerCase() || null;
}
function normalizeSiret(s: string | null | undefined) {
  return (s ?? "").replace(/\s+/g, "") || null;
}

async function callGemini(opts: {
  text?: string;
  file?: { fileName: string; mimeType: string; dataUrl: string };
}): Promise<{ rows: ImportClientRow[]; error?: string }> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) return { rows: [], error: "LOVABLE_API_KEY_MISSING" };

  const systemPrompt = `Tu es un assistant d'extraction de fiches clients pour le BTP français.
Analyse la source fournie (CSV, tableau, texte libre, carte de visite, fiche scannée) et retourne UNIQUEMENT un objet JSON {"rows": [...]}.
Chaque élément de "rows" est une fiche client.

Règles :
- "client_type" = "entreprise" si SIRET / SIREN / TVA / forme juridique (SAS, SARL, SCI, EURL...) est présent, sinon "particulier".
- "name" : pour un particulier = "Prénom Nom" ; pour une entreprise = raison sociale.
- "company_name" : raison sociale (entreprise uniquement).
- "contact_name" : interlocuteur identifié dans l'entreprise (entreprise uniquement).
- "siret" : 14 chiffres sans espaces. "siren" : 9 chiffres.
- "address_line1" : numéro + voie. "postal_code" : code postal. "city" : ville.
- Si une info n'est pas présente, retourne "" (chaîne vide) pour les chaînes, ne devine pas.
- Téléphone : conserve le format international si présent, sinon laisse tel quel.
- N'invente RIEN. Ne renvoie pas une ligne si tu n'as au minimum ni nom ni email ni téléphone.
- Maximum ${MAX_ROWS} lignes.`;

  const userContent: Array<Record<string, unknown>> = [];
  if (opts.file) {
    userContent.push({ type: "text", text: `Fichier : ${opts.file.fileName}. Extrais les fiches clients.` });
    if (opts.file.mimeType === "application/pdf") {
      userContent.push({ type: "file", file: { filename: opts.file.fileName, file_data: opts.file.dataUrl } });
    } else {
      userContent.push({ type: "image_url", image_url: { url: opts.file.dataUrl } });
    }
  } else {
    userContent.push({ type: "text", text: opts.text ?? "" });
  }

  const body = {
    model: "google/gemini-2.5-flash",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "clients_extraction",
        strict: false,
        schema: {
          type: "object",
          properties: {
            rows: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  client_type: { type: "string", enum: ["particulier", "entreprise"] },
                  name: { type: "string" },
                  email: { type: "string" },
                  phone: { type: "string" },
                  address_line1: { type: "string" },
                  postal_code: { type: "string" },
                  city: { type: "string" },
                  notes: { type: "string" },
                  company_name: { type: "string" },
                  siret: { type: "string" },
                  siren: { type: "string" },
                  vat_number: { type: "string" },
                  naf_code: { type: "string" },
                  contact_name: { type: "string" },
                },
                required: ["client_type", "name"],
              },
            },
          },
          required: ["rows"],
        },
      },
    },
  };

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": key,
        "X-Lovable-AIG-SDK": "raw-fetch",
      },
      body: JSON.stringify(body),
    });
    if (res.status === 429) return { rows: [], error: "AI_RATE_LIMIT" };
    if (res.status === 402) return { rows: [], error: "AI_CREDITS_EXHAUSTED" };
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { rows: [], error: `AI_GATEWAY_${res.status}:${t.slice(0, 200)}` };
    }
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content;
    if (!content) return { rows: [], error: "AI_EMPTY" };
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      const m = content.match(/\{[\s\S]*\}/);
      if (!m) return { rows: [], error: "AI_INVALID_JSON" };
      parsed = JSON.parse(m[0]);
    }
    const arr = (parsed as { rows?: unknown }).rows;
    if (!Array.isArray(arr)) return { rows: [], error: "AI_NO_ROWS" };
    const safe: ImportClientRow[] = [];
    for (const r of arr.slice(0, MAX_ROWS)) {
      const res2 = ClientRowSchema.safeParse(r);
      if (res2.success) safe.push(res2.data);
    }
    return { rows: safe };
  } catch (e) {
    return { rows: [], error: `AI_FETCH_FAILED:${(e as Error).message}` };
  }
}

function decodeDataUrlBytes(dataUrl: string): { bytes: Uint8Array; mime: string } | null {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, mime: m[1] };
}

export type ExtractedClientPreview = ImportClientRow & {
  duplicate_reason: "email" | "siret" | null;
  existing_id: string | null;
};

export const extractClientsFromSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ExtractInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanManage(supabase, data.companyId, userId);

    // Validation source
    if (data.mode === "text") {
      if (!data.text || !data.text.trim()) throw new Error("Aucun texte fourni.");
    } else {
      if (!data.file) throw new Error("Aucun fichier fourni.");
      const decoded = decodeDataUrlBytes(data.file.dataUrl);
      if (!decoded) throw new Error("Fichier illisible.");
      if (decoded.bytes.byteLength > MAX_BYTES) throw new Error("Fichier trop volumineux (max 10 Mo).");
    }

    const { rows, error } = await callGemini(
      data.mode === "text" ? { text: data.text } : { file: data.file! },
    );
    if (error === "AI_RATE_LIMIT") throw new Error("Trop de requêtes IA. Réessayez dans un instant.");
    if (error === "AI_CREDITS_EXHAUSTED") throw new Error("Crédits IA épuisés sur l'espace de travail.");
    if (error && rows.length === 0) throw new Error(`L'extraction a échoué (${error}).`);

    // Dédup : récupère les emails / SIRET existants pour cette entreprise
    const { data: existing } = await supabase
      .from("clients")
      .select("id,email,siret,archived_at")
      .eq("company_id", data.companyId);
    const emailMap = new Map<string, string>();
    const siretMap = new Map<string, string>();
    for (const c of (existing ?? []) as Array<{ id: string; email: string | null; siret: string | null }>) {
      const em = normalizeEmail(c.email);
      if (em) emailMap.set(em, c.id);
      const si = normalizeSiret(c.siret);
      if (si) siretMap.set(si, c.id);
    }

    const seenEmail = new Set<string>();
    const seenSiret = new Set<string>();
    const preview: ExtractedClientPreview[] = rows.map((r) => {
      const em = normalizeEmail(r.email);
      const si = normalizeSiret(r.siret);
      let duplicate_reason: "email" | "siret" | null = null;
      let existing_id: string | null = null;
      if (em && emailMap.has(em)) {
        duplicate_reason = "email";
        existing_id = emailMap.get(em) ?? null;
      } else if (si && siretMap.has(si)) {
        duplicate_reason = "siret";
        existing_id = siretMap.get(si) ?? null;
      } else if (em && seenEmail.has(em)) {
        duplicate_reason = "email";
      } else if (si && seenSiret.has(si)) {
        duplicate_reason = "siret";
      }
      if (em) seenEmail.add(em);
      if (si) seenSiret.add(si);
      return { ...r, duplicate_reason, existing_id };
    });

    return { rows: preview };
  });

export const importClientsBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ImportInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanManage(supabase, data.companyId, userId);

    // Re-check doublons côté serveur (politique skip) — l'UI ne peut pas tricher.
    const { data: existing } = await supabase
      .from("clients")
      .select("id,email,siret")
      .eq("company_id", data.companyId);
    const emailSet = new Set<string>();
    const siretSet = new Set<string>();
    for (const c of (existing ?? []) as Array<{ id: string; email: string | null; siret: string | null }>) {
      const em = normalizeEmail(c.email);
      const si = normalizeSiret(c.siret);
      if (em) emailSet.add(em);
      if (si) siretSet.add(si);
    }

    let inserted = 0;
    let skipped = 0;
    const errors: string[] = [];
    for (const r of data.rows) {
      const em = normalizeEmail(r.email);
      const si = normalizeSiret(r.siret);
      if ((em && emailSet.has(em)) || (si && siretSet.has(si))) {
        skipped++;
        continue;
      }
      const isEnt = r.client_type === "entreprise";
      const companyName = (r.company_name ?? "").trim();
      const finalName = isEnt && companyName ? companyName : r.name.trim();
      const payload = {
        client_type: r.client_type,
        name: finalName,
        email: em,
        phone: r.phone.trim() || null,
        address_line1: r.address_line1.trim() || null,
        postal_code: r.postal_code.trim() || null,
        city: r.city.trim() || null,
        address: [r.address_line1.trim(), [r.postal_code.trim(), r.city.trim()].filter(Boolean).join(" ")]
          .filter(Boolean).join(", ") || null,
        notes: r.notes.trim() || null,
        company_name: isEnt ? (companyName || null) : null,
        siret: isEnt ? si : null,
        siren: isEnt ? ((r.siren ?? "").replace(/\s+/g, "") || null) : null,
        vat_number: isEnt ? (r.vat_number.trim() || null) : null,
        naf_code: isEnt ? (r.naf_code.trim() || null) : null,
        contact_name: isEnt ? (r.contact_name.trim() || null) : null,
        owner_id: userId,
        company_id: data.companyId,
      };
      const { error } = await supabase.from("clients").insert(payload);
      if (error) {
        errors.push(`${finalName}: ${error.message}`);
      } else {
        inserted++;
        if (em) emailSet.add(em);
        if (si) siretSet.add(si);
      }
    }

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "client",
      action: "client.create",
      metadata: {
        sub_action: "client.ai_import_batch",
        inserted,
        skipped,
        failed: errors.length,
        total: data.rows.length,
      },
    });

    return { inserted, skipped, failed: errors.length, errors: errors.slice(0, 10) };
  });
