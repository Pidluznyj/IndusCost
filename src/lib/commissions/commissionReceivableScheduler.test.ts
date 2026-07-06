import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCommissionReceivableScheduleDrafts,
  buildCommissionReceivableScheduleSourceHash,
  deriveReceivableScheduleStatus,
  planCommissionReceivableScheduleRebuild,
} from "./commissionReceivableScheduler.js";
import { persistCommissionReceivableScheduleRebuild } from "./commissionReceivableScheduler.server.js";

const ORDER_SNAPSHOT_ID = "aa0e8400-e29b-41d4-a716-446655440100";
const ORDER_ID = "880e8400-e29b-41d4-a716-446655440004";
const CUSTOMER_ID = "aa0e8400-e29b-41d4-a716-446655440010";
const SELLER_ID = "550e8400-e29b-41d4-a716-446655440001";
const SNAPSHOT_HASH = "snapshot-hash-v1";

function snapshotContext(overrides: {
  totalFinalCommissionAmount?: number;
  itemStatuses?: string[];
  sourceHash?: string;
} = {}) {
  return {
    id: ORDER_SNAPSHOT_ID,
    sourceHash: overrides.sourceHash ?? SNAPSHOT_HASH,
    salesOrderId: ORDER_ID,
    nfeId: 1001,
    customerId: CUSTOMER_ID,
    canonicalSellerId: SELLER_ID,
    totalFinalCommissionAmount: overrides.totalFinalCommissionAmount ?? 160,
    itemStatuses: overrides.itemStatuses ?? ["COMMISSIONABLE"],
  };
}

function receivable(
  id: number,
  amount: number,
  installmentNumber: number
) {
  return {
    receivableId: id,
    receivableCode: `NF-1001/${installmentNumber}`,
    installmentNumber,
    receivableNominalAmount: amount,
  };
}

type MockSchedule = {
  id: string;
  orderSnapshotId: string;
  receivableId: number;
  sourceHash: string;
  status: string;
};

function createMockSchedulerDb() {
  const schedules = new Map<string, MockSchedule>();
  let idCounter = 1;

  const db = {
    schedules,
    commissionReceivableSchedule: {
      findMany: async ({
        where,
      }: {
        where: { orderSnapshotId: string; status: string };
      }) =>
        [...schedules.values()]
          .filter(
            (row) =>
              row.orderSnapshotId === where.orderSnapshotId && row.status === where.status
          )
          .map((row) => ({
            id: row.id,
            receivableId: row.receivableId,
            sourceHash: row.sourceHash,
          })),
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: { in: string[] } };
        data: { status: string };
      }) => {
        for (const id of where.id.in) {
          const row = schedules.get(id);
          if (row) row.status = data.status;
        }
        return { count: where.id.in.length };
      },
      create: async ({
        data,
      }: {
        data: {
          orderSnapshot: { connect: { id: string } };
          receivableId: number;
          sourceHash: string;
          status: string;
        };
      }) => {
        const id = `sched-${idCounter++}`;
        schedules.set(id, {
          id,
          orderSnapshotId: data.orderSnapshot.connect.id,
          receivableId: data.receivableId,
          sourceHash: data.sourceHash,
          status: data.status,
        });
        return { id };
      },
    },
    $transaction: async <T>(fn: (tx: typeof db) => Promise<T>): Promise<T> => fn(db),
  };

  return db;
}

describe("commissionReceivableScheduler", () => {
  it("2 parcelas 50/50 rateiam comissão igualmente", () => {
    const drafts = buildCommissionReceivableScheduleDrafts({
      snapshot: snapshotContext(),
      receivables: [receivable(101, 5000, 1), receivable(102, 5000, 2)],
    });

    assert.equal(drafts.length, 2);
    assert.equal(drafts[0].scheduledCommissionAmount, 80);
    assert.equal(drafts[1].scheduledCommissionAmount, 80);
    assert.equal(drafts[0].receivableSharePercent, 50);
    assert.equal(drafts[1].receivableSharePercent, 50);
    assert.equal(drafts[0].status, "ACTIVE");
  });

  it("4 parcelas 25/25/25/25 rateiam comissão igualmente", () => {
    const drafts = buildCommissionReceivableScheduleDrafts({
      snapshot: snapshotContext({ totalFinalCommissionAmount: 100 }),
      receivables: [
        receivable(201, 2500, 1),
        receivable(202, 2500, 2),
        receivable(203, 2500, 3),
        receivable(204, 2500, 4),
      ],
    });

    assert.equal(drafts.length, 4);
    for (const draft of drafts) {
      assert.equal(draft.scheduledCommissionAmount, 25);
      assert.equal(draft.receivableSharePercent, 25);
    }
  });

  it("título removido vira STALE", async () => {
    const db = createMockSchedulerDb();
    const v1 = buildCommissionReceivableScheduleDrafts({
      snapshot: snapshotContext(),
      receivables: [receivable(101, 5000, 1), receivable(102, 5000, 2)],
    });

    await persistCommissionReceivableScheduleRebuild(db as never, {
      orderSnapshotId: ORDER_SNAPSHOT_ID,
      plan: planCommissionReceivableScheduleRebuild({ existingActive: [], drafts: v1 }),
      drafts: v1,
      dryRun: false,
    });

    const v2 = buildCommissionReceivableScheduleDrafts({
      snapshot: snapshotContext(),
      receivables: [receivable(101, 10000, 1)],
    });
    const existingActive = await db.commissionReceivableSchedule.findMany({
      where: { orderSnapshotId: ORDER_SNAPSHOT_ID, status: "ACTIVE" },
    });
    const plan = planCommissionReceivableScheduleRebuild({ existingActive, drafts: v2 });

    assert.equal(plan.toStale.length, 1);
    assert.equal(plan.toStale[0].receivableId, 102);
    assert.equal(plan.toCreate.length, 1);
    assert.equal(plan.toCreate[0].receivableId, 101);

    const result = await persistCommissionReceivableScheduleRebuild(db as never, {
      orderSnapshotId: ORDER_SNAPSHOT_ID,
      plan,
      drafts: v2,
      dryRun: false,
    });

    assert.equal(result.schedulesStaled, 1);
    const stale = [...db.schedules.values()].find((row) => row.receivableId === 102);
    assert.equal(stale?.status, "STALE");
  });

  it("novo título entra no rateio", async () => {
    const db = createMockSchedulerDb();
    const v1 = buildCommissionReceivableScheduleDrafts({
      snapshot: snapshotContext(),
      receivables: [receivable(101, 10000, 1)],
    });

    await persistCommissionReceivableScheduleRebuild(db as never, {
      orderSnapshotId: ORDER_SNAPSHOT_ID,
      plan: planCommissionReceivableScheduleRebuild({ existingActive: [], drafts: v1 }),
      drafts: v1,
      dryRun: false,
    });

    const v2 = buildCommissionReceivableScheduleDrafts({
      snapshot: snapshotContext(),
      receivables: [receivable(101, 5000, 1), receivable(103, 5000, 2)],
    });
    const existingActive = await db.commissionReceivableSchedule.findMany({
      where: { orderSnapshotId: ORDER_SNAPSHOT_ID, status: "ACTIVE" },
    });
    const plan = planCommissionReceivableScheduleRebuild({ existingActive, drafts: v2 });

    assert.equal(plan.toCreate.length, 2);
    assert.equal(plan.toSupersede.length, 1);
    assert.equal(plan.toSupersede[0].receivableId, 101);

    await persistCommissionReceivableScheduleRebuild(db as never, {
      orderSnapshotId: ORDER_SNAPSHOT_ID,
      plan,
      drafts: v2,
      dryRun: false,
    });

    const active = [...db.schedules.values()].filter((row) => row.status === "ACTIVE");
    assert.equal(active.length, 2);
    assert.ok(active.some((row) => row.receivableId === 103));
  });

  it("rodar duas vezes não duplica", async () => {
    const db = createMockSchedulerDb();
    const drafts = buildCommissionReceivableScheduleDrafts({
      snapshot: snapshotContext(),
      receivables: [receivable(101, 5000, 1), receivable(102, 5000, 2)],
    });

    const firstPlan = planCommissionReceivableScheduleRebuild({ existingActive: [], drafts });
    await persistCommissionReceivableScheduleRebuild(db as never, {
      orderSnapshotId: ORDER_SNAPSHOT_ID,
      plan: firstPlan,
      drafts,
      dryRun: false,
    });

    const existingActive = await db.commissionReceivableSchedule.findMany({
      where: { orderSnapshotId: ORDER_SNAPSHOT_ID, status: "ACTIVE" },
    });
    const secondPlan = planCommissionReceivableScheduleRebuild({ existingActive, drafts });
    const second = await persistCommissionReceivableScheduleRebuild(db as never, {
      orderSnapshotId: ORDER_SNAPSHOT_ID,
      plan: secondPlan,
      drafts,
      dryRun: false,
    });

    assert.equal(firstPlan.toCreate.length, 2);
    assert.equal(secondPlan.toCreate.length, 0);
    assert.equal(secondPlan.unchanged.length, 2);
    assert.equal(second.action, "unchanged");
    assert.equal([...db.schedules.values()].filter((row) => row.status === "ACTIVE").length, 2);
  });

  it("cliente excluído mantém schedule com comissão zero e status CUSTOMER_EXCLUDED", () => {
    const drafts = buildCommissionReceivableScheduleDrafts({
      snapshot: snapshotContext({
        totalFinalCommissionAmount: 0,
        itemStatuses: ["CUSTOMER_EXCLUDED"],
      }),
      receivables: [receivable(101, 5000, 1), receivable(102, 5000, 2)],
    });

    assert.equal(deriveReceivableScheduleStatus({ itemStatuses: ["CUSTOMER_EXCLUDED"], totalFinalCommissionAmount: 0 }), "CUSTOMER_EXCLUDED");
    assert.equal(drafts[0].status, "CUSTOMER_EXCLUDED");
    assert.equal(drafts[0].scheduledCommissionAmount, 0);
    assert.equal(drafts[1].scheduledCommissionAmount, 0);
    assert.ok(drafts[0].sourceHash.length === 64);
    assert.notEqual(
      drafts[0].sourceHash,
      buildCommissionReceivableScheduleSourceHash({
        orderSnapshotId: ORDER_SNAPSHOT_ID,
        orderSnapshotSourceHash: SNAPSHOT_HASH,
        receivableId: 101,
        receivableNominalAmount: 5000,
        receivableSharePercent: 50,
        scheduledCommissionAmount: 80,
        status: "ACTIVE",
      })
    );
  });
});
