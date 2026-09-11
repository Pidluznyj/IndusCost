import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFixturePrisma } from "./crmReportsPrisma.fixtures.js";
import { collectCrmReportsHomologEvidence, countingDataSource } from "./crmReportsHomologEvidence.server.js";
import type { CrmReportsDataSource } from "./crmReportsOperationalService.server.js";
import { A, NOW, OWN_PERMISSIONS, baseDb, createFakeDataSource, mockAuth } from "./crmReportsService.fixtures.js";

// Mesma base das listas (hoje = 11/09/2026): a evidência roda o pipeline real
// sobre o avaliador do where canônico — o que roda na homologação é isto.

function setup(overrides: { dataSource?: (ds: CrmReportsDataSource) => CrmReportsDataSource } = {}) {
  const db = baseDb();
  const prisma = createFixturePrisma({ customers: db.customers as never, salesOrders: db.orders as never });
  const fake = createFakeDataSource(db);
  const errorCustomerIds = [...new Set(db.orders.filter((o) => o.status === "ERROR").map((o) => o.customerId))];
  const cancelledCustomerIds = [...new Set(db.orders.filter((o) => o.status === "CANCELLED").map((o) => o.customerId))];
  return {
    prisma: prisma as never,
    dataSource: overrides.dataSource ? overrides.dataSource(fake.ds) : fake.ds,
    now: NOW,
    statusSamples: { errorCustomerIds, cancelledCustomerIds },
    users: [
      { label: "gestor", auth: mockAuth({ role: "COMMERCIAL_MANAGER" }) },
      { label: "vendedora (carteira própria)", auth: mockAuth({ permissions: OWN_PERMISSIONS, externalSellerId: 464, sellerResponsibleName: "GISLENE LIMA" }) },
      { label: "sem vínculo", auth: mockAuth({ permissions: OWN_PERMISSIONS }) },
      { label: "sem escopo", auth: mockAuth({ permissions: ["crm.view"] }) },
    ],
    performanceRuns: 1,
  };
}

describe("evidências de homologação (pipeline real sobre fixtures)", () => {
  it("aprova as seis seções quando tudo reconcilia", async () => {
    const report = await collectCrmReportsHomologEvidence(setup());
    const byId = Object.fromEntries(report.sections.map((s) => [s.id, s]));
    for (const id of ["reconciliation", "repurchase", "exclusion", "scope", "performance", "builder"]) {
      assert.equal(byId[id]?.status, "PASS", `${id}:\n${byId[id]?.lines.join("\n")}`);
    }
    assert.equal(report.approved, true);
    assert.equal(report.today, "2026-09-11");
    // Amostra por perfil traz ERROR e CANCELLED (Alfa tem os dois).
    const reconciliation = byId.reconciliation!.lines.join("\n");
    assert.match(reconciliation, /com pedido ERROR \| Alfa Ltda/);
    assert.match(reconciliation, /com pedido CANCELLED \| Alfa Ltda/);
    // Conta manual × endpoint cliente a cliente.
    assert.match(byId.repurchase!.lines.join("\n"), /atrasado — Alfa Ltda .* ✓ conta manual = endpoint/);
    // Escopo: carteira própria só vê a própria carteira; sem escopo = 403.
    const scope = byId.scope!.lines.join("\n");
    assert.match(scope, /vendedora \(carteira própria\) \| VIEWER \| own \| 2 \| 2 \| todos da própria carteira/);
    assert.match(scope, /sem escopo \| VIEWER \| none \| 403/);
    assert.match(report.markdown, /resultado: \*\*APROVADO\*\*/);
  });

  it("REPROVA quando o lado relatório perde um pedido (a evidência pega)", async () => {
    const report = await collectCrmReportsHomologEvidence(
      setup({
        dataSource: (ds) => ({
          ...ds,
          // Some o pedido mais recente da Alfa (conta nos dois lados no oficial).
          findSalesOrders: async (where) => {
            const rows = await ds.findSalesOrders(where);
            const latest = rows
              .filter((o) => o.customerId === A.id)
              .sort((x, y) => y.issueDate.getTime() - x.issueDate.getTime())[0];
            return rows.filter((o) => o !== latest);
          },
        }),
      })
    );
    assert.equal(report.approved, false);
    assert.equal(report.sections.find((s) => s.id === "reconciliation")?.status, "FAIL");
    assert.match(report.markdown, /resultado: \*\*REPROVADO\*\*/);
  });

  it("contador de chamadas envolve todos os métodos do data source", async () => {
    const { ds, calls, reset } = countingDataSource(createFakeDataSource(baseDb()).ds);
    await ds.findCustomers({});
    await ds.findCustomers({});
    assert.equal(calls.findCustomers, 2);
    reset();
    assert.equal(calls.findCustomers, undefined);
  });
});
