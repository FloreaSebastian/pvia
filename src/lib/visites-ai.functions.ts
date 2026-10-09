/**
 * Assistant terrain IA des visites techniques (Lovable AI Gateway, côté serveur).
 *
 * Sécurité : authentification obligatoire, appartenance à l'entreprise, accès en écriture
 * à l'abonnement et fonctionnalité « technical_visits » (Pro+). « Comprends ma dictée »
 * exige en plus le droit de modifier la visite. Le contexte est TOUJOURS relu en base
 * (RLS de l'utilisateur) ; le texte du client n'est qu'une donnée non fiable.
 * Aucune écriture : les propositions sont renvoyées, l'application passe par
 * saveVisitAnswers (validation serveur) après action explicite de l'utilisateur.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertCanEditVisit, assertIsMember, loadVisitScoped } from "./visites.server";
import { resolveVisitTemplate } from "./visites/templates";
import { VISIT_PHASES, type AnswerMap } from "./visites/types";
import {
  ASSISTANT_ACTIONS,
  ASSISTANT_LIMITS,
  ASSISTANT_OUTPUT_SCHEMA,
  ASSISTANT_SYSTEM_PROMPT,
  buildAssistantContextWithMeta,
  sanitizeProposals,
  type AssistantAction,
  type RawProposal,
} from "./visites/assistant";

const MODEL = "openai/gpt-6-astra";
const GATEWAY = "https://ai.gateway.lovable.dev/v1/responses";

const InputSchema = z.object({
  companyId: z.string().uuid(),
  visitId: z.string().uuid(),
  action: z.enum(ASSISTANT_ACTIONS),
  phase: z
    .enum(VISIT_PHASES.map((p) => p.key) as [string, ...string[]])
    .nullable()
    .optional(),
  sectionKey: z.string().max(80).nullable().optional(),
  message: z.string().max(ASSISTANT_LIMITS.messageMax).optional().default(""),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        text: z.string().max(ASSISTANT_LIMITS.historyItemMax),
      }),
    )
    .max(ASSISTANT_LIMITS.historyTurns)
    .optional()
    .default([]),
});

export class AssistantError extends Error {
  constructor(
    public code: "RATE_LIMIT" | "UNAVAILABLE" | "CREDITS" | "REFUSED" | "INVALID",
    message: string,
  ) {
    super(message);
  }
}

const ACTION_INSTRUCTION: Record<AssistantAction, string> = {
  guide:
    "Action « Guide-moi pour cette étape » : donne au plus 3 vérifications concrètes à faire maintenant sur place pour l'étape en cours, en t'appuyant sur les champs vides ou à vérifier. Aucune proposition.",
  manque:
    "Action « Que manque-t-il ? » : liste les éléments obligatoires manquants (champs et photos) par ordre d'importance, regroupés, en 6 lignes maximum. Aucune proposition.",
  synthese:
    "Action « Prépare la synthèse » : rédige une synthèse factuelle de la visite (constats, points d'attention, travaux préparatoires, éléments manquants). N'énonce aucune conclusion de faisabilité qui ne figure pas dans les données ; signale ce qui reste à vérifier. Aucune proposition.",
  dictee:
    "Action « Comprends ma dictée » : résume la dictée en une ou deux phrases, puis propose des relevés structurés UNIQUEMENT pour les éléments explicitement dits, en utilisant les clés exactes de la liste CHAMPS. Pose une question si une valeur est ambiguë (unité, zone, élément).",
  question:
    "Question libre du technicien : réponds brièvement à partir des données de la visite uniquement. Aucune proposition.",
};

async function callGateway(
  system: string,
  input: { role: "user" | "assistant"; content: string }[],
  signal: AbortSignal,
) {
  const key = process.env.LOVABLE_API_KEY;
  if (!key)
    throw new AssistantError("UNAVAILABLE", "Assistant indisponible (configuration serveur).");
  let res: Response;
  try {
    res = await fetch(GATEWAY, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": key,
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        store: false,
        reasoning: { effort: "low" },
        max_output_tokens: 2500,
        instructions: system,
        input,
        text: {
          format: {
            type: "json_schema",
            name: "visit_assistant",
            strict: true,
            schema: ASSISTANT_OUTPUT_SCHEMA,
          },
        },
      }),
    });
  } catch {
    throw new AssistantError(
      "UNAVAILABLE",
      "Assistant injoignable. Vérifiez la connexion et réessayez.",
    );
  }
  if (res.status === 429)
    throw new AssistantError("RATE_LIMIT", "Assistant très sollicité. Réessayez dans une minute.");
  if (res.status === 402)
    throw new AssistantError(
      "CREDITS",
      "Crédits IA épuisés pour l'espace. Contactez l'administrateur.",
    );
  if (res.status === 403)
    throw new AssistantError("REFUSED", "Accès à l'assistant refusé par le service IA.");
  if (!res.ok || !res.body)
    throw new AssistantError("UNAVAILABLE", "Assistant momentanément indisponible. Réessayez.");

  // Lecture du flux SSE : on garde le texte final et l'usage.
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let text = "";
  let done = "";
  let usage: { input_tokens?: number; output_tokens?: number } | null = null;
  let refused = false;
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const ev = JSON.parse(payload);
        if (ev.type === "response.output_text.delta" && typeof ev.delta === "string")
          text += ev.delta;
        else if (ev.type === "response.output_text.done" && typeof ev.text === "string")
          done = ev.text;
        else if (ev.type === "response.refusal.delta" || ev.type === "response.refusal.done")
          refused = true;
        else if (ev.type === "response.completed") usage = ev.response?.usage ?? null;
        else if (ev.type === "response.failed" || ev.type === "error")
          throw new AssistantError("UNAVAILABLE", "Réponse de l'assistant interrompue. Réessayez.");
      } catch (e) {
        if (e instanceof AssistantError) throw e;
      }
    }
  }
  const out = done || text;
  if (refused || !out)
    throw new AssistantError("REFUSED", "L'assistant n'a pas pu répondre à cette demande.");
  return { text: out, usage };
}

export const askVisitAssistant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => InputSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertIsMember(supabase, data.companyId, userId);
    const guard = await import("./plan-guard.server");
    await guard.assertCompanyWriteAccess(data.companyId, userId);
    await guard.assertPlanFeature(data.companyId, "technical_visits", userId);
    // La dictée produit des propositions de saisie : droit d'édition exigé.
    const visit =
      data.action === "dictee"
        ? await assertCanEditVisit(supabase, data.companyId, data.visitId, userId)
        : await loadVisitScoped(supabase, data.companyId, data.visitId);

    if (
      (data.action === "dictee" || data.action === "question") &&
      data.message.trim().length < 2
    ) {
      throw new Error("Saisissez ou dictez un texte avant d'envoyer.");
    }

    const { enforceRateLimit, RateLimitError } = await import("./rate-limit.server");
    try {
      await enforceRateLimit({ bucket: "visit_ai_user", key: userId, limit: 30, windowSec: 3600 });
      await enforceRateLimit({
        bucket: "visit_ai_company",
        key: data.companyId,
        limit: 300,
        windowSec: 86400,
      });
    } catch (e) {
      if (e instanceof RateLimitError) {
        return {
          ok: false as const,
          code: "RATE_LIMIT",
          message: `Limite d'utilisation atteinte. Réessayez dans ${Math.ceil(e.retryAfterSec / 60)} min.`,
        };
      }
      throw e;
    }

    const template = resolveVisitTemplate(visit);
    if (!template) throw new Error("Type de visite inconnu.");

    const [answersRes, photosRes, skipsRes, constraintsRes] = await Promise.all([
      supabase
        .from("technical_visit_answers")
        .select("field_key,value")
        .eq("visit_id", visit.id)
        .eq("company_id", data.companyId),
      supabase
        .from("technical_visit_photos")
        .select("slot_key")
        .eq("visit_id", visit.id)
        .eq("company_id", data.companyId),
      supabase
        .from("technical_visit_photo_skips")
        .select("slot_key")
        .eq("visit_id", visit.id)
        .eq("company_id", data.companyId),
      supabase
        .from("technical_visit_constraints")
        .select("title,level,category,location,recommendation,description,responsible,lot", {
          count: "exact",
        })
        .eq("visit_id", visit.id)
        .eq("company_id", data.companyId)
        // Ordre déterministe ; la priorité (bloquants d'abord) est appliquée au contexte.
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(500),
    ]);
    if (answersRes.error || photosRes.error || skipsRes.error || constraintsRes.error) {
      throw new Error("Lecture de la visite impossible. Réessayez.");
    }
    const answers: AnswerMap = {};
    for (const a of answersRes.data ?? []) answers[a.field_key] = a.value as never;
    const photoSlotCounts: Record<string, number> = {};
    for (const p of photosRes.data ?? [])
      photoSlotCounts[p.slot_key] = (photoSlotCounts[p.slot_key] ?? 0) + 1;

    const { text: ctx, coverage } = buildAssistantContextWithMeta(
      {
        template,
        visit: {
          reference: visit.reference,
          status: visit.status,
          lots: (visit as { lots?: string[] }).lots ?? null,
        },
        answers,
        photoSlotCounts,
        skippedSlots: new Set((skipsRes.data ?? []).map((s) => s.slot_key)),
        constraints: (constraintsRes.data ?? []).map((c) => ({
          title: c.title,
          level: c.level,
          category: c.category,
          location: c.location,
          action: c.recommendation,
          description: c.description,
          responsible: c.responsible,
          lot: c.lot,
        })),
        constraintsTotal: constraintsRes.count ?? (constraintsRes.data ?? []).length,
      },
      data.action,
      { phase: (data.phase ?? null) as never, sectionKey: data.sectionKey ?? null },
    );

    const userBlock = [
      ACTION_INSTRUCTION[data.action],
      "",
      "<contexte_visite>",
      ctx,
      "</contexte_visite>",
      data.message.trim()
        ? `\n<texte_technicien_non_fiable>\n${data.message.trim()}\n</texte_technicien_non_fiable>`
        : "",
    ].join("\n");

    const input = [
      ...data.history.map((h) => ({ role: h.role, content: h.text })),
      { role: "user" as const, content: userBlock },
    ];

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60_000);
    let result: { text: string; usage: { input_tokens?: number; output_tokens?: number } | null };
    try {
      result = await callGateway(ASSISTANT_SYSTEM_PROMPT, input, ctrl.signal);
    } catch (e) {
      if (e instanceof AssistantError)
        return { ok: false as const, code: e.code, message: e.message };
      if ((e as Error).name === "AbortError") {
        return {
          ok: false as const,
          code: "UNAVAILABLE",
          message: "L'assistant a mis trop de temps à répondre. Réessayez.",
        };
      }
      console.error("visit assistant failed", { action: data.action });
      return {
        ok: false as const,
        code: "UNAVAILABLE",
        message: "Assistant momentanément indisponible. Réessayez.",
      };
    } finally {
      clearTimeout(timer);
    }

    let parsed: {
      reply?: unknown;
      questions?: unknown;
      proposals?: unknown;
      study_required?: unknown;
    };
    try {
      parsed = JSON.parse(result.text);
    } catch {
      return {
        ok: false as const,
        code: "UNAVAILABLE",
        message: "Réponse de l'assistant illisible. Réessayez.",
      };
    }
    const reply = typeof parsed.reply === "string" ? parsed.reply.slice(0, 4000) : "";
    const questions = Array.isArray(parsed.questions)
      ? parsed.questions
          .filter((q): q is string => typeof q === "string")
          .slice(0, 3)
          .map((q) => q.slice(0, 300))
      : [];
    const proposals =
      data.action === "dictee" && Array.isArray(parsed.proposals)
        ? sanitizeProposals(template, answers, parsed.proposals as RawProposal[])
        : [];
    const rawCount = Array.isArray(parsed.proposals) ? parsed.proposals.length : 0;

    return {
      ok: true as const,
      reply,
      questions,
      proposals,
      rejectedProposals: data.action === "dictee" ? Math.max(0, rawCount - proposals.length) : 0,
      studyRequired: parsed.study_required === true,
      coverage,
      usage: {
        input: result.usage?.input_tokens ?? null,
        output: result.usage?.output_tokens ?? null,
      },
    };
  });
