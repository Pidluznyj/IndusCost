import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createFixturePrisma, type FixtureRow } from "./crmReportsPrisma.fixtures.js";
import { createPrismaCrmReportsDataSource, type CrmReportsDataSource } from "./crmReportsOperationalService.server.js";
import {
  CRM_REPORTS_VERIFICATION_INDICATORS,
  verifyCrmReportsAgainstSalesOrders,
} from "./crmReportsVerification.server.js";

const NOW = new Date(2026, 8, 11, 10, 0, 0);
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const customer = (n: number, companyName: string, extra: FixtureRow = {}): FixtureRow => ({
  id: uuid(n),
  companyName,
  tradeName: null,
  taxId: `22.222.222/0001-${String(n).padStart(2, "0")}`,
  city: "Curitiba",
  state: "PR",
  status: "ACTIVE",
  ...extra,
});

let seq = 0;
const order = (customerId: string, ymd: string, value: number, extra: FixtureRow = {}): FixtureRow => {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  seq += 1;
  return {
    id: `vo-${seq}`,
    customerId,
    orderCode: `PD ${String(seq).padStart(5, "0")}`,
    issueDate: new Date(y, m - 1, d, (extra.hour as number) ?? 10, 0, 0),
    totalNetValue: value,
    externalSellerId: null,
    nomusSellerName: null,
    status: "SENT_TO_NOMUS",
    sourcePresenceStatus: "PRESENT",
    ...extra,
  };
};

const A = customer(1, "Alfa Ltda");
const B = customer(2, "Beta SA");
const F = customer(3, "Futuro Ltda");
const I = customer(4, "Inativa Ltda", { status: "INACTIVE" });
const K = customer(5, "Koppetel Indústria", { taxId: "72.569.510/0001-95" });
const N = customer(6, "Nunca Comprou");

function fixtureDb() {
  return {
    customers: [A, B, F, I, K, N],
    salesOrders: [
      order(A.id as string, "2026-09-01", 100.105, { id: "vo-a-1" }),
      order(A.id as string, "2026-09-01", 0.105, { hour: 16 }),
      order(A.id as string, "2026-06-01", 1000),
      order(A.id as string, "2025-09-11", 50), // fora dos 12m
      order(A.id as string, "2026-09-10", 999, { status: "CANCELLED" }),
      order(B.id as string, "2026-07-14", 10), // borda: hoje − 59
      order(B.id as string, "2026-07-13", 20), // hoje − 60
      order(B.id as string, "2026-08-01", 30, { status: "ERROR" }),
      order(F.id as string, "2026-01-10", 5),
      order(F.id as string, "2026-09-15", 70), // emissão futura
      order(I.id as string, "2026-09-02", 500),
      order(K.id as string, "2026-09-03", 5000),
    ],
  };
}

describe("verificador CRM > Relatórios × Pedidos de Venda (fixtures)", () => {
  it("aprova quando o relatório reconcilia com a população oficial", async () => {
    const prisma = createFixturePrisma(fixtureDb());
    const result = await verifyCrmReportsAgainstSalesOrders(prisma as never, { now: NOW });
    assert.equal(result.summary.approved, true, JSON.stringify(result.divergences, null, 2));
    // A, B, F e N (ativos, fora do grupo) × 5 indicadores.
    assert.equal(result.summary.customersCompared, 4);
    assert.equal(result.summary.comparisons, 20);
    assert.equal(result.divergences.length, 0);
    for (const total of result.totals) assert.equal(total.status, "OK", total.indicator);
    const alfa60 = result.rows.find(
      (r) => r.customerId === A.id && r.indicator === CRM_REPORTS_VERIFICATION_INDICATORS.purchaseValue60d
    )!;
    assert.equal(alfa60.pv, 100.21);
    assert.equal(alfa60.crm, 100.21);
    const beta60 = result.rows.find(
      (r) => r.customerId === B.id && r.indicator === CRM_REPORTS_VERIFICATION_INDICATORS.orders60d
    )!;
    assert.equal(beta60.pv, 2, "borda hoje−59 e pedido ERROR entram nos dois lados");
    assert.equal(beta60.crm, 2);
  });

  it("cliente inativo com pedido oficial vira AVISO (regra), não divergência", async () => {
    const prisma = createFixturePrisma(fixtureDb());
    const result = await verifyCrmReportsAgainstSalesOrders(prisma as never, { now: NOW });
    assert.deepEqual(result.inactiveOutsideUniverse.map((c) => c.id), [I.id]);
    assert.ok(result.warnings.some((w) => w.includes("INATIVO")));
    assert.ok(result.warnings.some((w) => w.includes("emissão depois de 2026-09-11")));
  });

  it("REPROVA quando o lado relatório perde um pedido (prova que o verificador pega)", async () => {
    const prisma = createFixturePrisma(fixtureDb());
    const real = createPrismaCrmReportsDataSource(prisma as never);
    const buggy: CrmReportsDataSource = {
      ...real,
      findSalesOrders: async (where) => (await real.findSalesOrders(where)).filter((o) => o.id !== "vo-a-1"),
    };
    const result = await verifyCrmReportsAgainstSalesOrders(prisma as never, { now: NOW, dataSource: buggy });
    assert.equal(result.summary.approved, false);
    const bad = result.divergences.filter((d) => d.customerId === A.id).map((d) => d.indicator).sort();
    assert.deepEqual(
      bad,
      [
        CRM_REPORTS_VERIFICATION_INDICATORS.orders12m,
        CRM_REPORTS_VERIFICATION_INDICATORS.orders60d,
        CRM_REPORTS_VERIFICATION_INDICATORS.purchaseValue12m,
        CRM_REPORTS_VERIFICATION_INDICATORS.purchaseValue60d,
      ].sort()
    );
    const value60 = result.divergences.find((d) => d.indicator === CRM_REPORTS_VERIFICATION_INDICATORS.purchaseValue60d)!;
    // Relatório ficou só com R$ 0,105 (→ R$ 0,11) contra R$ 100,21 oficial.
    assert.equal(value60.crm, 0.11);
    assert.equal(value60.pv, 100.21);
    assert.equal(value60.delta, -100.1);
    assert.ok(result.totals.some((t) => t.status === "DIVERGENTE"));
  });

  it("REPROVA quando a última compra diverge", async () => {
    const prisma = createFixturePrisma(fixtureDb());
    const real = createPrismaCrmReportsDataSource(prisma as never);
    const shifted: CrmReportsDataSource = {
      ...real,
      findSalesOrders: async (where) =>
        (await real.findSalesOrders(where)).map((o) =>
          // Último pedido de B (01/08, R$ 30) deslocado um dia só no lado relatório.
          o.customerId === B.id && o.totalNetValue === 30 ? { ...o, issueDate: new Date(2026, 7, 2, 10) } : o
        ),
    };
    const result = await verifyCrmReportsAgainstSalesOrders(prisma as never, { now: NOW, dataSource: shifted });
    const dateRow = result.rows.find(
      (r) => r.customerId === B.id && r.indicator === CRM_REPORTS_VERIFICATION_INDICATORS.lastPurchaseDate
    )!;
    assert.equal(dateRow.status, "DIVERGENTE");
    assert.equal(result.summary.approved, false);
  });

  it("--customer: compara só os clientes pedidos", async () => {
    const prisma = createFixturePrisma(fixtureDb());
    const result = await verifyCrmReportsAgainstSalesOrders(prisma as never, {
      now: NOW,
      customerIds: [B.id as string],
    });
    assert.equal(result.summary.customersCompared, 1);
    assert.ok(result.rows.every((r) => r.customerId === B.id));
    assert.equal(result.summary.approved, true);
  });

  it("só lê: findMany/groupBy", async () => {
    const prisma = createFixturePrisma(fixtureDb());
    await verifyCrmReportsAgainstSalesOrders(prisma as never, { now: NOW });
    assert.ok(prisma.calls.length > 0);
    for (const call of prisma.calls) assert.match(call, /\.(findMany|groupBy)$/);
  });
});

describe("contrato do CLI scripts/verify-crm-reports-vs-sales-orders.ts", () => {
  const cli = readFileSync(join(process.cwd(), "scripts/verify-crm-reports-vs-sales-orders.ts"), "utf8");
  const lib = readFileSync(join(process.cwd(), "src/lib/commercial/crmReportsVerification.server.ts"), "utf8");

  it("é somente leitura", () => {
    for (const src of [cli, lib]) {
      for (const forbidden of [".create(", ".update(", ".upsert(", ".delete(", ".executeRaw", "TRUNCATE", "INSERT", "UPDATE "]) {
        assert.ok(!src.includes(forbidden), `verificador não pode conter ${forbidden}`);
      }
    }
  });

  it("lado oficial = construtor de Pedidos de Venda; lado relatório = pipeline do endpoint", () => {
    assert.match(lib, /buildSalesOrderListWhere\(/);
    assert.match(lib, /excludeEconomicGroupCustomers: true/);
    assert.match(lib, /runCrmReportsAnalysis\(/);
    assert.match(cli, /verifyCrmReportsAgainstSalesOrders\(/);
  });

  it("cobre os cinco indicadores e exige delta zero / data igual", () => {
    for (const label of Object.values(CRM_REPORTS_VERIFICATION_INDICATORS)) {
      assert.ok(lib.includes(label) || lib.includes("CRM_REPORTS_VERIFICATION_INDICATORS"), label);
    }
    assert.ok(lib.includes('delta === 0 ? "OK" : "DIVERGENTE"'));
    assert.ok(lib.includes('pv === crm ? "OK" : "DIVERGENTE"'));
  });

  it("aceita --customer, --json, --today, --max-rows e sai com código 1 se divergir", () => {
    for (const flag of ["--customer=", "--json", "--today=", "--max-rows="]) {
      assert.ok(cli.includes(flag.replace("=", "")), flag);
    }
    assert.match(cli, /process\.exitCode = 1/);
  });
});
