/**
 * Histórico Nomus (competências até 09/2026) na UI de comissões — render estático
 * real: banner obrigatório, fontes oficiais, "TENHO CIÊNCIA", PDF com marcador em
 * toda página e nota de cobertura no detalhamento. Loader vazio para `.css`.
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import { before, describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  aggregateCommissionReceiptPreview,
  type CommissionReceiptPreviewLine,
} from "./commissions/commissionReceiptEngine.js";
import { buildCommissionReceiptLedgerLineKey } from "./commissions/commissionReceiptLedger.js";
import {
  buildReceiptClosingPageFromPreview,
  type ReceiptClosingPagePayload,
} from "./commissions/commissionReceiptClosingApi.js";
import {
  COMMISSION_LEGACY_REPORT_TEXT,
  getCommissionReportingAuthority,
  getCommissionReportingAuthorityForRange,
} from "./commissions/commissionCoverageCutover.js";
import {
  COMMISSION_LEGACY_OFFICIAL_REPORT_MISSING,
  type CommissionLegacyOfficialReportStatus,
} from "./commissions/commissionReceiptCoverage.shared.js";
import type { CommissionsReceiptClosingLine } from "../components/commissions/commissionsTypes.js";

register(
  `data:text/javascript,${encodeURIComponent(
    'export async function load(url, context, next) { if (url.endsWith(".css")) return { format: "module", source: "", shortCircuit: true }; return next(url, context); }'
  )}`,
  import.meta.url
);

let bannerModule: typeof import("../components/commissions/CommissionLegacyPeriodBanner.js");
let panelModule: typeof import("../components/commissions/CommissionReportingSourcesPanel.js");
let dialogModule: typeof import("../components/commissions/CommissionTechnicalMirrorConfirmDialog.js");
let printModule: typeof import("../components/commissions/CommissionClosingReportPrintDocument.js");
let tableModule: typeof import("../components/commissions/CommissionsReceiptClosingDetailTable.js");

before(async () => {
  bannerModule = await import("../components/commissions/CommissionLegacyPeriodBanner.js");
  panelModule = await import("../components/commissions/CommissionReportingSourcesPanel.js");
  dialogModule = await import("../components/commissions/CommissionTechnicalMirrorConfirmDialog.js");
  printModule = await import("../components/commissions/CommissionClosingReportPrintDocument.js");
  tableModule = await import("../components/commissions/CommissionsReceiptClosingDetailTable.js");
});

function previewLine(year: number, month: number): CommissionReceiptPreviewLine {
  return {
    ledgerLineKey: buildCommissionReceiptLedgerLineKey({
      year,
      month,
      nomusReceivableId: 19413,
      commissionRecordId: null,
      commissionPaymentScheduleId: null,
      commissionReceivableScheduleId: "sch-19413",
      installmentNumber: 1,
      nomusOrderItemId: null,
      ruleId: null,
    }),
    year,
    month,
    nomusReceivableId: 19413,
    receivableNumber: "19413",
    installmentNumber: 1,
    settlementDate: "2026-09-02T00:00:00.000Z",
    receiptDate: "2026-08-31",
    receiptIds: [90002],
    dueDate: null,
    receivableAmount: 365.3,
    receivedAmount: 365.3,
    receivedSharePercent: 100,
    customerExternalId: 11,
    customerId: null,
    customerName: "ADNUSIA NOGUEIRA DE SOUZA NASCIMENTO",
    nomusNfeId: 7752,
    nfeNumber: "7752",
    orderCode: "PD 02801",
    localOrderId: null,
    nomusOrderItemId: null,
    localItemId: null,
    productCode: null,
    productName: null,
    rawSellerId: 464,
    rawSellerName: "JOSEANE",
    canonicalSellerId: "seller-joseane",
    canonicalSellerName: "JOSEANE",
    sellerResolutionStatus: "OK_CANONICAL",
    commissionRecordId: null,
    commissionPaymentScheduleId: null,
    commissionReceivableScheduleId: "sch-19413",
    ruleId: null,
    ruleName: null,
    ratePercent: 2.74,
    commissionableBaseAmount: 365.3,
    expectedCommissionAmount: 10,
    releasedCommissionAmount: 10,
    grossCommissionAmount: 10,
    status: "COMMISSIONABLE",
    statusReason: null,
    exclusionRuleId: null,
    exclusionReason: null,
    source: "RECEIVABLE_SCHEDULE",
  };
}

function page(year: number, month: number): ReceiptClosingPagePayload {
  const lines = [previewLine(year, month)];
  return buildReceiptClosingPageFromPreview({
    preview: aggregateCommissionReceiptPreview(lines, { year, month }, 1),
    closing: null,
    canApply: false,
    applyBlockedReason: null,
  });
}

function status(month: number, registered: boolean): CommissionLegacyOfficialReportStatus {
  return {
    year: 2026,
    month,
    registered,
    imports: registered
      ? [
          {
            id: `imp-${month}`,
            referenceYear: 2026,
            referenceMonth: month,
            filename: `nomus-2026-${String(month).padStart(2, "0")}.xlsx`,
            importedAt: "2026-10-02T10:00:00.000Z",
            importedBy: "admin",
            rowCount: 10,
            matchedCount: 10,
            unmatchedCount: 0,
            ambiguousCount: 0,
            alreadyCoveredCount: 0,
          },
        ]
      : [],
  };
}

const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("UI — histórico Nomus não oficial", () => {
  it("banner obrigatório com texto explícito (não depende de cor) e contexto do vendedor", () => {
    const html = renderToStaticMarkup(
      <bannerModule.CommissionLegacyPeriodBanner authority={getCommissionReportingAuthority(2026, 8)} />
    );
    const text = plain(html);
    assert.match(html, /role="note"/);
    assert.match(text, /HISTÓRICO PRÉ-INDUSCOST — NÃO OFICIAL/);
    assert.match(text, /reconstrução técnica do IndusCost para consulta e auditoria/);
    assert.match(text, /Fonte oficial deste período: Nomus/);
    assert.match(text, /Consulta histórica — fonte oficial Nomus · Valor reconstruído pelo IndusCost/);
    assert.doesNotMatch(text, /Valor oficial IndusCost/);
    assert.equal(
      renderToStaticMarkup(
        <bannerModule.CommissionLegacyPeriodBanner authority={getCommissionReportingAuthority(2026, 10)} />
      ),
      ""
    );
    // Intervalo que inclui o histórico (Relatórios com vários meses) também mostra o aviso.
    assert.match(
      renderToStaticMarkup(
        <bannerModule.CommissionLegacyPeriodBanner
          authority={getCommissionReportingAuthorityForRange({ year: 2026, month: 9 }, { year: 2026, month: 10 })}
        />
      ),
      /NÃO OFICIAL/
    );
  });

  it("CASO 14 e 15 — relatório oficial do Nomus: registrado (referência) ou não arquivado", () => {
    const registered = plain(
      renderToStaticMarkup(
        <bannerModule.CommissionLegacyPeriodBanner
          authority={getCommissionReportingAuthority(2026, 9)}
          officialReport={status(9, true)}
        />
      )
    );
    assert.match(registered, /Relatório oficial do Nomus registrado: SIM/);
    assert.match(registered, /nomus-2026-09\.xlsx/);
    const missing = plain(
      renderToStaticMarkup(
        <bannerModule.CommissionLegacyPeriodBanner
          authority={getCommissionReportingAuthority(2026, 8)}
          officialReport={status(8, false)}
        />
      )
    );
    assert.match(missing, /Relatório oficial do Nomus registrado: NÃO/);
    assert.ok(missing.includes(COMMISSION_LEGACY_OFFICIAL_REPORT_MISSING));
  });

  it("aba Relatórios/Fechamentos separa HISTÓRICO OFICIAL NOMUS de RELATÓRIOS OFICIAIS INDUSCOST", () => {
    const html = renderToStaticMarkup(
      <panelModule.CommissionReportingSourcesPanel
        year={2026}
        legacyReports={[status(8, false), status(9, true)]}
        onConsultLegacyMonth={() => {}}
        officialDescription="Fechamentos oficiais abaixo."
      />
    );
    const text = plain(html);
    assert.match(text, /Histórico oficial Nomus/i);
    assert.match(text, /Até setembro\/2026/);
    assert.match(text, /Relatórios oficiais IndusCost/i);
    assert.match(text, /A partir de outubro\/2026/);
    assert.match(text, /08\/2026 · Fonte oficial: Nomus/);
    assert.match(text, /Relatório oficial Nomus registrado: SIM — nomus-2026-09\.xlsx/);
    assert.match(text, /Relatório oficial Nomus registrado: NÃO/);
    assert.equal((html.match(/Consultar reconstrução técnica/g) ?? []).length, 2);
  });

  it("'TENHO CIÊNCIA' antes de exportar o espelho técnico (texto completo e ação explícita)", () => {
    const html = renderToStaticMarkup(
      <dialogModule.CommissionTechnicalMirrorConfirmDialog open periodLabel="09/2026" onCancel={() => {}} onConfirm={() => {}} />
    );
    const text = plain(html);
    assert.match(html, /role="dialog"/);
    assert.match(text, /TENHO CIÊNCIA/);
    for (const paragraph of COMMISSION_LEGACY_REPORT_TEXT.confirmBody) assert.ok(text.includes(paragraph));
    assert.match(text, /Cancelar/);
    assert.match(text, /Entendi — exportar espelho técnico/);
    assert.equal(
      renderToStaticMarkup(
        <dialogModule.CommissionTechnicalMirrorConfirmDialog open={false} periodLabel="09/2026" onCancel={() => {}} onConfirm={() => {}} />
      ),
      ""
    );
  });

  it("CASO 10 — PDF de setembro: marcador 'NÃO OFICIAL — PERÍODO NOMUS' fixo (repetido em toda página) e avisos", () => {
    const html = renderToStaticMarkup(
      <printModule.CommissionClosingReportPrintDocument payload={page(2026, 9)} branding={null} />
    );
    const text = plain(html);
    assert.equal((html.match(/comm-closing-legacy-page-marker--(top|bottom)/g) ?? []).length, 2);
    assert.equal((text.match(/NÃO OFICIAL — PERÍODO NOMUS/g) ?? []).length >= 2, true);
    assert.match(text, /ESPELHO TÉCNICO DE COMISSÕES — NÃO OFICIAL/);
    assert.match(text, /Fonte oficial deste período: Nomus/);
    assert.match(text, /Reconstrução técnica gerada pelo IndusCost/);
    assert.match(text, /NÃO utilizar como comprovante oficial de comissão\./);
    assert.doesNotMatch(text, /Comissão final a pagar/);

    const official = plain(
      renderToStaticMarkup(<printModule.CommissionClosingReportPrintDocument payload={page(2026, 10)} branding={null} />)
    );
    assert.doesNotMatch(official, /NÃO OFICIAL|PERÍODO NOMUS/);
    assert.match(official, /COMERCIAL: RELATÓRIO DE COMISSÕES/);
  });

  it("detalhe da linha histórica: 'Contemplado: Nomus 09/2026' com detalhe acessível", () => {
    const line: CommissionsReceiptClosingLine = {
      ...(page(2026, 8).lines[0] as unknown as CommissionsReceiptClosingLine),
      coverageNote: {
        tag: "Contemplado: Nomus 09/2026",
        detail: "Competência natural: 08/2026 · Fonte oficial: Nomus · Contemplado em: 09/2026 (Nomus)",
      },
    };
    const html = renderToStaticMarkup(
      <tableModule.CommissionsReceiptClosingDetailTable
        rows={[line]}
        totals={{ lineCount: 1, receivedAmount: 365.3, scheduledCommissionAmount: 10, releasedCommissionAmount: 10 }}
      />
    );
    assert.match(html, /data-testid="commissions-receipt-closing-coverage-tag"/);
    assert.match(plain(html), /Contemplado: Nomus 09\/2026/);
    assert.match(html, /class="sr-only"> — Competência natural: 08\/2026 · Fonte oficial: Nomus · Contemplado em: 09\/2026 \(Nomus\)/);
  });
});
