/**
 * Enregistrement fiable d'une photo déjà envoyée dans le stockage.
 *
 * L'enregistrement serveur est idempotent par chemin (unicité en base
 * entreprise + visite + chemin) : le même chemin ne crée jamais deux photos,
 * même si deux appels se chevauchent.
 *
 * Règle de nettoyage : le fichier n'est supprimé QUE sur un refus métier
 * déterministe explicitement marqué par le serveur (validation du fichier ou
 * de l'emplacement). Les contrôles d'accès dépendent de la base/du réseau et
 * de l'état : une erreur à ce stade n'est PAS un refus, jamais de suppression.
 * jamais un refus, même si les lectures suivantes ne trouvent pas la photo :
 * l'appel initial peut encore être en cours et valider plus tard. Dans ce cas
 * le fichier est conservé et le résultat est « incertain ».
 */
export const PHOTO_REFUSED_PREFIX = "[PHOTO_REFUSED] ";

/** Message d'erreur marqué « refus déterministe » (côté serveur). */
export function photoRefusal(message: string): Error {
  return new Error(PHOTO_REFUSED_PREFIX + message);
}

/** Vrai uniquement si l'erreur porte le marqueur explicite du serveur. */
export function isDeterministicPhotoRefusal(e: unknown): boolean {
  const m = (e as { message?: unknown } | null)?.message;
  return typeof m === "string" && m.includes(PHOTO_REFUSED_PREFIX.trim());
}

/** Message lisible sans le marqueur technique. */
export function photoErrorMessage(e: unknown, fallback = "Envoi de la photo impossible"): string {
  const m = (e as { message?: unknown } | null)?.message;
  if (typeof m !== "string" || !m) return fallback;
  return m.replace(PHOTO_REFUSED_PREFIX.trim(), "").trim() || fallback;
}

export type PhotoCommitOutcome =
  | { status: "saved"; reconciled: boolean }
  | { status: "refused"; error: unknown }
  | { status: "uncertain"; error: unknown };

export async function commitVisitPhoto(opts: {
  add: () => Promise<unknown>;
  /** true = référencé, false = non trouvé (n'est PAS une preuve d'échec) ; rejet = lecture impossible. */
  isReferenced: () => Promise<boolean>;
  removeFile: () => Promise<unknown>;
  isDeterministicRefusal?: (e: unknown) => boolean;
}): Promise<PhotoCommitOutcome> {
  const deterministic = opts.isDeterministicRefusal ?? isDeterministicPhotoRefusal;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await opts.add();
      return { status: "saved", reconciled: attempt > 0 };
    } catch (e) {
      lastError = e;
    }
    if (deterministic(lastError)) {
      // Refus métier explicite : le même contenu serait refusé par tout appel concurrent.
      await opts.removeFile().catch(() => undefined);
      return { status: "refused", error: lastError };
    }
    let referenced: boolean;
    try {
      referenced = await opts.isReferenced();
    } catch {
      return { status: "uncertain", error: lastError };
    }
    if (referenced) return { status: "saved", reconciled: true };
    // Non trouvé après erreur de transport : une nouvelle tentative est sûre
    // (unicité en base), mais l'absence ne prouve rien : jamais de suppression ici.
  }
  return { status: "uncertain", error: lastError };
}
