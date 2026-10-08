import { describe, expect, test } from "bun:test";
import { commitVisitPhoto, photoRefusal, photoErrorMessage, isDeterministicPhotoRefusal } from "@/lib/visites/photo-commit";
import { createAutosaveQueue, sendDirtySnapshot, type DirtyEntry } from "@/lib/visites/autosave-queue";

/** Serveur simulé, idempotent par chemin comme addVisitPhoto. */
function fakeServer() {
  const rows = new Map<string, { id: string; path: string }>();
  const files = new Set<string>();
  let n = 0;
  return {
    rows,
    files,
    add(path: string) {
      if (![...rows.values()].some((r) => r.path === path))
        rows.set(`p${++n}`, { id: `p${n}`, path });
    },
    replace(id: string, path: string) {
      const r = rows.get(id)!;
      if (r.path === path) return;
      files.delete(r.path); // ancien fichier retiré seulement après mise à jour réussie
      r.path = path;
    },
    referenced: (path: string) => [...rows.values()].some((r) => r.path === path),
  };
}

describe("enregistrement photo — réponse réseau perdue", () => {
  test("panne réseau APRÈS écriture serveur : une seule photo valide, fichier conservé", async () => {
    const s = fakeServer();
    s.files.add("new.jpg");
    let calls = 0;
    const out = await commitVisitPhoto({
      add: async () => {
        calls++;
        s.add("new.jpg");
        if (calls === 1) throw new TypeError("Failed to fetch");
      },
      isReferenced: async () => s.referenced("new.jpg"),
      removeFile: async () => s.files.delete("new.jpg"),
    });
    expect(out).toEqual({ status: "saved", reconciled: true });
    expect(s.rows.size).toBe(1);
    expect(s.files.has("new.jpg")).toBe(true);
    expect(calls).toBe(1);
  });

  test("remplacement + réponse perdue : nouvelle photo référencée, aucune perte des deux", async () => {
    const s = fakeServer();
    s.add("old.jpg");
    s.files.add("old.jpg");
    s.files.add("new.jpg");
    const out = await commitVisitPhoto({
      add: async () => {
        s.replace("p1", "new.jpg");
        throw new TypeError("network lost");
      },
      isReferenced: async () => s.referenced("new.jpg"),
      removeFile: async () => s.files.delete("new.jpg"),
    });
    expect(out.status).toBe("saved");
    expect(s.rows.size).toBe(1);
    expect(s.rows.get("p1")!.path).toBe("new.jpg");
    expect(s.files.has("new.jpg")).toBe(true);
  });

  test("vérification impossible : résultat incertain, fichier jamais effacé", async () => {
    let removed = false;
    const out = await commitVisitPhoto({
      add: async () => {
        throw new TypeError("offline");
      },
      isReferenced: async () => {
        throw new TypeError("offline");
      },
      removeFile: async () => {
        removed = true;
      },
    });
    expect(out.status).toBe("uncertain");
    expect(removed).toBe(false);
  });

  test("panne AVANT écriture : nouvelle tentative sûre, une seule photo", async () => {
    const s = fakeServer();
    let calls = 0;
    const out = await commitVisitPhoto({
      add: async () => {
        calls++;
        if (calls === 1) throw new TypeError("Failed to fetch");
        s.add("a.jpg");
      },
      isReferenced: async () => s.referenced("a.jpg"),
      removeFile: async () => undefined,
    });
    expect(out).toEqual({ status: "saved", reconciled: true });
    expect(calls).toBe(2);
    expect(s.rows.size).toBe(1);
  });

  test("refus confirmé : fichier non référencé nettoyé, ancienne photo intacte", async () => {
    const s = fakeServer();
    s.add("old.jpg");
    s.files.add("old.jpg");
    s.files.add("bad.jpg");
    const out = await commitVisitPhoto({
      add: async () => {
        throw photoRefusal("Ce fichier n'est pas une image JPEG, PNG ou WebP valide.");
      },
      isReferenced: async () => s.referenced("bad.jpg"),
      removeFile: async () => s.files.delete("bad.jpg"),
    });
    expect(out.status).toBe("refused");
    expect(s.files.has("bad.jpg")).toBe(false);
    expect(s.files.has("old.jpg")).toBe(true);
    expect(s.rows.get("p1")!.path).toBe("old.jpg");
  });
});

describe("photo — erreurs non classifiables : jamais de suppression", () => {
  test("appel initial encore en cours, lectures absentes, réponse perdue puis commit tardif : fichier conservé", async () => {
    const s = fakeServer();
    s.files.add("slow.jpg");
    let lateCommit!: () => void;
    const late = new Promise<void>((r) => (lateCommit = r));
    let calls = 0;
    const out = await commitVisitPhoto({
      add: async () => {
        calls++;
        // Le serveur traite encore la 1re requête ; la réponse est perdue, et la 2e aussi.
        void late.then(() => s.add("slow.jpg"));
        throw new TypeError("Failed to fetch");
      },
      isReferenced: async () => s.referenced("slow.jpg"), // absent à chaque lecture
      removeFile: async () => s.files.delete("slow.jpg"),
    });
    expect(out.status).toBe("uncertain");
    expect(calls).toBe(2);
    expect(s.files.has("slow.jpg")).toBe(true);
    lateCommit();
    await late;
    await Promise.resolve();
    expect(s.rows.size).toBe(1);
    expect(s.referenced("slow.jpg")).toBe(true);
    expect(s.files.has("slow.jpg")).toBe(true);
  });

  test("erreur serveur non marquée (ex. insertion impossible) : incertain, fichier conservé", async () => {
    let removed = false;
    const out = await commitVisitPhoto({
      add: async () => {
        throw new Error("Enregistrement de la photo impossible.");
      },
      isReferenced: async () => false,
      removeFile: async () => {
        removed = true;
      },
    });
    expect(out.status).toBe("uncertain");
    expect(removed).toBe(false);
  });

  // Régression : l'assertion d'accès de addVisitPhoto n'est plus entourée d'un
  // catch qui marquait TOUTE erreur en refus + suppression. Une panne DB/réseau
  // ou un changement d'état pendant l'assertion doit laisser le fichier intact.
  test("erreur de contrôle d'accès (panne DB/réseau) non marquée : pas de marqueur, pas de suppression", async () => {
    let removed = false;
    let attempts = 0;
    const err = new Error("Vérification de l'accès impossible. Réessayez.");
    expect(isDeterministicPhotoRefusal(err)).toBe(false);
    const out = await commitVisitPhoto({
      add: async () => {
        attempts++;
        throw err; // assertCanEditVisit échoue (DB/réseau/état), erreur brute propagée
      },
      isReferenced: async () => false, // la photo n'est évidemment pas enregistrée
      removeFile: async () => {
        removed = true; // ne doit JAMAIS être appelé sur ce type d'erreur
      },
    });
    expect(attempts).toBe(2);
    expect(out.status).toBe("uncertain");
    expect(removed).toBe(false);
  });

  test("marqueur de refus : reconnu et retiré du message affiché", () => {
    const e = photoRefusal("Photo trop lourde (10 Mo maximum).");
    expect(isDeterministicPhotoRefusal(e)).toBe(true);
    expect(isDeterministicPhotoRefusal(new TypeError("Failed to fetch"))).toBe(false);
    expect(photoErrorMessage(e)).toBe("Photo trop lourde (10 Mo maximum).");
  });
});

describe("autosave — modification de la même clé pendant un envoi lent", () => {
  test("la seconde valeur part automatiquement après le succès du premier envoi", async () => {
    const dirty = new Map<string, DirtyEntry>();
    const sent: unknown[][] = [];
    let release!: () => void;
    let first = true;
    const save = async (entries: { field_key: string; value: unknown }[]) => {
      sent.push(entries.map((e) => e.value));
      if (first) {
        first = false;
        await new Promise<void>((r) => (release = r));
      }
      return { fieldErrors: [] };
    };
    // Même contrat que la page terrain : true sur succès, false sur échec.
    const sendOnce = async () => {
      if (dirty.size === 0) return true;
      try {
        await sendDirtySnapshot(dirty, save);
        return true;
      } catch {
        return false;
      }
    };
    const q = createAutosaveQueue({ send: sendOnce, hasPending: () => dirty.size > 0 });
    dirty.set("puissance", { section_key: "s", value: 3 });
    const run = q.flush();
    await Promise.resolve();
    // Saisie pendant l'envoi lent, même clé, sans nouveau flush.
    dirty.set("puissance", { section_key: "s", value: 6 });
    release();
    expect(await run).toBe(true);
    expect(sent).toEqual([[3], [6]]);
    expect(dirty.size).toBe(0);
  });

  test("échec réel : drain interrompu, valeur conservée", async () => {
    const dirty = new Map<string, DirtyEntry>([["k", { section_key: "s", value: 1 }]]);
    let calls = 0;
    const q = createAutosaveQueue({
      send: async () => {
        calls++;
        try {
          await sendDirtySnapshot(dirty, async () => {
            throw new TypeError("offline");
          });
          return true;
        } catch {
          return false;
        }
      },
      hasPending: () => dirty.size > 0,
    });
    expect(await q.flush()).toBe(false);
    expect(calls).toBe(1);
    expect(dirty.get("k")?.value).toBe(1);
  });
});
