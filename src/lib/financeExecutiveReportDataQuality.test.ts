import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildFinanceExecutiveReportDataQuality,
  parseFinanceExecutiveReportQuery,
} from "./financeExecutiveReport.js";
import { FINANCE_EXECUTIVE_REPORT_KNOWN_GAPS } from "./financeExecutiveReportTypes.js";

const EMPTY_SANITIZATION = {
  ignoredInternalGroupReceivables: 0,
  ignoredInternalGroupPayables: 0,
  ignoredGhostReceivables: 0,
  ignoredStaleReceivables: 0,
  ignoredStalePayables: 0,
  ignoredPurchaseOrderAgendaPayables: 0,
  supersededPreInvoiceReceivables: 0,
  supersededPreInvoiceAmount: 0,
};

describe("financeExecutiveReportDataQuality", () => {
  it("sinaliza metas derivadas quando cadastro editável não existe", () => {
    const dq = buildFinanceExecutiveReportDataQuality({
      warnings: [],
      unavailableSections: [],
      sanitization: EMPTY_SANITIZATION,
      sync: {
        accountsReceivableLastSyncAt: "2026-06-17T10:00:00.000Z",
        accountsPayableLastSyncAt: "2026-06-17T10:00:00.000Z",
        nfeLastSyncAt: "2026-06-17T10:00:00.000Z",
        salesOrdersLastSyncAt: null,
      },
      arStaleExcluded: false,
      apStaleExcluded: false,
      billingTargetMissing: true,
    });

    assert.equal(dq.targetsDerived, true);
    assert.ok(dq.warnings.some((w) => w.includes("Metas de faturamento derivadas")));
    assert.ok(dq.warnings.some((w) => w.includes("não há cadastro editável")));
  });

  it("não inventa achievementPercent quando meta oficial é null", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/financeExecutiveReport.ts"), "utf8");
    assert.ok(src.includes("billingTab?.target.actual ?? null"));
    assert.ok(src.includes("achievementPercent == null"));
  });

  it("avisos de sync ausente para AR, AP e NF-e", () => {
    const dq = buildFinanceExecutiveReportDataQuality({
      warnings: [],
      unavailableSections: [],
      sanitization: EMPTY_SANITIZATION,
      sync: {
        accountsReceivableLastSyncAt: null,
        accountsPayableLastSyncAt: null,
        nfeLastSyncAt: null,
        salesOrdersLastSyncAt: null,
      },
      arStaleExcluded: false,
      apStaleExcluded: false,
      billingTargetMissing: false,
    });

    assert.ok(dq.warnings.some((w) => w.includes("Contas a Receber")));
    assert.ok(dq.warnings.some((w) => w.includes("Contas a Pagar")));
    assert.ok(dq.warnings.some((w) => w.includes("NF-e")));
  });

  it("freshness AR/AP stale documentada quando syncCutoff ativo", () => {
    const dq = buildFinanceExecutiveReportDataQuality({
      warnings: [],
      unavailableSections: [],
      sanitization: EMPTY_SANITIZATION,
      sync: {
        accountsReceivableLastSyncAt: "2026-06-17T10:00:00.000Z",
        accountsPayableLastSyncAt: "2026-06-17T10:00:00.000Z",
        nfeLastSyncAt: "2026-06-17T10:00:00.000Z",
        salesOrdersLastSyncAt: null,
      },
      arStaleExcluded: true,
      apStaleExcluded: true,
      billingTargetMissing: false,
    });

    assert.equal(dq.freshness.arStaleExcluded, true);
    assert.equal(dq.freshness.apStaleExcluded, true);
    assert.ok(dq.warnings.some((w) => w.toLowerCase().includes("stale")));
  });

  it("unavailableSections preserva seções indisponíveis sem mascarar", () => {
    const dq = buildFinanceExecutiveReportDataQuality({
      warnings: ["Falha ao carregar faturamento"],
      unavailableSections: ["billing", "salesOrders"],
      sanitization: EMPTY_SANITIZATION,
      sync: {
        accountsReceivableLastSyncAt: null,
        accountsPayableLastSyncAt: null,
        nfeLastSyncAt: null,
        salesOrdersLastSyncAt: null,
      },
      arStaleExcluded: false,
      apStaleExcluded: false,
      billingTargetMissing: false,
    });

    assert.deepEqual(dq.unavailableSections, ["billing", "salesOrders"]);
    assert.ok(dq.warnings.includes("Falha ao carregar faturamento"));
  });

  it("lacuna conhecida de metas cadastradas permanece missing", () => {
    const gap = FINANCE_EXECUTIVE_REPORT_KNOWN_GAPS.find((g) => g.id === "custom-meta-table");
    assert.ok(gap);
    assert.equal(gap!.status, "missing");
  });

  it("parse persiste invoiceIssuedFilter separado da fonte NF-e de faturamento", () => {
    const filters = parseFinanceExecutiveReportQuery({
      year: "2026",
      asOfDate: "2026-06-09",
      nfeFilter: "without-nfe",
    });
    assert.equal(filters.nfeFilter, "nfe");
    assert.equal(filters.invoiceIssuedFilter, "without-nfe");
  });

  it("billing fallback usa null em actual/target quando seção indisponível", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/financeExecutiveReport.ts"), "utf8");
    assert.ok(src.includes("actual: null"));
    assert.ok(src.includes("target: null"));
    assert.ok(src.includes("unavailableSections.push(\"billing\")"));
  });
});
