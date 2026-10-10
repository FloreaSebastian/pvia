import { describe, expect, test } from "bun:test";
import {
  InviteError,
  EMAIL_PROOF_AMR,
  INVITE_PASSWORD_MIN,
  acceptInviteCore,
  hasEmailProof,
  enterpriseLoginEligibility,
  inviteReturnPath,
  inviteSignupCore,
  prepareInvite,
  type InviteRow,
  type PrepareInviteDeps,
} from "@/lib/invite-core";

const NOW = Date.parse("2026-10-10T12:00:00Z");
const FUTURE = new Date(NOW + 86400_000).toISOString();
const PAST = new Date(NOW - 1000).toISOString();
const TOKEN = "a".repeat(64);
const HASH = "h-" + TOKEN;

function invite(p: Partial<InviteRow> = {}): InviteRow {
  return {
    id: "inv1",
    company_id: "c1",
    role: "technicien",
    status: "invited",
    user_id: null,
    invited_email: "bob@ex.fr",
    invite_expires_at: FUTURE,
    invite_token_hash: HASH,
    ...p,
  };
}

/* ---------------- Envoi / renvoi ---------------- */
function prepDeps(over: Partial<PrepareInviteDeps> = {}, log: string[] = []) {
  const d: PrepareInviteDeps = {
    getCallerMembership: async () => ({ role: "directeur", status: "active" }),
    hasWriteAccess: async () => true,
    isExistingMemberEmail: async () => false,
    findPendingInvite: async () => null,
    assertCanAddSeat: async () => {
      log.push("seat");
    },
    assertNotRecentlySent: async () => {
      log.push("throttle");
    },
    newToken: async () => {
      log.push("token");
      return { token: "t2", hash: "h2" };
    },
    casRotateInvite: async (e, p) => {
      log.push("cas");
      return { ...e, invite_token_hash: p.token_hash };
    },
    insertInvite: async (r) => {
      log.push("insert");
      return invite({ id: "new", invite_token_hash: r.token_hash });
    },
    ...over,
  };
  return d;
}
const input = {
  userId: "u1",
  callerEmail: "boss@ex.fr",
  companyId: "c1",
  email: "Bob@Ex.fr ",
  role: "technicien" as const,
  now: NOW,
};

describe("invitation : envoi et renvoi", () => {
  test("refus avant tout effet : non admin, membre suspendu, écriture fermée", async () => {
    for (const over of [
      { getCallerMembership: async () => ({ role: "conducteur_travaux", status: "active" }) },
      { getCallerMembership: async () => ({ role: "directeur", status: "suspended" }) },
      { getCallerMembership: async () => null },
      { hasWriteAccess: async () => false },
    ] as Partial<PrepareInviteDeps>[]) {
      const log: string[] = [];
      await expect(prepareInvite(prepDeps(over, log), input)).rejects.toBeInstanceOf(InviteError);
      expect(log).toEqual([]);
    }
  });
  test("renvoi au quota plein : invitation active non expirée n'exige aucun siège", async () => {
    const log: string[] = [];
    const deps = prepDeps(
      {
        findPendingInvite: async () => invite(),
        assertCanAddSeat: async () => {
          throw new Error("quota plein");
        },
      },
      log,
    );
    const r = await prepareInvite(deps, input);
    expect(r.resent).toBe(true);
    expect(log).toEqual(["throttle", "token", "cas"]);
  });
  test("invitation expirée : le siège est revérifié", async () => {
    const deps = prepDeps({
      findPendingInvite: async () => invite({ invite_expires_at: PAST }),
      assertCanAddSeat: async () => {
        throw new Error("quota plein");
      },
    });
    await expect(prepareInvite(deps, input)).rejects.toThrow("quota plein");
  });
  test("anti-renvoi avant génération du jeton : le premier lien reste valide", async () => {
    const log: string[] = [];
    const deps = prepDeps(
      {
        findPendingInvite: async () => invite(),
        assertNotRecentlySent: async () => {
          throw new Error("déjà envoyé");
        },
      },
      log,
    );
    await expect(prepareInvite(deps, input)).rejects.toThrow("déjà envoyé");
    expect(log).not.toContain("token");
    expect(log).not.toContain("cas");
  });
  test("CAS perdu (renvoi concurrent) : aucune ligne → erreur, pas d'email", async () => {
    const deps = prepDeps({
      findPendingInvite: async () => invite(),
      casRotateInvite: async () => null,
    });
    await expect(prepareInvite(deps, input)).rejects.toMatchObject({ code: "conflict" });
  });
  test("email normalisé, rôle directeur refusé, auto-invitation refusée", async () => {
    let seen = "";
    await prepareInvite(
      prepDeps({ findPendingInvite: async (_c, e) => ((seen = e), null) }),
      input,
    );
    expect(seen).toBe("bob@ex.fr");
    await expect(
      prepareInvite(prepDeps(), { ...input, role: "directeur" as never }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      prepareInvite(prepDeps(), { ...input, email: "BOSS@ex.fr" }),
    ).rejects.toMatchObject({ code: "self" });
  });
});

/* ---------------- Acceptation ---------------- */
function acceptDeps(state: {
  row: InviteRow | null;
  membership?: { id: string; status: string } | null;
  verified?: boolean;
  authEmail?: string;
}) {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      findInviteByHash: async (h: string) =>
        state.row && state.row.invite_token_hash === h ? state.row : null,
      getAuthIdentity: async () => ({
        email: state.authEmail ?? "bob@ex.fr",
        verified: state.verified ?? true,
      }),
      findMembership: async () => state.membership ?? null,
      casActivate: async (i: InviteRow, h: string, uid: string) => {
        calls.push("activate");
        if (
          !state.row ||
          state.row.invite_token_hash !== h ||
          state.row.status !== "invited" ||
          state.row.user_id
        )
          return null;
        state.row = { ...state.row, status: "active", user_id: uid, invite_token_hash: null };
        return state.row;
      },
      casConsume: async (_i: InviteRow, h: string) => {
        calls.push("consume");
        return !!state.row && state.row.invite_token_hash === h;
      },
    },
  };
}

describe("invitation : acceptation", () => {
  test("bon destinataire vérifié : activation", async () => {
    const { deps, calls } = acceptDeps({ row: invite() });
    const r = await acceptInviteCore(deps, {
      userId: "u2",
      sessionEmail: "BOB@ex.fr",
      emailProof: true,
      tokenHash: HASH,
      now: NOW,
    });
    expect(r.alreadyMember).toBe(false);
    expect(calls).toEqual(["activate"]);
  });
  test("refus : email différent, expirée, utilisée, non vérifié, sans email de session", async () => {
    const cases: [Parameters<typeof acceptDeps>[0], string | null, string][] = [
      [{ row: invite(), authEmail: "eve@ex.fr" }, "eve@ex.fr", "wrong_recipient"],
      [{ row: invite({ invite_expires_at: PAST }) }, "bob@ex.fr", "expired"],
      [{ row: invite({ status: "active" }) }, "bob@ex.fr", "used"],
      [{ row: invite({ user_id: "x" }) }, "bob@ex.fr", "used"],
      [{ row: invite(), verified: false }, "bob@ex.fr", "unverified"],
      [{ row: invite() }, null, "unverified"],
      [{ row: invite(), authEmail: "autre@ex.fr" }, "bob@ex.fr", "unverified"],
    ];
    for (const [st, email, code] of cases) {
      const { deps, calls } = acceptDeps(st);
      await expect(
        acceptInviteCore(deps, { userId: "u2", sessionEmail: email, emailProof: true, tokenHash: HASH, now: NOW }),
      ).rejects.toMatchObject({ code });
      expect(calls).toEqual([]);
    }
  });
  test("jeton remplacé entre l'envoi et l'acceptation : ancien lien inutilisable", async () => {
    const st = { row: invite({ invite_token_hash: "nouveau" }) };
    const { deps, calls } = acceptDeps(st);
    await expect(
      acceptInviteCore(deps, {
        userId: "u2",
        sessionEmail: "bob@ex.fr",
        emailProof: true,
        tokenHash: HASH,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(calls).toEqual([]);
  });
  test("déjà membre actif : consomme seulement ce jeton ; suspendu : refus sans effet", async () => {
    const a = acceptDeps({ row: invite(), membership: { id: "m", status: "active" } });
    const r = await acceptInviteCore(a.deps, {
      userId: "u2",
      sessionEmail: "bob@ex.fr",
      emailProof: true,
      tokenHash: HASH,
      now: NOW,
    });
    expect(r.alreadyMember).toBe(true);
    expect(a.calls).toEqual(["consume"]);
    const b = acceptDeps({ row: invite(), membership: { id: "m", status: "suspended" } });
    await expect(
      acceptInviteCore(b.deps, {
        userId: "u2",
        sessionEmail: "bob@ex.fr",
        emailProof: true,
        tokenHash: HASH,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "suspended" });
    expect(b.calls).toEqual([]);
  });
  test("double acceptation : la seconde échoue (CAS)", async () => {
    const st = { row: invite() };
    const { deps } = acceptDeps(st);
    await acceptInviteCore(deps, {
      userId: "u2",
      sessionEmail: "bob@ex.fr",
      emailProof: true,
      tokenHash: HASH,
      now: NOW,
    });
    await expect(
      acceptInviteCore(deps, {
        userId: "u2",
        sessionEmail: "bob@ex.fr",
        emailProof: true,
        tokenHash: HASH,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(InviteError);
  });
});

/* ---------------- Code de connexion professionnel ---------------- */
function eligDeps(o: { user?: boolean; member?: string | null; row?: InviteRow | null }) {
  return {
    findUserByEmail: async () => (o.user === false ? null : { id: "u2" }),
    findActiveMembershipCompany: async () => o.member ?? null,
    findInviteByHash: async (h: string) => (o.row && o.row.invite_token_hash === h ? o.row : null),
    hashToken: async (t: string) => "h-" + t,
  };
}

describe("code de connexion avec invitation", () => {
  test("membre actif : connexion normale inchangée", async () => {
    const r = await enterpriseLoginEligibility(eligDeps({ member: "c9" }), {
      email: "bob@ex.fr",
      now: NOW,
    });
    expect(r).toMatchObject({ ok: true, via: "member", companyId: "c9" });
  });
  test("compte sans adhésion : refusé sans jeton, accepté avec jeton valide destiné à cet email", async () => {
    expect(
      (
        await enterpriseLoginEligibility(eligDeps({ row: invite() }), {
          email: "bob@ex.fr",
          now: NOW,
        })
      ).ok,
    ).toBe(false);
    const r = await enterpriseLoginEligibility(eligDeps({ row: invite() }), {
      email: "bob@ex.fr",
      inviteToken: TOKEN,
      now: NOW,
    });
    expect(r).toMatchObject({ ok: true, via: "invite", companyId: "c1" });
  });
  test("jeton valide mais email différent / expirée / utilisée / suspendue / inconnu : refus", async () => {
    const cases: [InviteRow | null, string, string][] = [
      [invite(), "eve@ex.fr", "wrong_recipient"],
      [invite({ invite_expires_at: PAST }), "bob@ex.fr", "expired"],
      [invite({ status: "active" }), "bob@ex.fr", "used"],
      [invite({ status: "suspended" }), "bob@ex.fr", "used"],
      [null, "bob@ex.fr", "not_found"],
    ];
    for (const [row, email, reason] of cases) {
      const r = await enterpriseLoginEligibility(eligDeps({ row }), {
        email,
        inviteToken: TOKEN,
        now: NOW,
      });
      expect(r).toMatchObject({ ok: false, reason });
    }
    const unknown = await enterpriseLoginEligibility(eligDeps({ user: false, row: invite() }), {
      email: "bob@ex.fr",
      inviteToken: TOKEN,
      now: NOW,
    });
    expect(unknown).toMatchObject({ ok: false, reason: "unknown_enterprise_email" });
  });
  test("retour après vérification : uniquement /invite/<jeton>", () => {
    expect(inviteReturnPath(TOKEN)).toBe(`/invite/${TOKEN}`);
    for (const bad of ["https://evil.fr", "../dashboard", "//evil", TOKEN + "x", "", null])
      expect(inviteReturnPath(bad as string)).toBeNull();
  });
});

describe("inscription bornée à l'invitation", () => {
  const deps = (row: InviteRow | null, seen: { email?: string; redirect?: string }) => ({
    findInviteByHash: async (h: string) => (row && row.invite_token_hash === h ? row : null),
    hashToken: async (t: string) => "h-" + t,
    appUrl: () => "https://pvia.fr",
    signUp: async (a: { email: string; redirectTo: string }) => {
      seen.email = a.email;
      seen.redirect = a.redirectTo;
      return { error: null };
    },
  });
  test("email dérivé du serveur et redirection fixe", async () => {
    const seen: { email?: string; redirect?: string } = {};
    await inviteSignupCore(deps(invite({ invited_email: " Bob@Ex.fr" }), seen), {
      token: TOKEN,
      password: "123456789012",
      fullName: "Bob",
      now: NOW,
    });
    expect(seen).toEqual({ email: "bob@ex.fr", redirect: `https://pvia.fr/invite/${TOKEN}` });
  });
  test("mot de passe court, invitation expirée ou utilisée : aucun compte créé", async () => {
    for (const [row, pwd] of [
      [invite(), "12345678901"],
      [invite({ invite_expires_at: PAST }), "123456789012"],
      [invite({ status: "active" }), "123456789012"],
    ] as const) {
      const seen: { email?: string } = {};
      await expect(
        inviteSignupCore(deps(row, seen), {
          token: TOKEN,
          password: pwd,
          fullName: "Bob",
          now: NOW,
        }),
      ).rejects.toBeInstanceOf(InviteError);
      expect(seen.email).toBeUndefined();
    }
  });
});

/* ---------------- Preuve email (claims vérifiés) ---------------- */
describe("preuve de possession de l'email", () => {
  const claims = (amr: unknown, extra: Record<string, unknown> = {}) => ({
    sub: "u2",
    email: "bob@ex.fr",
    amr,
    ...extra,
  });
  test("flux pro existant (verifyOtp token_hash) = amr otp ; magiclink accepté", () => {
    expect([...EMAIL_PROOF_AMR]).toEqual(["otp", "magiclink"]);
    expect(hasEmailProof(claims([{ method: "otp", timestamp: 1 }]))).toBe(true);
    expect(hasEmailProof(claims([{ method: "magiclink", timestamp: 1 }]))).toBe(true);
    expect(hasEmailProof(claims(["otp"]))).toBe(true);
  });
  test("mot de passe, inscription, oauth, anonyme, sans amr/email : refus", () => {
    for (const c of [
      claims([{ method: "password", timestamp: 1 }]),
      claims([{ method: "email/signup", timestamp: 1 }]),
      claims([{ method: "oauth", timestamp: 1 }]),
      claims([{ method: "token_refresh", timestamp: 1 }]),
      claims([{ method: "otp" }], { is_anonymous: true }),
      claims([{ method: "otp" }], { email: "" }),
      claims(undefined),
      claims("otp"),
      // email_confirmed_at / user_metadata ne comptent jamais
      claims([{ method: "password" }], {
        email_confirmed_at: "2026-01-01",
        user_metadata: { amr: "otp", email_verified: true },
      }),
      null,
    ])
      expect(hasEmailProof(c)).toBe(false);
  });
  test("acceptation sans preuve : refus AVANT toute lecture/mutation, même email confirmé", async () => {
    const reads: string[] = [];
    const { deps, calls } = acceptDeps({ row: invite(), verified: true });
    const spy = {
      ...deps,
      findInviteByHash: async (h: string) => {
        reads.push("invite");
        return deps.findInviteByHash(h);
      },
      getAuthIdentity: async (u: string) => {
        reads.push("identity");
        return deps.getAuthIdentity(u);
      },
    };
    await expect(
      acceptInviteCore(spy, {
        userId: "u2",
        sessionEmail: "bob@ex.fr",
        emailProof: hasEmailProof(claims([{ method: "password" }])),
        tokenHash: HASH,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "email_proof_required" });
    expect(reads).toEqual([]);
    expect(calls).toEqual([]);
  });
  test("mot de passe invitation : 12 caractères comme l'inscription pro", () => {
    expect(INVITE_PASSWORD_MIN).toBe(12);
  });
});

/* ---------------- Renouvellement d'invitations expirées ---------------- */
describe("renouvellement expiré : quota vérifié", () => {
  test("deux invitations expirées, un seul siège : une seule renouvelée", async () => {
    let seatsLeft = 1;
    const results: string[] = [];
    for (const email of ["a@ex.fr", "b@ex.fr"]) {
      const existing = invite({ id: email, invited_email: email, invite_expires_at: PAST });
      const log: string[] = [];
      const deps = prepDeps(
        {
          findPendingInvite: async () => existing,
          assertCanAddSeat: async () => {
            log.push("seat");
            if (seatsLeft <= 0) throw new InviteError("forbidden", "Nombre maximal atteint");
          },
          casRotateInvite: async (e, p) => {
            log.push("cas");
            seatsLeft -= 1;
            return { ...e, invite_token_hash: p.token_hash, invite_expires_at: p.expires_at };
          },
        },
        log,
      );
      try {
        await prepareInvite(deps, {
          userId: "u1",
          callerEmail: "dir@ex.fr",
          companyId: "c1",
          email,
          role: "technicien",
          now: NOW,
        });
        results.push("ok");
      } catch (e) {
        results.push((e as InviteError).code);
        expect(log).not.toContain("cas");
      }
    }
    expect(results).toEqual(["ok", "forbidden"]);
  });
  test("le CAS de renouvellement réécrit status pour déclencher le trigger quota", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/lib/invites.functions.ts", "utf8");
    const cas = src.slice(src.indexOf("casRotateInvite: async"), src.indexOf("insertInvite: async"));
    expect(cas).toContain('status: "invited"');
    expect(cas).toContain('.eq("status", "invited")');
    expect(cas).toContain('.is("user_id", null)');
    expect(cas).toContain("invite_token_hash");
    expect(cas).toMatch(/SEAT_QUOTA[\s\S]*Nombre maximal d'utilisateurs/);
  });
});
