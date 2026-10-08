import { describe, expect, test } from "bun:test";
import { commitVisitPhoto } from "@/lib/visites/photo-commit";

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
        throw new Error("Ce fichier n'est pas une image JPEG, PNG ou WebP valide.");
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
