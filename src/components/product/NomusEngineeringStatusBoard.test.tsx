import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  nextSnapshotWithAutoApply,
  type StatusSnapshot,
} from "./NomusEngineeringStatusBoard";
import type { AutoApplyBomDashboardResult } from "@/src/lib/nomusAutoApplyBomDashboardTypes";

const boardSrc = readFileSync(
  join(process.cwd(), "src/components/product/NomusEngineeringStatusBoard.tsx"),
  "utf8"
);

function fakeAutoApply(): AutoApplyBomDashboardResult {
  return {
    generatedAt: "2026-06-23T10:00:00.000Z",
    mode: "READ_ONLY",
    source: "REPORT_FILE",
    hasReport: true,
    hasProductList: true,
    needsReportRegeneration: false,
    regenerateReportCommand: null,
    productListSource: "products",
    checklistMdPath: null,
    partialReportWarning: null,
    emptyMessage: null,
    lastRun: null,
    totals: null,
    blockingReasonBuckets: [],
    products: [
      {
        parentCode: "308.05AB",
        productId: "p-308",
        status: "BLOCKED",
        canApply: false,
        errorMessage: null,
        primaryReason: "Itens locais pendentes",
        blockingReasons: ["Itens locais pendentes"],
        categories: [],
        filterBuckets: ["BLOCKED"],
        quantityDiffCount: 0,
        metadataOnlyCount: 0,
        localOnlyLineCodes: [],
        actionsPreview: [],
        pendingTypeLabel: "Item local pendente",
        recommendedAction: "Resolver itens locais",
        recommendedTab: "effective-pricing-bom",
        severity: 5,
        actionsCount: 0,
        actionsSummaryLines: [],
        readyToApply: false,
        hasUnappliedBomDiff: false,
        appliedToOfficialBom: false,
        planHash: null,
        confirmationRequiredText: null,
        diffSummary: "—",
        applyRunId: null,
        resultStatus: undefined,
      },
    ],
    filterCounts: {
      ALL: 1,
      BLOCKED: 1,
      DIVERGENT: 0,
      OPTIONAL_PENDING: 0,
      LOCAL_PENDING: 1,
      SKIPPED: 0,
      NO_CHANGES: 0,
      READY_TO_APPLY: 0,
      APPLIED: 0,
      ERROR: 0,
    },
    totalProducts: 876,
    filter: "ALL",
    search: null,
    matchedCount: 876,
    statusRevalidatedAt: "2026-06-23T10:00:00.000Z",
    revalidatedProductCount: 68,
    revalidationErrorCount: 0,
    batchTotalsNote: null,
    batchTotals: null,
  } as AutoApplyBomDashboardResult;
}

describe("nextSnapshotWithAutoApply", () => {
  it("preserva masterData/equalize/runs e substitui autoApply", () => {
    const prev: StatusSnapshot = {
      masterData: { totals: { missingTotal: 1 } } as never,
      equalize: { totals: {} } as never,
      autoApply: null,
      runs: [{ label: "run-1" } as never],
      generatedAt: "2026-06-23T09:00:00.000Z",
    };
    const next = nextSnapshotWithAutoApply(prev, fakeAutoApply(), "2026-06-23T10:00:00.000Z");
    assert.equal(next.masterData, prev.masterData);
    assert.equal(next.equalize, prev.equalize);
    assert.equal(next.runs, prev.runs);
    assert.ok(next.autoApply);
    assert.equal(next.autoApply?.hasProductList, true);
    assert.equal(next.autoApply?.products.length, 1);
    assert.equal(next.generatedAt, "2026-06-23T10:00:00.000Z");
  });

  it("cria snapshot quando não há anterior, mantendo o autoApply", () => {
    const next = nextSnapshotWithAutoApply(null, fakeAutoApply());
    assert.equal(next.masterData, null);
    assert.equal(next.equalize, null);
    assert.deepEqual(next.runs, []);
    assert.equal(next.autoApply?.hasProductList, true);
  });
});

describe("NomusEngineeringStatusBoard — proteção contra regressões de render", () => {
  it("aplica o snapshot antes de limpar pollJobId (não descarta a fila ao fim do job)", () => {
    const setSnapshotIdx = boardSrc.indexOf(
      "setSnapshot((prev) => nextSnapshotWithAutoApply(prev, autoApply));"
    );
    assert.ok(setSnapshotIdx > 0, "tick deve aplicar autoApply via nextSnapshotWithAutoApply");
    const clearPollIdx = boardSrc.indexOf("setPollJobId(null);", setSnapshotIdx);
    assert.ok(
      clearPollIdx > setSnapshotIdx,
      "setPollJobId(null) deve ocorrer DEPOIS de setSnapshot no tick de término"
    );
    // Guarda contra reentrância do tick após término.
    assert.match(boardSrc, /let finished = false;/);
    assert.match(boardSrc, /if \(finished\) return;/);
  });

  it("carrega o snapshot ao montar a tela quando não há job rodando", () => {
    assert.match(boardSrc, /await loadAll\(\);/);
    assert.match(boardSrc, /\}, \[loadAll\]\);/);
  });

  it("a tabela é renderizada por hasProductList e mostra mensagem de filtro vazio sem sumir a seção", () => {
    assert.match(boardSrc, /autoApply\.hasProductList \?/);
    assert.match(boardSrc, /Nenhum produto encontrado para este filtro\./);
    assert.match(boardSrc, /Limpar filtros/);
    // A origem da lista é exibida.
    assert.match(boardSrc, /productListSource/);
  });
});
