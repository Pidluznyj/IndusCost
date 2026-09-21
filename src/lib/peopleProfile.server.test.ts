import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveProfileAccess } from "./peopleProfile.server.ts";
import {
  loadPeopleCareer,
  loadPeopleCompensation,
  loadPeopleNotes,
  loadPeopleProfileSummary,
} from "./peopleProfile.server.ts";
import { buildPeopleProfileCapabilities } from "./peopleProfileCapabilities.ts";
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

describe("loadPeopleProfileSummary — última promoção", () => {
  it("encontra a promoção mesmo fora da janela das 8 movimentações recentes", async () => {
    let promotionArgs: Record<string, unknown> | null = null;
    let recentTake: number | undefined;
    const recent = Array.from({ length: 8 }, (_, i) => ({
      id: `h-${i}`,
      eventType: i % 2 === 0 ? "EPI_DELIVERY" : "NOTE_ADDED",
      effectiveDate: new Date(Date.UTC(2026, 5, 20 - i)),
      createdAt: new Date(Date.UTC(2026, 5, 20 - i)),
      previousRoleName: null,
      newRoleName: null,
      previousDepartment: null,
      newDepartment: null,
      previousManagerName: null,
      newManagerName: null,
    }));
    const prisma = {
      employee: {
        findUnique: async () => ({
          id: "emp-1",
          name: "João da Silva",
          socialName: null,
          status: "ACTIVE",
          department: "Produção",
          departmentId: null,
          costCenter: "Usinagem",
          costCenterId: null,
          managerId: null,
          managerName: null,
          contractType: null,
          workSchedule: null,
          corporateEmail: null,
          classification: "MOD",
          admissionDate: new Date("2015-02-01T00:00:00.000Z"),
          terminationDate: null,
          personId: null,
          photoStorageKey: "hremployeephotos/emp-1/0a1b2c3d-foto.png",
          monthlyHours: 220,
          professionalNotes: null,
          updatedAt: new Date("2026-06-01T00:00:00.000Z"),
          createdAt: new Date("2015-02-01T00:00:00.000Z"),
          roleId: "r1",
          Role: { id: "r1", name: "Operador II" },
          financialCostCenter: null,
          orgDepartment: null,
          manager: null,
          person: null,
        }),
      },
      hrEmployeeHistory: {
        findMany: async (args: { take?: number }) => {
          recentTake = args.take;
          return recent;
        },
        findFirst: async (args: Record<string, unknown>) => {
          promotionArgs = args;
          return {
            eventType: "PROMOTION",
            effectiveDate: new Date("2019-08-01T00:00:00.000Z"),
            previousRoleName: "Operador I",
            newRoleName: "Operador II",
          };
        },
      },
      hrCompensationAdjustment: { findMany: async () => [] },
    };
    const summary = await loadPeopleProfileSummary(
      prisma as never,
      "emp-1",
      buildPeopleProfileCapabilities(check(["employees.view"]))
    );
    assert.equal(recentTake, 8);
    assert.deepEqual(promotionArgs?.where, { employeeId: "emp-1", eventType: "PROMOTION" });
    assert.deepEqual(promotionArgs?.orderBy, [
      { effectiveDate: "desc" },
      { createdAt: "desc" },
      { id: "desc" },
    ]);
    assert.equal(summary.kpis.lastPromotionDate, "2019-08-01T00:00:00.000Z");
    assert.equal(summary.kpis.lastPromotionLabel, "Operador I → Operador II");
    assert.ok(summary.kpis.timeSinceLastPromotionLabel);
    assert.equal(summary.overview.lastPromotionDate, "2019-08-01T00:00:00.000Z");
    // A janela de movimentações recentes continua a mesma (5 itens, sem a promoção antiga).
    assert.equal(summary.overview.recentMovements.length, 5);
    assert.ok(summary.overview.recentMovements.every((m) => m.eventType !== "PROMOTION"));
    assert.equal(summary.identity.photoUrl, "/api/employees/emp-1/photo?v=0a1b2c3d");
  });
});

describe("loadPeopleCareer — flag editable", () => {
  it("filtra os tipos de carreira no banco e marca o que aceita correção", async () => {
    let capturedWhere: Record<string, unknown> | null = null;
    const base = {
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
      source: "USER",
      reason: null,
      notes: null,
      createdByUserId: null,
    };
    const prisma = {
      hrEmployeeHistory: {
        findMany: async (args: { where: Record<string, unknown> }) => {
          capturedWhere = args.where;
          return [
            { ...base, id: "h3", eventType: "PROMOTION", effectiveDate: new Date("2024-01-01") },
            { ...base, id: "h2", eventType: "TERMINATION", effectiveDate: new Date("2023-01-01") },
            { ...base, id: "h1", eventType: "INITIAL_STATE", effectiveDate: new Date("2022-01-01") },
          ];
        },
      },
      appUser: { findMany: async () => [] },
    };
    const out = await loadPeopleCareer(prisma as never, "emp-1");
    const types = (capturedWhere?.eventType as { in: string[] }).in;
    assert.ok(types.includes("PROMOTION"));
    assert.ok(types.includes("INITIAL_STATE"));
    assert.ok(!types.includes("COMPENSATION_ADJUSTMENT"));
    assert.ok(!types.includes("EPI_DELIVERY"));
    assert.deepEqual(
      out.items.map((i) => [i.id, i.editable]),
      [
        ["h3", true],
        ["h2", true],
        ["h1", false],
      ]
    );
    const json = JSON.stringify(out);
    assert.ok(!json.includes("previousAmount"));
    assert.ok(!json.includes("newAmount"));
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
