import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildBillingSourceDailyComparison } from "./financeBillingAuditDataset.js";
import { billingTabMetricsAreFinite } from "./financeBillingDashboard.js";
import { NOMUS_NFE_STATUS_AUTHORIZED } from "./nomusNfeClassification.js";
import type { BillingAuditRow } from "./financeBillingAuditTypes.js";

function auditRow(
  partial: Partial<BillingAuditRow> & Pick<BillingAuditRow, "id" | "dataSource" | "includedInBilling">
): BillingAuditRow {
  return {
    exclusionReason: null,
    exclusionReasonCode: null,
    companyName: null,
    companyDocument: null,
    nfNumber: null,
    nfSeries: null,
    nfKey: null,
    nfStatus: null,
    operationNature: null,
    cfop: null,
    issueDate: null,
    processingDate: null,
    competenceDateUsed: null,
    importDate: null,
    customerName: null,
    customerDocument: null,
    sellerName: null,
    salesOrderCode: null,
    valueProducts: null,
    valueServices: null,
    valueFreight: null,
    valueDiscount: null,
    valueTaxes: null,
    valueTotalNf: null,
    valueNet: null,
    valueUsedInDashboard: 0,
    valueCalculationMode: null,
    billingClassification: null,
    syncedAt: null,
    originLabel: null,
    xmlPath: null,
    notes: null,
    ...partial,
  };
}

describe("financeBillingNfeDashboard", () => {
  it("SQL fiscal usa status autorizado, mercado e valorLiquido", () => {
    const src = readFileSync(
      join(process.cwd(), "src", "lib", "financeBillingNfeDashboard.ts"),
      "utf8"
    );
    assert.match(src, /NOMUS_NFE_STATUS_AUTHORIZED/);
    assert.match(src, /isMarketSale/);
    assert.match(src, /MARKET_REVENUE/);
    assert.match(src, /valorLiquido/);
    assert.equal(NOMUS_NFE_STATUS_AUTHORIZED, 4);
  });

  it("cards NF-e rotulam mês atual com fonte fiscal", () => {
    const src = readFileSync(
      join(process.cwd(), "src", "lib", "financeBillingNfeDashboard.ts"),
      "utf8"
    );
    assert.match(src, /Mês atual — NF-e fiscal/);
  });

  it("junho/2026 fixture: NF-e ~284k vs SalesOrder ~92k", () => {
    const juneDays: Array<[string, number, number]> = [
      ["2026-06-01", 1048.9, 1108.9],
      ["2026-06-02", 24970, 20562],
      ["2026-06-03", 37830.91, 17132.51],
      ["2026-06-08", 180232.34, 12254.34],
      ["2026-06-09", 1459.25, 1601.25],
      ["2026-06-10", 36582.96, 36704.32],
      ["2026-06-11", 2781.3, 2697],
    ];

    const nfeRows = juneDays.flatMap(([date, nfe]) => {
      const rows: BillingAuditRow[] = [
        auditRow({
          id: `nfe-${date}`,
          dataSource: "NomusNfe",
          includedInBilling: true,
          competenceDateUsed: date,
          valueUsedInDashboard: nfe,
          nfNumber: date === "2026-06-08" ? "7052" : "x",
          valueNet: date === "2026-06-08" ? 168075 : nfe,
        }),
      ];
      return rows;
    });

    const salesRows = juneDays.map(([date, , sales]) =>
      auditRow({
        id: `so-${date}`,
        dataSource: "SalesOrder",
        includedInBilling: true,
        competenceDateUsed: date,
        valueUsedInDashboard: sales,
      })
    );

    const daily = buildBillingSourceDailyComparison(nfeRows, salesRows);
    const nfeTotal = daily.reduce((s, r) => s + r.nfeTotal, 0);
    const salesTotal = daily.reduce((s, r) => s + r.salesOrderTotal, 0);

    assert.ok(Math.abs(nfeTotal - 284905.66) < 1);
    assert.ok(Math.abs(salesTotal - 92060.32) < 1);

    const day08 = daily.find((r) => r.date === "2026-06-08");
    assert.ok(day08);
    assert.ok(Math.abs(day08!.difference - 167978) < 1);

    const nf7052 = nfeRows.find((r) => r.nfNumber === "7052");
    assert.equal(nf7052?.valueNet, 168075);
  });

  it("comparação diária não produz NaN", () => {
    const daily = buildBillingSourceDailyComparison(
      [
        auditRow({
          id: "1",
          dataSource: "NomusNfe",
          includedInBilling: true,
          competenceDateUsed: "2026-06-01",
          valueUsedInDashboard: 100,
        }),
      ],
      []
    );
    assert.equal(daily[0]!.difference, 100);
    assert.equal(Number.isFinite(daily[0]!.nfeTotal), true);
  });

  it("billingTabMetricsAreFinite está disponível para validação de métricas", () => {
    assert.equal(typeof billingTabMetricsAreFinite, "function");
  });

  describe("performance — regex contra xmlRaw só roda quando necessário", () => {
    const src = readFileSync(
      join(process.cwd(), "src", "lib", "financeBillingNfeDashboard.ts"),
      "utf8"
    );

    it("queryTopFiscalNfeCustomers guarda a extração via xmlRaw com CASE WHEN", () => {
      // Antes: MAX(regexp_match(xmlRaw, ...)) rodava para TODA linha do grupo,
      // incondicionalmente — mesmo quando Customer.tradeName/companyName já
      // resolviam o nome. Como o COALESCE externo prioriza tradeName/companyName,
      // essa linha só é o resultado final quando NENHUMA linha do grupo tinha
      // nome cadastrado — logo a guarda abaixo preserva o mesmo customer_name
      // em todos os casos, só evita computar regex desnecessário.
      const match = src.match(
        /MAX\(\s*CASE\s+WHEN\s+NULLIF\(TRIM\(c\."tradeName"\), ''\) IS NULL[\s\S]{0,80}NULLIF\(TRIM\(c\."companyName"\), ''\) IS NULL[\s\S]{0,200}ELSE NULL\s+END\s*\)/
      );
      assert.ok(
        match,
        "a extração via xmlRaw em queryTopFiscalNfeCustomers precisa estar protegida por CASE WHEN — sem isso, o regex volta a rodar para toda linha do ano"
      );
    });

    it("a ordem de prioridade do COALESCE de customer_name não mudou", () => {
      // tradeName > companyName > xmlRaw (guardado) > CNPJ cru > '—'
      const coalesceBlock = src.match(
        /customer_name,?\s*(?:$)|AS customer_name/
      );
      assert.ok(coalesceBlock);
      const idxTrade = src.indexOf('MAX(NULLIF(TRIM(c."tradeName")');
      const idxCompany = src.indexOf('MAX(NULLIF(TRIM(c."companyName")');
      const idxXmlGuard = src.indexOf('NULLIF(TRIM(c."tradeName"), \'\') IS NULL');
      const idxCnpj = src.indexOf('MAX(n."xmlDestCnpjCpf")');
      assert.ok(idxTrade > 0 && idxCompany > idxTrade);
      assert.ok(idxXmlGuard > idxCompany);
      assert.ok(idxCnpj > idxXmlGuard);
    });
  });

  describe("performance — índices casam com o predicado real das consultas", () => {
    const migrationPath = join(
      process.cwd(),
      "prisma",
      "migrations",
      "20260831120000_billing_nfe_dashboard_perf_indexes",
      "migration.sql"
    );
    const migrationSrc = readFileSync(migrationPath, "utf8");
    const src = readFileSync(
      join(process.cwd(), "src", "lib", "financeBillingNfeDashboard.ts"),
      "utf8"
    );

    it("existe índice parcial para o predicado fiscal com dateBase=emissao (padrão da tela)", () => {
      assert.match(
        migrationSrc,
        /COALESCE\("xmlDhEmi", "dataProcessamento"\)/
      );
      assert.match(migrationSrc, /"status" = 4/);
      assert.match(migrationSrc, /"isMarketSale" = true/);
      assert.match(
        migrationSrc,
        /'MARKET_REVENUE'::"NomusNfeBillingClassification"/
      );
      assert.match(migrationSrc, /"valorLiquido" IS NOT NULL/);
    });

    it("existe o par simétrico para dateBase=processamento", () => {
      assert.match(
        migrationSrc,
        /COALESCE\("dataProcessamento", "xmlDhEmi"\)/
      );
    });

    it("os índices de expressão da junção casam com a expressão usada no código", () => {
      // O JOIN em queryTopFiscalNfeCustomers/queryRecentFiscalNfes usa esta
      // expressão dos dois lados — o índice precisa ser byte-a-byte igual,
      // senão o Postgres não o reconhece como aplicável.
      assert.match(
        src,
        /regexp_replace\(COALESCE\(c\."taxId", ''\), '\[\^0-9\]', '', 'g'\)/
      );
      assert.match(
        src,
        /regexp_replace\(COALESCE\(n\."xmlDestCnpjCpf", ''\), '\[\^0-9\]', '', 'g'\)/
      );
      assert.match(
        migrationSrc,
        /regexp_replace\(COALESCE\("taxId", ''\), '\[\^0-9\]', '', 'g'\)/
      );
      assert.match(
        migrationSrc,
        /regexp_replace\(COALESCE\("xmlDestCnpjCpf", ''\), '\[\^0-9\]', '', 'g'\)/
      );
    });

    it("a migration só cria índices — nenhum DML, nenhum DROP de dado", () => {
      assert.equal(/DELETE|UPDATE|TRUNCATE|DROP TABLE|DROP COLUMN/i.test(migrationSrc), false);
      assert.match(migrationSrc, /CREATE INDEX IF NOT EXISTS/);
    });
  });
});
