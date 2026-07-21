import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  isFinanceArExcludedByCancelledSalesOrder,
  isSalesOrderStatusExcludedFromOperationalReceivables,
  normalizeFinanceArOrderCodeKey,
  shouldIncludeSalesOrderInOperationalReceivables,
} from "./financeArCancelledSalesOrderExclusion.js";
import { buildSalesOrderListWhere } from "./salesOrdersListSummary.js";
import { NOMUS_OPS_EXCLUDE_MISSING_SALES_ORDERS_ENV } from "./nomus/nomusSourcePresencePolicy.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

const FLAG = NOMUS_OPS_EXCLUDE_MISSING_SALES_ORDERS_ENV;

describe("financeArCancelledSalesOrderExclusion", () => {
  it("CANCELLED e ERROR ficam fora do CR operacional", () => {
    assert.equal(isSalesOrderStatusExcludedFromOperationalReceivables("CANCELLED"), true);
    assert.equal(isSalesOrderStatusExcludedFromOperationalReceivables("ERROR"), true);
    assert.equal(isSalesOrderStatusExcludedFromOperationalReceivables("SENT_TO_NOMUS"), false);
  });

  it("PD 02739 MISSING_CONFIRMED fora com flag on; CANCELLED sempre fora", () => {
    assert.equal(
      shouldIncludeSalesOrderInOperationalReceivables({
        status: "CANCELLED",
        sourcePresenceStatus: "PRESENT",
        env: { [FLAG]: "true" },
      }),
      false
    );
    assert.equal(
      shouldIncludeSalesOrderInOperationalReceivables({
        status: "SENT_TO_NOMUS",
        sourcePresenceStatus: "MISSING_CONFIRMED",
        env: { [FLAG]: "true" },
      }),
      false
    );
    assert.equal(
      shouldIncludeSalesOrderInOperationalReceivables({
        status: "SENT_TO_NOMUS",
        sourcePresenceStatus: "MISSING_CONFIRMED",
        env: { [FLAG]: "false" },
      }),
      true
    );
  });

  it("exclui CR por NF e por código PD na descrição", () => {
    const exclusion = {
      invoiceIds: new Set([9001]),
      orderCodes: new Set(["PD 02739"]),
    };
    assert.equal(
      isFinanceArExcludedByCancelledSalesOrder(
        { sourceInvoiceId: 9001, description: "NF qualquer" },
        exclusion
      ),
      true
    );
    assert.equal(
      isFinanceArExcludedByCancelledSalesOrder(
        {
          sourceInvoiceId: null,
          description: "Pedido PD 02739 — Depósito Bancário",
        },
        exclusion
      ),
      true
    );
    assert.equal(
      isFinanceArExcludedByCancelledSalesOrder(
        { sourceInvoiceId: 1, description: "Pedido PD 02740" },
        exclusion
      ),
      false
    );
  });

  it("normalizeFinanceArOrderCodeKey normaliza PD", () => {
    assert.equal(normalizeFinanceArOrderCodeKey("pd 02739"), "PD 02739");
    assert.equal(normalizeFinanceArOrderCodeKey("Pedido PD02739"), "PD 02739");
  });

  it("listagem operacional exclui CANCELLED por padrão", () => {
    const where = buildSalesOrderListWhere({}, { env: {} });
    assert.match(JSON.stringify(where), /"not":"CANCELLED"/);
    const explicit = buildSalesOrderListWhere(
      { status: "CANCELLED" },
      { env: {} }
    );
    assert.match(JSON.stringify(explicit), /"status":"CANCELLED"/);
    assert.doesNotMatch(JSON.stringify(explicit), /"not":"CANCELLED"/);
  });

  it("wiring FIN-08 e loaders AR aplicam exclusão", () => {
    assert.match(
      read("src/lib/finance/financeAccountsReceivableEffectiveTitles.server.ts"),
      /buildFinanceArEffectiveSalesOrderWhere|shouldIncludeSalesOrderInOperationalReceivables/
    );
    assert.match(
      read("src/lib/financeAccountsReceivableManagement.server.ts"),
      /loadFinanceArCancelledSalesOrderExclusionIndex/
    );
    assert.match(
      read("src/lib/financeAccountsReceivableManagement.server.ts"),
      /isFinanceArExcludedByCancelledSalesOrder/
    );
    assert.match(
      read("src/lib/financeAccountsReceivableTitles.ts"),
      /orderContexts\.length === 0/
    );
  });
});
