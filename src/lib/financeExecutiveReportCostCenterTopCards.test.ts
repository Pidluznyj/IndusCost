import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildExecutiveReportCostCenterTopCards,
  EXECUTIVE_REPORT_COST_CENTER_TOP_CARDS_LIMIT,
} from "./financeExecutiveReportCostCenterTopCards.js";
import type { FinanceCostCenterDashboardByCostCenterRow } from "./financeCostCenterDashboard.js";
import type { FinanceCostCenterDto } from "./financeCostCenters.js";

function center(overrides: Partial<FinanceCostCenterDto> = {}): FinanceCostCenterDto {
  return {
    id: "cc-1",
    code: "ADM",
    name: "Administrativo",
    description: null,
    parentId: null,
    responsibleUserId: null,
    responsibleName: null,
    status: "ACTIVE",
    color: null,
    icon: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

const centers: FinanceCostCenterDto[] = [
  center({ id: "cc-a", code: "CC_A", name: "Centro A" }),
  center({ id: "cc-b", code: "CC_B", name: "Centro B" }),
  center({ id: "cc-c", code: "CC_C", name: "Centro C", parentId: "cc-a" }),
];

function row(
  id: string,
  code: string,
  name: string,
  amount: number,
  share: number
): FinanceCostCenterDashboardByCostCenterRow {
  return {
    costCenterId: id,
    code,
    name,
    amount,
    openAmount: amount * 0.4,
    overdueAmount: amount * 0.1,
    paidAmount: amount * 0.5,
    titlesCount: 10,
    sharePercentage: share,
  };
}

describe("financeExecutiveReportCostCenterTopCards", () => {
  it("retorna no máximo 12 cards ordenados por amount desc", () => {
    const byCostCenter = Array.from({ length: 15 }, (_, index) =>
      row(`cc-${index}`, `C${index}`, `Centro ${index}`, 1000 - index * 10, 1)
    );
    const allCenters: FinanceCostCenterDto[] = byCostCenter.map((item) =>
      center({ id: item.costCenterId, code: item.code, name: item.name })
    );

    const { topCards } = buildExecutiveReportCostCenterTopCards(byCostCenter, allCenters, {
      limit: EXECUTIVE_REPORT_COST_CENTER_TOP_CARDS_LIMIT,
    });

    assert.equal(topCards.length, 12);
    assert.equal(topCards[0]?.code, "C0");
    assert.equal(topCards[11]?.code, "C11");
    for (let i = 1; i < topCards.length; i += 1) {
      assert.ok(
        (topCards[i - 1]?.totalAmount ?? 0) >= (topCards[i]?.totalAmount ?? 0),
        "ordem decrescente"
      );
    }
  });

  it("calcula headline de concentração a partir do array oficial", () => {
    const byCostCenter = [
      row("cc-a", "CC_A", "Centro A", 800, 80),
      row("cc-b", "CC_B", "Centro B", 200, 20),
    ];
    const { summary, totals } = buildExecutiveReportCostCenterTopCards(byCostCenter, centers, {
      classifiedTotal: 1000,
    });
    assert.equal(summary.topAmount, 1000);
    assert.equal(summary.topSharePercent, 100);
    assert.match(summary.headline, /concentram/);
    assert.equal(totals.centersCount, 2);
    assert.equal(totals.amount, 1000);
    assert.equal(totals.overdueAmount, 100);
    assert.equal(totals.participationPercent, 100);
  });

  it("relatório presidencial usa motor oficial sem cálculo paralelo", () => {
    const report = readFileSync(
      join(process.cwd(), "src/lib/financeExecutiveReport.ts"),
      "utf8"
    );
    assert.match(report, /buildFinanceCostCenterDashboardDefault/);
    assert.match(report, /buildExecutiveReportCostCenterTopCards/);
    assert.doesNotMatch(report, /loadExecutiveReportCostCenterSpendingChart/);
  });

  it("documento não renderiza gráfico/tabela antigos de centro de custo", () => {
    const document = readFileSync(
      join(
        process.cwd(),
        "src/components/finance/executive-report/ExecutiveReportDocument.tsx"
      ),
      "utf8"
    );
    assert.doesNotMatch(document, /ExecutiveCostCenterAnnualSpendingChart/);
    assert.match(document, /ExecutiveCostCenterTopCardsGrid/);
    assert.match(document, /Principais Centros de Custo/);
    assert.match(document, /allowContentFlow/);
    assert.match(document, /costCenterSpending\.totals/);
  });
});
