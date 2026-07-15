import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CanonicalPersonError } from "./canonicalPerson.ts";
import {
  buildPersonCreateData,
  toPersonAdminDto,
  toPersonPublicDto,
} from "./canonicalPersonCore.server.ts";
import {
  createPersonCore,
  inactivatePersonCore,
  linkStage1RoleToPerson,
  updatePersonCore,
} from "./canonicalPersonCore.server.ts";

describe("canonicalPersonCore — normalização create payload", () => {
  it("cria payload com e-mail lowercase e CPF só dígitos", () => {
    const data = buildPersonCreateData({
      displayName: "  Ana Silva ",
      primaryEmail: "  Ana@Empresa.COM ",
      cpf: "123.456.789-09",
      phone: "(11) 98888-7777",
      origin: "EMPLOYEE",
    });
    assert.equal(data.displayName, "Ana Silva");
    assert.equal(data.corporateEmail, "ana@empresa.com");
    assert.equal(data.cpfNormalized, "12345678909");
    assert.equal(data.phoneNormalized, "11988887777");
    assert.equal(data.origin, "EMPLOYEE");
    assert.equal(data.status, "ACTIVE");
  });

  it("permite pessoa sem e-mail e sem CPF", () => {
    const data = buildPersonCreateData({ displayName: "João" });
    assert.equal(data.corporateEmail, null);
    assert.equal(data.cpfNormalized, null);
  });

  it("nome vazio falha", () => {
    assert.throws(
      () => buildPersonCreateData({ displayName: "  " }),
      (e: unknown) => e instanceof CanonicalPersonError && e.code === "NAME_REQUIRED"
    );
  });
});

describe("canonicalPersonCore — DTOs", () => {
  it("público mascara e-mail", () => {
    const dto = toPersonPublicDto({
      id: "11111111-1111-4111-8111-111111111111",
      displayName: "Ana",
      socialName: null,
      corporateEmail: "ana@x.com",
      status: "ACTIVE",
      origin: "MANUAL",
    });
    assert.equal(dto.primaryEmailMasked, "an***@x.com");
  });

  it("admin expõe vínculos resumidos", () => {
    const dto = toPersonAdminDto({
      id: "11111111-1111-4111-8111-111111111111",
      displayName: "Ana",
      socialName: null,
      corporateEmail: "ana@x.com",
      personalEmail: null,
      cpfNormalized: "12345678909",
      phoneNormalized: null,
      status: "ACTIVE",
      origin: "MANUAL",
      createdByUserId: null,
      inactivatedAt: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      employees: [{ id: "e1" }],
      appUsers: [],
      commissionPeople: [{ id: "c1" }, { id: "c2" }],
    });
    assert.equal(dto.linksSummary.employeeId, "e1");
    assert.equal(dto.linksSummary.appUserId, null);
    assert.deepEqual(dto.linksSummary.commissionPersonIds, ["c1", "c2"]);
    assert.equal(dto.cpfNormalized, "12345678909");
  });
});

type PersonRow = {
  id: string;
  displayName: string;
  socialName: string | null;
  corporateEmail: string | null;
  personalEmail: string | null;
  cpfNormalized: string | null;
  phoneNormalized: string | null;
  status: string;
  origin: string;
  createdByUserId: string | null;
  inactivatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function makeMemoryPrisma() {
  const people = new Map<string, PersonRow>();
  const employees = new Map<string, { id: string; name: string; personId: string | null }>();
  const appUsers = new Map<string, { id: string; email: string; personId: string | null }>();
  const commissionPeople = new Map<
    string,
    { id: string; name: string; personId: string | null }
  >();
  let seq = 0;
  const uid = () => {
    seq += 1;
    const n = String(seq).padStart(12, "0");
    return `00000000-0000-4000-8000-${n}`;
  };

  const prisma = {
    person: {
      async findMany(args: {
        where?: {
          cpfNormalized?: string;
          corporateEmail?: { equals: string; mode?: string };
          id?: { not: string };
        };
        select?: { id: true };
        take?: number;
      }) {
        let rows = [...people.values()];
        if (args.where?.cpfNormalized) {
          rows = rows.filter((p) => p.cpfNormalized === args.where!.cpfNormalized);
        }
        if (args.where?.corporateEmail?.equals) {
          const e = args.where.corporateEmail.equals.toLowerCase();
          rows = rows.filter((p) => (p.corporateEmail ?? "").toLowerCase() === e);
        }
        if (args.where?.id?.not) {
          rows = rows.filter((p) => p.id !== args.where!.id!.not);
        }
        return rows.slice(0, args.take ?? 100).map((p) => ({ id: p.id }));
      },
      async findUnique(args: {
        where: { id: string };
        select?: Record<string, boolean>;
        include?: Record<string, unknown>;
      }) {
        const row = people.get(args.where.id);
        if (!row) return null;
        if (args.include) {
          return {
            ...row,
            employees: [...employees.values()]
              .filter((e) => e.personId === row.id)
              .map((e) => ({ id: e.id })),
            appUsers: [...appUsers.values()]
              .filter((u) => u.personId === row.id)
              .map((u) => ({ id: u.id })),
            commissionPeople: [...commissionPeople.values()]
              .filter((c) => c.personId === row.id)
              .map((c) => ({ id: c.id })),
          };
        }
        if (args.select) {
          const out: Record<string, unknown> = {};
          for (const k of Object.keys(args.select)) {
            out[k] = (row as Record<string, unknown>)[k];
          }
          return out;
        }
        return row;
      },
      async create(args: { data: Omit<PersonRow, "id" | "createdAt" | "updatedAt" | "inactivatedAt"> & { inactivatedAt?: Date | null } }) {
        const id = uid();
        const now = new Date();
        const row: PersonRow = {
          id,
          displayName: args.data.displayName,
          socialName: args.data.socialName ?? null,
          corporateEmail: args.data.corporateEmail ?? null,
          personalEmail: args.data.personalEmail ?? null,
          cpfNormalized: args.data.cpfNormalized ?? null,
          phoneNormalized: args.data.phoneNormalized ?? null,
          status: args.data.status ?? "ACTIVE",
          origin: args.data.origin ?? "MANUAL",
          createdByUserId: args.data.createdByUserId ?? null,
          inactivatedAt: args.data.inactivatedAt ?? null,
          createdAt: now,
          updatedAt: now,
        };
        people.set(id, row);
        return row;
      },
      async update(args: { where: { id: string }; data: Partial<PersonRow> }) {
        const row = people.get(args.where.id);
        if (!row) throw new Error("not found");
        const next = { ...row, ...args.data, updatedAt: new Date() };
        people.set(row.id, next);
        return next;
      },
    },
    employee: {
      async findFirst(args: {
        where: { personId: string; id?: { not: string } };
        select: { id: true; name: true };
      }) {
        return (
          [...employees.values()].find(
            (e) =>
              e.personId === args.where.personId &&
              (!args.where.id?.not || e.id !== args.where.id.not)
          ) ?? null
        );
      },
      async findUnique(args: { where: { id: string }; select: { id: true; personId: true } }) {
        const e = employees.get(args.where.id);
        return e ? { id: e.id, personId: e.personId } : null;
      },
      async update(args: { where: { id: string }; data: { personId: string } }) {
        const e = employees.get(args.where.id);
        if (!e) throw new Error("missing");
        e.personId = args.data.personId;
        return e;
      },
    },
    appUser: {
      async findFirst(args: {
        where: { personId: string; id?: { not: string } };
        select: { id: true; email: true };
      }) {
        return (
          [...appUsers.values()].find(
            (u) =>
              u.personId === args.where.personId &&
              (!args.where.id?.not || u.id !== args.where.id.not)
          ) ?? null
        );
      },
      async findUnique(args: { where: { id: string }; select: { id: true; personId: true } }) {
        const u = appUsers.get(args.where.id);
        return u ? { id: u.id, personId: u.personId } : null;
      },
      async update(args: { where: { id: string }; data: { personId: string } }) {
        const u = appUsers.get(args.where.id);
        if (!u) throw new Error("missing");
        u.personId = args.data.personId;
        return u;
      },
    },
    commissionPerson: {
      async findUnique(args: { where: { id: string }; select: { id: true; personId: true } }) {
        const c = commissionPeople.get(args.where.id);
        return c ? { id: c.id, personId: c.personId } : null;
      },
      async update(args: { where: { id: string }; data: { personId: string } }) {
        const c = commissionPeople.get(args.where.id);
        if (!c) throw new Error("missing");
        c.personId = args.data.personId;
        return c;
      },
    },
    __seed: {
      employee(id: string, name: string, personId: string | null = null) {
        employees.set(id, { id, name, personId });
      },
      appUser(id: string, email: string, personId: string | null = null) {
        appUsers.set(id, { id, email, personId });
      },
      commission(id: string, name: string, personId: string | null = null) {
        commissionPeople.set(id, { id, name, personId });
      },
      people,
    },
  };

  return prisma as unknown as Parameters<typeof createPersonCore>[0] & {
    __seed: typeof prisma.__seed;
  };
}

describe("canonicalPersonCore — persistência (memória)", () => {
  it("cria pessoa sem e-mail/CPF", async () => {
    const prisma = makeMemoryPrisma();
    const created = await createPersonCore(prisma, { displayName: "Maria" });
    assert.ok(created.id);
    assert.equal(created.displayName, "Maria");
  });

  it("rejeita CPF duplicado", async () => {
    const prisma = makeMemoryPrisma();
    await createPersonCore(prisma, { displayName: "A", cpf: "12345678909" });
    await assert.rejects(
      () => createPersonCore(prisma, { displayName: "B", cpf: "123.456.789-09" }),
      (e: unknown) => e instanceof CanonicalPersonError && e.code === "DUPLICATE_CPF"
    );
  });

  it("atualiza e normaliza e-mail", async () => {
    const prisma = makeMemoryPrisma();
    const created = await createPersonCore(prisma, { displayName: "A" });
    await updatePersonCore(prisma, created.id, { primaryEmail: "  Novo@X.com " });
    const row = [...prisma.__seed.people.values()][0]!;
    assert.equal(row.corporateEmail, "novo@x.com");
  });

  it("inativa sem apagar vínculos", async () => {
    const prisma = makeMemoryPrisma();
    const created = await createPersonCore(prisma, { displayName: "A" });
    const empId = "00000000-0000-4000-8000-000000000101";
    prisma.__seed.employee(empId, "A", null);
    await linkStage1RoleToPerson(prisma, {
      personId: created.id,
      role: "employee",
      roleEntityId: empId,
    });
    await inactivatePersonCore(prisma, created.id);
    const person = prisma.__seed.people.get(created.id)!;
    assert.equal(person.status, "INACTIVE");
    assert.ok(person.inactivatedAt);
    const emp = await (prisma as any).employee.findUnique({
      where: { id: empId },
      select: { id: true, personId: true },
    });
    assert.equal(emp.personId, created.id);
  });

  it("impede dois colaboradores no mesmo Person", async () => {
    const prisma = makeMemoryPrisma();
    const created = await createPersonCore(prisma, { displayName: "A" });
    const e1 = "00000000-0000-4000-8000-000000000201";
    const e2 = "00000000-0000-4000-8000-000000000202";
    prisma.__seed.employee(e1, "A", null);
    prisma.__seed.employee(e2, "B", null);
    await linkStage1RoleToPerson(prisma, {
      personId: created.id,
      role: "employee",
      roleEntityId: e1,
    });
    await assert.rejects(
      () =>
        linkStage1RoleToPerson(prisma, {
          personId: created.id,
          role: "employee",
          roleEntityId: e2,
        }),
      (e: unknown) =>
        e instanceof CanonicalPersonError && e.code === "PERSON_ALREADY_HAS_EMPLOYEE"
    );
  });

  it("legado sem personId continua linkável", async () => {
    const prisma = makeMemoryPrisma();
    const created = await createPersonCore(prisma, { displayName: "A" });
    const empId = "00000000-0000-4000-8000-000000000301";
    prisma.__seed.employee(empId, "Legado", null);
    await linkStage1RoleToPerson(prisma, {
      personId: created.id,
      role: "employee",
      roleEntityId: empId,
    });
    const emp = await (prisma as any).employee.findUnique({
      where: { id: empId },
      select: { id: true, personId: true },
    });
    assert.equal(emp.personId, created.id);
  });

  it("impede AppUser já vinculado a outra pessoa", async () => {
    const prisma = makeMemoryPrisma();
    const p1 = await createPersonCore(prisma, { displayName: "P1" });
    const p2 = await createPersonCore(prisma, { displayName: "P2" });
    const u1 = "00000000-0000-4000-8000-000000000401";
    prisma.__seed.appUser(u1, "a@x.com", p1.id);
    await assert.rejects(
      () =>
        linkStage1RoleToPerson(prisma, {
          personId: p2.id,
          role: "app_user",
          roleEntityId: u1,
        }),
      (e: unknown) =>
        e instanceof CanonicalPersonError && e.code === "APP_USER_ALREADY_LINKED"
    );
  });
});
