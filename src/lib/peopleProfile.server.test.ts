import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveProfileAccess } from "./peopleProfile.server.ts";
import { PeopleProfileAccessError } from "./peopleProfileErrors.ts";
import { toHistoryEventDto } from "./peopleProfileHistory.ts";
import { assertNoCompensationValuesLeak } from "./peopleProfileSanitize.ts";

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
