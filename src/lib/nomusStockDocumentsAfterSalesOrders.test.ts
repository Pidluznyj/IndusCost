/**
 * Pós PV → DS por idNfe (mocks, sem API real).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  formatStockDocumentsAfterSalesOrdersLogLine,
  isStockDocumentsAfterSalesSyncEnabled,
  NOMUS_STOCK_DOCUMENTS_AFTER_SALES_SYNC_ENV,
  runNomusStockDocumentsAfterSalesOrdersSync,
} from "@/src/lib/nomusStockDocumentsAfterSalesOrders.server.js";
import { emptyStockDocumentsSyncCounters } from "@/src/lib/nomusStockDocumentsSyncLogic.js";

describe("runNomusStockDocumentsAfterSalesOrdersSync", () => {
  it("desabilitado por env", async () => {
    const result = await runNomusStockDocumentsAfterSalesOrdersSync({
      prisma: {
        salesOrderNfeLink: {
          findMany: async () => {
            throw new Error("não deve consultar");
          },
        },
      } as never,
      salesOrderIds: ["o1"],
      env: { [NOMUS_STOCK_DOCUMENTS_AFTER_SALES_SYNC_ENV]: "false" },
      logger: () => {},
    });
    assert.equal(result.skipped, true);
    assert.equal(result.skipReason, NOMUS_STOCK_DOCUMENTS_AFTER_SALES_SYNC_ENV);
    assert.match(
      formatStockDocumentsAfterSalesOrdersLogLine(result),
      /skipped/
    );
  });

  it("sem vínculos NFe → skip no-nfe-links", async () => {
    const result = await runNomusStockDocumentsAfterSalesOrdersSync({
      prisma: {
        salesOrderNfeLink: {
          findMany: async () => [],
        },
      } as never,
      salesOrderIds: ["o1"],
      env: { [NOMUS_STOCK_DOCUMENTS_AFTER_SALES_SYNC_ENV]: "true" },
      logger: () => {},
    });
    assert.equal(result.skipped, true);
    assert.equal(result.skipReason, "no-nfe-links");
  });

  it("com idNfe chama sync pontual (respectGlobalLock=false)", async () => {
    let called = 0;
    const result = await runNomusStockDocumentsAfterSalesOrdersSync({
      prisma: {
        salesOrderNfeLink: {
          findMany: async () => [{ nfeExternalId: 9001 }],
        },
      } as never,
      salesOrderIds: ["order-a"],
      env: { [NOMUS_STOCK_DOCUMENTS_AFTER_SALES_SYNC_ENV]: "true" },
      logger: () => {},
      syncByIdNfes: async (args) => {
        called += 1;
        assert.equal(args.respectGlobalLock, false);
        assert.deepEqual(args.idNfes, [9001]);
        return {
          skipped: false,
          skipReason: null,
          lockBlocked: false,
          idNfes: [9001],
          counters: {
            ...emptyStockDocumentsSyncCounters(),
            documentsReceived: 1,
            documentsCreated: 1,
          },
          errors: 0,
        };
      },
    });
    assert.equal(called, 1);
    assert.equal(result.skipped, false);
    assert.match(
      formatStockDocumentsAfterSalesOrdersLogLine(result),
      /by-idNfe/
    );
    assert.match(
      formatStockDocumentsAfterSalesOrdersLogLine(result),
      /created=1/
    );
  });

  it("env default habilitado", () => {
    assert.equal(isStockDocumentsAfterSalesSyncEnabled({}), true);
    assert.equal(
      isStockDocumentsAfterSalesSyncEnabled({
        [NOMUS_STOCK_DOCUMENTS_AFTER_SALES_SYNC_ENV]: "false",
      }),
      false
    );
  });

  it("sync de pedidos chama o hook antes do recompute", () => {
    const sales = readFileSync(
      join(process.cwd(), "scripts/nomusSalesOrdersSyncV1.ts"),
      "utf8"
    );
    assert.match(sales, /runNomusStockDocumentsAfterSalesOrdersSync/);
    assert.match(sales, /formatStockDocumentsAfterSalesOrdersLogLine/);
    const dsIdx = sales.indexOf("runNomusStockDocumentsAfterSalesOrdersSync");
    const flowIdx = sales.indexOf("runSalesOrderFlowRecomputeAfterNomusSync");
    assert.ok(dsIdx > 0 && flowIdx > dsIdx);
  });
});
