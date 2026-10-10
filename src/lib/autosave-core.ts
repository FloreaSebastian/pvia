// Cœur d'autosave indépendant de React. Chaque valeur est rattachée à la
// portée (utilisateur/entreprise) dans laquelle elle a été saisie : une
// valeur saisie en A n'est jamais enregistrée après passage en B, et une
// réponse tardive de A ne modifie ni la base ni le statut de B.
export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

export type AutosaveCoreOptions<T> = {
  save: (scope: string, value: T) => Promise<void>;
  eq?: (a: T, b: T) => boolean;
  onStatus: (s: SaveStatus) => void;
  onSaved?: (at: Date) => void;
};

export function createAutosaveCore<T>(opts: AutosaveCoreOptions<T>) {
  const eq = opts.eq ?? ((a: T, b: T) => JSON.stringify(a) === JSON.stringify(b));
  let scope: string | null = null;
  let gen = 0;
  let baseline: T | undefined;
  let latest: T | undefined;
  let status: SaveStatus = "idle";
  let inFlight: Promise<boolean> | null = null;
  let disposed = false;

  const setStatus = (s: SaveStatus) => {
    if (disposed) return;
    status = s;
    opts.onStatus(s);
  };

  return {
    get status() {
      return status;
    },
    get scope() {
      return scope;
    },
    isDirty() {
      return (
        scope !== null && latest !== undefined && baseline !== undefined && !eq(latest, baseline)
      );
    },
    /** Ouvre une portée avec sa base chargée avec succès. null = fermé (chargement/erreur). */
    open(nextScope: string | null, loaded?: T) {
      if (disposed) return;
      gen += 1;
      scope = nextScope;
      baseline = nextScope === null ? undefined : loaded;
      latest = baseline;
      inFlight = null;
      setStatus("idle");
    },
    /**
     * Invalide définitivement le cœur (démontage) : les commandes en attente et
     * les réponses tardives n'ont plus aucun effet. Une écriture déjà émise pour
     * sa portée d'origine n'est pas annulée côté serveur.
     */
    dispose() {
      disposed = true;
      gen += 1;
      scope = null;
      baseline = undefined;
      latest = undefined;
      inFlight = null;
    },
    get disposed() {
      return disposed;
    },
    /** Saisie dans la portée indiquée ; ignorée si ce n'est pas la portée ouverte. */
    update(forScope: string | null, value: T) {
      if (disposed || forScope === null || forScope !== scope || baseline === undefined)
        return false;
      latest = value;
      setStatus(eq(value, baseline) ? "idle" : "dirty");
      return true;
    },
    /** Rebase sans enregistrer (ex. après rechargement). */
    rebase(forScope: string, value: T) {
      if (disposed || forScope !== scope) return;
      baseline = value;
      latest = value;
      setStatus("idle");
    },
    /**
     * true seulement si tout est réellement enregistré dans la portée où la
     * commande a été émise. La portée et la génération sont capturées AVANT
     * d'attendre l'écriture en cours : si elles changent pendant l'attente,
     * la commande est refusée (jamais d'enregistrement de B par une commande de A).
     */
    async flush(): Promise<boolean> {
      const myScope = scope;
      const myGen = gen;
      if (disposed || myScope === null) return false;
      // File sérialisée : chaque waiter réexamine l'écriture COURANTE après
      // chaque fin d'écriture ; une seule écriture à la fois par génération.
      while (inFlight) {
        const waiting = inFlight;
        await waiting.catch(() => false);
        if (disposed || myGen !== gen || scope !== myScope) return false;
      }
      if (disposed || myGen !== gen || scope !== myScope) return false;
      if (baseline === undefined || latest === undefined) return false;
      const snapshot = latest;
      if (eq(snapshot, baseline)) {
        if (status !== "error") setStatus("idle");
        return status !== "error";
      }
      setStatus("saving");
      // inFlight est posé AVANT l'exécution de save (même si save lève de façon
      // synchrone) ; il n'est effacé que s'il désigne encore cette écriture.
      const p: Promise<boolean> = Promise.resolve().then(async () => {
        try {
          await opts.save(myScope, snapshot);
          if (disposed || myGen !== gen) return false; // portée changée : résultat ignoré
          baseline = snapshot;
          opts.onSaved?.(new Date());
          setStatus(latest !== undefined && !eq(latest, baseline) ? "dirty" : "saved");
          return true;
        } catch {
          if (disposed || myGen !== gen) return false;
          setStatus("error");
          return false;
        } finally {
          if (inFlight === p) inFlight = null;
        }
      });
      inFlight = p;
      return p;
    },
  };
}
