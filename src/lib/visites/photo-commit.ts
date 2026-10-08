/**
 * Enregistrement fiable d'une photo déjà envoyée dans le stockage.
 *
 * L'enregistrement serveur est idempotent par chemin de fichier : le même
 * chemin ne crée jamais deux photos. Si la réponse est perdue, on réconcilie
 * par chemin avant toute décision ; le fichier n'est supprimé que lorsque le
 * serveur confirme qu'aucune photo ne le référence. Résultat incertain =
 * fichier conservé.
 */
export type PhotoCommitOutcome =
  | { status: "saved"; reconciled: boolean }
  | { status: "refused"; error: unknown }
  | { status: "uncertain"; error: unknown };

export async function commitVisitPhoto(opts: {
  add: () => Promise<unknown>;
  /** true = référencé, false = confirmé absent ; rejet = lecture impossible. */
  isReferenced: () => Promise<boolean>;
  removeFile: () => Promise<unknown>;
}): Promise<PhotoCommitOutcome> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await opts.add();
      return { status: "saved", reconciled: attempt > 0 };
    } catch (e) {
      lastError = e;
    }
    let referenced: boolean;
    try {
      referenced = await opts.isReferenced();
    } catch {
      return { status: "uncertain", error: lastError };
    }
    if (referenced) return { status: "saved", reconciled: true };
    // Confirmé absent : une seule nouvelle tentative sûre (idempotente par chemin).
  }
  await opts.removeFile().catch(() => undefined);
  return { status: "refused", error: lastError };
}
