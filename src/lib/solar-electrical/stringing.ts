/**
 * Solar Studio P2-A — auto-câblage déterministe (strings / micro-onduleurs).
 * Chaque panneau est affecté exactement une fois ou reste explicitement non affecté.
 */
import { fingerprint } from "../solar/hash";
import { evaluateDesign, impWorst, iscWorst, vmpCold, vmpHot, vocCold } from "./engine";
import {
  ELECTRICAL_ENGINE_VERSION,
  type DesignTemperatures,
  type ElecGroup,
  type ElecModule,
  type InverterSpec,
  type ModuleElectrical,
  type WiringProposal,
} from "./types";

export interface StringingInput {
  inverter: InverterSpec;
  modules: ElecModule[];
  electrical: Record<string, ModuleElectrical>;
  temps: DesignTemperatures;
  /** Ordre de priorité des pans (clés). */
  plane_order?: string[];
  layout_hash: string;
}

export type StringingResult =
  | { ok: true; proposals: WiringProposal[] }
  | { ok: false; reason: string; missing: string[] };

export interface LengthRange {
  nmin: number;
  nmax: number;
  maxParallel: number;
  /**
   * Bornes non justifiables faute de données publiées : la proposition reste
   * déterministe mais les contrôles correspondants restent « non vérifiables ».
   */
  provisional: string[];
}

/** Données onduleur indispensables pour structurer un câblage (sinon aucune proposition). */
function structuralMissing(inv: InverterSpec): string[] {
  const m: string[] = [];
  if (inv.mppt_count == null) m.push("nombre de MPPT onduleur");
  if (inv.inputs_per_mppt == null) m.push("entrées par MPPT onduleur");
  return m;
}

/**
 * Plage de longueurs de string pour une référence de panneau.
 * Bornes justifiées quand les données sont publiées ; sinon repli déterministe
 * et conservateur (strings longues, pas de parallèle), signalé dans `provisional`.
 * Une borne justifiée n'est jamais relâchée par le repli.
 */
export function admissibleRange(
  inv: InverterSpec,
  el: ModuleElectrical,
  temps: DesignTemperatures,
  bucketSize?: number,
): { ok: true; range: LengthRange } | { ok: false; missing: string[]; reason?: string } {
  const structural = structuralMissing(inv);
  if (structural.length) return { ok: false, missing: structural };
  const provisional: string[] = [];
  const vc = vocCold(el, temps);
  const vh = vmpHot(el, temps);
  const vco = vmpCold(el, temps);
  const ip = impWorst(el, temps);
  const is = iscWorst(el, temps);

  let nmax: number | null = null;
  if (vc != null && inv.vdc_max_v != null)
    nmax = Math.floor(Math.min(inv.vdc_max_v, el.max_system_voltage_v ?? Infinity) / vc + 1e-9);
  else provisional.push("tension max (Voc froid / Vdc max) non vérifiable");
  if (inv.mppt_vmax_v != null && vco != null)
    nmax = Math.min(nmax ?? Infinity, Math.floor(inv.mppt_vmax_v / vco + 1e-9));

  let nmin: number | null = null;
  if (vh != null && inv.mppt_vmin_v != null)
    nmin = Math.max(1, Math.ceil(Math.max(inv.mppt_vmin_v, inv.start_voltage_v ?? 0) / vh - 1e-9));
  else provisional.push("tension min (Vmp chaud / MPPT min) non vérifiable");

  if (nmin != null && nmax != null && nmin > nmax) {
    return {
      ok: false,
      missing: [],
      reason: `Aucune longueur de string admissible (min ${nmin}, max ${nmax}) avec cet onduleur et ces températures.`,
    };
  }
  // Repli : borne haute inconnue ⇒ répartir le groupe sur les entrées d'un MPPT ;
  // borne basse inconnue ⇒ strings aussi longues que la borne haute (pas de string courte injustifiée).
  const g = Math.max(1, bucketSize ?? 1);
  const nmaxF = nmax ?? Math.max(nmin ?? 1, Math.ceil(g / inv.inputs_per_mppt!));
  const nminF = nmin ?? nmaxF;

  let maxParallel = inv.inputs_per_mppt!;
  if (ip == null || is == null) {
    maxParallel = 1;
    provisional.push("courants pire cas non vérifiables : aucune mise en parallèle proposée");
  } else {
    if (inv.imax_mppt_a != null)
      maxParallel = Math.min(maxParallel, Math.floor(inv.imax_mppt_a / ip + 1e-9));
    if (inv.isc_max_mppt_a != null)
      maxParallel = Math.min(maxParallel, Math.floor(inv.isc_max_mppt_a / is + 1e-9));
    if (inv.imax_input_a != null && ip > inv.imax_input_a + 1e-9) maxParallel = 0;
  }
  if (maxParallel < 1)
    return {
      ok: false,
      missing: [],
      reason: "Le courant du panneau dépasse la limite d'entrée de l'onduleur.",
    };
  return { ok: true, range: { nmin: nminF, nmax: nmaxF, maxParallel, provisional } };
}

/** Découpe G panneaux en strings : k strings égales + éventuellement une string de reste. */
export function splitLengths(g: number, r: LengthRange, preferLong: boolean): number[] {
  let best: { n: number; k: number; used: number } | null = null;
  for (let n = r.nmin; n <= r.nmax; n += 1) {
    const k = Math.floor(g / n);
    const used = k * n;
    if (k === 0) continue;
    if (!best || used > best.used || (used === best.used && (preferLong ? n > best.n : n < best.n)))
      best = { n, k, used };
  }
  if (!best) return [];
  const out = Array<number>(best.k).fill(best.n);
  const rest = g - best.used;
  if (rest >= r.nmin) out.push(Math.min(rest, r.nmax));
  return out;
}

function sortModules(ms: ElecModule[]): ElecModule[] {
  return [...ms].sort((a, b) => a.v - b.v || a.u - b.u || (a.id < b.id ? -1 : 1));
}

interface Bucket {
  key: string;
  label: string;
  module_key: string;
  modules: ElecModule[];
}

function buckets(input: StringingInput, byPlane: boolean): Bucket[] {
  const order = input.plane_order ?? [];
  const rank = (k: string) => {
    const i = order.indexOf(k);
    return i < 0 ? order.length : i;
  };
  const map = new Map<string, Bucket>();
  for (const m of input.modules) {
    if (!m.module_key) continue;
    const k = byPlane ? `${m.module_key}|${m.plane_key}|${m.orientation}` : m.module_key;
    const b = map.get(k) ?? {
      key: k,
      label: byPlane ? `${m.plane_name} · ${m.orientation}` : "Tous pans",
      module_key: m.module_key,
      modules: [],
    };
    b.modules.push(m);
    map.set(k, b);
  }
  return [...map.values()]
    .map((b) => ({ ...b, modules: sortModules(b.modules) }))
    .sort(
      (a, b) =>
        rank(a.modules[0].plane_key) - rank(b.modules[0].plane_key) ||
        b.modules.length - a.modules.length ||
        (a.key < b.key ? -1 : 1),
    );
}

export function designSignature(i: {
  inverter: InverterSpec;
  electrical: Record<string, ModuleElectrical>;
  temps: DesignTemperatures;
  layout_hash: string;
  groups: ElecGroup[];
}): string {
  return fingerprint({
    engine: ELECTRICAL_ENGINE_VERSION,
    inverter: i.inverter,
    electrical: i.electrical,
    temps: i.temps,
    layout_hash: i.layout_hash,
    groups: i.groups.map((g) => ({
      kind: g.kind,
      inverter_index: g.inverter_index,
      mppt_index: g.mppt_index,
      module_ids: g.module_ids,
    })),
  });
}

function buildStrings(
  input: StringingInput,
  byPlane: boolean,
  preferLong: boolean,
): { groups: ElecGroup[]; notes: string[] } | { error: string; missing: string[] } {
  const inv = input.inverter;
  const groups: ElecGroup[] = [];
  const notes: string[] = [];
  let inverter = 0;
  let mppt = 0;
  let sIdx = 0;
  const advance = () => {
    mppt += 1;
    if (mppt >= inv.mppt_count!) {
      mppt = 0;
      inverter += 1;
    }
  };
  let usedAny = false;
  for (const b of buckets(input, byPlane)) {
    const el = input.electrical[b.module_key];
    if (!el) continue;
    const ar = admissibleRange(inv, el, input.temps, b.modules.length);
    if (!ar.ok)
      return {
        error: ar.reason ?? "Données insuffisantes pour proposer un câblage.",
        missing: ar.missing,
      };
    const lens = splitLengths(b.modules.length, ar.range, preferLong);
    if (!lens.length) {
      notes.push(
        `${b.label} : ${b.modules.length} panneau(x), en dessous du minimum de ${ar.range.nmin} par string — non affectés.`,
      );
      continue;
    }
    let cursor = 0;
    let onMppt = 0;
    let lastLen = -1;
    if (usedAny) advance();
    usedAny = true;
    for (const n of lens) {
      if (onMppt > 0 && (n !== lastLen || onMppt >= ar.range.maxParallel)) {
        advance();
        onMppt = 0;
      }
      sIdx += 1;
      groups.push({
        id: `s${sIdx}`,
        kind: "string",
        label: `S${sIdx}`,
        inverter_index: inverter,
        mppt_index: mppt,
        module_ids: b.modules.slice(cursor, cursor + n).map((m) => m.id),
      });
      cursor += n;
      onMppt += 1;
      lastLen = n;
    }
    const left = b.modules.length - cursor;
    if (ar.range.provisional.length)
      notes.push(
        `${b.label} : longueurs provisoires — ${ar.range.provisional.join(" ; ")}. Contrôles correspondants non vérifiables.`,
      );
    notes.push(
      `${b.label} : ${lens.length} string(s) de ${[...new Set(lens)].join("/")} panneaux (plage admissible ${ar.range.nmin}–${ar.range.nmax})${left ? `, ${left} non affecté(s)` : ""}.`,
    );
  }
  const invCount = groups.length ? inverter + 1 : 0;
  if (invCount > 1)
    notes.push(`${invCount} onduleurs identiques nécessaires (MPPT insuffisants sur un seul).`);
  return { groups, notes };
}

function buildMicro(
  input: StringingInput,
  byPlane: boolean,
): { groups: ElecGroup[]; notes: string[] } | { error: string; missing: string[] } {
  const per = input.inverter.micro_inputs;
  if (per == null || per < 1)
    return {
      error: "Nombre d'entrées du micro-onduleur non publié.",
      missing: ["entrées par micro-onduleur"],
    };
  const groups: ElecGroup[] = [];
  const notes: string[] = [];
  let i = 0;
  for (const b of buckets(input, byPlane)) {
    for (let c = 0; c < b.modules.length; c += per) {
      i += 1;
      groups.push({
        id: `m${i}`,
        kind: "micro",
        label: `µ${i}`,
        inverter_index: i - 1,
        mppt_index: null,
        module_ids: b.modules.slice(c, c + per).map((m) => m.id),
      });
    }
    notes.push(
      `${b.label} : ${Math.ceil(b.modules.length / per)} micro-onduleur(s) de ${per} entrée(s).`,
    );
  }
  return { groups, notes };
}

export function proposeWiring(input: StringingInput): StringingResult {
  const plans: {
    role: WiringProposal["role"];
    label: string;
    byPlane: boolean;
    preferLong: boolean;
    why: string;
  }[] = [
    {
      role: "recommandee",
      label: "Recommandée",
      byPlane: true,
      preferLong: true,
      why: "Un MPPT par pan et orientation, strings longues : moins de câbles, comportement homogène.",
    },
    {
      role: "simple",
      label: "Câblage simple",
      byPlane: false,
      preferLong: true,
      why: "Regroupe les panneaux identiques tous pans confondus : le moins de strings possible (mismatch possible entre pans).",
    },
    {
      role: "alternative",
      label: "Alternative",
      byPlane: true,
      preferLong: false,
      why: "Strings plus courtes en parallèle : marge de tension supérieure.",
    },
  ];
  const noKey = input.modules.filter((m) => !m.module_key).length;
  const out: WiringProposal[] = [];
  const seen = new Set<string>();
  for (const p of plans) {
    const built =
      input.inverter.kind === "micro"
        ? buildMicro(input, p.byPlane)
        : buildStrings(input, p.byPlane, p.preferLong);
    if ("error" in built) return { ok: false, reason: built.error, missing: built.missing };
    if (!built.groups.length) continue;
    const sig = designSignature({ ...input, groups: built.groups });
    if (seen.has(sig)) continue;
    seen.add(sig);
    const evaluation = evaluateDesign({ ...input, groups: built.groups });
    const reasons = [p.why, ...built.notes];
    if (noKey) reasons.push(`${noKey} panneau(x) sans fiche électrique : non affectés.`);
    out.push({
      id: p.role,
      role: p.role,
      label: p.label,
      groups: built.groups,
      evaluation,
      reasons,
      signature: sig,
    });
  }
  if (!out.length)
    return { ok: false, reason: "Aucun câblage possible avec les panneaux posés.", missing: [] };
  return { ok: true, proposals: out };
}
