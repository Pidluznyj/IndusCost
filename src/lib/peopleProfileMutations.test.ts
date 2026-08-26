import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyCompensationAdjustment } from "./peopleProfileMutations.server.ts";
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
        return true;
      }
    );
  });
});
