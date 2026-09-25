/**
 * Detalhamento do fechamento por recebimento — render estático real da tabela:
 * coluna Parcela (n/total), Status como bolinha com tooltip e texto acessível,
 * 12 colunas alinhadas no thead, tbody e tfoot, e uma única <table>.
 * Loader vazio para `.css` (commissionsUi importa componentes com CSS).
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import { before, describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CommissionsReceiptClosingLine } from "../components/commissions/commissionsTypes.js";
import { formatFinanceCurrency } from "./financeAccountsReceivableFormat.js";

register(
  `data:text/javascript,${encodeURIComponent(
    'export async function load(url, context, next) { if (url.endsWith(".css")) return { format: "module", source: "", shortCircuit: true }; return next(url, context); }'
  )}`,
  import.meta.url
);

type TableModule = typeof import("../components/commissions/CommissionsReceiptClosingDetailTable.js");
let mod: TableModule;

before(async () => {
  mod = await import("../components/commissions/CommissionsReceiptClosingDetailTable.js");
});

function line(partial: Partial<CommissionsReceiptClosingLine> & Pick<CommissionsReceiptClosingLine, "lineKey">): CommissionsReceiptClosingLine {
  return {
    nomusReceivableId: 201,
    receivableNumber: "7651",
    installmentNumber: 1,
    installmentTotal: 3,
    settlementDate: "2026-09-12T00:00:00.000Z",
    dueDate: "2026-09-10T00:00:00.000Z",
    customerId: "cust-1",
    customerExternalId: 10,
    customerName: "E Energy Soluções",
    orderCode: "PD 02838",
    localOrderId: "order-1",
    nomusNfeId: 7651,
    nfeNumber: "7651",
    localItemId: null,
    nomusOrderItemId: null,
    productCode: null,
    productName: null,
    rawSellerId: 464,
    rawSellerName: "JOSEANE",
    canonicalSellerId: "seller-1",
    canonicalSellerName: "Joseane Aparecida Correa",
    sellerResolutionStatus: "OK_CANONICAL",
    receivedAmount: 1000,
    uniqueReceivedAmount: 1000,
    receivableOriginalAmount: 1000,
    commissionPrincipalAmount: 1000,
    ignoredFinancialChargesAmount: 0,
    auditFlags: [],
    commissionableBaseAmount: 1000,
    ratePercent: 2,
    expectedCommissionAmount: 20,
    releasedCommissionAmount: 20,
    grossCommissionAmount: 20,
    scheduledCommissionAmount: 20,
    commissionReceivableScheduleId: "sched-1",
    ruleId: null,
    ruleName: null,
    exclusionReason: null,
    status: "COMMISSIONABLE",
    statusReason: null,
    source: "MATERIALIZED_SCHEDULE",
    ...partial,
  };
}

const ROWS: CommissionsReceiptClosingLine[] = [
  line({ lineKey: "a" }),
  line({
    lineKey: "b",
    nomusReceivableId: 202,
    installmentNumber: 2,
    installmentTotal: null,
    uniqueReceivedAmount: 500,
    receivedAmount: 500,
    scheduledCommissionAmount: 10,
    releasedCommissionAmount: 10,
    status: "CUSTOMER_EXCLUDED",
  }),
  line({
    lineKey: "c",
    nomusReceivableId: 300,
    installmentNumber: null,
    installmentTotal: null,
    uniqueReceivedAmount: 250,
    receivedAmount: 250,
    scheduledCommissionAmount: null,
    releasedCommissionAmount: 0,
    status: "NO_SCHEDULE",
    statusReason: "Título sem schedule de comissão",
  }),
];
const TOTALS = { lineCount: 3, receivedAmount: 1750, scheduledCommissionAmount: 30, releasedCommissionAmount: 30 };

const EXPECTED_HEADERS = [
  "NF",
  "Pedido",
  "Cliente",
  "Vendedor",
  "Parcela",
  "Valor real",
  "Recebido",
  "Base comissão",
  "Juros/multa ignorados",
  "Comissão agendada",
  "Comissão liberada",
  "Status",
];

function section(html: string, tag: "thead" | "tbody" | "tfoot"): string {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`).exec(html);
  assert.ok(match, `seção ${tag}`);
  return match[1]!;
}

function rowsOf(sectionHtml: string): string[] {
  return [...sectionHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => m[1]!);
}

function cellsOf(rowHtml: string, tag: "th" | "td"): Array<{ attrs: string; text: string; html: string }> {
  return [...rowHtml.matchAll(new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>|<${tag}\\b([^>]*)/>`, "g"))].map(
    (m) => {
      const html = m[2] ?? "";
      return {
        attrs: m[1] ?? m[3] ?? "",
        html,
        text: html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim(),
      };
    }
  );
}

function colSpan(attrs: string): number {
  const match = /colspan="(\d+)"/i.exec(attrs);
  return match ? Number(match[1]) : 1;
}

function render(rows = ROWS): string {
  return renderToStaticMarkup(<mod.CommissionsReceiptClosingDetailTable rows={rows} totals={TOTALS} />);
}

describe("detalhamento — Parcela, Status e alinhamento", () => {
  it("uma única <table> (sem tabela aninhada no wrapper de rolagem)", () => {
    const html = render();
    assert.equal((html.match(/<table\b/g) ?? []).length, 1);
    assert.match(html, /data-testid="commissions-receipt-closing-detail-table"/);
  });

  it("12 colunas na ordem pedida, com Parcela depois de Vendedor", () => {
    const headers = cellsOf(rowsOf(section(render(), "thead"))[0]!, "th").map((cell) => cell.text);
    assert.deepEqual(headers, EXPECTED_HEADERS);
    for (const row of rowsOf(section(render(), "tbody"))) {
      assert.equal(cellsOf(row, "td").length, 12);
    }
  });

  it("rodapé soma 12 colunas e os totais ficam sob Recebido e Comissões", () => {
    const footerCells = cellsOf(rowsOf(section(render(), "tfoot"))[0]!, "td");
    assert.equal(footerCells.reduce((sum, cell) => sum + colSpan(cell.attrs), 0), 12);
    const byColumn = new Map<string, string>();
    let column = 0;
    for (const cell of footerCells) {
      byColumn.set(EXPECTED_HEADERS[column]!, cell.text);
      column += colSpan(cell.attrs);
    }
    assert.match(byColumn.get("NF") ?? "", /^Totais \(3 linhas\)$/);
    assert.equal(byColumn.get("Recebido"), formatFinanceCurrency(1750));
    assert.equal(byColumn.get("Comissão agendada"), formatFinanceCurrency(30));
    assert.equal(byColumn.get("Comissão liberada"), formatFinanceCurrency(30));
    assert.equal(byColumn.get("Valor real"), "—");
    assert.equal(byColumn.get("Status"), "");
  });

  it("Parcela mostra n/total e nunca inventa denominador", () => {
    const cells = rowsOf(section(render(), "tbody")).map((row) => cellsOf(row, "td")[4]!.text);
    assert.deepEqual(cells, ["1/3", "2/—", "—"]);
  });

  it("CASO I — Status: bolinha verde/cinza/âmbar com tooltip e texto acessível; sem badge textual", () => {
    const html = render();
    const statusCells = rowsOf(section(html, "tbody")).map((row) => cellsOf(row, "td")[11]!.html);
    assert.match(statusCells[0]!, /bg-emerald-500/);
    assert.match(statusCells[0]!, /aria-label="Status: Comissionável"/);
    assert.match(statusCells[0]!, /title="Comissionável"/);
    assert.match(statusCells[0]!, /role="img"/);
    assert.match(statusCells[1]!, /bg-slate-500/);
    assert.match(statusCells[1]!, /aria-label="Status: Cliente excluído"/);
    assert.match(statusCells[2]!, /bg-amber-500/);
    assert.match(statusCells[2]!, /aria-label="Status: Sem programação de comissão"/);
    assert.match(statusCells[2]!, /title="Sem programação de comissão\nTítulo sem schedule de comissão"/);
    // Enum técnico não aparece como texto do status (nem badge "COMMISSIONABLE").
    for (const cell of statusCells) assert.equal(cell.replace(/<[^>]+>/g, "").trim(), "");
    assert.doesNotMatch(html, />COMMISSIONABLE</);
    // Tooltip da linha com o motivo continua (convive com o da bolinha).
    assert.match(html, /<tr[^>]*title="NO_SCHEDULE: Título sem schedule de comissão"/);
  });

  it("cores seguem a mesma semântica do antigo badge", () => {
    assert.equal(mod.receiptClosingStatusIndicatorClass("COMMISSIONABLE"), "bg-emerald-500");
    for (const status of ["CUSTOMER_EXCLUDED", "GROUP_COMPANY_EXCLUDED", "EXCLUDED"]) {
      assert.match(mod.receiptClosingStatusIndicatorClass(status), /^bg-slate-/);
    }
    for (const status of ["NO_SCHEDULE", "STALE_SCHEDULE", "SELLER_UNRESOLVED", "QUALQUER_OUTRO"]) {
      assert.equal(mod.receiptClosingStatusIndicatorClass(status), "bg-amber-500");
    }
    assert.equal(mod.receiptClosingStatusTooltip("STALE_SCHEDULE", null), "Programação desatualizada");
    assert.equal(mod.receiptClosingStatusTooltip("COMMISSIONABLE", null), "Comissionável");
  });

  it("colunas de valor não quebram linha; Status e Parcela com largura mínima", () => {
    const html = render();
    const header = rowsOf(section(html, "thead"))[0]!;
    const ths = cellsOf(header, "th");
    assert.match(ths[4]!.attrs, /w-px/);
    assert.match(ths[11]!.attrs, /w-px/);
    const firstRow = cellsOf(rowsOf(section(html, "tbody"))[0]!, "td");
    for (const index of [5, 6, 7, 8, 9, 10]) {
      assert.match(firstRow[index]!.attrs, /whitespace-nowrap/, `coluna ${EXPECTED_HEADERS[index]}`);
    }
    assert.doesNotMatch(html, /min-w-\[1100px\]/);
  });
});
