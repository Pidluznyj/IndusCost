import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildCommissionReceivableForecastPreview,
  filterOpenReceivablesForForecast,
  forecastCommissionFromMaterializedSchedule,
  isOpenReceivableForForecast,
  type CommissionReceiptReceivableInput,
  type MaterializedReceivableScheduleInput,
} from "./commissionReceiptEngine.js";
import {
  COMMISSION_FORECAST_RECONCILIATION_NOTE,
  buildReceivableForecastOfficialPayload,
} from "./commissionReceivableForecastOfficial.js";
import { COMMISSION_GROUP_COMPANY_EXCLUSION_REASON } from "./commissionInternalGroupExclusion.js";
import type { CommissionSellerIdentityContext } from "./commissionSellerIdentity.js";

const identityCtx: CommissionSellerIdentityContext = {
  personsByNomusId: new Map(),
  personsById: new Map(),
  aliasesByNomusSellerId: new Map(),
  aliasesByNormalizedName: new Map(),
};

function openReceivable(
  partial: Partial<CommissionReceiptReceivableInput> & Pick<CommissionReceiptReceivableInput, "nomusReceivableId">
): CommissionReceiptReceivableInput {
  return {
    receivableNumber: "CR-1",
    installmentNumber: 1,
    settlementDate: null,
    dueDate: new Date("2026-08-15"),
    amountReceivable: 1000,
    amountReceived: 0,
    balanceReceivable: 1000,
    nomusNfeId: 5001,
    nfeNumber: "NF-5001",
    customerExternalId: 100,
    customerId: "cust-1",
    customerName: "Cliente Mercado",
    ...partial,
  };
}

function activeSchedule(
  partial: Partial<MaterializedReceivableScheduleInput> = {}
): MaterializedReceivableScheduleInput {
  return {
    id: "sch-1",
    orderSnapshotId: "snap-1",
    receivableId: 9001,
    receivableCode: "CR-1",
    installmentNumber: 1,
    nfeId: 5001,
    salesOrderId: "so-1",
    customerId: "cust-1",
    canonicalSellerId: "person-1",
    canonicalSellerName: "Vendedor Oficial",
    rawSellerId: 42,
    rawSellerName: "Vendedor Nomus",
    orderCode: "PD-100",
    receivableNominalAmount: 1000,
    receivableSharePercent: 100,
    scheduledCommissionAmount: 50,
    scheduleStatus: "ACTIVE",
    sellerResolutionStatus: "RESOLVED",
    exclusionRuleId: null,
    exclusionReason: null,
    ...partial,
  };
}

describe("commissionReceivableForecastOfficial", () => {
  it("previsão usa saldo em aberto para comissão proporcional ao schedule", () => {
    const fc = forecastCommissionFromMaterializedSchedule({
      schedule: activeSchedule({ scheduledCommissionAmount: 80 }),
      receivable: openReceivable({ nomusReceivableId: 9001, balanceReceivable: 500 }),
    });
    assert.equal(fc.commissionableBaseAmount, 500);
    assert.equal(fc.forecastCommissionAmount, 40);
  });

  it("empresa do grupo é excluída na previsão como no fechamento", () => {
    const preview = buildCommissionReceivableForecastPreview({
      year: 2026,
      month: 6,
      receivables: [
        openReceivable({
          nomusReceivableId: 1,
          customerCnpj: "72.569.510/0001-95",
          customerName: "Lazarios Comercio de Plasticos LTDA",
        }),
      ],
      ordersByNfeId: new Map(),
      materializedSchedulesByReceivableId: new Map(),
      rules: [],
      exclusionRules: [],
      identityCtx,
    });
    assert.equal(preview.lines.length, 1);
    assert.equal(preview.lines[0]!.status, "GROUP_COMPANY_EXCLUDED");
  });

  it("vendedor não resolvido não atribui comissão comissionável", () => {
    const preview = buildCommissionReceivableForecastPreview({
      year: 2026,
      month: 6,
      receivables: [openReceivable({ nomusReceivableId: 2 })],
      ordersByNfeId: new Map(),
      materializedSchedulesByReceivableId: new Map([
        [
          2,
          [
            activeSchedule({
              receivableId: 2,
              canonicalSellerId: null,
              sellerResolutionStatus: "UNRESOLVED",
            }),
          ],
        ],
      ]),
      rules: [],
      exclusionRules: [],
      identityCtx,
    });
    assert.equal(preview.lines[0]!.status, "SELLER_UNRESOLVED");
    assert.equal(preview.lines[0]!.releasedCommissionAmount, 0);
  });

  it("payload oficial expõe nota de reconciliação e cards de materialização", () => {
    const preview = buildCommissionReceivableForecastPreview({
      year: 2026,
      month: 6,
      receivables: [openReceivable({ nomusReceivableId: 3 })],
      ordersByNfeId: new Map(),
      materializedSchedulesByReceivableId: new Map([[3, [activeSchedule({ receivableId: 3 })]]]),
      rules: [],
      exclusionRules: [],
      identityCtx,
    });
    const payload = buildReceivableForecastOfficialPayload(preview);
    assert.equal(payload.reconciliationNote, COMMISSION_FORECAST_RECONCILIATION_NOTE);
    assert.ok(payload.materializationSummary.totalReceivablesCount >= 1);
    assert.ok(payload.officialCards.finalCommissionAmount >= 0);
  });

  it("server da previsão não usa mais visual audit FORECAST", () => {
    const server = readFileSync(
      join(import.meta.dirname, "commissionReceivableForecast.server.ts"),
      "utf8"
    );
    assert.match(server, /loadCommissionReceivableForecastPreview/);
    assert.doesNotMatch(server, /listForecastVisualAuditRows/);
  });

  it("filtro open exclui títulos sem saldo", () => {
    assert.equal(
      isOpenReceivableForForecast(
        openReceivable({ nomusReceivableId: 4, balanceReceivable: 0, amountReceivable: 1000 })
      ),
      false
    );
    const filtered = filterOpenReceivablesForForecast([
      openReceivable({ nomusReceivableId: 5 }),
      openReceivable({ nomusReceivableId: 6, balanceReceivable: 0 }),
    ]);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]!.nomusReceivableId, 5);
  });

  it("motivo de exclusão de grupo bate com fechamento", () => {
    const preview = buildCommissionReceivableForecastPreview({
      year: 2026,
      month: 6,
      receivables: [
        openReceivable({
          nomusReceivableId: 7,
          customerCnpj: "14.055.501/0001-80",
        }),
      ],
      ordersByNfeId: new Map(),
      materializedSchedulesByReceivableId: new Map(),
      rules: [],
      exclusionRules: [],
      identityCtx,
    });
    assert.equal(preview.lines[0]!.exclusionReason, COMMISSION_GROUP_COMPANY_EXCLUSION_REASON);
  });
});
