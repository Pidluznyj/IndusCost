import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSalesOrderLifecycleSummary } from "./salesOrderLifecycleStatus.js";
import { buildManagementRowsFromOrders } from "./salesOrderManagement.js";
import {
  extractNomusItemStatusFromOrderRaw,
  extractNomusRawItems,
  normalizeNomusSalesOrderItemStatusCode,
  normalizeSalesOrderItemStatus,
  resolveSalesOrderItemNomusStatus,
} from "./salesOrderNomusRaw.js";
import {
  formatDeadlineBadge,
  formatInvoiceBadge,
  formatProductionBadge,
} from "./salesOrderManagementUi.js";
import {
  PD_02130_NESTED_STATUS_NOMUS_RAW,
  PD_02130_SANITIZED_DB_ITEM,
  PD_02130_SANITIZED_NOMUS_RAW,
  PD_02130_SANITIZED_ORDER,
} from "./fixtures/salesOrderPd02130SanitizedRaw.js";

const REF = new Date(2026, 5, 15);

describe("PD 02130 real raw sanitizado", () => {
  it("normalizeSalesOrderItemStatus(6) e (\"6\") retornam cancelled", () => {
    assert.equal(normalizeSalesOrderItemStatus(6), "cancelled");
    assert.equal(normalizeSalesOrderItemStatus("6"), "cancelled");
    assert.equal(normalizeNomusSalesOrderItemStatusCode(6), "cancelled");
    assert.equal(normalizeNomusSalesOrderItemStatusCode("6"), "cancelled");
  });

  it("extrai status numérico 6 de itensPedido[]", () => {
    const rawItems = extractNomusRawItems(PD_02130_SANITIZED_NOMUS_RAW);
    assert.equal(rawItems.length, 1);
    assert.equal(rawItems[0]?.status, "6");
    assert.equal(
      extractNomusItemStatusFromOrderRaw(
        PD_02130_SANITIZED_NOMUS_RAW,
        PD_02130_SANITIZED_DB_ITEM,
        { itemIndex: 0, totalDbItems: 1 }
      ),
      "6"
    );
    assert.equal(
      resolveSalesOrderItemNomusStatus(
        PD_02130_SANITIZED_NOMUS_RAW,
        PD_02130_SANITIZED_DB_ITEM,
        { itemIndex: 0, totalDbItems: 1 }
      ),
      "cancelled"
    );
  });

  it("status numérico desconhecido permanece unknown com warning", () => {
    const { lifecycle, items } = buildSalesOrderLifecycleSummary({
      salesOrderId: "so-unknown-code",
      salesOrderNumber: "PD UNK",
      originalStatus: "SENT_TO_NOMUS",
      issueDate: new Date(2026, 0, 1),
      expectedDeliveryDate: new Date(2026, 5, 1),
      referenceDate: REF,
      nomusRawResponse: {
        itensPedido: [{ idProduto: 1, status: 99, quantidade: 1 }],
        nfes: [],
      },
      items: [
        {
          id: "i1",
          externalProductId: 1,
          skuSnapshot: "SKU",
          productNameSnapshot: "Produto",
          quantity: 1,
        },
      ],
    });
    assert.equal(items[0]?.normalizedStatus, "unknown");
    assert.ok(lifecycle.riskFlags.includes("unknown_item_status"));
    assert.ok(
      lifecycle.dataQuality.warnings.some((w) => w.includes("Status de item não mapeado: 99"))
    );
    assert.equal(normalizeNomusSalesOrderItemStatusCode(99), null);
  });

  it("formato aninhado situacaoItemPedido continua cancelado", () => {
    const rawItems = extractNomusRawItems(PD_02130_NESTED_STATUS_NOMUS_RAW);
    assert.equal(rawItems[0]?.status, "Cancelado");
    assert.equal(normalizeSalesOrderItemStatus(rawItems[0]?.status), "cancelled");
  });

  it("lifecycle — PD 02130 com status 6 não vira atrasado sem NF", () => {
    const { lifecycle } = buildSalesOrderLifecycleSummary({
      salesOrderId: PD_02130_SANITIZED_ORDER.id,
      salesOrderNumber: PD_02130_SANITIZED_ORDER.orderCode,
      originalStatus: PD_02130_SANITIZED_ORDER.status,
      issueDate: PD_02130_SANITIZED_ORDER.issueDate,
      expectedDeliveryDate: PD_02130_SANITIZED_ORDER.expectedDeliveryDate,
      nomusRawResponse: PD_02130_SANITIZED_NOMUS_RAW,
      items: [PD_02130_SANITIZED_DB_ITEM],
      referenceDate: REF,
    });
    assert.equal(lifecycle.operationalStatus, "cancelled");
    assert.equal(lifecycle.completionStatus, "cancelled");
    assert.equal(lifecycle.executiveStatusLabel, "Cancelado");
    assert.notEqual(lifecycle.deadlineStatus, "overdue");
    assert.equal(lifecycle.itemsCancelled, 1);
    assert.ok(!lifecycle.riskFlags.includes("overdue_without_invoice"));
    assert.ok(!lifecycle.riskFlags.includes("missing_production_order"));
    assert.ok(!lifecycle.riskFlags.includes("unknown_item_status"));
    assert.equal(lifecycle.daysOverdue, null);
  });

  it("mapper da gestão — row exibida como Cancelado", () => {
    const order = {
      ...PD_02130_SANITIZED_ORDER,
      items: [{ ...PD_02130_SANITIZED_DB_ITEM }],
    };
    const { rows } = buildManagementRowsFromOrders([order], {}, REF);
    const row = rows[0];
    assert.ok(row);
    assert.equal(row.executiveStatusLabel, "Cancelado");
    assert.equal(row.operationalStatus, "cancelled");
    assert.equal(row.completionStatus, "cancelled");
    assert.equal(row.suggestedActionLabel, "Nenhuma ação necessária");
    assert.equal(formatDeadlineBadge(row.deadlineStatus, row.daysOverdue, row.operationalStatus), "—");
    assert.equal(
      formatInvoiceBadge(row.hasInvoice, row.invoicedPercent, row.operationalStatus),
      "Não aplicável"
    );
    assert.equal(
      formatProductionBadge(row.hasLinkedProductionOrder, row.productionOrderLate, {
        operationalStatus: row.operationalStatus,
      }),
      "Não aplicável"
    );
  });

  it("cards — PD 02130 isolado não entra em atrasado/aguardando", () => {
    const order = {
      ...PD_02130_SANITIZED_ORDER,
      items: [{ ...PD_02130_SANITIZED_DB_ITEM }],
    };
    const { cards } = buildManagementRowsFromOrders([order], {}, REF);
    assert.equal(cards.overdueWithoutInvoice, 0);
    assert.equal(cards.reviewUnknown, 0);
    assert.equal(cards.cancelledOrReturned, 1);
  });

  it("cards — PD 02130 com pedido aberto não contamina cancelado", () => {
    const cancelled = {
      ...PD_02130_SANITIZED_ORDER,
      items: [{ ...PD_02130_SANITIZED_DB_ITEM }],
    };
    const open = {
      ...PD_02130_SANITIZED_ORDER,
      id: "so-open",
      orderCode: "PD 99999",
      nomusRawResponse: {
        itensPedido: [{ idProduto: 1, status: "Liberado", quantidade: 1 }],
        nfes: [],
      },
      items: [
        {
          id: "item-open",
          externalProductId: 1,
          skuSnapshot: "SKU-OPEN",
          productNameSnapshot: "Produto",
          quantity: 1,
        },
      ],
      expectedDeliveryDate: new Date(2026, 4, 1),
    };
    const { cards } = buildManagementRowsFromOrders([cancelled, open], {}, REF);
    assert.equal(cards.cancelledOrReturned, 1);
    assert.equal(cards.overdueWithoutInvoice, 1);
    assert.equal(cards.reviewUnknown, 0);
  });

  it("parcialmente cancelado permanece misto", () => {
    const { lifecycle } = buildSalesOrderLifecycleSummary({
      salesOrderId: "so-mix",
      salesOrderNumber: "PD MIX",
      originalStatus: "SENT_TO_NOMUS",
      issueDate: new Date(2026, 0, 1),
      expectedDeliveryDate: new Date(2026, 5, 1),
      referenceDate: REF,
      nomusRawResponse: {
        itensPedido: [
          {
            idProduto: 1,
            produto: { codigo: "A" },
            status: 6,
            quantidade: 1,
          },
          {
            idProduto: 2,
            produto: { codigo: "B" },
            situacaoItemPedido: { descricao: "Liberado" },
            quantidade: 2,
          },
        ],
        nfes: [],
      },
      items: [
        {
          id: "i1",
          externalProductId: 1,
          skuSnapshot: "A",
          productNameSnapshot: "Produto A",
          quantity: 1,
        },
        {
          id: "i2",
          externalProductId: 2,
          skuSnapshot: "B",
          productNameSnapshot: "Produto B",
          quantity: 2,
        },
      ],
    });
    assert.notEqual(lifecycle.operationalStatus, "cancelled");
    assert.equal(lifecycle.completionStatus, "mixed");
    assert.ok(lifecycle.riskFlags.includes("mixed_item_status"));
  });
});
