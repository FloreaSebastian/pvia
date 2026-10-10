import { describe, expect, test } from "bun:test";
import { createCompanyController, effectiveRole, type CompanyCtxState, type CompanyMembership } from "@/lib/company-context";
import { createAutosaveCore } from "@/lib/autosave-core";
import { canRunAction, createRoleEdit, groupMembers, memberRights, type TeamMember } from "@/lib/team-view";

const mem = (company_id: string, role: string = "directeur"): CompanyMembership =>
  ({ id: "m-" + company_id, company_id, role, status: "active", company: { id: company_id, name: company_id, logo_url: null, icon_url: null } }) as CompanyMembership;

function deferred<T>() {
  let resolve!: (v: T) => void;
  const p = new Promise<T>((r) => (resolve = r));
  return { p, resolve };
}

function setup(stored: string | null = null) {
  const pending = new Map<string, ReturnType<typeof deferred<{ data: CompanyMembership[] | null; error: unknown }>>[]>();
  const stores: string[] = [];
  let last: CompanyCtxState | null = null;
  const ctrl = createCompanyController(
    {
      fetchMemberships: (uid) => {
        const d = deferred<{ data: CompanyMembership[] | null; error: unknown }>();
        pending.set(uid, [...(pending.get(uid) ?? []), d]);
        return d.p;
      },
      readStored: () => stored,
      store: (id) => stores.push(id),
    },
    (s) => (last = s),
  );
  return { ctrl, pending, stores, state: () => last! };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("contexte entreprise", () => {
  test("réponse tardive de l'utilisateur A ignorée après passage à B", async () => {
    const t = setup();
    t.ctrl.setUser("A");
    t.ctrl.setUser("B");
    expect(t.state().userId).toBe("B");
    expect(effectiveRole(t.state())).toBeNull();
    t.pending.get("B")![0].resolve({ data: [mem("cB", "technicien")], error: null });
    await tick();
    t.pending.get("A")![0].resolve({ data: [mem("cA", "directeur")], error: null });
    await tick();
    expect(t.state().activeCompanyId).toBe("cB");
    expect(effectiveRole(t.state())).toBe("technicien");
  });
  test("déconnexion : données et rôle fermés immédiatement", async () => {
    const t = setup();
    t.ctrl.setUser("A");
    t.pending.get("A")![0].resolve({ data: [mem("cA")], error: null });
    await tick();
    expect(effectiveRole(t.state())).toBe("directeur");
    t.ctrl.setUser(null);
    expect(t.state()).toMatchObject({ userId: null, memberships: [], activeCompanyId: null });
    expect(effectiveRole(t.state())).toBeNull();
  });
  test("erreur de lecture : accès non confirmé, aucun rôle", async () => {
    const t = setup("cA");
    t.ctrl.setUser("A");
    t.pending.get("A")![0].resolve({ data: null, error: new Error("réseau") });
    await tick();
    expect(t.state().status).toBe("error");
    expect(t.state().activeCompanyId).toBeNull();
    expect(effectiveRole(t.state())).toBeNull();
  });
  test("liste vide : aucune entreprise active malgré une préférence stockée", async () => {
    const t = setup("cA");
    t.ctrl.setUser("A");
    t.pending.get("A")![0].resolve({ data: [], error: null });
    await tick();
    expect(t.state()).toMatchObject({ status: "ready", activeCompanyId: null });
    expect(t.stores).toEqual([]);
  });
  test("préférence stockée seulement si membre actif ; choix limité aux adhésions", async () => {
    const t = setup("inconnue");
    t.ctrl.setUser("A");
    t.pending.get("A")![0].resolve({ data: [mem("c1"), mem("c2", "lecture_seule")], error: null });
    await tick();
    expect(t.state().activeCompanyId).toBe("c1");
    expect(t.ctrl.select("c-ailleurs")).toBe(false);
    expect(t.ctrl.select("c2")).toBe(true);
    expect(effectiveRole(t.state())).toBe("lecture_seule");
    expect(t.stores).toEqual(["c1", "c2"]);
  });
  test("entreprise A→B : relectures hors ordre, la plus récente gagne ; révocation ferme le rôle", async () => {
    const t = setup();
    t.ctrl.setUser("A");
    t.pending.get("A")![0].resolve({ data: [mem("c1"), mem("c2")], error: null });
    await tick();
    t.ctrl.select("c2");
    void t.ctrl.refresh(true); // relecture 1 (lente)
    void t.ctrl.refresh(true); // relecture 2
    t.pending.get("A")![2].resolve({ data: [mem("c1")], error: null }); // c2 révoquée
    await tick();
    t.pending.get("A")![1].resolve({ data: [mem("c1"), mem("c2")], error: null }); // ancienne réponse
    await tick();
    expect(t.state().activeCompanyId).toBe("c1");
    expect(t.state().memberships.map((m) => m.company_id)).toEqual(["c1"]);
  });
  test("rôle inconnu renvoyé par la base : ignoré", async () => {
    const t = setup();
    t.ctrl.setUser("A");
    t.pending.get("A")![0].resolve({ data: [mem("c1", "super_admin")], error: null });
    await tick();
    expect(t.state().activeCompanyId).toBeNull();
    expect(effectiveRole(t.state())).toBeNull();
  });
});

describe("autosave borné à la portée", () => {
  test("saisie en A puis passage à B : A n'est jamais enregistré dans B", async () => {
    const saved: [string, string][] = [];
    const core = createAutosaveCore<string>({ save: async (s, v) => void saved.push([s, v]), onStatus: () => {} });
    core.open("A", "a0");
    core.update("A", "a1");
    core.open("B", "b0");
    expect(core.update("A", "a1")).toBe(false); // valeur de A refusée dans B
    expect(await core.flush()).toBe(true);
    expect(saved).toEqual([]);
    core.update("B", "b1");
    await core.flush();
    expect(saved).toEqual([["B", "b1"]]);
  });
  test("réponse tardive de A après passage à B : ignorée", async () => {
    const d = deferred<void>();
    const statuses: string[] = [];
    const core = createAutosaveCore<string>({ save: () => d.p, onStatus: (s) => statuses.push(s) });
    core.open("A", "a0");
    core.update("A", "a1");
    const res = core.flush();
    core.open("B", "b0");
    d.resolve();
    expect(await res).toBe(false);
    expect(core.status).toBe("idle");
    expect(core.isDirty()).toBe(false);
  });
  test("erreur : flush renvoie false (pas de faux succès)", async () => {
    const core = createAutosaveCore<string>({ save: async () => { throw new Error("x"); }, onStatus: () => {} });
    core.open("A", "a0");
    core.update("A", "a1");
    expect(await core.flush()).toBe(false);
    expect(core.status).toBe("error");
    expect(core.isDirty()).toBe(true);
  });
  test("portée fermée (non chargée) : aucune saisie ni enregistrement", async () => {
    let n = 0;
    const core = createAutosaveCore<string>({ save: async () => void n++, onStatus: () => {} });
    core.open(null);
    expect(core.update(null, "x")).toBe(false);
    expect(await core.flush()).toBe(false);
    expect(n).toBe(0);
  });
});

const m = (p: Partial<TeamMember>): TeamMember => ({
  id: "x",
  user_id: "u-x",
  role: "technicien",
  status: "active",
  invited_email: null,
  invite_expires_at: null,
  created_at: "2026-01-01",
  profile: { full_name: "X" },
  ...p,
});

describe("équipe : actions et rôles", () => {
  const ctx = { currentUserId: "me", actorRole: "responsable_exploitation", writeOpen: true };
  test("le rôle n'est modifié qu'au clic Enregistrer, une seule fois", async () => {
    const calls: string[] = [];
    const edit = createRoleEdit(m({ id: "t1" }), async (_id, r) => (calls.push(r), true));
    expect(edit.choose("assistant_admin")).toBe(true);
    expect(calls).toEqual([]);
    const [a, b] = await Promise.all([edit.save(), edit.save()]);
    expect([a, b].sort()).toEqual(["busy", "saved"]);
    expect(calls).toEqual(["assistant_admin"]);
  });
  test("annuler ou rôle inchangé : aucune mutation ; directeur/rôle inconnu non sélectionnables", async () => {
    const calls: string[] = [];
    const edit = createRoleEdit(m({}), async (_id, r) => (calls.push(r), true));
    expect(edit.choose("directeur")).toBe(false);
    expect(edit.choose("super_admin")).toBe(false);
    expect(await edit.save()).toBe("unchanged");
    edit.choose("lecture_seule");
    edit.cancel();
    expect(await edit.save()).toBe("busy");
    expect(calls).toEqual([]);
  });
  test("actions inconnues refusées ; soi-même et directeur protégés ; écriture fermée = rien", () => {
    expect(canRunAction("delete_company", m({}), ctx)).toBe(false);
    expect(canRunAction("suspend", m({ user_id: "me" }), ctx)).toBe(false);
    expect(canRunAction("role", m({ role: "directeur" }), ctx)).toBe(false);
    expect(canRunAction("remove", m({}), ctx)).toBe(false); // retrait réservé au Directeur
    expect(canRunAction("remove", m({}), { ...ctx, actorRole: "directeur" })).toBe(true);
    expect(canRunAction("suspend", m({}), ctx)).toBe(true);
    expect(canRunAction("suspend", m({}), { ...ctx, writeOpen: false })).toBe(false);
    expect(canRunAction("resend", m({ user_id: null, status: "invited" }), { ...ctx, actorRole: "conducteur_travaux" })).toBe(false);
    expect(memberRights(m({}), { ...ctx, actorRole: null }).canToggle).toBe(false);
  });
  test("regroupement et recherche : actifs/invitations/suspendus, sans résultat ≠ équipe vide", () => {
    const list = [
      m({ id: "1", profile: { full_name: "Élodie Martin" } }),
      m({ id: "2", user_id: null, status: "invited", invited_email: "paul@ex.fr", profile: null }),
      m({ id: "3", status: "suspended", profile: { full_name: "Zoé" } }),
    ];
    const g = groupMembers(list, "elodie");
    expect(g.active.map((x) => x.id)).toEqual(["1"]);
    expect(g.counts).toEqual({ active: 1, invited: 1, suspended: 1 });
    expect(groupMembers(list, "introuvable").noResult).toBe(true);
    expect(groupMembers([], "x").noResult).toBe(false);
  });
});
