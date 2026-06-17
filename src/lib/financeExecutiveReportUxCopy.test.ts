import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildExecutiveReportStaleSyncNotices,
  EXECUTIVE_REPORT_NO_TARGET_MESSAGE,
  EXECUTIVE_REPORT_SECTION_INTROS,
  EXECUTIVE_REPORT_SOURCES_LABEL,
  formatExecutiveReportBillingYearsSubtitle,
  formatExecutiveReportGeneratedFooter,
  formatExecutiveReportStaleSyncWarning,
} from "./financeExecutiveReportUxCopy.js";

describe("financeExecutiveReportUxCopy", () => {
  it("fontes oficiais documentadas", () => {
    assert.match(EXECUTIVE_REPORT_SOURCES_LABEL, /Nomus/);
    assert.match(EXECUTIVE_REPORT_SOURCES_LABEL, /Contas a Receber/);
    assert.match(EXECUTIVE_REPORT_SOURCES_LABEL, /Pedidos de Venda/);
  });

  it("rodapé de geração usa IndusCost e data formatada", () => {
    const footer = formatExecutiveReportGeneratedFooter("2026-06-17T14:30:00.000Z");
    assert.match(footer, /Documento gerado pelo IndusCost em/);
  });

  it("aviso de meta não cadastrada completo", () => {
    assert.match(EXECUTIVE_REPORT_NO_TARGET_MESSAGE, /indicadores de atingimento/);
  });

  it("aviso de sync stale inclui fonte e data", () => {
    const msg = formatExecutiveReportStaleSyncWarning(
      "Contas a Receber",
      "2026-06-12T10:00:00.000Z"
    );
    assert.match(msg, /Atenção/);
    assert.match(msg, /Contas a Receber/);
  });

  it("subtítulo de billing usa anos dinâmicos", () => {
    assert.match(formatExecutiveReportBillingYearsSubtitle([2024, 2025, 2026]), /2024 · 2025 · 2026/);
  });

  it("intros existem para todas as seções principais", () => {
    for (const key of [
      "summary",
      "billing-comparison",
      "billing-projection",
      "accounts-receivable",
      "accounts-payable",
      "cash-flow",
      "sales-orders",
      "conclusion",
    ]) {
      assert.ok(EXECUTIVE_REPORT_SECTION_INTROS[key]?.length, key);
    }
  });

  it("buildExecutiveReportStaleSyncNotices quando freshness ativo", () => {
    const notices = buildExecutiveReportStaleSyncNotices({
      sanitization: null,
      warnings: [],
      unavailableSections: [],
      targetsDerived: true,
      sync: {
        accountsReceivableLastSyncAt: "2026-06-12T10:00:00.000Z",
        accountsPayableLastSyncAt: "2026-06-12T11:00:00.000Z",
        nfeLastSyncAt: "2026-06-12T12:00:00.000Z",
        salesOrdersLastSyncAt: null,
      },
      freshness: { arStaleExcluded: true, apStaleExcluded: true },
    });
    assert.equal(notices.length, 3);
  });
});
