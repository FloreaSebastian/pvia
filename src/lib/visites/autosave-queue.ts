/**
 * File d'envoi de l'autosave terrain : un seul envoi à la fois, et toute saisie
 * arrivée pendant un envoi lent est envoyée automatiquement dès la fin de
 * celui-ci, sans nouvelle frappe. S'arrête sur échec (pas de boucle infinie).
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
