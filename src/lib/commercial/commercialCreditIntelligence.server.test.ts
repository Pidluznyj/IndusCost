/**
 * A consulta de crédito do modal lê o mesmo stage da decisão.
 * Não abre banco e não grava título.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { loadCustomerCommercialCreditIntelligence, type CommercialCreditDb } from "./commercialCreditDecision.server.js";

const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";
const CNPJ = "11444777000161";
const TODAY = new Date(2026, 9, 19, 10, 0, 0);
const SYNCED = new Date(2026, 9, 19, 9, 0, 0);

function createDb(balance = 1000) {
  const db = {
    customer: {
      findUnique: async () => ({ id: CUSTOMER_ID, taxId: CNPJ, nomusExternalPersonId: 100 }),
      findMany: async () => [{ id: CUSTOMER_ID }],
    },
    salesOrder: {
      findMany: async () => [{ externalCustomerId: 100 }],
    },
    nomusAccountsReceivable: {
      aggregate: async () => ({ _max: { syncedAt: SYNCED } }),
      findMany: async () => [
        {
          externalId: 1,
          personId: 100,
          personName: "Cliente",
          personCnpj: CNPJ,
          companyName: "Lazarios",
          description: "Parcela",
          comments: null,
          dueDate: new Date(2026, 9, 15),
          settlementDate: null,
          amountReceivable: balance,
          amountReceived: 0,
          balanceReceivable: balance,
          sourceInvoiceId: 50,
          sourceInvoiceNumber: "100",
          paymentMethodName: "Boleto",
          bankAccountName: null,
          suspendCollection: false,
          status: false,
          syncedAt: SYNCED,
          sourcePresenceStatus: "PRESENT",
          rawPayload: { id: 1 },
        },
      ],
    },
    nomusSourceSyncRun: {
      findFirst: async () => ({ status: "SUCCESS", payloadComplete: true, startedAt: SYNCED }),
    },
    customerCorporateLink: { findMany: async () => [] },
    commercialExternalProtest: { findMany: async () => [] },
    commercialCreditException: { findMany: async () => [] },
    commercialCreditOccurrence: { findMany: async () => [] },
    commercialCorporateMembership: { findMany: async () => [], findFirst: async () => null },
    customerCnpjLookup: { findFirst: async () => null },
  };
  return db as unknown as CommercialCreditDb;
}

describe("loadCustomerCommercialCreditIntelligence", () => {
  it("cliente inadimplente permanece bloqueado e omite valores sem permissão", async () => {
    const visible = await loadCustomerCommercialCreditIntelligence(createDb(), CUSTOMER_ID, {
      revealFinancial: true,
      now: TODAY,
    });
    const hidden = await loadCustomerCommercialCreditIntelligence(createDb(), CUSTOMER_ID, {
      revealFinancial: false,
      now: TODAY,
    });
    assert.equal(visible.headline, "CRÉDITO BLOQUEADO");
    assert.equal(visible.customerStatus, "BLOQUEADO");
    assert.equal(visible.cadastralAuthorizesCredit, false);
    assert.equal(visible.internalProtest, "CLEAR");
    assert.equal(visible.externalProtest, "NOT_CONSULTED");
    assert.match(visible.externalProtestDetail, /não significa ausência de protesto/);
    assert.equal(visible.bcbState, "NOT_APPLICABLE");
    assert.match(visible.overdueAmountLabel, /1\.?000/);
    assert.equal(visible.overdueTitleCountLabel, "1");
    assert.equal(visible.maxDaysOverdueLabel, "4 dias");
    assert.equal(hidden.headline, "CRÉDITO BLOQUEADO");
    assert.equal(hidden.overdueAmountLabel, "Restrito");
    assert.equal(JSON.stringify(hidden).includes("1000"), false);
  });

  it("a tela não recalcula atraso e a rota usa o serviço interno", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
    const panel = readFileSync(join(root, "src/components/customers/CustomerCnpjIntelligencePanel.tsx"), "utf8");
    const routes = readFileSync(join(root, "src/lib/companyIntelligenceRoutes.ts"), "utf8");
    assert.equal(panel.includes("computeDaysOverdue"), false);
    assert.equal(panel.includes("balanceReceivable"), false);
    assert.equal(panel.includes("/commercial-credit"), true);
    assert.equal(routes.includes('"/api/customers/:id/commercial-credit"'), true);
    assert.equal(routes.includes("loadCustomerCommercialCreditIntelligence"), true);
  });
});
