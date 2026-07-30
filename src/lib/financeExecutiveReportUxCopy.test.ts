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
  translateExecutiveReportWarning,
} from "./financeExecutiveReportUxCopy.js";

describe("financeExecutiveReportUxCopy", () => {
  it("fontes oficiais em linguagem simples", () => {
    assert.match(EXECUTIVE_REPORT_SOURCES_LABEL, /notas fiscais/);
    assert.match(EXECUTIVE_REPORT_SOURCES_LABEL, /contas a receber/);
    assert.match(EXECUTIVE_REPORT_SOURCES_LABEL, /pedidos/);
    assert.ok(!EXECUTIVE_REPORT_SOURCES_LABEL.includes("Nomus"));
  });

  it("rodapé de geração usa IndusCost e data formatada", () => {
    const footer = formatExecutiveReportGeneratedFooter("2026-06-17T14:30:00.000Z");
    assert.match(footer, /Documento gerado pelo IndusCost em/);
  });

  it("aviso de meta não cadastrada em linguagem simples", () => {
    assert.match(EXECUTIVE_REPORT_NO_TARGET_MESSAGE, /meta cadastrada/i);
    assert.match(EXECUTIVE_REPORT_NO_TARGET_MESSAGE, /referência automática/i);
  });

  it("aviso de sync stale inclui fonte e data", () => {
    const msg = formatExecutiveReportStaleSyncWarning(
      "Contas a Receber",
      "2026-06-12T10:00:00.000Z"
    );
    assert.match(msg, /Atenção/);
    assert.match(msg, /desatualizados/i);
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

  it("translateExecutiveReportWarning simplifica metas derivadas", () => {
    const msg = translateExecutiveReportWarning(
      "Metas de faturamento derivadas (+20% sobre período anterior); não há cadastro editável de metas."
    );
    assert.match(msg, /Meta estimada/i);
    assert.ok(!msg.includes("derivadas (+20%"));
  });
});
