import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateAutoApplyTotals,
  buildAutoApplyReportMarkdown,
  NOMUS_AUTO_SYNC_APPROVED_BY,
} from "./nomusBomAutoApplyAfterSync";
import type {
  NomusBomAutoApplyProductResult,
  NomusBomAutoApplyReport,
} from "./nomusBomAutoApplyAfterSyncTypes";

describe("nomusBomAutoApplyAfterSync — agregação de totais", () => {
  const products: NomusBomAutoApplyProductResult[] = [
    {
      parentCode: "307.05AA",
      productId: "p1",
      status: "APPLIED",
      canApply: true,
      blockingReasons: [],
      summary: { created: 0, updated: 2, removed: 0, kept: 5, skipped: 0, blocked: 0 },
    },
    {
      parentCode: "611.48AA",
      productId: "p2",
      status: "NO_CHANGES",
      canApply: true,
      blockingReasons: [],
      summary: { created: 0, updated: 0, removed: 0, kept: 10, skipped: 0, blocked: 0 },
    },
    {
      parentCode: "304.02AA",
      productId: "p3",
      status: "BLOCKED",
      canApply: false,
      blockingReasons: ["Opcionais de precificação ainda não estão resolvidos."],
    },
    {
      parentCode: "999.99XX",
      productId: null,
      status: "ERROR",
      canApply: false,
      blockingReasons: [],
      errorMessage: "timeout simulado",
    },
  ];

  it("conta aplicados, bloqueados e erros sem confundir status", () => {
    const totals = aggregateAutoApplyTotals(products, 120);
    assert.equal(totals.parentsInNomusStage, 120);
    assert.equal(totals.parentsEvaluated, 4);
    assert.equal(totals.parentsApplied, 1);
    assert.equal(totals.parentsNoChanges, 1);
    assert.equal(totals.parentsBlocked, 1);
    assert.equal(totals.parentsErrored, 1);
    assert.equal(totals.linesUpdated, 2);
    assert.equal(totals.linesKept, 15);
  });

  it("307.05AA entra como caso aplicado com 2 updates", () => {
    const pilot = products.find((p) => p.parentCode === "307.05AA");
    assert.ok(pilot);
    assert.equal(pilot!.status, "APPLIED");
    assert.equal(pilot!.summary?.updated, 2);
  });

  it("metadata-only conta como updated sem UPDATE_PRODUCT_BOM_QUANTITY", () => {
    const metadataOnly: NomusBomAutoApplyProductResult[] = [
      {
        parentCode: "307.05AA",
        productId: "p1",
        status: "APPLIED",
        canApply: true,
        blockingReasons: [],
        summary: { created: 0, updated: 2, removed: 0, kept: 0, skipped: 0, blocked: 0 },
        actionsPreview: [
          {
            actionType: "UPDATE_PRODUCT_BOM_NOMUS_METADATA",
            componentCode: "115.01--",
            currentQuantity: 0.001268,
            effectiveQuantity: 0.001268,
          },
          {
            actionType: "UPDATE_PRODUCT_BOM_NOMUS_METADATA",
            componentCode: "121.16--",
            currentQuantity: 0.000033,
            effectiveQuantity: 0.000033,
          },
        ],
      },
    ];
    const totals = aggregateAutoApplyTotals(metadataOnly, 1);
    assert.equal(totals.parentsApplied, 1);
    assert.equal(totals.linesUpdated, 2);
  });
});

describe("nomusBomAutoApplyAfterSync — relatório markdown", () => {
  it("gera seções de totais, bloqueados e erros", () => {
    const report: NomusBomAutoApplyReport = {
      generatedAt: "2026-05-26T12:00:00.000Z",
      mode: "APPLY",
      startedAt: "2026-05-26T11:59:00.000Z",
      finishedAt: "2026-05-26T12:00:00.000Z",
      approvedBy: NOMUS_AUTO_SYNC_APPROVED_BY,
      batchRunId: "batch-1",
      reportMdPath: null,
      reportJsonPath: null,
      totals: aggregateAutoApplyTotals(
        [
          {
            parentCode: "307.05AA",
            productId: "p1",
            status: "APPLIED",
            canApply: true,
            blockingReasons: [],
            summary: { created: 0, updated: 2, removed: 0, kept: 3, skipped: 0, blocked: 0 },
            actionsPreview: [
              {
                actionType: "UPDATE_PRODUCT_BOM_QUANTITY",
                componentCode: "115.01--",
                currentQuantity: 0.002951,
                effectiveQuantity: 0.001268,
              },
              {
                actionType: "UPDATE_PRODUCT_BOM_QUANTITY",
                componentCode: "121.16--",
                currentQuantity: 0.000602,
                effectiveQuantity: 0.000033,
              },
            ],
          },
          {
            parentCode: "304.02AA",
            productId: "p2",
            status: "BLOCKED",
            canApply: false,
            blockingReasons: ["Opcionais pendentes"],
          },
        ],
        2
      ),
      products: [],
    };

    const md = buildAutoApplyReportMarkdown({
      ...report,
      products: [
        {
          parentCode: "307.05AA",
          productId: "p1",
          status: "APPLIED",
          canApply: true,
          blockingReasons: [],
          summary: { created: 0, updated: 2, removed: 0, kept: 3, skipped: 0, blocked: 0 },
          actionsPreview: [
            {
              actionType: "UPDATE_PRODUCT_BOM_QUANTITY",
              componentCode: "115.01--",
              currentQuantity: 0.002951,
              effectiveQuantity: 0.001268,
            },
          ],
        },
        {
          parentCode: "304.02AA",
          productId: "p2",
          status: "BLOCKED",
          canApply: false,
          blockingReasons: ["Opcionais pendentes"],
        },
      ],
    });

    assert.match(md, /307\.05AA/);
    assert.match(md, /115\.01--/);
    assert.match(md, /0\.002951/);
    assert.match(md, /0\.001268/);
    assert.match(md, /Produtos bloqueados/);
    assert.match(md, /304\.02AA/);
  });
});
