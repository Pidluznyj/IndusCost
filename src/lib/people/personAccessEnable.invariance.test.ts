/**
 * Invariância: habilitar acesso pela Pessoa e regularizar conta legada tocam SÓ o que devem.
 * Prisma falso com Proxy que lança em qualquer modelo de comissões/Nomus; registra as escritas.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createAppUserAccount } from "@/src/lib/adminUserCreation.server.ts";
import { attachAccountToPerson } from "@/src/lib/people/personLinkOps.server.ts";

const PERSON = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EMP = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const USER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

type Call = { model: string; op: string; args: unknown };

function fakePrisma(models: Record<string, Record<string, (args: unknown) => unknown>>, log: Call[]) {
  const wrap = (model: string) =>
    new Proxy({}, {
      get: (_t, op: string) => (args: unknown) => {
        const fn = models[model]?.[op];
        if (!fn) throw new Error(`operação inesperada ${model}.${op}`);
        log.push({ model, op, args });
        return Promise.resolve(fn(args));
      },
    });
  const client = new Proxy({} as Record<string, unknown>, {
    get(_t, model: string) {
      if (model === "then") return undefined;
      if (model === "$transaction") return async (fn: (tx: unknown) => Promise<unknown>) => fn(client);
      // Travas de linha/chave (SELECT … FOR UPDATE / advisory lock): sem efeito no fake, mas registradas.
      if (model === "$executeRaw") return async () => { log.push({ model: "$executeRaw", op: "lock", args: null }); return 0; };
      if (!models[model]) throw new Error(`modelo tocado indevidamente: ${model}`);
      return wrap(model);
    },
  });
  return client as never;
}

describe("Habilitar acesso pela Pessoa — política fail-closed e nada de comissões", () => {
  it("conta nasce VIEWER, sem permissões/perfil/vendedor, ligada à Pessoa (sem colaborador) e auditada", async () => {
    const log: Call[] = [];
    let created: Record<string, unknown> | null = null;
    const prisma = fakePrisma(
      {
        person: { findUnique: () => ({ id: PERSON, displayName: "Dir. Externa", socialName: null, corporateEmail: "dir@parceiro.com", personalEmail: null, status: "ACTIVE", employees: [] }) },
        appUser: {
          findUnique: () => null,
          create: (args) => {
            created = (args as { data: Record<string, unknown> }).data;
            return { id: USER, ...created, accessProfile: null, employee: null };
          },
        },
        securityAuditLog: { create: () => ({ id: "a" }) },
        personLinkEvent: { create: () => ({ id: "ev" }) },
      },
      log
    );
    const user = await createAppUserAccount(
      { prisma, hashPassword: async () => "hash" },
      {
        source: { kind: "person", personId: PERSON },
        password: "SenhaForte#2026",
        // tentativa de elevação no corpo: ignorada por construção (o tipo nem aceita, mas simulamos campos extras)
        ...({ role: "SUPER_ADMIN", permissions: ["users.manage"], externalSellerId: 464 } as object),
        actor: { id: "actor", role: "ADMIN" },
        origin: { ipAddress: null, userAgent: null },
        creationSource: "PERSON_ENABLE_ACCESS",
      } as never
    );
    assert.equal(user.id, USER);
    assert.ok(created);
    const c = created as Record<string, unknown>;
    assert.equal(c.role, "VIEWER");
    assert.deepEqual(c.permissions, []);
    assert.equal(c.accessProfileId, null);
    assert.equal(c.externalSellerId, null);
    assert.deepEqual(c.externalSellerIds, []);
    assert.equal(c.sellerResponsibleName, null);
    assert.equal(c.personId, PERSON);
    assert.equal(c.employeeId, null);
    assert.equal(c.mustChangePassword, true, "ADMIN não desliga a troca obrigatória");
    assert.equal(c.email, "dir@parceiro.com");
    assert.equal(log.filter((l) => l.model === "securityAuditLog").length, 2);
    const ev = log.find((l) => l.model === "personLinkEvent")!.args as { data: { eventKind: string; entityKind: string; evidence: string } };
    assert.equal(ev.data.eventKind, "LINKED");
    assert.equal(ev.data.entityKind, "app_user");
    assert.equal(ev.data.evidence, "SYSTEM");
    assert.ok(!log.some((l) => l.model.startsWith("commission")));
  });

  it("Pessoa com colaborador ativo: a conta nasce com employeeId; Pessoa INACTIVE/MERGED ou já com conta é recusada", async () => {
    const mk = (person: Record<string, unknown>, holder: unknown = null) =>
      fakePrisma(
        {
          person: { findUnique: () => person },
          appUser: { findUnique: () => holder, create: (args) => ({ id: USER, ...(args as { data: object }).data, accessProfile: null, employee: null }) },
          securityAuditLog: { create: () => ({}) },
          personLinkEvent: { create: () => ({}) },
        },
        []
      );
    const base = { id: PERSON, displayName: "Ana", socialName: null, corporateEmail: "ana@x.com", personalEmail: null, status: "ACTIVE" };
    const input = { source: { kind: "person" as const, personId: PERSON }, password: "SenhaForte#2026", actor: { id: "a", role: "SUPER_ADMIN" }, origin: { ipAddress: null, userAgent: null }, creationSource: "PERSON_ENABLE_ACCESS" as const };
    const withEmp = await createAppUserAccount({ prisma: mk({ ...base, employees: [{ id: EMP, name: "Ana", socialName: null, personalEmail: null, corporateEmail: "ana@x.com", department: "TI", status: "ACTIVE", personId: PERSON, appUser: null }] }), hashPassword: async () => "h" }, input);
    assert.equal((withEmp as { employeeId: string | null }).employeeId, EMP);
    for (const [person, holder, code] of [
      [{ ...base, status: "INACTIVE", employees: [] }, null, "PERSON_INACTIVE"],
      [{ ...base, status: "MERGED", employees: [] }, null, "PERSON_MERGED"],
      [{ ...base, employees: [] }, { id: "u9", email: "x@x" }, "PERSON_ALREADY_HAS_USER"],
      [{ ...base, employees: [{ id: EMP, name: "Ana", socialName: null, personalEmail: null, corporateEmail: null, department: "TI", status: "INACTIVE", personId: PERSON, appUser: null }] }, null, "EMPLOYEE_INACTIVE"],
      [{ ...base, employees: [{ id: EMP, name: "Ana", socialName: null, personalEmail: null, corporateEmail: null, department: "TI", status: "ACTIVE", personId: PERSON, appUser: { id: "u8" } }] }, null, "EMPLOYEE_ALREADY_LINKED"],
    ] as Array<[Record<string, unknown>, unknown, string]>) {
      await assert.rejects(createAppUserAccount({ prisma: mk(person, holder), hashPassword: async () => "h" }, input), (e: { code: string }) => e.code === code, code);
    }
  });
});

describe("Regularizar conta legada — só personId/employeeId mudam", () => {
  it("updateMany da conta leva apenas personId (+ employeeId) com estado esperado; nada de senha/papel/vendedor; evento + auditoria", async () => {
    const log: Call[] = [];
    const account = { id: USER, name: "Paulo", email: "paulo@empresa.com", role: "SUPER_ADMIN", isActive: true, personId: null, employeeId: null, employee: null, person: null, passwordHash: "secret", permissions: ["x"], externalSellerId: 464, externalSellerIds: [464], sellerResponsibleName: "PAULO" };
    const prisma = fakePrisma(
      {
        person: { findUnique: () => ({ id: PERSON, displayName: "Paulo P.", status: "ACTIVE", corporateEmail: "paulo@empresa.com", personalEmail: null, appUsers: [], employees: [{ id: EMP, name: "Paulo P.", status: "ACTIVE", personId: PERSON, corporateEmail: "paulo@empresa.com", appUser: null }] }) },
        appUser: { findUnique: () => account, updateMany: () => ({ count: 1 }) },
        employee: { findUnique: () => ({ id: EMP, name: "Paulo P.", status: "ACTIVE", personId: PERSON, corporateEmail: "paulo@empresa.com", appUser: null }) },
        personLinkEvent: { create: () => ({ id: "ev1" }) },
        securityAuditLog: { create: () => ({}) },
      },
      log
    );
    const r = await attachAccountToPerson(prisma, {
      targetPersonId: PERSON,
      appUserId: USER,
      expected: { personId: null, employeeId: null },
      confirmEmailMismatch: false,
      reason: "Caso real: SUPER_ADMIN sem vínculo",
      actor: { id: "sa", name: "SA", role: "SUPER_ADMIN", elevated: true },
    });
    assert.equal(r!.kind, "LINK");
    assert.equal(r!.employeeId, EMP);
    const upd = log.filter((l) => l.model === "appUser" && l.op === "updateMany");
    assert.equal(upd.length, 1);
    const args = upd[0]!.args as { where: Record<string, unknown>; data: Record<string, unknown> };
    assert.deepEqual(Object.keys(args.data).sort(), ["employeeId", "personId"]);
    assert.deepEqual(args.where, { id: USER, personId: null, employeeId: null });
    assert.ok(!log.some((l) => l.model === "employee" && l.op !== "findUnique"), "colaborador já tinha Pessoa: não é tocado");
    assert.ok(log.some((l) => l.model === "securityAuditLog"));
    const ev = log.find((l) => l.model === "personLinkEvent")!.args as { data: { eventKind: string; snapshot: Record<string, unknown> } };
    assert.equal(ev.data.eventKind, "LINKED");
    assert.equal(ev.data.snapshot.touchesSuperAdmin, true);
    assert.ok(!log.some((l) => l.model.startsWith("commission")));
  });

  it("sem step-up, conta SUPER_ADMIN não é regularizada (403) e nada é gravado", async () => {
    const log: Call[] = [];
    const prisma = fakePrisma(
      {
        person: { findUnique: () => ({ id: PERSON, displayName: "P", status: "ACTIVE", corporateEmail: null, personalEmail: null, appUsers: [], employees: [] }) },
        appUser: { findUnique: () => ({ id: USER, name: "Paulo", email: "p@x", role: "SUPER_ADMIN", isActive: true, personId: null, employeeId: null, employee: null, person: null }), updateMany: () => ({ count: 1 }) },
        personLinkEvent: { create: () => ({ id: "ev1" }) },
        securityAuditLog: { create: () => ({}) },
      },
      log
    );
    await assert.rejects(
      attachAccountToPerson(prisma, { targetPersonId: PERSON, appUserId: USER, expected: {}, confirmEmailMismatch: true, reason: "tentativa sem step-up", actor: { id: "sa", role: "SUPER_ADMIN", elevated: false } }),
      (e: { code: string; status: number }) => e.code === "ADMIN_ELEVATION_REQUIRED" && e.status === 403
    );
    assert.ok(!log.some((l) => l.op === "updateMany" || l.op === "create"));
  });
});
