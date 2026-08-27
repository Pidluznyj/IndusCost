import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyCompensationAdjustment, createEmployeeBenefit } from "./peopleProfileMutations.server.ts";
import { PeopleProfileAccessError } from "./peopleProfileErrors.ts";

describe("applyCompensationAdjustment — concorrência", () => {
  it("409 quando o salário esperado diverge (lost update)", async () => {
    const prisma = {
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          employee: {
            findUnique: async () => ({
              id: "e1",
              salary: { toNumber: () => 2000 },
              roleId: "r1",
              Role: { name: "Op" },
            }),
            updateMany: async () => ({ count: 0 }),
          },
        };
        return fn(tx);
      },
    };
    await assert.rejects(
      () =>
        applyCompensationAdjustment(prisma as never, {
          employeeId: "11111111-1111-4111-8111-111111111111",
          expectedPreviousAmount: 2000,
          newAmount: 2200,
          type: "MERIT",
          effectiveDate: new Date("2026-05-01"),
          actorUserId: "u1",
        }),
      (err: unknown) => {
        assert.ok(err instanceof PeopleProfileAccessError);
        assert.equal(err.code, "SALARY_CONFLICT");
        assert.equal(err.status, 409);
        assert.ok(!String(err.message).includes("2000"));
        assert.ok(!String(err.message).includes("2200"));
        return true;
      }
    );
  });
});

describe("createEmployeeBenefit — catálogo oficial", () => {
  it("grava a atribuição a partir do PayrollComponent oficial", async () => {
    let upserted: { code?: string; name?: string } | null = null;
    let createdBenefitId: string | null = null;
    const prisma = {
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          payrollComponent: {
            findUnique: async () => ({
              id: "p-fgts",
              name: "FGTS",
              type: "CHARGE",
              calculationType: "PERCENTAGE",
            }),
          },
          hrBenefit: {
            findUnique: async () => null,
            upsert: async (args: { create: { code: string; name: string } }) => {
              upserted = args.create;
              return { id: "hb-mirror", name: args.create.name };
            },
          },
          hrEmployeeBenefit: {
            create: async (args: { data: { benefitId: string } }) => {
              createdBenefitId = args.data.benefitId;
              return { id: "row-1", ...args.data };
            },
          },
          hrEmployeeHistory: {
            create: async () => ({ id: "hist-1" }),
          },
        };
        return fn(tx);
      },
    };
    const row = await createEmployeeBenefit(prisma as never, {
      employeeId: "11111111-1111-4111-8111-111111111111",
      benefitId: "p-fgts",
      startDate: new Date("2026-08-27"),
      actorUserId: "u1",
    });
    assert.equal(upserted?.name, "FGTS");
    assert.equal(upserted?.code, "PAYROLL:p-fgts");
    assert.equal(createdBenefitId, "hb-mirror");
    assert.equal((row as { id: string }).id, "row-1");
  });

  it("recusa id que não é verba oficial nem benefício legado", async () => {
    const prisma = {
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          payrollComponent: { findUnique: async () => null },
          hrBenefit: { findUnique: async () => null },
        };
        return fn(tx);
      },
    };
    await assert.rejects(
      () =>
        createEmployeeBenefit(prisma as never, {
          employeeId: "11111111-1111-4111-8111-111111111111",
          benefitId: "missing",
          startDate: new Date("2026-08-27"),
        }),
      (err: unknown) => {
        assert.ok(err instanceof PeopleProfileAccessError);
        assert.equal(err.code, "INVALID_BENEFIT");
        return true;
      }
    );
  });
});
