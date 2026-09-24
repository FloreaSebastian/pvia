/**
 * Solar Studio V2 — P1.1 : chargement sûr du logo inséré dans les PDF.
 *
 * Règles :
 *  - uniquement le stockage de fichiers DU projet (hôte exact, chemin /storage/v1/object/) ;
 *  - 2 Mio maximum, vérifiés avant ET pendant la lecture ;
 *  - 5 s maximum, aucune redirection suivie ;
 *  - vrai type détecté par signature binaire (PNG / JPEG uniquement) ;
 *  - en cas de doute, le logo est ignoré : le PDF est toujours produit.
 */
import { sniffDocumentMime } from "../file-sniff";

export const PDF_LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const PDF_LOGO_TIMEOUT_MS = 5000;

/** Vrai si l'URL désigne un objet du stockage du projet (comparaison stricte de l'hôte). */
export function isProjectStorageUrl(raw: string | null | undefined, projectUrl: string | null | undefined): boolean {
  if (!raw || !projectUrl) return false;
  let target: URL;
  let base: URL;
  try {
    target = new URL(raw);
    base = new URL(projectUrl);
  } catch {
    return false;
  }
  if (target.protocol !== "https:" && !(target.protocol === "http:" && base.protocol === "http:"))
    return false;
  if (target.protocol !== base.protocol) return false;
  if (target.username || target.password) return false;
  if (target.host !== base.host) return false;
  if (!target.pathname.startsWith("/storage/v1/object/")) return false;
  if (target.pathname.includes("..")) return false;
  return true;
}

/** Un Content-Length présent doit être un entier valide ≤ max. Absent : lecture bornée. */
export function contentLengthAcceptable(header: string | null, max = PDF_LOGO_MAX_BYTES): boolean {
  if (header === null || header === "") return true;
  if (!/^\d+$/.test(header.trim())) return false;
  return Number(header) <= max;
}

/** Vrai type du logo, par signature binaire : PNG ou JPEG uniquement. */
export function sniffLogoType(bytes: Uint8Array): "png" | "jpg" | null {
  const mime = sniffDocumentMime(bytes);
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  return null;
}

/** Lit un flux en s'arrêtant dès que la taille dépasse `max` (renvoie alors `null`). */
export async function readBounded(
  body: ReadableStream<Uint8Array> | null,
  max = PDF_LOGO_MAX_BYTES,
): Promise<Uint8Array | null> {
  if (!body) return null;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Télécharge le logo selon la politique ci-dessus ; `null` au moindre doute. */
export async function fetchLogoSafely(
  url: string | null | undefined,
  opts: { projectUrl: string | null | undefined; fetchImpl?: FetchLike; timeoutMs?: number },
): Promise<{ bytes: Uint8Array; type: "png" | "jpg" } | null> {
  if (!url || !isProjectStorageUrl(url, opts.projectUrl)) return null;
  const fetchImpl = opts.fetchImpl ?? ((u, i) => fetch(u, i));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? PDF_LOGO_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { redirect: "error", signal: controller.signal });
    if (!res.ok) return null;
    if (!contentLengthAcceptable(res.headers.get("content-length"))) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    const bytes = await readBounded(res.body);
    if (!bytes || bytes.byteLength === 0) return null;
    const type = sniffLogoType(bytes);
    return type ? { bytes, type } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
