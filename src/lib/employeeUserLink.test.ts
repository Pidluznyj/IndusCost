import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  accessStateBadgeClass,
  accessStateMessage,
  mapToAccessState,
} from "./employeeUserLink.ts";
import {
  getEmployeeUserLinkStatus,
  linkEmployeeToAppUser,
  unlinkEmployeeFromAppUser,
} from "./employeeUserLink.server.ts";

describe("employeeUserLink — estados", () => {
  it("mapeia linked / inativo / mismatch / match / conflito", () => {
    assert.equal(mapToAccessState({ linkStatus: "linked", linkedIsActive: true }), "linked");
    assert.equal(
      mapToAccessState({ linkStatus: "linked", linkedIsActive: false }),
      "linked_inactive"
    );
    assert.equal(
      mapToAccessState({ linkStatus: "linked", linkedIsActive: true, emailMismatch: true }),
      "email_mismatch"
    );
    assert.equal(mapToAccessState({ linkStatus: "available_match" }), "available_match");
    assert.equal(mapToAccessState({ linkStatus: "conflict" }), "conflict");
    assert.equal(mapToAccessState({ linkStatus: "none" }), "none");
  });

  it("mensagens e badge", () => {
    assert.equal(accessStateMessage("none"), "Sem usuário de acesso");
    assert.equal(accessStateMessage("available_match"), "Usuário disponível para vínculo");
    assert.ok(accessStateBadgeClass("linked").includes("emerald"));
    assert.ok(accessStateBadgeClass("conflict").includes("amber"));
    assert.equal(accessStateMessage("match_blocked"), "Usuário encontrado — vínculo bloqueado");
    assert.ok(accessStateBadgeClass("match_blocked").includes("amber"), "bloqueado não usa o azul de 'disponível'");
  });
});

describe("employeeUserLink.server — status e vínculo (mock)", () => {
  it("status available_match quando AppUser livre e da mesma Pessoa canônica", async () => {
    const prismaFor = (accountPersonId: string | null, personStatus = "ACTIVE") =>
      ({
        person: { findUnique: async () => ({ status: personStatus }) },
        employee: { findUnique: async () => ({ id: "e1", corporateEmail: "a@b.com", personId: "p1", appUser: null }) },
        appUser: { findFirst: async () => ({ id: "u1", email: "a@b.com", employeeId: null, isActive: true, personId: accountPersonId }) },
      }) as never;
    const dto = await getEmployeeUserLinkStatus(prismaFor("p1"), "e1", { viewerUserId: "rh" });
    assert.equal(dto.status, "available_match");
    assert.equal(dto.canLink, true);
    assert.equal(dto.canUnlink, false);
    assert.equal(dto.linkBlockedReason, null);
    assert.equal("personId" in (dto.matchedUser ?? {}), false, "não expõe ids internos da conta");
    // Só e-mail igual: não vincula por aqui (Pessoas 360°).
    const emailOnly = await getEmployeeUserLinkStatus(prismaFor(null), "e1", { viewerUserId: "rh" });
    assert.equal(emailOnly.canLink, false);
    assert.match(emailOnly.linkBlockedReason ?? "", /Pessoas 360°/);
    assert.equal(emailOnly.status, "match_blocked", "o selo 'disponível para vínculo' não aparece quando o vínculo está bloqueado");
    assert.equal(emailOnly.message, "Usuário encontrado — vínculo bloqueado");
    // A própria conta: nem o botão aparece.
    const own = await getEmployeeUserLinkStatus(prismaFor("p1"), "e1", { viewerUserId: "u1" });
    assert.equal(own.canLink, false);
    assert.match(own.linkBlockedReason ?? "", /própria conta/);
    assert.equal(own.status, "match_blocked");
    // Pessoa compartilhada não ATIVA: o servidor recusaria, então o cartão já mostra o bloqueio com o motivo real.
    const review = await getEmployeeUserLinkStatus(prismaFor("p1", "NEEDS_REVIEW"), "e1", { viewerUserId: "rh" });
    assert.deepEqual([review.canLink, review.status], [false, "match_blocked"]);
    assert.match(review.linkBlockedReason ?? "", /em revisão/);
    const inactive = await getEmployeeUserLinkStatus(prismaFor("p1", "INACTIVE"), "e1", { viewerUserId: "rh" });
    assert.match(inactive.linkBlockedReason ?? "", /inativa ou unificada/);
  });

  it("conflito quando AppUser já tem outro employee", async () => {
    const prisma = {
      employee: {
        findUnique: async () => ({
          id: "e1",
          corporateEmail: "a@b.com",
          appUser: null,
        }),
      },
      appUser: {
        findFirst: async () => ({
          id: "u1",
          email: "a@b.com",
          employeeId: "other",
          isActive: true,
        }),
      },
    } as never;
    const dto = await getEmployeeUserLinkStatus(prisma, "e1");
    assert.equal(dto.status, "conflict");
    assert.equal(dto.canLink, false);
  });

  it("linked_inactive e email_mismatch", async () => {
    const prisma = {
      employee: {
        findUnique: async () => ({
          id: "e1",
          corporateEmail: "corp@x.com",
          appUser: {
            id: "u1",
            email: "login@x.com",
            isActive: false,
            role: "USER",
            name: "Ana",
          },
        }),
      },
      appUser: { findFirst: async () => null },
    } as never;
    const dto = await getEmployeeUserLinkStatus(prisma, "e1");
    assert.equal(dto.status, "email_mismatch");
    assert.equal(dto.canUnlink, true);
    assert.equal(dto.emailMismatch, true);
  });

  it("link bloqueia vínculo duplo do colaborador", async () => {
    const prisma = {
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          employee: {
            findUnique: async () => ({
              id: "e1",
              corporateEmail: "a@b.com",
              personId: null,
              appUser: { id: "u0" },
            }),
          },
          appUser: { findFirst: async () => null, update: async () => null },
        }),
    } as never;
    await assert.rejects(
      () => linkEmployeeToAppUser(prisma, "e1"),
      (e: unknown) =>
        e instanceof Error && (e as { code?: string }).code === "EMPLOYEE_ALREADY_HAS_USER"
    );
  });

  it("link bloqueia AppUser já de outro colaborador", async () => {
    const prisma = {
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          employee: {
            findUnique: async () => ({
              id: "e1",
              corporateEmail: "a@b.com",
              personId: null,
              appUser: null,
            }),
          },
          appUser: {
            findFirst: async () => ({
              id: "u1",
              employeeId: "other",
              personId: null,
              email: "a@b.com",
            }),
            update: async () => null,
          },
        }),
    } as never;
    await assert.rejects(
      () => linkEmployeeToAppUser(prisma, "e1", { actorUserId: "rh", actor: { id: "rh", role: "VIEWER", elevated: false } }),
      (e: unknown) =>
        e instanceof Error && (e as { code?: string }).code === "APPUSER_ALREADY_LINKED"
    );
  });

  it("unlink limpa employeeId sem desativar", async () => {
    let updatedData: unknown = null;
    const prisma = {
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          employee: {
            findUnique: async () => ({
              id: "e1",
              appUser: { id: "u1", email: "a@b.com", role: "SUPER_ADMIN", employeeId: "e1" },
            }),
          },
          appUser: {
            updateMany: async ({ data }: { data: unknown }) => {
              updatedData = data;
              return { count: 1 };
            },
          },
          securityAuditLog: { create: async () => ({}) },
        }),
    } as never;
    // Conta SUPER_ADMIN: desvincular exige SUPER_ADMIN com step-up (guarda E2 por identidade).
    const r = await unlinkEmployeeFromAppUser(prisma, "e1", { actorUserId: "actor", actor: { id: "actor", role: "SUPER_ADMIN", elevated: true } });
    assert.equal(r.ok, true);
    assert.equal(r.appUserId, "u1");
    assert.deepEqual(updatedData, { employeeId: null });
  });

  it("rotas de autorização documentadas no arquivo de routes", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/lib/employeeLookupRoutes.ts", "utf8");
    assert.match(src, /getEmployeeUserLinkStatus\(prisma, id, \{ viewerUserId: await resolveActorId\(req\) \}\)/, "status sabe quem está vendo");
    assert.match(src, /linkEmployeeToAppUser\(prisma, id, \{\s*actorUserId,\s*actor: guards\.resolveActor\?\.\(req\),/);
    assert.match(src, /unlinkEmployeeFromAppUser\(prisma, id, \{\s*actorUserId,\s*actor: guards\.resolveActor\?\.\(req\),/);
  });

  it("rotas de autorização documentadas no arquivo de routes (contrato)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(process.cwd(), "src/lib/employeeLookupRoutes.ts"), "utf8");
    assert.ok(src.includes('"/api/employees/:id/user-link-status"'));
    assert.ok(src.includes('"/api/employees/lookups/app-user-by-email"'));
    assert.ok(src.includes('"/api/employees/:id/link-user"'));
    assert.ok(src.includes('"/api/employees/:id/unlink-user"'));
    assert.ok(src.includes("EMPLOYEES_RESOURCE_KEYS.userLink"));
    assert.ok(src.includes("EMPLOYEES_ACTIONS.manage"));
  });
});

describe("employeeUserLink.server — autovinculação e identidade (mock de transação)", () => {
  const P = "p-hugo";
  type Audit = { eventType: string; actorUserId: string | null; targetUserId: string | null };
  type State = { account: { id: string; email: string; role: string; employeeId: string | null; personId: string | null }; writes: unknown[]; audits: Audit[] };
  const db = (state: State, opts: { employeePersonId?: string | null; personStatus?: string; raceCount?: number } = {}) => ({
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        $executeRaw: async () => 0,
        employee: { findUnique: async () => ({ id: "e-hugo", corporateEmail: state.account.email, personId: opts.employeePersonId === undefined ? P : opts.employeePersonId, appUser: null }) },
        person: { findUnique: async () => ({ status: opts.personStatus ?? "ACTIVE" }) },
        appUser: {
          findFirst: async () => ({ ...state.account }),
          updateMany: async (args: { where: unknown; data: unknown }) => {
            if (opts.raceCount === 0) return { count: 0 };
            state.writes.push(args);
            return { count: 1 };
          },
          findUnique: async () => ({ id: state.account.id, email: state.account.email, isActive: true, role: state.account.role, name: "x" }),
        },
        securityAuditLog: {
          create: async ({ data }: { data: Audit }) => {
            state.audits.push(data);
            return {};
          },
        },
      }),
  });
  const fresh = (account: Partial<State["account"]> = {}): State => ({
    account: { id: "u-op", email: "op@empresa.com", role: "VIEWER", employeeId: null, personId: P, ...account },
    writes: [],
    audits: [],
  });
  const codeOf = async (p: Promise<unknown>) => p.then(() => "OK", (e: { code?: string }) => e.code ?? "ERR");
  const fresh_state = () => fresh({ id: "u-hugo" });

  it("escalonamento: operador troca o e-mail corporativo do líder pelo próprio login e vincula → recusado para comum, RH e ADMIN (mesmo com Pessoa forjada)", async () => {
    for (const actor of [
      { id: "u-op", role: "VIEWER", elevated: false },
      { id: "u-op", role: "VIEWER", elevated: true },
      { id: "u-op", role: "ADMIN", elevated: true },
    ]) {
      const s = fresh();
      assert.equal(await codeOf(linkEmployeeToAppUser(db(s) as never, "e-hugo", { actorUserId: "u-op", actor })), "SELF_LINK_FORBIDDEN", actor.role);
      assert.equal(s.writes.length + s.audits.length, 0, "nada gravado");
    }
    // Ator da guarda divergente da sessão: a sessão também conta como "própria conta".
    assert.equal(await codeOf(linkEmployeeToAppUser(db(fresh()) as never, "e-hugo", { actorUserId: "u-op", actor: { id: "outro", role: "ADMIN", elevated: false } })), "SELF_LINK_FORBIDDEN");
    // Sem ator identificado: fail-closed.
    assert.equal(await codeOf(linkEmployeeToAppUser(db(fresh()) as never, "e-hugo")), "ACTOR_REQUIRED");
  });

  it("SUPER_ADMIN: a própria conta exige step-up; elevado, regulariza a si mesmo com auditoria", async () => {
    const plain = fresh({ id: "u-sa", role: "SUPER_ADMIN" });
    assert.equal(await codeOf(linkEmployeeToAppUser(db(plain) as never, "e-hugo", { actorUserId: "u-sa", actor: { id: "u-sa", role: "SUPER_ADMIN", elevated: false } })), "ADMIN_ELEVATION_REQUIRED");
    const elevated = fresh({ id: "u-sa", role: "SUPER_ADMIN" });
    assert.equal(await codeOf(linkEmployeeToAppUser(db(elevated) as never, "e-hugo", { actorUserId: "u-sa", actor: { id: "u-sa", role: "SUPER_ADMIN", elevated: true } })), "OK");
    assert.equal(elevated.audits[0]?.eventType, "USER_IDENTITY_LINKED");
  });

  it("RH/ADMIN regularizam a conta de OUTRA pessoa com Pessoa canônica confirmada: grava só employeeId (comparação-e-troca) e audita", async () => {
    for (const actor of [{ id: "rh", role: "VIEWER", elevated: false }, { id: "adm", role: "ADMIN", elevated: false }]) {
      const s = fresh({ id: "u-hugo", email: "hugo@empresa.com" });
      assert.equal(await codeOf(linkEmployeeToAppUser(db(s) as never, "e-hugo", { actorUserId: actor.id, actor })), "OK", actor.role);
      assert.deepEqual(s.writes, [{ where: { id: "u-hugo", employeeId: null, personId: P }, data: { employeeId: "e-hugo" } }]);
      assert.deepEqual(s.audits.map((a) => [a.eventType, a.actorUserId, a.targetUserId]), [["USER_IDENTITY_LINKED", actor.id, "u-hugo"]]);
    }
    // Conta SUPER_ADMIN de outra pessoa: RH/ADMIN não, SUPER_ADMIN elevado sim.
    assert.equal(await codeOf(linkEmployeeToAppUser(db(fresh({ id: "u-x", role: "SUPER_ADMIN" })) as never, "e-hugo", { actorUserId: "adm", actor: { id: "adm", role: "ADMIN", elevated: true } })), "SUPER_ADMIN_REQUIRED");
    assert.equal(await codeOf(linkEmployeeToAppUser(db(fresh({ id: "u-x", role: "SUPER_ADMIN" })) as never, "e-hugo", { actorUserId: "sa", actor: { id: "sa", role: "SUPER_ADMIN", elevated: true } })), "OK");
  });

  it("e-mail igual sem Pessoa confirmada → IDENTITY_CONFIRMATION_REQUIRED (inclusive para SUPER_ADMIN); Pessoa inativa → PERSON_INACTIVE; nada gravado", async () => {
    const actor = { id: "sa", role: "SUPER_ADMIN", elevated: true };
    const cases: Array<[string | null, string | null]> = [[null, P], [P, null], [null, null]];
    for (const [accountPersonId, employeePersonId] of cases) {
      const s = fresh({ id: "u-hugo", personId: accountPersonId });
      assert.equal(await codeOf(linkEmployeeToAppUser(db(s, { employeePersonId }) as never, "e-hugo", { actorUserId: "sa", actor })), "IDENTITY_CONFIRMATION_REQUIRED");
      assert.equal(s.writes.length, 0);
    }
    const inactive = fresh({ id: "u-hugo" });
    assert.equal(await codeOf(linkEmployeeToAppUser(db(inactive, { personStatus: "MERGED" }) as never, "e-hugo", { actorUserId: "sa", actor })), "PERSON_INACTIVE");
    assert.equal(inactive.writes.length, 0);
  });

  it("concorrência: o colaborador mudou de Pessoa (ou ganhou conta) antes da trava → STALE, nada gravado", async () => {
    for (const fresh of [{ personId: "outra", appUser: null }, { personId: P, appUser: { id: "u-outra" } }]) {
      const s = fresh_state();
      let reads = 0;
      const tx = {
        $executeRaw: async () => 0,
        employee: {
          findUnique: async () => (reads++ === 0 ? { id: "e-hugo", corporateEmail: s.account.email, personId: P, appUser: null } : { ...fresh }),
        },
        person: { findUnique: async () => ({ status: "ACTIVE" }) },
        appUser: {
          findFirst: async () => ({ ...s.account }),
          updateMany: async (args: unknown) => {
            s.writes.push(args);
            return { count: 1 };
          },
          findUnique: async () => null,
        },
        securityAuditLog: { create: async () => ({}) },
      };
      const prisma = { $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx) };
      assert.equal(await codeOf(linkEmployeeToAppUser(prisma as never, "e-hugo", { actorUserId: "rh", actor: { id: "rh", role: "VIEWER", elevated: false } })), "STALE");
      assert.equal(s.writes.length, 0);
    }
  });

  it("concorrência: a conta mudou entre a leitura e a gravação → STALE, sem auditoria", async () => {
    const s = fresh({ id: "u-hugo" });
    assert.equal(await codeOf(linkEmployeeToAppUser(db(s, { raceCount: 0 }) as never, "e-hugo", { actorUserId: "rh", actor: { id: "rh", role: "VIEWER", elevated: false } })), "STALE");
    assert.equal(s.audits.length, 0);
  });

  it("desvincular: a própria conta é recusada (exceto SUPER_ADMIN elevado); outra conta grava com comparação-e-troca e audita", async () => {
    const unlinkDb = (accountId: string, role: string, writes: unknown[], audits: Array<{ eventType: string }>, count = 1) => ({
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          employee: { findUnique: async () => ({ id: "e1", appUser: { id: accountId, email: "a@b.com", role, employeeId: "e1" } }) },
          appUser: {
            updateMany: async (args: unknown) => {
              writes.push(args);
              return { count };
            },
          },
          securityAuditLog: {
            create: async ({ data }: { data: { eventType: string } }) => {
              audits.push(data);
              return {};
            },
          },
        }),
    });
    for (const actor of [{ id: "u-op", role: "VIEWER", elevated: false }, { id: "u-op", role: "ADMIN", elevated: true }]) {
      const writes: unknown[] = [];
      assert.equal(await codeOf(unlinkEmployeeFromAppUser(unlinkDb("u-op", actor.role, writes, []) as never, "e1", { actorUserId: "u-op", actor })), "SELF_LINK_FORBIDDEN");
      assert.equal(writes.length, 0);
    }
    assert.equal(await codeOf(unlinkEmployeeFromAppUser(unlinkDb("u-sa", "SUPER_ADMIN", [], []) as never, "e1", { actorUserId: "u-sa", actor: { id: "u-sa", role: "SUPER_ADMIN", elevated: true } })), "OK");
    const writes: unknown[] = [];
    const audits: Array<{ eventType: string }> = [];
    assert.equal(await codeOf(unlinkEmployeeFromAppUser(unlinkDb("u-x", "VIEWER", writes, audits) as never, "e1", { actorUserId: "rh", actor: { id: "rh", role: "VIEWER", elevated: false } })), "OK");
    assert.deepEqual(writes, [{ where: { id: "u-x", employeeId: "e1" }, data: { employeeId: null } }]);
    assert.deepEqual(audits.map((a) => a.eventType), ["USER_IDENTITY_UNLINKED"]);
    assert.equal(await codeOf(unlinkEmployeeFromAppUser(unlinkDb("u-x", "VIEWER", [], [], 0) as never, "e1", { actorUserId: "rh", actor: { id: "rh", role: "VIEWER", elevated: false } })), "STALE");
  });
});
