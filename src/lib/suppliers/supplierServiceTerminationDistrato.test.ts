import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateServiceTermination } from "./supplierServiceTerminationCalc.js";
import {
  buildDistratoSettlementRows,
  collectForbiddenPrintTerms,
  formatNoticeOriginPrintLabel,
  sumDistratoSettlementParts,
  validateDistratoForStatusTransition,
} from "./supplierServiceTerminationDistrato.js";
import {
  buildServiceTerminationPrintModel,
  buildServiceTerminationPrintPlainText,
} from "./supplierServiceTerminationPrint.js";
import type { ServiceTerminationDto } from "./supplierServiceTerminationTypes.js";

function fixtureDto(overrides: Partial<ServiceTerminationDto> = {}): ServiceTerminationDto {
  const calc = calculateServiceTermination({
    monthlyServiceAmount: 6000,
    averageWorkedDaysPerMonth: 30,
    hoursPerDay: 8.8,
    monthlyHours: 176,
    restDaysPerYear: 20,
    calculationMode: "WORKED_MONTHS",
    workedMonths: 4,
    contractStartDate: "2026-04-01",
    contractEndDate: "2026-07-09",
    extraWorkedDays: 7,
    noticePenaltyAmount: 4000,
    commissionReportTotal: 458.83,
    otherCredits: 0,
    otherDiscounts: 0,
  });

  return {
    id: "11111111-1111-4111-8111-111111111111",
    supplierId: "22222222-2222-4222-8222-222222222222",
    supplierName: "26.861.465 RODRIGO DA SILVA RAMOS",
    personName: "RODRIGO DA SILVA RAMOS",
    personDocument: "26.861.465/0001-00",
    serviceRole: "Prestação de serviços comerciais",
    contractStartDate: "2026-04-01",
    contractEndDate: "2026-07-09",
    monthlyServiceAmount: calc.monthlyServiceAmount,
    averageWorkedDaysPerMonth: calc.averageWorkedDaysPerMonth,
    hoursPerDay: calc.hoursPerDay,
    monthlyHours: calc.monthlyHours,
    hourlyServiceAmount: calc.hourlyServiceAmount,
    dailyServiceAmount: calc.dailyServiceAmount,
    restDaysPerYear: calc.restDaysPerYear,
    calculationMode: "WORKED_MONTHS",
    workedMonths: calc.workedMonths,
    workedDays: calc.workedDays,
    proportionalRestDays: calc.proportionalRestDays,
    proportionalRestAmount: calc.proportionalRestAmount,
    extraWorkedDays: calc.extraWorkedDays,
    extraWorkedAmount: calc.extraWorkedAmount,
    noticePenaltyAmount: calc.noticePenaltyAmount,
    commissionReportId: null,
    commissionReportTotal: calc.commissionReportTotal,
    otherCredits: 0,
    otherDiscounts: 0,
    otherAdjustments: 0,
    totalTerminationAmount: calc.totalTerminationAmount,
    status: "DRAFT",
    notes: null,
    adjustmentNotes: null,
    createdByName: "QA",
    finalizedByName: null,
    finalizedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    commissionLinks: [
      {
        commissionReportKey: "1",
        commissionPersonId: null,
        commissionPersonName: "RODRIGO",
        periodLabel: "Refrigeração Reletron Ltda",
        orderCode: "PD 02705",
        commissionAmount: 216.64,
        source: "COMMISSION_REPORTS",
        statusLabel: "DEVIDA",
        commissionsHref: null,
      },
      {
        commissionReportKey: "2",
        commissionPersonId: null,
        commissionPersonName: "RODRIGO",
        periodLabel: "Filtrada Piracicaba Ltda",
        orderCode: "PD 02601",
        commissionAmount: 64.1,
        source: "COMMISSION_REPORTS",
        statusLabel: "DEVIDA",
        commissionsHref: null,
      },
      {
        commissionReportKey: "3",
        commissionPersonId: null,
        commissionPersonName: "RODRIGO",
        periodLabel: "Samplas Indústria e Comércio de Plásticos Ltda",
        orderCode: "PD 02508",
        commissionAmount: 38.55,
        source: "COMMISSION_REPORTS",
        statusLabel: "DEVIDA",
        commissionsHref: null,
      },
      {
        commissionReportKey: "4",
        commissionPersonId: null,
        commissionPersonName: "RODRIGO",
        periodLabel: "J S M Gonçalves Variedades",
        orderCode: "PD 02707",
        commissionAmount: 139.54,
        source: "COMMISSION_REPORTS",
        statusLabel: "DEVIDA",
        commissionsHref: null,
      },
    ],
    documentCode: "DST-202607-TEST0001",
    documentVersion: 1,
    supersedesId: null,
    originalContractDate: "2026-04-01",
    originalContractReference: "Contrato PJ 2026",
    contractingPartyName: "Lazarios Koppetel",
    contractingPartyDocument: "14.055.501/0001-80",
    contractingPartyRepName: "Paulo",
    contractingPartyRepRole: "Sócio",
    contractingPartyRepDocument: "000.000.000-00",
    contractedPartyName: "26.861.465 RODRIGO DA SILVA RAMOS",
    contractedPartyDocument: "26.861.465/0001-00",
    contractedPartyRepName: "RODRIGO DA SILVA RAMOS",
    contractedPartyRepDocument: "000.000.000-00",
    contractedServiceDescription: "serviços comerciais",
    signaturePlace: "Curitiba/PR",
    terminationModality: "MUTUAL_AGREEMENT",
    terminationReason: null,
    paymentDueDate: "2026-07-15",
    paymentMethod: "PIX",
    paymentTransactionId: "E2E-TEST",
    paymentEffectiveDate: "2026-07-15",
    paymentConfirmedAmount: calc.totalTerminationAmount,
    paymentProofStorageKey: "manual:comprovante.pdf",
    paymentProofFileName: "comprovante.pdf",
    paymentProofWaiverReason: null,
    commissionTreatment: "NONE_PENDING",
    commissionPendingNotes: null,
    commissionNegotiatedAmount: null,
    commissionNegotiatedOrders: null,
    commissionNegotiatedJustification: null,
    commissionNegotiatedApprover: null,
    noticePenaltyOrigin: "AGREEMENT",
    noticePenaltyClauseNumber: null,
    noticePenaltyClauseDescription: null,
    proportionalCompensationJustification: "Critério contratual proporcional",
    extraServicesDescription: "Saldo adicional do período",
    otherDiscountsDescription: null,
    contractualNotes: null,
    pendingObligationsNotes: null,
    hasPendingObligations: false,
    witness1Name: "Testemunha Um",
    witness1Document: "111.111.111-11",
    witness2Name: "Testemunha Dois",
    witness2Document: "222.222.222-22",
    integrityCode: null,
    settledSnapshotJson: null,
    contractTypeConfirmedPj: true,
    ...overrides,
  };
}

describe("supplierServiceTerminationDistrato", () => {
  it("preserva fórmulas e soma do caso fixture → 7192.16", () => {
    const dto = fixtureDto();
    assert.equal(dto.proportionalRestAmount, 1333.33);
    assert.equal(dto.extraWorkedAmount, 1400);
    assert.equal(dto.noticePenaltyAmount, 4000);
    assert.equal(dto.commissionReportTotal, 458.83);
    assert.equal(dto.totalTerminationAmount, 7192.16);
    assert.equal(sumDistratoSettlementParts(dto), 7192.16);
  });

  it("mapeia nomes internos para nomes impressos civis", () => {
    const rows = buildDistratoSettlementRows(fixtureDto());
    const labels = rows.map((r) => r.label).join(" | ");
    assert.match(labels, /Compensação contratual proporcional/);
    assert.match(labels, /Saldo adicional de serviços prestados/);
    assert.match(labels, /Valor negociado para encerramento contratual/);
    assert.match(labels, /Comissões comerciais apuradas/);
    assert.match(labels, /VALOR LÍQUIDO DO ACERTO CONTRATUAL/);
    assert.doesNotMatch(labels, /Descanso remunerado|aviso|férias|salário/i);
    assert.equal(
      formatNoticeOriginPrintLabel("CONTRACT_CLAUSE", "8.2"),
      "Compensação contratual pelo encerramento sem antecedência (cláusula 8.2)"
    );
  });

  it("PDF preliminar sem marca d'água e não imprime fatores internos/trabalhistas", () => {
    const model = buildServiceTerminationPrintModel(fixtureDto({ status: "DRAFT" }));
    const plain = buildServiceTerminationPrintPlainText(fixtureDto({ status: "DRAFT" }));
    assert.equal(model.watermarkText, null);
    assert.match(plain, /MINUTA — SEM EFEITO DE QUITAÇÃO/); // rodapé apenas
    assert.match(plain, /TERMO DE DISTRATO/);
    assert.match(plain, /PD 02705/);
    assert.match(plain, /PD 02601/);
    assert.match(plain, /PD 02508/);
    assert.match(plain, /PD 02707/);
    assert.equal(collectForbiddenPrintTerms(plain).length, 0);
    assert.doesNotMatch(plain, /8[,.]8|176|22[,.]73/);
    assert.doesNotMatch(plain, /descanso remunerado|aviso-prévio|salário|rescisão CLT/i);
  });

  it("PDF pago e quitado sem marca d'água e com cláusula de quitação", () => {
    const model = buildServiceTerminationPrintModel(
      fixtureDto({ status: "PAID_AND_SETTLED" })
    );
    const plain = buildServiceTerminationPrintPlainText(
      fixtureDto({ status: "PAID_AND_SETTLED" })
    );
    assert.equal(model.watermarkText, null);
    assert.doesNotMatch(plain, /MINUTA — SEM EFEITO DE QUITAÇÃO/);
    assert.match(plain, /quitação específica|quitacao especifica/i);
    assert.equal(collectForbiddenPrintTerms(plain).length, 0);
  });

  it("bloqueia quitação sem pagamento e com comissão pendente", () => {
    const base = fixtureDto({
      status: "SIGNED_AWAITING_PAYMENT",
      paymentEffectiveDate: null,
      paymentMethod: null,
      paymentTransactionId: null,
      paymentConfirmedAmount: null,
      paymentProofStorageKey: null,
      paymentProofFileName: null,
      paymentProofWaiverReason: null,
    });
    const issues = validateDistratoForStatusTransition({
      dto: base,
      targetStatus: "PAID_AND_SETTLED",
    });
    assert.ok(issues.some((i) => i.code === "PAYMENT_DATE_REQUIRED"));

    const pending = validateDistratoForStatusTransition({
      dto: fixtureDto({
        status: "SIGNED_AWAITING_PAYMENT",
        commissionTreatment: "HAS_PENDING",
        commissionPendingNotes: "Anexo II",
      }),
      targetStatus: "PAID_AND_SETTLED",
    });
    assert.ok(pending.some((i) => i.code === "PENDING_COMMISSION_BLOCKS_SETTLEMENT"));
  });
});
