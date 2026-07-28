/**
 * Backfill de complementos Tesouraria — preview/apply (lógica pura).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  assertBackfillDoesNotTouchOfficialTitles,
  buildTreasuryTitleComplementBackfillPreviewReport,
  buildTreasuryTitleComplementCreateSeed,
  chunkTreasuryBackfillItems,
  compareTreasuryBackfillCursor,
  createEmptyTreasuryBackfillCheckpoint,
  estimateTreasuryBackfillApplyMs,
  isAfterTreasuryBackfillCursor,
  isOfficialTitleCancelled,
  isOfficialTitleSettled,
  moneyFromOfficial,
  parseTreasuryBackfillCursor,
  parseTreasuryTitleComplementBackfillCli,
  planTreasuryTitleComplementBackfill,
  serializeTreasuryBackfillCursor,
  TREASURY_TITLE_COMPLEMENT_BACKFILL_NOTES,
  type TreasuryOfficialTitleBackfillSeed,
} from "./treasuryTitleComplementBackfill.js";

const ROOT = process.cwd();
const USER = "11111111-1111-4111-8111-111111111111";

function title(
  overrides: Partial<TreasuryOfficialTitleBackfillSeed> &
    Pick<TreasuryOfficialTitleBackfillSeed, "officialTitleId" | "officialExternalId">
): TreasuryOfficialTitleBackfillSeed {
  return {
    titleType: "RECEIVABLE",
    dueDate: "2026-07-20",
    scheduleDate: null,
    openBalance: "100.00",
    status: false,
    sourcePresenceStatus: "PRESENT",
    sourceRemovedAt: null,
    ...overrides,
  };
}

describe("treasuryTitleComplementBackfill — CLI", () => {
  it("parseia preview/apply e flags", () => {
    const preview = parseTreasuryTitleComplementBackfillCli([
      "preview",
      "--title-type=receivable",
      "--from=2026-01-01",
      "--to=2026-12-31",
      "--batch-size=50",
      "--json",
    ]);
    assert.equal(preview.mode, "preview");
    assert.equal(preview.titleType, "RECEIVABLE");
    assert.equal(preview.from, "2026-01-01");
    assert.equal(preview.to, "2026-12-31");
    assert.equal(preview.batchSize, 50);
    assert.equal(preview.json, true);

    const apply = parseTreasuryTitleComplementBackfillCli(
      [
        "apply",
        "--title-type=all",
        "--created-by-user-id=" + USER,
        "--checkpoint-file=.tmp/cp.json",
        "--resume",
      ],
      {}
    );
    assert.equal(apply.mode, "apply");
    assert.equal(apply.createdByUserId, USER);
    assert.equal(apply.checkpointFile, ".tmp/cp.json");
    assert.equal(apply.resume, true);

    assert.throws(() => parseTreasuryTitleComplementBackfillCli(["dry"]), /preview|apply/);
  });

  it("lê createdByUserId e checkpoint do env", () => {
    const opts = parseTreasuryTitleComplementBackfillCli(["preview"], {
      TREASURY_BACKFILL_CREATED_BY_USER_ID: USER,
      TREASURY_TITLE_COMPLEMENT_BACKFILL_CHECKPOINT_FILE: "cp.json",
    });
    assert.equal(opts.createdByUserId, USER);
    assert.equal(opts.checkpointFile, "cp.json");
  });
});

describe("treasuryTitleComplementBackfill — classificação", () => {
  it("marca elegíveis para CREATE e preserva existentes (idempotência)", () => {
    const plan = planTreasuryTitleComplementBackfill({
      createdByUserId: USER,
      titles: [
        title({ officialTitleId: "a1", officialExternalId: 1 }),
        title({ officialTitleId: "a2", officialExternalId: 2 }),
      ],
      existingComplements: [
        {
          id: "c1",
          titleType: "RECEIVABLE",
          officialTitleId: "a1",
          officialExternalId: 1,
          cancelledAt: null,
        },
      ],
    });

    assert.equal(plan.counters.titlesFound, 2);
    assert.equal(plan.counters.existingComplements, 1);
    assert.equal(plan.counters.wouldCreate, 1);
    assert.equal(plan.toCreate[0]?.officialTitleId, "a2");
    assert.equal(plan.toCreate[0]?.create?.notes, TREASURY_TITLE_COMPLEMENT_BACKFILL_NOTES);
    assert.equal(plan.toCreate[0]?.create?.expectedDate, "2026-07-20");
    assert.equal(plan.toCreate[0]?.create?.expectedAmount, "100.00");
  });

  it("não recria complemento cancelado; conta cancelados/settled/inconsistências/duplicidades", () => {
    const plan = planTreasuryTitleComplementBackfill({
      createdByUserId: USER,
      titles: [
        title({
          officialTitleId: "cxl",
          officialExternalId: 10,
          sourcePresenceStatus: "MISSING_CONFIRMED",
        }),
        title({
          officialTitleId: "settled",
          officialExternalId: 11,
          openBalance: "0.00",
          status: true,
        }),
        title({
          officialTitleId: "nodate",
          officialExternalId: 12,
          dueDate: null,
        }),
        title({ officialTitleId: "dup-a", officialExternalId: 99 }),
        title({ officialTitleId: "dup-b", officialExternalId: 99 }),
        title({
          officialTitleId: "cancelled-comp",
          officialExternalId: 13,
        }),
        title({
          officialTitleId: "mismatch",
          officialExternalId: 14,
        }),
      ],
      existingComplements: [
        {
          id: "cc",
          titleType: "RECEIVABLE",
          officialTitleId: "cancelled-comp",
          officialExternalId: 13,
          cancelledAt: "2026-07-01T00:00:00.000Z",
        },
        {
          id: "mm",
          titleType: "RECEIVABLE",
          officialTitleId: "other-title",
          officialExternalId: 14,
          cancelledAt: null,
        },
      ],
    });

    assert.equal(plan.counters.skippedCancelledOfficial, 1);
    assert.equal(plan.counters.skippedSettled, 1);
    assert.ok(plan.counters.inconsistencies >= 2);
    assert.equal(plan.counters.duplicates, 2);
    assert.equal(plan.counters.existingCancelledComplements, 1);
    assert.equal(plan.counters.wouldCreate, 0);
  });

  it("PAYABLE usa scheduleDate quando disponível", () => {
    const seed = buildTreasuryTitleComplementCreateSeed(
      title({
        titleType: "PAYABLE",
        officialTitleId: "p1",
        officialExternalId: 5,
        dueDate: "2026-08-01",
        scheduleDate: "2026-08-10",
        openBalance: "50.00",
      }),
      USER
    );
    assert.equal(seed?.expectedDate, "2026-08-10");
    assert.equal(seed?.scheduledDate, "2026-08-10");
    assert.equal(seed?.scheduledAmount, "50.00");
  });

  it("helpers de settled/cancelled/money", () => {
    assert.equal(
      isOfficialTitleCancelled({
        sourcePresenceStatus: "PRESENT",
        sourceRemovedAt: "2026-01-01",
      }),
      true
    );
    assert.equal(
      isOfficialTitleSettled({ status: false, openBalance: "0.00" }),
      true
    );
    assert.equal(moneyFromOfficial({ toFixed: () => "12.30" }), "12.30");
  });
});

describe("treasuryTitleComplementBackfill — checkpoint/lotes/preview", () => {
  it("cursor e lotes suportam retomada", () => {
    const a = { titleType: "PAYABLE" as const, officialExternalId: 1 };
    const b = { titleType: "RECEIVABLE" as const, officialExternalId: 1 };
    assert.ok(compareTreasuryBackfillCursor(a, b) < 0);
    const cur = serializeTreasuryBackfillCursor(a);
    assert.deepEqual(parseTreasuryBackfillCursor(cur), a);
    assert.equal(isAfterTreasuryBackfillCursor(a, a), false);
    assert.equal(
      isAfterTreasuryBackfillCursor(
        { titleType: "PAYABLE", officialExternalId: 2 },
        a
      ),
      true
    );

    assert.deepEqual(chunkTreasuryBackfillItems([1, 2, 3, 4, 5], 2), [
      [1, 2],
      [3, 4],
      [5],
    ]);

    const cp = createEmptyTreasuryBackfillCheckpoint({
      runId: "r1",
      titleType: "ALL",
      from: "2026-01-01",
      to: "2026-12-31",
    });
    assert.equal(cp.completed, false);
    assert.equal(cp.cursor, null);
  });

  it("preview report expõe métricas obrigatórias e estimativa", () => {
    const plan = planTreasuryTitleComplementBackfill({
      createdByUserId: USER,
      titles: [
        title({ officialTitleId: "a1", officialExternalId: 1 }),
        title({
          officialTitleId: "a2",
          officialExternalId: 2,
          sourceRemovedAt: "2026-01-01",
        }),
      ],
      existingComplements: [],
    });
    const report = buildTreasuryTitleComplementBackfillPreviewReport({
      mode: "preview",
      options: {
        from: "2026-01-01",
        to: "2026-12-31",
        titleType: "ALL",
        batchSize: 100,
      },
      plan,
      sampleDurationMs: 40,
    });

    assert.equal(report.period.from, "2026-01-01");
    assert.equal(report.titlesFound, 2);
    assert.equal(report.eligible, 1);
    assert.equal(report.wouldCreate, 1);
    assert.equal(report.cancelledOfficial, 1);
    assert.equal(report.existingComplements, 0);
    assert.ok(report.estimate.estimatedTotalApplyMs >= 0);
    assert.ok(report.sampleWouldCreate.length >= 1);
  });

  it("estimate e guard de campos oficiais", () => {
    const est = estimateTreasuryBackfillApplyMs({
      wouldCreate: 1000,
      batchSize: 200,
      sampleSize: 1000,
      sampleDurationMs: 500,
    });
    assert.equal(est.estimatedBatches, 5);
    assert.ok(est.estimatedTotalApplyMs > 0);

    assert.throws(
      () =>
        assertBackfillDoesNotTouchOfficialTitles({
          officialTitleId: "x",
          dueDate: "2026-01-01",
        }),
      /dueDate/
    );
    assert.doesNotThrow(() =>
      assertBackfillDoesNotTouchOfficialTitles({
        officialTitleId: "x",
        expectedDate: "2026-01-01",
      })
    );
  });
});

describe("treasuryTitleComplementBackfill — wiring", () => {
  it("script e package.json registram preview/apply", () => {
    const script = readFileSync(
      join(ROOT, "scripts/treasuryTitleComplementBackfill.ts"),
      "utf8"
    );
    const pkg = readFileSync(join(ROOT, "package.json"), "utf8");
    assert.match(script, /runTreasuryTitleComplementBackfill/);
    assert.match(script, /preview/);
    assert.match(script, /apply/);
    assert.match(pkg, /backfill:treasury:title-complements:preview/);
    assert.match(pkg, /backfill:treasury:title-complements:apply/);

    const server = readFileSync(
      join(ROOT, "src/lib/treasury/treasuryTitleComplementBackfill.server.ts"),
      "utf8"
    );
    assert.match(server, /createComplementIdempotent|findByOfficialTitle/);
    assert.match(server, /saveCheckpoint|loadCheckpoint/);
    assert.doesNotMatch(server, /nomusAccountsReceivable\.update|deleteMany/);
    assert.doesNotMatch(server, /treasuryTitleOperationalComplement\.delete/);
  });
});
