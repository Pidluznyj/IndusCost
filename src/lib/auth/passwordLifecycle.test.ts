/**
 * Núcleo do ciclo de senha — comportamento, não fiação.
 *
 * Roda contra um Prisma em memória com CAS real (ver passwordLifecycleFakeDb),
 * então prova de fato: hash trocado, flag virada, sessões revogadas, sessão
 * nova emitida, corrida resolvida com 409 e auditoria escrita na transação.
 *
 * Todas as senhas são fictícias.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  adminResetPassword,
  changeOwnPassword,
  completeForcedPasswordChange,
  PASSWORD_LIFECYCLE_ERRORS,
} from "./passwordLifecycle.server.js";
import {
  FakePrisma,
  fakeHash,
  makeSession,
  makeUser,
  type FakeUser,
} from "./passwordLifecycleFakeDb.js";
import { SECURITY_AUDIT_EVENTS } from "./securityAudit.server.js";

const SENHA_ATUAL = "senha atual valida";
const SENHA_NOVA = "senha nova bem grande";
const SENHA_CURTA = "curta1";

function deps(db: FakePrisma, extra: Record<string, unknown> = {}) {
  return {
    db: db as never,
    hashPassword: fakeHash.hashPassword,
    verifyPassword: fakeHash.verifyPassword,
    createSessionToken: () => "token-novo-em-claro",
    hashSessionToken: (t: string) => `sha256(${t})`,
    sessionTtlMs: 12 * 60 * 60 * 1000,
    ...extra,
  };
}

function setup(userOverrides: Partial<FakeUser> = {}, sessionCount = 2) {
  const user = makeUser(userOverrides);
  const sessions = Array.from({ length: sessionCount }, (_, i) =>
    makeSession({ id: `session-antiga-${i + 1}`, tokenHash: `hash-antigo-${i + 1}` })
  );
  return { db: new FakePrisma([user], sessions), user };
}

/* ================================================================== */
/* Troca voluntária                                                    */
/* ================================================================== */

describe("changeOwnPassword — troca voluntária", () => {
  it("exige a senha atual correta", async () => {
    const { db } = setup();
    const r = await changeOwnPassword(deps(db), {
      userId: "user-1",
      currentPassword: "senha atual errada",
      newPassword: SENHA_NOVA,
    });
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.code, PASSWORD_LIFECYCLE_ERRORS.INVALID_CURRENT_PASSWORD);
    // nada mudou
    assert.equal(db.userById("user-1")?.passwordHash, `fake:${SENHA_ATUAL}`);
    assert.equal(db.activeSessionsOf("user-1").length, 2);
  });

  it("usuário inativo não consegue trocar", async () => {
    const { db } = setup({ isActive: false });
    const r = await changeOwnPassword(deps(db), {
      userId: "user-1",
      currentPassword: SENHA_ATUAL,
      newPassword: SENHA_NOVA,
    });
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.code, PASSWORD_LIFECYCLE_ERRORS.USER_INACTIVE);
    assert.equal(r.ok === false && r.status, 403);
  });

  it("usuário inexistente devolve NOT_FOUND", async () => {
    const { db } = setup();
    const r = await changeOwnPassword(deps(db), {
      userId: "user-fantasma",
      currentPassword: SENHA_ATUAL,
      newPassword: SENHA_NOVA,
    });
    assert.equal(r.ok === false && r.code, PASSWORD_LIFECYCLE_ERRORS.NOT_FOUND);
  });

  it("nova senha fraca é rejeitada pela política central", async () => {
    const { db } = setup();
    const r = await changeOwnPassword(deps(db), {
      userId: "user-1",
      currentPassword: SENHA_ATUAL,
      newPassword: SENHA_CURTA,
    });
    assert.equal(r.ok === false && r.code, PASSWORD_LIFECYCLE_ERRORS.PASSWORD_POLICY_VIOLATION);
    assert.equal(r.ok === false && r.status, 422);
    assert.match(String(r.ok === false && r.reasons?.[0]), /no mínimo 12/);
  });

  it("repetir a senha atual é rejeitado", async () => {
    const { db } = setup();
    const r = await changeOwnPassword(deps(db), {
      userId: "user-1",
      currentPassword: SENHA_ATUAL,
      newPassword: SENHA_ATUAL,
    });
    assert.equal(r.ok === false && r.code, PASSWORD_LIFECYCLE_ERRORS.PASSWORD_REUSED);
  });

  it("sucesso: troca o hash, zera mustChangePassword e carimba passwordChangedAt", async () => {
    const { db } = setup({ mustChangePassword: true });
    const antes = db.userById("user-1")?.passwordHash;
    const r = await changeOwnPassword(deps(db), {
      userId: "user-1",
      currentPassword: SENHA_ATUAL,
      newPassword: SENHA_NOVA,
    });
    assert.equal(r.ok, true);

    const depois = db.userById("user-1");
    assert.notEqual(depois?.passwordHash, antes);
    assert.equal(depois?.passwordHash, `fake:${SENHA_NOVA}`);
    assert.equal(depois?.mustChangePassword, false);
    assert.ok(depois?.passwordChangedAt instanceof Date);
  });

  it("sucesso: revoga TODAS as sessões anteriores e emite exatamente UMA nova", async () => {
    const { db } = setup({}, 3);
    const r = await changeOwnPassword(deps(db), {
      userId: "user-1",
      currentPassword: SENHA_ATUAL,
      newPassword: SENHA_NOVA,
    });
    assert.equal(r.ok, true);
    assert.equal(r.ok === true && r.sessionsRevoked, 3);

    // as três antigas morreram
    for (const id of ["session-antiga-1", "session-antiga-2", "session-antiga-3"]) {
      const s = db.sessions.find((x) => x.id === id);
      assert.ok(s?.revokedAt instanceof Date, `${id} deveria estar revogada`);
    }
    // exatamente uma sessão viva, e é a nova
    const vivas = db.activeSessionsOf("user-1");
    assert.equal(vivas.length, 1);
    assert.equal(vivas[0].tokenHash, "sha256(token-novo-em-claro)");
  });

  it("a nova sessão herda o permissionsVersion do usuário (ACL intacta)", async () => {
    const { db } = setup({ permissionsVersion: 42 });
    await changeOwnPassword(deps(db), {
      userId: "user-1",
      currentPassword: SENHA_ATUAL,
      newPassword: SENHA_NOVA,
    });
    assert.equal(db.activeSessionsOf("user-1")[0].permissionsVersionAtIssue, 42);
  });

  it("o token em claro só existe na resposta; o banco guarda o hash", async () => {
    const { db } = setup();
    const r = await changeOwnPassword(deps(db), {
      userId: "user-1",
      currentPassword: SENHA_ATUAL,
      newPassword: SENHA_NOVA,
    });
    assert.equal(r.ok === true && r.session.token, "token-novo-em-claro");
    for (const s of db.sessions) {
      assert.notEqual(s.tokenHash, "token-novo-em-claro");
    }
  });

  it("nenhuma senha em claro é persistida em lugar nenhum", async () => {
    const { db } = setup();
    await changeOwnPassword(deps(db), {
      userId: "user-1",
      currentPassword: SENHA_ATUAL,
      newPassword: SENHA_NOVA,
    });
    const dump = JSON.stringify({ u: db.users, s: db.sessions, a: db.audits });
    assert.equal(dump.includes(`"${SENHA_NOVA}"`), false);
    assert.equal(dump.includes(SENHA_ATUAL), false);
  });

  it("audita PASSWORD_CHANGED com actor=target e sem nada sensível", async () => {
    const { db } = setup({}, 2);
    await changeOwnPassword(deps(db), {
      userId: "user-1",
      currentPassword: SENHA_ATUAL,
      newPassword: SENHA_NOVA,
      origin: { ipAddress: "127.0.0.1", userAgent: "teste/1.0" },
    });
    assert.equal(db.audits.length, 1);
    const log = db.audits[0];
    assert.equal(log.eventType, SECURITY_AUDIT_EVENTS.PASSWORD_CHANGED);
    assert.equal(log.actorUserId, "user-1");
    assert.equal(log.targetUserId, "user-1");
    assert.deepEqual(log.metadata, { source: "SELF_SERVICE", sessionsRevoked: 2 });
  });

  it("corrida: se a senha mudou entre a leitura e a escrita, dá 409 e não sobrescreve", async () => {
    const { db } = setup();
    // Outra requisição venceu logo antes do commit desta.
    db.onTransactionStart = () => {
      const u = db.userById("user-1");
      if (u) u.passwordHash = "fake:senha de outra requisicao";
      db.onTransactionStart = null;
    };
    const r = await changeOwnPassword(deps(db), {
      userId: "user-1",
      currentPassword: SENHA_ATUAL,
      newPassword: SENHA_NOVA,
    });
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.code, PASSWORD_LIFECYCLE_ERRORS.PASSWORD_STATE_CHANGED);
    assert.equal(r.ok === false && r.status, 409);
    // a senha da vencedora sobreviveu
    assert.equal(db.userById("user-1")?.passwordHash, "fake:senha de outra requisicao");
    // e nenhuma sessão foi revogada por engano
    assert.equal(db.activeSessionsOf("user-1").length, 2);
  });

  it("falha de auditoria desfaz a troca inteira (não é best effort)", async () => {
    const { db } = setup();
    const quebrada = deps(db);
    const original = db.securityAuditLog.create;
    void original;
    // Sabota o insert de auditoria dentro da transação.
    const dbQuebrado = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "$transaction") {
          return async (fn: (tx: Record<string, unknown>) => Promise<unknown>) =>
            target.$transaction(async (tx) => {
              const sabotado = {
                ...tx,
                securityAuditLog: {
                  create: async () => {
                    throw new Error("falha ao auditar");
                  },
                },
              };
              return fn(sabotado as never);
            });
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    await assert.rejects(
      changeOwnPassword({ ...quebrada, db: dbQuebrado as never }, {
        userId: "user-1",
        currentPassword: SENHA_ATUAL,
        newPassword: SENHA_NOVA,
      }),
      /falha ao auditar/
    );

    assert.equal(db.userById("user-1")?.passwordHash, `fake:${SENHA_ATUAL}`, "senha voltou");
    assert.equal(db.activeSessionsOf("user-1").length, 2, "sessões voltaram");
    assert.equal(db.audits.length, 0);
  });
});

/* ================================================================== */
/* Troca obrigatória                                                   */
/* ================================================================== */

describe("completeForcedPasswordChange — troca obrigatória", () => {
  it("só funciona quando há troca pendente", async () => {
    const { db } = setup({ mustChangePassword: false });
    const r = await completeForcedPasswordChange(deps(db), {
      userId: "user-1",
      newPassword: SENHA_NOVA,
    });
    assert.equal(r.ok === false && r.code, PASSWORD_LIFECYCLE_ERRORS.PASSWORD_CHANGE_NOT_REQUIRED);
    assert.equal(r.ok === false && r.status, 409);
  });

  it("NÃO pede a senha temporária de novo — a sessão já provou a posse", async () => {
    const { db } = setup({ mustChangePassword: true });
    const r = await completeForcedPasswordChange(deps(db), {
      userId: "user-1",
      newPassword: SENHA_NOVA,
    });
    assert.equal(r.ok, true);
    assert.equal(db.userById("user-1")?.mustChangePassword, false);
  });

  it("aplica a mesma política central", async () => {
    const { db } = setup({ mustChangePassword: true });
    const r = await completeForcedPasswordChange(deps(db), {
      userId: "user-1",
      newPassword: SENHA_CURTA,
    });
    assert.equal(r.ok === false && r.code, PASSWORD_LIFECYCLE_ERRORS.PASSWORD_POLICY_VIOLATION);
  });

  it("repetir a senha temporária é rejeitado", async () => {
    const { db } = setup({ mustChangePassword: true });
    const r = await completeForcedPasswordChange(deps(db), {
      userId: "user-1",
      newPassword: SENHA_ATUAL,
    });
    assert.equal(r.ok === false && r.code, PASSWORD_LIFECYCLE_ERRORS.PASSWORD_REUSED);
  });

  it("revoga tudo e emite a sessão nova", async () => {
    const { db } = setup({ mustChangePassword: true }, 2);
    const r = await completeForcedPasswordChange(deps(db), {
      userId: "user-1",
      newPassword: SENHA_NOVA,
    });
    assert.equal(r.ok === true && r.sessionsRevoked, 2);
    const vivas = db.activeSessionsOf("user-1");
    assert.equal(vivas.length, 1);
    assert.equal(vivas[0].tokenHash, "sha256(token-novo-em-claro)");
  });

  it("audita PASSWORD_FORCED_CHANGE_COMPLETED", async () => {
    const { db } = setup({ mustChangePassword: true }, 1);
    await completeForcedPasswordChange(deps(db), { userId: "user-1", newPassword: SENHA_NOVA });
    assert.equal(db.audits[0].eventType, SECURITY_AUDIT_EVENTS.PASSWORD_FORCED_CHANGE_COMPLETED);
    assert.deepEqual(db.audits[0].metadata, { source: "FORCED_CHANGE", sessionsRevoked: 1 });
  });

  it("duas trocas obrigatórias concorrentes: só uma vence, a outra recebe 409", async () => {
    const { db } = setup({ mustChangePassword: true });
    // A segunda requisição encontra o estado já consumido pela primeira.
    db.onTransactionStart = () => {
      const u = db.userById("user-1");
      if (u) {
        u.mustChangePassword = false;
        u.passwordHash = "fake:senha da requisicao vencedora";
      }
      db.onTransactionStart = null;
    };
    const r = await completeForcedPasswordChange(deps(db), {
      userId: "user-1",
      newPassword: SENHA_NOVA,
    });
    assert.equal(r.ok === false && r.code, PASSWORD_LIFECYCLE_ERRORS.PASSWORD_STATE_CHANGED);
    assert.equal(db.userById("user-1")?.passwordHash, "fake:senha da requisicao vencedora");
  });
});

/* ================================================================== */
/* Reset administrativo                                                */
/* ================================================================== */

describe("adminResetPassword — efeito do reset", () => {
  it("gera senha temporária pelo sistema e persiste só o hash", async () => {
    const { db } = setup();
    const r = await adminResetPassword(deps(db), {
      actorUserId: "super-1",
      targetUserId: "user-1",
    });
    assert.equal(r.ok, true);
    const temp = r.ok === true ? r.temporaryPassword : "";
    assert.ok(temp.length >= 12);
    assert.equal(db.userById("user-1")?.passwordHash, `fake:${temp}`);
    const dump = JSON.stringify({ u: db.users, s: db.sessions, a: db.audits });
    assert.equal(dump.includes(`"${temp}"`), false, "plaintext não pode ser persistido");
  });

  it("liga mustChangePassword e carimba passwordChangedAt", async () => {
    const { db } = setup();
    await adminResetPassword(deps(db), { actorUserId: "super-1", targetUserId: "user-1" });
    const u = db.userById("user-1");
    assert.equal(u?.mustChangePassword, true);
    assert.ok(u?.passwordChangedAt instanceof Date);
  });

  it("revoga todas as sessões do alvo e NÃO cria sessão nova", async () => {
    const { db } = setup({}, 3);
    const r = await adminResetPassword(deps(db), {
      actorUserId: "super-1",
      targetUserId: "user-1",
    });
    assert.equal(r.ok === true && r.sessionsRevoked, 3);
    assert.equal(db.activeSessionsOf("user-1").length, 0, "reset não emite sessão");
  });

  it("a senha anterior deixa de funcionar", async () => {
    const { db } = setup();
    const antes = db.userById("user-1")?.passwordHash;
    await adminResetPassword(deps(db), { actorUserId: "super-1", targetUserId: "user-1" });
    const depois = db.userById("user-1")?.passwordHash;
    assert.notEqual(depois, antes);
    assert.equal(await fakeHash.verifyPassword(SENHA_ATUAL, String(depois)), false);
  });

  it("a senha temporária devolvida é a que funciona", async () => {
    const { db } = setup();
    const r = await adminResetPassword(deps(db), {
      actorUserId: "super-1",
      targetUserId: "user-1",
    });
    const temp = r.ok === true ? r.temporaryPassword : "";
    const stored = String(db.userById("user-1")?.passwordHash);
    assert.equal(await fakeHash.verifyPassword(temp, stored), true);
  });

  it("audita com actor e target distintos, sem plaintext no metadata", async () => {
    const { db } = setup({}, 1);
    const r = await adminResetPassword(deps(db), {
      actorUserId: "super-1",
      targetUserId: "user-1",
      origin: { ipAddress: "10.0.0.9", userAgent: "navegador/2" },
    });
    const temp = r.ok === true ? r.temporaryPassword : "";
    const log = db.audits[0];
    assert.equal(log.eventType, SECURITY_AUDIT_EVENTS.PASSWORD_RESET_BY_SUPER_ADMIN);
    assert.equal(log.actorUserId, "super-1");
    assert.equal(log.targetUserId, "user-1");
    assert.equal(log.ipAddress, "10.0.0.9");
    assert.deepEqual(log.metadata, { source: "ADMIN_RESET", sessionsRevoked: 1 });
    assert.equal(JSON.stringify(log).includes(temp), false);
  });

  it("dois resets concorrentes: o perdedor recebe 409 em vez de anunciar senha morta", async () => {
    const { db } = setup();
    db.onTransactionStart = () => {
      const u = db.userById("user-1");
      if (u) u.passwordHash = "fake:temporaria do outro admin";
      db.onTransactionStart = null;
    };
    const r = await adminResetPassword(deps(db), {
      actorUserId: "super-2",
      targetUserId: "user-1",
    });
    assert.equal(r.ok === false && r.code, PASSWORD_LIFECYCLE_ERRORS.PASSWORD_STATE_CHANGED);
    assert.equal(db.userById("user-1")?.passwordHash, "fake:temporaria do outro admin");
  });

  it("alvo inexistente devolve NOT_FOUND", async () => {
    const { db } = setup();
    const r = await adminResetPassword(deps(db), {
      actorUserId: "super-1",
      targetUserId: "nao-existe",
    });
    assert.equal(r.ok === false && r.code, PASSWORD_LIFECYCLE_ERRORS.NOT_FOUND);
  });
});

/* ================================================================== */
/* Sem expiração periódica                                             */
/* ================================================================== */

describe("ausência de expiração periódica de senha", () => {
  let db: FakePrisma;
  beforeEach(() => {
    db = setup().db;
  });

  it("nenhuma operação grava campo de validade/rotação no usuário", async () => {
    await changeOwnPassword(deps(db), {
      userId: "user-1",
      currentPassword: SENHA_ATUAL,
      newPassword: SENHA_NOVA,
    });
    const u = db.userById("user-1") as unknown as Record<string, unknown>;
    for (const proibido of [
      "passwordExpiresAt",
      "passwordExpirationDays",
      "passwordValidUntil",
      "passwordMaxAge",
      "mustChangePasswordEveryXDays",
      "lastPasswordReminderAt",
      "passwordRotationInterval",
    ]) {
      assert.equal(proibido in u, false, `${proibido} não pode ser gravado`);
    }
  });
});
