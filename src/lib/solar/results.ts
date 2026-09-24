/**
 * Solar Studio V2 — P1 : synthèse « Résultats ».
 *
 * Module PUR. Il n'invente AUCUNE donnée : toutes les valeurs proviennent du
 * modèle enregistré (pans, modules posés, snapshot panneau DU CHAMP DE CHAQUE PAN).
 * Aucune production annuelle ni ombrage n'est estimé ici : aucun moteur
 * d'irradiance n'existe à ce stade (cf. `production: null`).
 *
 * P1.1 : chaque module utilise le snapshot du champ (array) de son propre pan.
 * Un module dont le pan n'a pas de fiche exploitable a une puissance et une
 * surface INCONNUES (jamais empruntées à un autre pan).
 */
import { azimuthLabel } from "./geo";
import { normalizeValidityStatus, type PlacedModule } from "./types";

export interface ResultsModelRef {
  reference: string | null;
  name: string | null;
  address: string | null;
  geometry_version: number;
  geometry_hash: string | null;
  updated_at: string | null;
  quality_level: string | null;
}

export interface ResultsPlaneRef {
  id: string;
  key: string;
  name: string;
  area_m2: number;
  azimuth_deg: number;
  tilt_deg: number;
}

export interface ResultsObstacleRef {
  roof_plane_id: string | null;
  obstacle_type: string;
  label?: string | null;
}

export interface ResultsArrayRef {
  roof_plane_id: string;
  module_variant_id?: string | null;
  module_revision_id?: string | null;
  module_snapshot?: unknown;
  rules_profile_id?: string | null;
  rules_profile_version?: number | null;
  layout_engine_version?: string | null;
}

export interface ResultsInput {
  model: ResultsModelRef;
  planes: ResultsPlaneRef[];
  modules: PlacedModule[];
  obstacles: ResultsObstacleRef[];
  arrays: ResultsArrayRef[];
  /** Fiche qualité/provenance déjà calculée par le serveur (jamais recalculée ici). */
  quality?: { verified_count: number; total_count: number } | null;
}

export interface ModuleSpecRef {
  manufacturer: string | null;
  model: string | null;
  power_wc: number | null;
  width_mm: number | null;
  height_mm: number | null;
  depth_mm: number | null;
  /** Vrai si dimensions ET puissance sont présentes : sinon le dossier est incomplet. */
  complete: boolean;
}

/** Référence de panneau réellement posée (une entrée par référence distincte). */
export interface ModuleTypeSummary {
  manufacturer: string | null;
  model: string | null;
  power_wc: number | null;
  width_mm: number | null;
  height_mm: number | null;
  depth_mm: number | null;
  module_count: number;
  /** `null` si la puissance unitaire est absente de la fiche. */
  power_kwc: number | null;
  module_area_m2: number | null;
  plane_keys: string[];
}

/** Configuration réellement enregistrée pour un pan (traçabilité). */
export interface ArrayConfiguration {
  plane_key: string;
  plane_name: string;
  manufacturer: string | null;
  model: string | null;
  power_wc: number | null;
  module_variant_id: string | null;
  module_revision_id: string | null;
  rules_profile_id: string | null;
  rules_profile_version: number | null;
  layout_engine_version: string | null;
}

export interface PlaneResult {
  key: string;
  name: string;
  area_m2: number;
  tilt_deg: number;
  azimuth_deg: number;
  cardinal: string;
  module_count: number;
  /** Somme des puissances CONNUES des panneaux actifs du pan. */
  power_kwc: number;
  module_area_m2: number;
  /** Faux si au moins un panneau actif du pan n'a pas de fiche exploitable. */
  power_known: boolean;
  unknown_count: number;
  warning_count: number;
  invalid_count: number;
  spec: ModuleSpecRef | null;
  obstacles: string[];
  alerts: string[];
}

export interface ResultsWarning {
  code:
    | "aucun_panneau"
    | "pan_sans_panneau"
    | "snapshot_incomplet"
    | "panneaux_desactives"
    | "provenance_a_verifier"
    | "geometrie_non_verifiee"
    | "module_sans_fiche"
    | "modules_a_verifier"
    | "modules_invalides"
    | "plusieurs_champs_meme_pan";
  message: string;
}

export interface SolarResultsReport {
  global: {
    /** Somme des puissances connues de tous les panneaux actifs. */
    power_kwc: number;
    /** Faux si certains panneaux actifs ont une puissance inconnue. */
    power_complete: boolean;
    module_count: number;
    /** Référence unique si homogène ; sinon fiche vide (voir `module_types`). */
    spec: ModuleSpecRef;
    module_types: ModuleTypeSummary[];
    module_area_m2: number;
    roof_area_m2: number;
    planes_used: number;
    orientations: string[];
    warning_count: number;
    invalid_count: number;
    status: "ok" | "alerte";
  };
  planes: PlaneResult[];
  technical: {
    geometry_version: number;
    geometry_hash_short: string | null;
    /** Champs hérités : renseignés seulement s'il n'y a qu'UNE configuration. */
    module_variant_id: string | null;
    module_revision_id: string | null;
    module_snapshot: Record<string, unknown> | null;
    rules_profile_id: string | null;
    rules_profile_version: number | null;
    layout_engine_version: string | null;
    /** Toutes les configurations réellement enregistrées, pan par pan. */
    configurations: ArrayConfiguration[];
    updated_at: string | null;
    quality_level: string | null;
    quality_verified: string | null;
  };
  warnings: ResultsWarning[];
  /** Aucun moteur de production/irradiance n'existe : le champ reste `null`. */
  production: null;
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function plural(n: number, s: string, p: string): string {
  return n > 1 ? p : s;
}

const EMPTY_SPEC: ModuleSpecRef = {
  manufacturer: null,
  model: null,
  power_wc: null,
  width_mm: null,
  height_mm: null,
  depth_mm: null,
  complete: false,
};

/** Dimensions/identité du panneau, exclusivement issues du snapshot du champ. */
export function readModuleSpec(snapshot: unknown): ModuleSpecRef {
  const s = (snapshot && typeof snapshot === "object" ? snapshot : {}) as Record<string, unknown>;
  const spec: ModuleSpecRef = {
    manufacturer: str(s["manufacturer"]),
    model: str(s["model"]) ?? str(s["reference"]) ?? str(s["series"]),
    power_wc: num(s["power_wc"]),
    width_mm: num(s["width_mm"]),
    height_mm: num(s["height_mm"]),
    depth_mm: num(s["depth_mm"]),
    complete: false,
  };
  spec.complete =
    spec.width_mm !== null &&
    spec.height_mm !== null &&
    spec.power_wc !== null &&
    spec.manufacturer !== null &&
    spec.model !== null;
  return spec;
}

/** Surface d'un panneau en m² (identique en portrait et en paysage), ou `null`. */
function moduleArea(spec: ModuleSpecRef | null): number | null {
  if (!spec || spec.width_mm === null || spec.height_mm === null) return null;
  return (spec.width_mm / 1000) * (spec.height_mm / 1000);
}

function specSignature(spec: ModuleSpecRef): string {
  return [spec.manufacturer, spec.model, spec.power_wc, spec.width_mm, spec.height_mm].join("|");
}

/**
 * Associe chaque clé de pan au champ (array) qui lui est rattaché.
 * Si plusieurs champs pointent vers le même pan, le premier (ordre enregistré)
 * est retenu et le cas est signalé : on ne fusionne jamais deux fiches.
 */
export function resolveArraysByPlaneKey<A extends { roof_plane_id: string }>(
  planes: { id: string; key: string }[],
  arrays: A[],
): { byKey: Map<string, A>; duplicatedKeys: string[] } {
  const keyById = new Map(planes.map((p) => [p.id, p.key]));
  const byKey = new Map<string, A>();
  const duplicated = new Set<string>();
  for (const a of arrays) {
    const key = keyById.get(a.roof_plane_id);
    if (!key) continue;
    if (byKey.has(key)) duplicated.add(key);
    else byKey.set(key, a);
  }
  return { byKey, duplicatedKeys: [...duplicated].sort() };
}

export function buildSolarResults(input: ResultsInput): SolarResultsReport {
  const active = input.modules.filter((m) => m.enabled);
  const disabled = input.modules.length - active.length;

  const planeById = new Map(input.planes.map((p) => [p.id, p]));
  const { byKey: arrayByKey, duplicatedKeys } = resolveArraysByPlaneKey(input.planes, input.arrays);
  const specByKey = new Map<string, ModuleSpecRef>();
  for (const [key, a] of arrayByKey) specByKey.set(key, readModuleSpec(a.module_snapshot));

  const obstaclesByPlane = new Map<string, string[]>();
  for (const o of input.obstacles) {
    const plane = o.roof_plane_id ? planeById.get(o.roof_plane_id) : null;
    if (!plane) continue;
    const list = obstaclesByPlane.get(plane.key) ?? [];
    list.push(str(o.label) ?? o.obstacle_type);
    obstaclesByPlane.set(plane.key, list);
  }

  const warnings: ResultsWarning[] = [];
  const types = new Map<string, ModuleTypeSummary>();
  const validityCauses = { warning: new Set<string>(), invalid: new Set<string>() };

  const planes: PlaneResult[] = input.planes.map((p) => {
    const mine = active.filter((m) => m.roof_plane_key === p.key);
    const spec = specByKey.get(p.key) ?? null;
    const area = moduleArea(spec);
    const powerKnown = spec?.power_wc ?? null;
    const unknown = mine.length > 0 && (powerKnown === null || area === null) ? mine.length : 0;

    let warningCount = 0;
    let invalidCount = 0;
    for (const m of mine) {
      const status = normalizeValidityStatus(m.validity_status);
      if (status === "warning") {
        warningCount += 1;
        if (str(m.validity_cause)) validityCauses.warning.add(str(m.validity_cause)!);
      } else if (status === "invalid") {
        invalidCount += 1;
        if (str(m.validity_cause)) validityCauses.invalid.add(str(m.validity_cause)!);
      }
    }

    if (spec && mine.length > 0) {
      const sig = specSignature(spec);
      const t = types.get(sig) ?? {
        manufacturer: spec.manufacturer,
        model: spec.model,
        power_wc: spec.power_wc,
        width_mm: spec.width_mm,
        height_mm: spec.height_mm,
        depth_mm: spec.depth_mm,
        module_count: 0,
        power_kwc: spec.power_wc === null ? null : 0,
        module_area_m2: area === null ? null : 0,
        plane_keys: [],
      };
      t.module_count += mine.length;
      if (t.power_kwc !== null && spec.power_wc !== null)
        t.power_kwc = round(t.power_kwc + (mine.length * spec.power_wc) / 1000, 3);
      if (t.module_area_m2 !== null && area !== null)
        t.module_area_m2 = round(t.module_area_m2 + mine.length * area, 3);
      t.plane_keys.push(p.key);
      types.set(sig, t);
    }

    const alerts: string[] = [];
    if (mine.length === 0) alerts.push("Aucun panneau posé sur ce pan.");
    if (unknown > 0)
      alerts.push(
        `${unknown} ${plural(unknown, "panneau", "panneaux")} sans fiche exploitable : puissance et surface inconnues.`,
      );
    if (invalidCount > 0)
      alerts.push(
        `${invalidCount} ${plural(invalidCount, "panneau invalide", "panneaux invalides")}.`,
      );
    if (warningCount > 0)
      alerts.push(
        `${warningCount} ${plural(warningCount, "panneau à vérifier", "panneaux à vérifier")}.`,
      );

    return {
      key: p.key,
      name: p.name,
      area_m2: round(p.area_m2, 1),
      tilt_deg: round(p.tilt_deg, 1),
      azimuth_deg: round(p.azimuth_deg, 1),
      cardinal: azimuthLabel(p.azimuth_deg),
      module_count: mine.length,
      power_kwc: powerKnown === null ? 0 : round((mine.length * powerKnown) / 1000, 2),
      module_area_m2: area === null ? 0 : round(mine.length * area, 1),
      power_known: unknown === 0,
      unknown_count: unknown,
      warning_count: warningCount,
      invalid_count: invalidCount,
      spec,
      obstacles: obstaclesByPlane.get(p.key) ?? [],
      alerts,
    };
  });

  // Modules rattachés à un pan inconnu : jamais comptés avec une fiche empruntée.
  const knownKeys = new Set(input.planes.map((p) => p.key));
  const orphan = active.filter((m) => !knownKeys.has(m.roof_plane_key)).length;

  const moduleTypes = [...types.values()].sort((a, b) =>
    `${a.manufacturer ?? ""} ${a.model ?? ""}`.localeCompare(`${b.manufacturer ?? ""} ${b.model ?? ""}`),
  );

  const orientations = [...new Set(active.map((m) => m.orientation))].sort();
  const planesUsed = planes.filter((p) => p.module_count > 0).length;
  const unknownTotal = planes.reduce((s, p) => s + p.unknown_count, 0) + orphan;
  const warningTotal = planes.reduce((s, p) => s + p.warning_count, 0);
  const invalidTotal = planes.reduce((s, p) => s + p.invalid_count, 0);

  if (active.length === 0) {
    warnings.push({ code: "aucun_panneau", message: "Aucun panneau posé sur cette toiture." });
  }
  for (const p of planes) {
    if (p.module_count === 0) {
      warnings.push({ code: "pan_sans_panneau", message: `${p.name} : aucun panneau posé.` });
    }
  }
  for (const p of planes) {
    if (p.unknown_count > 0) {
      warnings.push({
        code: "module_sans_fiche",
        message: `${p.name} : ${p.unknown_count} ${plural(p.unknown_count, "panneau", "panneaux")} sans fiche panneau exploitable — puissance et surface inconnues.`,
      });
    }
  }
  if (orphan > 0) {
    warnings.push({
      code: "module_sans_fiche",
      message: `${orphan} ${plural(orphan, "panneau rattaché", "panneaux rattachés")} à aucun pan connu — puissance et surface inconnues.`,
    });
  }
  const incomplete = planes.some(
    (p) => p.module_count > 0 && p.spec !== null && !p.spec.complete,
  );
  if (incomplete) {
    warnings.push({
      code: "snapshot_incomplet",
      message: "Fiche du panneau incomplète : vérifiez la référence enregistrée.",
    });
  }
  if (invalidTotal > 0) {
    const causes = [...validityCauses.invalid].sort();
    warnings.push({
      code: "modules_invalides",
      message: `${invalidTotal} ${plural(invalidTotal, "panneau invalide", "panneaux invalides")}${causes.length ? ` (${causes.join(", ")})` : ""}.`,
    });
  }
  if (warningTotal > 0) {
    const causes = [...validityCauses.warning].sort();
    warnings.push({
      code: "modules_a_verifier",
      message: `${warningTotal} ${plural(warningTotal, "panneau à vérifier", "panneaux à vérifier")}${causes.length ? ` (${causes.join(", ")})` : ""}.`,
    });
  }
  for (const key of duplicatedKeys) {
    const name = input.planes.find((p) => p.key === key)?.name ?? key;
    warnings.push({
      code: "plusieurs_champs_meme_pan",
      message: `${name} : plusieurs champs enregistrés, seul le premier est pris en compte.`,
    });
  }
  if (disabled > 0) {
    warnings.push({
      code: "panneaux_desactives",
      message: `${disabled} panneau${disabled > 1 ? "x" : ""} désactivé${disabled > 1 ? "s" : ""} : non compté${disabled > 1 ? "s" : ""} dans la puissance.`,
    });
  }
  if (input.quality && input.quality.total_count > input.quality.verified_count) {
    warnings.push({
      code: "provenance_a_verifier",
      message: `${input.quality.total_count - input.quality.verified_count} donnée(s) non vérifiée(s) sur site.`,
    });
  }

  const configurations: ArrayConfiguration[] = input.planes
    .filter((p) => arrayByKey.has(p.key))
    .map((p) => {
      const a = arrayByKey.get(p.key)!;
      const s = specByKey.get(p.key) ?? EMPTY_SPEC;
      return {
        plane_key: p.key,
        plane_name: p.name,
        manufacturer: s.manufacturer,
        model: s.model,
        power_wc: s.power_wc,
        module_variant_id: a.module_variant_id ?? null,
        module_revision_id: a.module_revision_id ?? null,
        rules_profile_id: a.rules_profile_id ?? null,
        rules_profile_version: a.rules_profile_version ?? null,
        layout_engine_version: a.layout_engine_version ?? null,
      };
    });

  // Référence globale : seulement si elle est unique. Sinon, aucune fiche fictive.
  let globalSpec: ModuleSpecRef;
  if (moduleTypes.length === 1) {
    const t = moduleTypes[0]!;
    globalSpec = readModuleSpec(t);
  } else if (moduleTypes.length === 0 && arrayByKey.size > 0) {
    globalSpec = specByKey.get([...arrayByKey.keys()][0]!) ?? EMPTY_SPEC;
  } else {
    globalSpec = { ...EMPTY_SPEC };
  }

  const single = input.arrays.length === 1 ? input.arrays[0]! : null;
  const snapshot =
    single?.module_snapshot && typeof single.module_snapshot === "object"
      ? (single.module_snapshot as Record<string, unknown>)
      : null;

  const status = warnings.some((w) =>
    ["aucun_panneau", "snapshot_incomplet", "module_sans_fiche", "modules_invalides", "modules_a_verifier"].includes(
      w.code,
    ),
  )
    ? "alerte"
    : "ok";

  return {
    global: {
      power_kwc: round(
        planes.reduce((s, p) => s + p.power_kwc, 0),
        2,
      ),
      power_complete: unknownTotal === 0,
      module_count: active.length,
      spec: globalSpec,
      module_types: moduleTypes,
      module_area_m2: round(
        planes.reduce((s, p) => s + p.module_area_m2, 0),
        1,
      ),
      roof_area_m2: round(
        input.planes.reduce((s, p) => s + p.area_m2, 0),
        1,
      ),
      planes_used: planesUsed,
      orientations,
      warning_count: warningTotal,
      invalid_count: invalidTotal,
      status,
    },
    planes,
    technical: {
      geometry_version: input.model.geometry_version,
      geometry_hash_short: input.model.geometry_hash
        ? input.model.geometry_hash.slice(0, 12)
        : null,
      module_variant_id: single?.module_variant_id ?? null,
      module_revision_id: single?.module_revision_id ?? null,
      module_snapshot: snapshot,
      rules_profile_id: single?.rules_profile_id ?? null,
      rules_profile_version: single?.rules_profile_version ?? null,
      layout_engine_version: single?.layout_engine_version ?? null,
      configurations,
      updated_at: input.model.updated_at,
      quality_level: input.model.quality_level,
      quality_verified: input.quality
        ? `${input.quality.verified_count}/${input.quality.total_count}`
        : null,
    },
    warnings,
    production: null,
  };
}

/** Libellé lisible d'une référence de panneau. */
export function moduleTypeLabel(t: { manufacturer: string | null; model: string | null }): string {
  return [t.manufacturer, t.model].filter(Boolean).join(" ") || "Référence non renseignée";
}

/** Nom de fichier d'export, normalisé et sans caractère hasardeux. */
export function planExportFileName(reference: string | null, date: Date, ext: string): string {
  const ref = (reference ?? "dossier")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const iso = date.toISOString().slice(0, 10);
  return `PVIA_${ref || "dossier"}_plan-photovoltaique_${iso}.${ext}`;
}
