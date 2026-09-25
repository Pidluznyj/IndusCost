/**
 * Grid "Pendências de períodos anteriores" e etiqueta de pendência no
 * detalhamento — render estático real (sem recálculo no frontend).
 * Loader vazio para `.css` (commissionsUi importa componentes com CSS).
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import { before, describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CommissionsReceiptClosingLine } from "../components/commissions/commissionsTypes.js";
import {
  RECEIPT_CLOSING_CARRYOVER_HELP,
  summarizeCarryoverRows,
  type ReceiptClosingCarryoverRow,
  type ReceiptClosingCarryoverSection,
} from "./commissions/commissionReceiptCoverage.shared.js";

register(
  `data:text/javascript,${encodeURIComponent(
    'export async function load(url, context, next) { if (url.endsWith(".css")) return { format: "module", source: "", shortCircuit: true }; return next(url, context); }'
  )}`,
  import.meta.url
);

type GridModule = typeof import("../components/commissions/CommissionsReceiptClosingCarryoverGrid.js");
type TableModule = typeof import("../components/commissions/CommissionsReceiptClosingDetailTable.js");
let grid: GridModule;
let table: TableModule;

before(async () => {
  grid = await import("../components/commissions/CommissionsReceiptClosingCarryoverGrid.js");
  table = await import("../components/commissions/CommissionsReceiptClosingDetailTable.js");
});

function carryoverRow(partial: Partial<ReceiptClosingCarryoverRow> & Pick<ReceiptClosingCarryoverRow, "rowKey">): ReceiptClosingCarryoverRow {
  return {
    receivableExternalId: 50002,
    receiptExternalIds: [70002],
    receiptDate: "2026-10-31",
    naturalYear: 2026,
    naturalMonth: 10,
    state: "POST_CUTOVER_PENDING",
    origin: "INDUSCOST",
    inclusionType: "LATE_CARRYOVER",
    situation: "Recebimento sincronizado após fechamento",
    includable: true,
    blockedReason: null,
    selected: false,
    nfeNumber: "7801",
    orderCode: "PD 02900",
    customerName: "CLIENTE A",
    canonicalSellerId: "seller-gislene",
    canonicalSellerName: "GISLENE",
    rawSellerId: null,
    rawSellerName: "GISLENE",
    sellerResolutionStatus: "OK_CANONICAL",
    installmentNumber: 1,
    installmentTotal: 2,
    receivedAmount: 2000,
    receivableOriginalAmount: 2000,
    commissionableBaseAmount: 2000,
    commissionAmount: 50,
    lineStatus: "COMMISSIONABLE",
    statusReason: null,
    commissionReceivableScheduleId: "sch-50002",
    ...partial,
  };
}

const ROWS: ReceiptClosingCarryoverRow[] = [
  carryoverRow({ rowKey: "50002|2026-10" }),
  carryoverRow({
    rowKey: "19236|2026-08",
    receivableExternalId: 19236,
    receiptExternalIds: [90001],
    receiptDate: "2026-08-26",
    naturalMonth: 8,
    state: "LEGACY_PENDING_CANDIDATE",
    origin: "LEGACY_NOMUS",
    inclusionType: "LEGACY_CARRYOVER",
    situation: "Não encontrado na cobertura Nomus",
    includable: false,
    blockedReason: "Falta confirmação histórica: importe a cobertura do Nomus de 08/2026, 09/2026.",
    nfeNumber: "7704",
    customerName: "ACQUAPER BEBEDOUROS E EQUIPAMENTOS LTDA",
    receivedAmount: 499.35,
    receivableOriginalAmount: 499.35,
    commissionableBaseAmount: 499.35,
    commissionAmount: 17.2,
  }),
  carryoverRow({ rowKey: "50001|2026-10", receivableExternalId: 50001, receiptExternalIds: [70001], selected: true }),
];

function section(rows = ROWS): ReceiptClosingCarryoverSection {
  return {
    closingYear: 2026,
    closingMonth: 11,
    rows,
    summary: summarizeCarryoverRows(rows),
    legacyImportStatus: [
      { year: 2026, month: 8, imported: false },
      { year: 2026, month: 9, imported: true },
    ],
    selectionErrors: [{ receiptExternalId: 90001, reason: "Falta confirmação histórica" }],
  };
}

function renderGrid(options: { canInclude?: boolean } = {}): string {
  const data = section();
  const noop = () => {};
  return renderToStaticMarkup(
    <grid.CommissionsReceiptClosingCarryoverGrid
      section={data}
      rows={data.rows}
      summary={data.summary}
      checkedKeys={new Set(["50002|2026-10"])}
      canInclude={options.canInclude ?? true}
      busy={false}
      onToggleRow={noop}
      onSelectEligible={noop}
      onIncludeChecked={noop}
      onIncludeRow={noop}
      onRemoveRow={noop}
    />
  );
}

function headersOf(html: string): string[] {
  const thead = /<thead\b[^>]*>([\s\S]*?)<\/thead>/.exec(html)?.[1] ?? "";
  return [...thead.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map((m) =>
    m[1]!.replace(/<[^>]+>/g, "").trim()
  );
}

function rowHtml(html: string, rowKey: string): string {
  const match = new RegExp(`<tr[^>]*data-testid="commissions-receipt-closing-carryover-row-${rowKey.replace("|", "\\|")}"[^>]*>([\\s\\S]*?)</tr>`).exec(html);
  assert.ok(match, `linha ${rowKey}`);
  return match[0];
}

describe("grid de pendências de períodos anteriores", () => {
  it("título, texto auxiliar e colunas pedidas", () => {
    const html = renderGrid();
    assert.match(html, /Pendências de períodos anteriores/);
    assert.ok(html.includes(RECEIPT_CLOSING_CARRYOVER_HELP));
    assert.deepEqual(headersOf(html), [
      "Selecionar",
      "Competência",
      "NF",
      "CR",
      "Pedido",
      "Cliente",
      "Vendedor",
      "Parcela",
      "Recebido em",
      "Valor real",
      "Base comissão",
      "Comissão",
      "Origem",
      "Situação",
      "Ação",
    ]);
  });

  it("resumo: elegíveis, recebido, base, comissão potencial e ambíguos", () => {
    const html = renderGrid();
    const summary = /data-testid="commissions-receipt-closing-carryover-summary"[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "";
    const text = summary.replace(/<[^>]+>/g, "").replace(/&nbsp;| /g, " ");
    assert.match(text, /Elegíveis: 2/);
    assert.match(text, /Comissão potencial: R\$ 100,00/);
    assert.match(text, /Ambíguos: 0/);
    assert.match(text, /Aguardando cobertura Nomus: 1/);
    assert.match(html, /Cobertura do Nomus ainda não importada para[\s\S]*08\/2026/);
    assert.match(html, /Recebimento 90001: Falta confirmação histórica/);
  });

  it("linha elegível tem 'Incluir neste fechamento'; bloqueada mostra o motivo; incluída mostra 'Remover'", () => {
    const html = renderGrid();
    const eligible = rowHtml(html, "50002|2026-10");
    assert.match(eligible, /Incluir neste fechamento/);
    assert.match(eligible, /10\/2026/);
    assert.match(eligible, /31\/10\/2026/);
    assert.match(eligible, />IndusCost</);
    assert.match(eligible, /1\/2/);
    const blocked = rowHtml(html, "19236|2026-08");
    assert.match(blocked, /Bloqueada/);
    assert.match(blocked, /Falta confirmação histórica/);
    assert.match(blocked, /Pré-cutover \/ Nomus/);
    assert.match(blocked, /disabled=""/);
    const included = rowHtml(html, "50001|2026-10");
    assert.match(included, /Remover/);
    assert.match(included, /data-selected="true"/);
    assert.match(included, /checked=""/);
  });

  it("sem permissão de fechar: sem botões de inclusão", () => {
    const html = renderGrid({ canInclude: false });
    assert.doesNotMatch(html, /Incluir neste fechamento/);
    assert.doesNotMatch(html, /Selecionar elegíveis/);
    assert.doesNotMatch(html, /Incluir selecionados/);
  });

  it("botões de seleção múltipla com contagem das marcadas", () => {
    const html = renderGrid();
    assert.match(html, /Selecionar elegíveis/);
    assert.match(html, /Incluir selecionados \(1\)/);
  });

  it("'Selecionar elegíveis' desabilita quando todas as elegíveis já estão incluídas", () => {
    const rows = ROWS.map((row) => (row.includable ? { ...row, selected: true } : row));
    const data = section(rows);
    const noop = () => {};
    const html = renderToStaticMarkup(
      <grid.CommissionsReceiptClosingCarryoverGrid
        section={data}
        rows={data.rows}
        summary={data.summary}
        checkedKeys={new Set()}
        canInclude
        busy={false}
        onToggleRow={noop}
        onSelectEligible={noop}
        onIncludeChecked={noop}
        onIncludeRow={noop}
        onRemoveRow={noop}
      />
    );
    assert.match(html, /<button[^>]*disabled=""[^>]*data-testid="commissions-receipt-closing-carryover-select-eligible"/);
  });
});

describe("detalhamento — etiqueta de pendência retroativa (sem coluna nova)", () => {
  function line(partial: Partial<CommissionsReceiptClosingLine> & Pick<CommissionsReceiptClosingLine, "lineKey">): CommissionsReceiptClosingLine {
    return {
      nomusReceivableId: 50002,
      receivableNumber: "50002",
      installmentNumber: 1,
      installmentTotal: 1,
      settlementDate: null,
      dueDate: null,
      customerId: null,
      customerExternalId: null,
      customerName: "CLIENTE A",
      orderCode: "PD 02900",
      localOrderId: null,
      nomusNfeId: null,
      nfeNumber: "7801",
      localItemId: null,
      nomusOrderItemId: null,
      productCode: null,
      productName: null,
      rawSellerId: null,
      rawSellerName: "GISLENE",
      canonicalSellerId: "seller-gislene",
      canonicalSellerName: "GISLENE",
      sellerResolutionStatus: "OK_CANONICAL",
      receivedAmount: 2000,
      uniqueReceivedAmount: 2000,
      commissionableBaseAmount: 2000,
      ratePercent: 2.5,
      expectedCommissionAmount: 50,
      releasedCommissionAmount: 50,
      grossCommissionAmount: 50,
      scheduledCommissionAmount: 50,
      commissionReceivableScheduleId: "sch-50002",
      ruleId: null,
      ruleName: null,
      exclusionReason: null,
      status: "COMMISSIONABLE",
      statusReason: null,
      source: "RECEIVABLE_SCHEDULE",
      ...partial,
    };
  }

  it("linha incluída como pendência leva 'Retroativa MM/AAAA' na célula da NF; 12 colunas preservadas", () => {
    const html = renderToStaticMarkup(
      <table.CommissionsReceiptClosingDetailTable
        rows={[
          line({ lineKey: "normal", nomusReceivableId: 50001, nfeNumber: "7800" }),
          line({ lineKey: "carry", inclusionType: "LATE_CARRYOVER", naturalYear: 2026, naturalMonth: 10 }),
        ]}
        totals={{ lineCount: 2, receivedAmount: 4000, scheduledCommissionAmount: 100, releasedCommissionAmount: 100 }}
      />
    );
    assert.equal(headersOf(html).length, 12);
    assert.equal((html.match(/data-testid="commissions-receipt-closing-carryover-tag"/g) ?? []).length, 1);
    assert.match(html, /7801<span[^>]*title="Pendência pós-cutover"[^>]*>Retroativa 10\/2026<\/span>/);
  });
});
