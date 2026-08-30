/**
 * Récupération contrôlée après un déploiement : quand le HTML chargé référence
 * des chunks JS supprimés (bundle désynchronisé, PWA installée, cache navigateur),
 * l'import dynamique échoue avec un `ChunkLoadError` / 404.
 *
 * Stratégie : UNE SEULE tentative de rechargement par session (garde
 * sessionStorage + horodatage), après purge des caches du service worker.
 * Aucune boucle possible ; aucune action pour les erreurs métier.
 */

const FLAG = "pvia.chunk_reload.v1";
const WINDOW_MS = 60_000;

const CHUNK_PATTERNS = [
  /ChunkLoadError/i,
  /Loading chunk [\w-]+ failed/i,
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
  /'text\/html' is not a valid JavaScript MIME type/i,
];

export function isChunkLoadError(error: unknown): boolean {
  const msg =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === "string"
        ? error
        : "";
  if (!msg) return false;
  return CHUNK_PATTERNS.some((re) => re.test(msg));
}

function alreadyRecovered(): boolean {
  try {
    const raw = sessionStorage.getItem(FLAG);
    if (!raw) return false;
    const at = Number(raw);
    // Garde permanente pour la session : une seule tentative, jamais de boucle.
    return Number.isFinite(at);
  } catch {
    return true; // sessionStorage indisponible → ne pas recharger
  }
}

async function purgeCaches(): Promise<void> {
  try {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      reg?.active?.postMessage("PVIA_PURGE_CACHES");
      await reg?.update().catch(() => {});
    }
    const cacheStorage = typeof window !== "undefined" ? window.caches : undefined;
    if (cacheStorage && typeof cacheStorage.keys === "function") {
      const names = await cacheStorage.keys();
      await Promise.all(names.filter((n) => n.startsWith("pvia-")).map((n) => cacheStorage.delete(n)));
    }
  } catch {
    /* best effort */
  }
}

/** `true` si une récupération a été déclenchée (rechargement imminent). */
export function recoverFromChunkError(error: unknown): boolean {
  if (typeof window === "undefined") return false;
  if (!isChunkLoadError(error)) return false;
  if (alreadyRecovered()) return false;

  try {
    sessionStorage.setItem(FLAG, String(Date.now()));
  } catch {
    return false;
  }

  console.warn("[chunk-recovery] bundle désynchronisé — purge des caches et rechargement unique");
  void purgeCaches().then(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("_v", String(Math.floor(Date.now() / WINDOW_MS)));
    window.location.replace(url.toString());
  });
  return true;
}

/** Branche les écouteurs globaux (client uniquement, une seule fois). */
export function installChunkRecovery(): void {
  if (typeof window === "undefined") return;
  const w = window as Window & { __pviaChunkRecovery?: boolean };
  if (w.__pviaChunkRecovery) return;
  w.__pviaChunkRecovery = true;

  window.addEventListener("vite:preloadError", (event) => {
    if (recoverFromChunkError((event as unknown as { payload?: unknown }).payload)) {
      event.preventDefault();
    }
  });
  window.addEventListener("error", (event) => {
    recoverFromChunkError((event as ErrorEvent).error ?? event.message);
  });
  window.addEventListener("unhandledrejection", (event) => {
    recoverFromChunkError((event as PromiseRejectionEvent).reason);
  });
}
