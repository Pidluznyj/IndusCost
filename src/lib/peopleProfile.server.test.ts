import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveProfileAccess } from "./peopleProfile.server.ts";
import { loadPeopleCompensation, loadPeopleNotes } from "./peopleProfile.server.ts";
import { PeopleProfileAccessError } from "./peopleProfileErrors.ts";
import { toHistoryEventDto } from "./peopleProfileHistory.ts";
import { assertNoCompensationValuesLeak } from "./peopleProfileSanitize.ts";
import { readEmployeeDocumentFile } from "./peopleProfileMutations.server.ts";

function check(perms: string[]) {
  const set = new Set(perms);
  return {
    hasPermission: (p: string) => set.has(p),
    hasAnyPermission: (list: readonly string[]) => list.some((p) => set.has(p)),
  };
}

describe("resolveProfileAccess — IDOR e escopo", () => {
  it("SEM ACESSO recusa a ficha", async () => {
    const prisma = {
      employee: { findUnique: async () => ({ id: "t", managerId: null }) },
    };
    await assert.rejects(
      () =>
        resolveProfileAccess(prisma as never, {
          check: check([]),
          actorEmployeeId: null,
          targetEmployeeId: "t",
        }),
      (err: unknown) => {
        assert.ok(err instanceof PeopleProfileAccessError);
        assert.equal(err.code, "PROFILE_FORBIDDEN");
        return true;
      }
    );
  });

  it("líder fora da equipe é bloqueado", async () => {
    const prisma = {
      employee: { findUnique: async () => ({ id: "maria", managerId: "outro" }) },
    };
    await assert.rejects(
      () =>
        resolveProfileAccess(prisma as never, {
          check: check(["employees.team.view"]),
          actorEmployeeId: "joao-lider",
          targetEmployeeId: "maria",
        }),
      (err: unknown) => {
        assert.ok(err instanceof PeopleProfileAccessError);
        assert.equal(err.code, "PROFILE_SCOPE");
        return true;
      }
    );
  });

  it("líder vê reporte direto", async () => {
    const prisma = {
      employee: { findUnique: async () => ({ id: "maria", managerId: "joao-lider" }) },
    };
    const access = await resolveProfileAccess(prisma as never, {
      check: check(["employees.team.view"]),
      actorEmployeeId: "joao-lider",
      targetEmployeeId: "maria",
    });
    assert.equal(access.capabilities.canViewProfile, true);
    assert.equal(access.capabilities.canViewCompensationValues, false);
    assert.equal(access.capabilities.accessScope, "DIRECT_REPORTS");
  });

  it("RH com employees.view não recebe valores no DTO de histórico", () => {
    const dto = toHistoryEventDto(
      {
        id: "h1",
        eventType: "COMPENSATION_ADJUSTMENT",
        effectiveDate: "2026-05-01",
        createdAt: "2026-05-02",
        source: "USER",
        percentage: 6.8,
        previousAmount: 4500,
        newAmount: 4806,
        differenceAmount: 306,
      },
      { includeAmounts: false }
    );
    const json = JSON.stringify(dto);
    assert.ok(!json.includes("4500"));
    assert.ok(!json.includes("previousAmount"));
    assert.doesNotThrow(() => assertNoCompensationValuesLeak(dto));
  });
});

describe("loadPeopleCompensation — leak de valores", () => {
  it("omite previousAmount/newAmount/salary do JSON sem includeValues", async () => {
    let compensationSelect: Record<string, unknown> | null = null;
    const prisma = {
      employee: {
        findUnique: async () => ({ monthlyHours: 220, salary: 99999.12 }),
      },
      hrCompensationAdjustment: {
        findMany: async (args: { select?: Record<string, unknown> }) => {
          compensationSelect = args.select ?? null;
          return [
            {
              id: "adj1",
              effectiveDate: new Date("2026-05-01T00:00:00.000Z"),
              registeredAt: new Date("2026-05-02T00:00:00.000Z"),
              type: "MERIT",
              percentage: 6.8,
              reason: "dissídio",
              notes: null,
              createdByUserId: null,
              previousAmount: 99999.12,
              newAmount: 106800,
              differenceAmount: 6800.88,
            },
          ];
        },
      },
      appUser: { findMany: async () => [] },
    };
    const payload = await loadPeopleCompensation(prisma as never, "emp-1", {
      includeValues: false,
      actorUserId: "u1",
    });
    const json = JSON.stringify(payload);
    assert.ok(!json.includes("99999"));
    assert.ok(!json.includes("previousAmount"));
    assert.ok(!json.includes("newAmount"));
    assert.ok(!json.includes("currentSalary"));
    assert.ok(json.includes("6.8") || json.includes("percentage"));
    assert.doesNotThrow(() => assertNoCompensationValuesLeak(payload));
    assert.equal(compensationSelect?.previousAmount, undefined);
    assert.equal(compensationSelect?.newAmount, undefined);
  });
});

describe("loadPeopleNotes — RESTRITA não vaza", () => {
  it("filtra categoria RESTRITA no banco e no resultado", async () => {
    let capturedWhere: unknown;
    const prisma = {
      employee: {
        findUnique: async () => ({
          professionalNotes: "ok",
          adminNotes: "conta salário 7777",
        }),
      },
      hrEmployeeNote: {
        findMany: async (args: { where: unknown }) => {
          capturedWhere = args.where;
          return [
            {
              id: "n-restricted",
              category: "RESTRITA",
              body: "salário 7777",
              visibility: "RESTRICTED",
              createdAt: new Date("2026-01-01T00:00:00.000Z"),
              createdByUserId: null,
            },
          ];
        },
      },
      appUser: { findMany: async () => [] },
    };
    const out = await loadPeopleNotes(prisma as never, "emp-1", { includeRestricted: false });
    assert.deepEqual(capturedWhere, { employeeId: "emp-1", NOT: { category: "RESTRITA" } });
    assert.equal(out.legacy.adminNotes, null);
    assert.equal(out.notes.length, 0);
    const json = JSON.stringify(out);
    assert.ok(!json.includes("7777"));
    assert.ok(!json.includes("RESTRITA"));
  });
});

describe("readEmployeeDocumentFile — IDOR", () => {
  it("404 quando o documento não pertence ao employeeId", async () => {
    let capturedWhere: unknown;
    const prisma = {
      hrEmployeeDocument: {
        findFirst: async (args: { where: unknown }) => {
          capturedWhere = args.where;
          return null;
        },
      },
    };
    await assert.rejects(
      () =>
        readEmployeeDocumentFile(prisma as never, {
          employeeId: "11111111-1111-4111-8111-111111111111",
          documentId: "22222222-2222-4222-8222-222222222222",
        }),
      (err: unknown) => {
        assert.ok(err instanceof PeopleProfileAccessError);
        assert.equal(err.status, 404);
        assert.equal(err.code, "NOT_FOUND");
        return true;
      }
    );
    assert.deepEqual(capturedWhere, {
      id: "22222222-2222-4222-8222-222222222222",
      employeeId: "11111111-1111-4111-8111-111111111111",
    });
  });
});
