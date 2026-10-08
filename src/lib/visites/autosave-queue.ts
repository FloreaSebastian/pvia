/**
 * File d'envoi de l'autosave terrain : un seul envoi à la fois, et toute saisie
 * arrivée pendant un envoi lent est envoyée automatiquement dès la fin de
 * celui-ci, sans nouvelle frappe. S'arrête sur échec (pas de boucle infinie).
 *
 * Contrat : send() renvoie true si l'envoi a réussi (même si de nouvelles
 * saisies sont arrivées entre-temps), false uniquement en cas d'échec.
 * hasPending() décide seul s'il faut repasser.
 */
export function createAutosaveQueue(opts: {
  send: () => Promise<boolean>;
  hasPending: () => boolean;
}) {
  let running: Promise<boolean> | null = null;
  let rerun = false;

  async function drain(): Promise<boolean> {
    let ok = true;
    do {
      rerun = false;
      ok = await opts.send();
      if (!ok) break;
    } while (rerun || opts.hasPending());
    return ok && !opts.hasPending();
  }

  return {
    /** Demande un envoi ; partage l'envoi en cours et garantit un nouveau passage après lui. */
    flush(): Promise<boolean> {
      if (running) {
        rerun = true;
        return running;
      }
      const p = drain().finally(() => {
        running = null;
      });
      running = p;
      return p;
    },
    isRunning: () => running !== null,
  };
}

export type DirtyEntry = { section_key: string; value: unknown };

/**
 * Envoie un snapshot des réponses en attente et ne retire de la file que les
 * entrées inchangées depuis le snapshot (identité d'objet) : une valeur
 * modifiée pendant l'envoi reste en attente pour le passage suivant.
 * Renvoie la réponse serveur ; lève l'erreur d'envoi telle quelle.
 */
export async function sendDirtySnapshot<R>(
  dirty: Map<string, DirtyEntry>,
  save: (entries: { field_key: string; section_key: string; value: unknown }[]) => Promise<R>,
): Promise<{ result: R; sentKeys: string[] }> {
  const snapshot = Array.from(dirty.entries());
  const result = await save(
    snapshot.map(([field_key, v]) => ({ field_key, section_key: v.section_key, value: v.value })),
  );
  for (const [key, ref] of snapshot) {
    if (dirty.get(key) === ref) dirty.delete(key);
  }
  return { result, sentKeys: snapshot.map(([k]) => k) };
}
