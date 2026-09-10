/**
 * Client serveur du moteur géospatial externe.
 *
 * Le navigateur ne contacte jamais le moteur : seule une fonction serveur PVIA
 * (après contrôle d'appartenance à l'entreprise) s'y adresse.
 */
import {
  DATASET_STATE_LABEL,
  type DatasetState,
  type EngineDatasetStatus,
  type EngineHealth,
  type EngineState,
} from "./engine";

export interface EngineStatus {
  state: EngineState;
  label: string;
  health: EngineHealth | null;
  datasets: EngineDatasetStatus[];
  detail: string;
}

function engineConfig(): { url: string; secret: string } | null {
  const url = process.env["SOLAR_ENGINE_URL"];
  const secret = process.env["SOLAR_ENGINE_SECRET"];
  if (!url || !secret) return null;
  return { url: url.replace(/\/+$/, ""), secret };
}

export function isEngineConfigured(): boolean {
  return engineConfig() !== null;
}

async function call<T>(path: string, init?: RequestInit): Promise<T | null> {
  const cfg = engineConfig();
  if (!cfg) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${cfg.url}${path}`, {
      ...init,
      headers: { "x-engine-secret": cfg.secret, "content-type": "application/json", ...(init?.headers ?? {}) },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** État réel du moteur : rien n'est déclaré disponible sans réponse du service. */
export async function getEngineStatus(): Promise<EngineStatus> {
  if (!isEngineConfigured()) {
    return {
      state: "not_configured",
      label: "Service de traitement 3D non configuré",
      health: null,
      datasets: [],
      detail:
        "Le moteur d'analyse 3D (LiDAR HD, MNT, MNS, MNH) n'est pas relié à cette application. La modélisation manuelle reste entièrement disponible.",
    };
  }

  const health = await call<EngineHealth>("/health");
  if (!health) {
    return {
      state: "unreachable",
      label: "Analyse 3D temporairement indisponible",
      health: null,
      datasets: [],
      detail: "Le service de traitement ne répond pas. Réessayez plus tard : l'édition manuelle reste disponible.",
    };
  }

  const raw = await call<{ datasets: RawDataset[] }>("/v1/coverage");
  const datasets = (raw?.datasets ?? []).map(toDatasetStatus);
  const state: EngineState = health.status === "ok" ? "ready" : "degraded";

  return {
    state,
    label: state === "ready" ? "Service de traitement 3D disponible" : "Service de traitement 3D incomplet",
    health,
    datasets,
    detail:
      state === "ready"
        ? `Moteur ${health.version} · PDAL ${health.pdal_version} · GDAL ${health.gdal_version} · PROJ ${health.proj_version}`
        : "Le moteur répond mais une bibliothèque géospatiale manque : traitement 3D indisponible.",
  };
}

interface RawDataset {
  dataset_kind: string;
  label: string;
  configured: boolean;
  engine_ready: boolean;
  provider: string | null;
  dataset: string | null;
  resolution_m: number | null;
  attribution: string | null;
  notes: string;
}

function toDatasetStatus(d: RawDataset): EngineDatasetStatus {
  let state: DatasetState;
  if (!d.engine_ready) state = "service_unavailable";
  else if (!d.configured) state = "unavailable_here";
  else state = "processing_required";
  return {
    dataset_kind: d.dataset_kind,
    label: d.label,
    state,
    provider: d.provider,
    dataset: d.dataset,
    resolution_m: d.resolution_m,
    attribution: d.attribution,
    notes: d.notes || DATASET_STATE_LABEL[state],
  };
}
