/**
 * Solar Studio P2-A — fonctions serveur de conception électrique.
 * Calcul en lecture seule ; enregistrement : droits + abonnement + versions
 * attendues + rejeu du moteur + signature, puis une seule transaction SQL.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertSolarManage, assertSolarMember } from "@/lib/solar.server";
import { loadCurrentDesign, loadElectricalContext } from "@/lib/solar-electrical.server";
import {
  assertGroupsContract,
  designSignature,
  electricalErrorMessage,
  evaluateDesign,
  STALE_LAYOUT_MESSAGE,
  SIGNATURE_MISMATCH_MESSAGE,
  validateTemperatures,
  type ElecGroup,
} from "@/lib/solar-electrical";

type Loose = {
  rpc: (
    f: string,
    a: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

const ids = z.object({ companyId: z.string().uuid(), modelId: z.string().uuid() });

export const getElectricalContext = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => ids.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSolarMember(supabase, data.companyId, userId);
    const [ctx, design, manage] = await Promise.all([
      loadElectricalContext(supabase, data.companyId, data.modelId),
      loadCurrentDesign(supabase, data.companyId, data.modelId),
      supabase.rpc("can_manage_company", { _company_id: data.companyId, _user_id: userId }),
    ]);
    const stale = design
      ? design.layout_version !== ctx.layout_version ||
        design.layout_hash !== ctx.layout_hash ||
        design.geometry_version !== ctx.geometry_version
      : false;
    return { ...ctx, design, designStale: stale, canManage: manage.data === true };
  });

const num = z.union([z.number(), z.null()]).optional();
const inverterInput = z.object({
  companyId: z.string().uuid(),
  inverter: z.object({
    manufacturer: z.string().trim().min(1).max(120),
    series: z.string().trim().max(120).optional().nullable(),
    model: z.string().trim().min(1).max(120),
    kind: z.enum(["string", "hybride", "micro"]),
  }),
  spec: z.object({
    provenance: z.string().trim().min(3).max(300),
    datasheet_url: z.string().url().max(500).optional().nullable(),
    datasheet_version: z.string().max(60).optional().nullable(),
    phase: z.enum(["mono", "tri"]).optional().nullable(),
    ac_power_w: num,
    mppt_count: num,
    inputs_per_mppt: num,
    vdc_max_v: num,
    mppt_vmin_v: num,
    mppt_vmax_v: num,
    start_voltage_v: num,
    imax_mppt_a: num,
    imax_input_a: num,
    isc_max_mppt_a: num,
    dc_power_max_w: num,
    dc_ac_ratio_max: num,
    micro_inputs: num,
    micro_input_vmax_v: num,
    micro_input_imax_a: num,
    micro_input_isc_max_a: num,
    micro_input_power_max_w: num,
  }),
});

export const createManualInverter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => inverterInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSolarManage(supabase, data.companyId, userId);
    for (const [k, v] of Object.entries(data.spec)) {
      if (typeof v === "number" && (!Number.isFinite(v) || v < 0 || v > 1e6))
        throw new Error(`Valeur invalide : ${k}`);
    }
    const { data: id, error } = await supabase.rpc(
      "solar_create_manual_inverter",
      {
        _company_id: data.companyId,
        _inverter: data.inverter,
        _spec: data.spec,
      },
    );
    if (error) throw new Error(electricalErrorMessage(error.message));
    return { id: String(id) };
  });

const groupSchema = z.object({
  id: z.string().max(40),
  kind: z.enum(["string", "micro"]),
  label: z.string().max(40),
  inverter_index: z.number().int().min(0).max(200),
  mppt_index: z.number().int().min(0).max(64).nullable(),
  module_ids: z.array(z.string().uuid()).max(2000),
});
const saveInput = ids.extend({
  inverterId: z.string().uuid(),
  inverterRevisionId: z.string().uuid(),
  temps: z.object({
    tmin_c: z.number(),
    tmax_c: z.number(),
    source: z.string().trim().min(2).max(200),
  }),
  groups: z.array(groupSchema).max(500),
  signature: z.string().min(8).max(64),
  expectedGeometryVersion: z.number().int(),
  expectedLayoutVersion: z.number().int(),
  expectedLayoutHash: z.string().min(8).max(64),
  variantLabel: z.string().max(60).nullable().optional(),
});

export const saveElectricalDesign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => saveInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSolarManage(supabase, data.companyId, userId);
    const tErr = validateTemperatures(data.temps);
    if (tErr) throw new Error(tErr);

    // Rejeu intégral sur l'état serveur.
    const ctx = await loadElectricalContext(supabase, data.companyId, data.modelId);
    if (
      ctx.geometry_version !== data.expectedGeometryVersion ||
      ctx.layout_version !== data.expectedLayoutVersion ||
      ctx.layout_hash !== data.expectedLayoutHash
    )
      throw new Error(STALE_LAYOUT_MESSAGE);
    const inverter = ctx.inverters.find(
      (i) => i.inverter_id === data.inverterId && i.revision_id === data.inverterRevisionId,
    );
    if (!inverter)
      throw new Error("La fiche onduleur a changé ou n'est plus disponible. Relancez le câblage.");

    const groups = data.groups as ElecGroup[];
    try {
      assertGroupsContract(groups, inverter.kind);
    } catch (e) {
      throw new Error(electricalErrorMessage((e as Error).message));
    }
    const sig = designSignature({
      inverter,
      electrical: ctx.electrical,
      temps: data.temps,
      layout_hash: ctx.layout_hash,
      groups,
    });
    if (sig !== data.signature) throw new Error(SIGNATURE_MISMATCH_MESSAGE);

    const evaluation = evaluateDesign({
      inverter,
      modules: ctx.modules,
      electrical: ctx.electrical,
      temps: data.temps,
      groups,
    });
    if (evaluation.status === "invalide") {
      throw new Error(
        "Le câblage comporte des erreurs bloquantes : corrigez les éléments en rouge avant d'enregistrer.",
      );
    }
    const kept = groups.filter((g) => g.module_ids.length > 0);
    const byGroup = new Map(evaluation.groups.map((g) => [g.group_id, g]));
    const { data: res, error } = await supabase.rpc(
      "solar_apply_electrical_design",
      {
        _company_id: data.companyId,
        _model_id: data.modelId,
        _expected_geometry_version: data.expectedGeometryVersion,
        _expected_layout_version: data.expectedLayoutVersion,
        _expected_layout_hash: data.expectedLayoutHash,
        _design: JSON.parse(JSON.stringify({
          topology: inverter.kind,
          inverter_id: inverter.inverter_id,
          inverter_revision_id: inverter.revision_id,
          inverter_snapshot: inverter,
          inverter_count: evaluation.inverter_count,
          module_electrical_snapshot: ctx.electrical,
          temp_min_c: data.temps.tmin_c,
          temp_max_c: data.temps.tmax_c,
          temp_source: data.temps.source,
          geometry_hash: ctx.geometry_hash,
          engine_version: evaluation.engine_version,
          signature: sig,
          status: evaluation.status,
          variant_label: data.variantLabel ?? null,
          summary: {
            dc_power_w: evaluation.dc_power_w,
            ac_power_w: evaluation.ac_power_w,
            dc_ac_ratio: evaluation.dc_ac_ratio,
            inverter_count: evaluation.inverter_count,
            mppts: evaluation.mppts,
            unassigned: evaluation.unassigned_module_ids.length,
            strings: kept.length,
            formulas: evaluation.formulas,
          },
          warnings: evaluation.checks.filter((c) => c.status !== "ok"),
        },
        _strings: JSON.parse(JSON.stringify(kept.map((g) => ({
          kind: g.kind,
          label: g.label,
          inverter_index: g.inverter_index,
          mppt_index: g.mppt_index,
          module_ids: g.module_ids,
          results: byGroup.get(g.id) ?? {},
        })),
      },
    );
    if (error) throw new Error(electricalErrorMessage(error.message));
    return res as { design_id: string; assigned: number };
  });
