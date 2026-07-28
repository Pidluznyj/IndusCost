import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  SALES_ORDER_LIST_HTTP_FORBIDDEN_KEYS,
  SALES_ORDER_LIST_PAGE_PRISMA_SELECT,
  toSalesOrderListHttpRow,
} from "@/src/lib/salesOrderListApiDto.js";
import {
  SALES_ORDER_LEGACY_DETAIL_HTTP_FORBIDDEN_KEYS,
  toSalesOrderLegacyDetailHttpRow,
} from "@/src/lib/salesOrderLegacyDetailApiDto.js";

describe("PERFORMANCE 04 — sales-orders list/detail DTOs", () => {
  it("list HTTP omite nomusRawResponse e campos de sync/detalhe", () => {
    const row = toSalesOrderListHttpRow(
      {
        id: "o1",
        customerId: "c1",
        orderCode: "PV-1",
        status: "SENT_TO_NOMUS",
        issueDate: "2026-07-01",
        expectedDeliveryDate: null,
        totalItems: 2,
        totalNetValue: 1000,
        externalSellerId: 9,
        proposalId: null,
        Customer: { companyName: "Acme", tradeName: null },
        Proposal: null,
        marginSummary: undefined,
        marginItems: undefined,
      },
      {
        seller: {
          externalSellerId: 9,
          name: "Ana",
          resolutionStatus: "MAPPED",
        },
        hasInvoice: true,
        billingStatus: "INVOICED",
        invoiceCount: 1,
        lastInvoiceNumber: "123",
        lastInvoiceDate: "2026-07-10T00:00:00.000Z",
        responsible: "Ana",
      }
    );

    const keys = Object.keys(row);
    for (const forbidden of SALES_ORDER_LIST_HTTP_FORBIDDEN_KEYS) {
      assert.equal(keys.includes(forbidden), false, `não deve expor ${forbidden}`);
    }
    assert.equal(row.orderCode, "PV-1");
    assert.equal(row.billingStatus, "INVOICED");
    assert.equal(row.Customer?.companyName, "Acme");
    assert.equal(row.hasInvoice, true);
    assert.equal(row.invoiceCount, 1);
  });

  it("page select da lista não carrega nomusRawResponse", () => {
    assert.equal(
      "nomusRawResponse" in SALES_ORDER_LIST_PAGE_PRISMA_SELECT,
      false
    );
    assert.ok(SALES_ORDER_LIST_PAGE_PRISMA_SELECT.Customer.select.companyName);
    assert.ok(SALES_ORDER_LIST_PAGE_PRISMA_SELECT.Proposal.select.number);
  });

  it("GET /api/sales-orders usa DTO/select e aggregate de totais (não spread Prisma)", () => {
    const server = readFileSync(join(process.cwd(), "server.ts"), "utf8");
    const start = server.indexOf('app.get("/api/sales-orders"');
    assert.ok(start > 0);
    const end = server.indexOf('app.get("/api/sales-orders/:id"', start);
    const chunk = server.slice(start, end > start ? end : start + 8000);
    assert.match(chunk, /SALES_ORDER_LIST_PAGE_PRISMA_SELECT/);
    assert.match(chunk, /salesOrder\.aggregate/);
    assert.match(chunk, /_sum:\s*\{\s*totalNetValue:\s*true/);
    assert.match(chunk, /buildSalesOrderListSummaryFromAggregate/);
    assert.match(chunk, /toSalesOrderListHttpRow/);
    assert.match(chunk, /loadSalesOrderLinkedNfeContextMap/);
    assert.match(chunk, /omitLinkRawPayload:\s*true/);
    assert.doesNotMatch(chunk, /nomusRawResponse:\s*order\.nomusRawResponse/);
    assert.doesNotMatch(chunk, /Customer:\s*true/);
    assert.doesNotMatch(chunk, /\.\.\.order\b/);
    assert.doesNotMatch(chunk, /SALES_ORDER_RULES_PRISMA_SELECT/);
    assert.doesNotMatch(chunk, /SALES_ORDER_LIST_SUMMARY_PRISMA_SELECT/);
    assert.doesNotMatch(chunk, /buildSalesOrderListTotalsFromPrismaOrders/);
  });

  it("GET /api/sales-orders/:id legado usa select slim sem Product/Proposal integrais", () => {
    const server = readFileSync(join(process.cwd(), "server.ts"), "utf8");
    const start = server.indexOf('app.get("/api/sales-orders/:id"');
    assert.ok(start > 0);
    const chunk = server.slice(start, start + 2500);
    assert.match(chunk, /SALES_ORDER_LEGACY_DETAIL_PRISMA_SELECT/);
    assert.match(chunk, /toSalesOrderLegacyDetailHttpRow/);
    assert.doesNotMatch(chunk, /Product:\s*true/);
    assert.doesNotMatch(chunk, /Proposal:\s*true/);
    assert.doesNotMatch(chunk, /ProposalItem:\s*true/);
    assert.ok(SALES_ORDER_LEGACY_DETAIL_HTTP_FORBIDDEN_KEYS.includes("nomusRawResponse"));
  });

  it("legacy detail HTTP omite raw e relações integrais, preserva impressão", () => {
    const row = toSalesOrderLegacyDetailHttpRow({
      id: "o1",
      orderCode: "PV-9",
      status: "SENT_TO_NOMUS",
      issueDate: "2026-07-01",
      expectedDeliveryDate: null,
      responsible: "Ana",
      paymentTerms: "30",
      paymentMethod: "Boleto",
      freightCondition: "CIF",
      deliveryLocation: "SP",
      notes: "ok",
      totalGrossValue: 1100,
      totalDiscount: 100,
      totalNetValue: 1000,
      totalFreight: 0,
      Customer: {
        companyName: "Acme",
        tradeName: null,
        taxId: "00.000.000/0001-00",
        address: "Rua A",
        city: "SP",
        state: "SP",
        zipCode: "01000-000",
        phone: "11",
      },
      items: [
        {
          id: "i1",
          skuSnapshot: "SKU",
          productNameSnapshot: "Item",
          quantity: 1,
          unit: "PC",
          negotiatedPrice: 1000,
          totalNetValue: 1000,
        },
      ],
    });
    const json = JSON.stringify(row);
    for (const forbidden of SALES_ORDER_LEGACY_DETAIL_HTTP_FORBIDDEN_KEYS) {
      assert.doesNotMatch(json, new RegExp(`"${forbidden}"`));
    }
    assert.equal(row.orderCode, "PV-9");
    assert.equal(row.Customer?.taxId, "00.000.000/0001-00");
    assert.equal(row.items[0]?.skuSnapshot, "SKU");
  });

  it("billing nfes list continua sem xmlRaw no select principal", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/financeBillingNfeList.ts"),
      "utf8"
    );
    const findManyIdx = source.indexOf("prisma.nomusNfe.findMany");
    const selectIdx = source.indexOf("select: {", findManyIdx);
    const selectEnd = source.indexOf("},", selectIdx);
    const primarySelect = source.slice(selectIdx, selectEnd);
    assert.doesNotMatch(primarySelect, /xmlRaw\s*:/);
    assert.doesNotMatch(primarySelect, /rawPayload\s*:/);
  });
});
