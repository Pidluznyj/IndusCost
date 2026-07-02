import type { Prisma, PrismaClient } from "@prisma/client";
import {
  buildCommissionCalculationHash,
  buildPaymentScheduleKey,
  buildRuleMatchContext,
  shouldBlockAutoChangePaidRecord,
} from "./commission-calculation-hash.js";
import {
  allocateProportional,
  computeCommissionAmount,
  decimalToNumber,
  roundMoney,
  toPrismaDecimal,
} from "./commission-money.js";
import {
  collectOrderAuditIssues,
  upsertCommissionAuditIssues,
  buildNoCommissionRuleIssue,
  buildPaidWithoutReleaseIssue,
  shouldFlagPaidWithoutRelease,
} from "./commission-audit-service.js";
import {
  extractAuditSettings,
  filterRulesByScope,
  resolveActiveBeneficiaryTypes,
} from "./commissionSettings.server.js";
import {
  computeBalanceAfterRelease,
  computeReleaseForSchedule,
  resolveEffectiveReleaseRule,
} from "./commission-release-service.js";
import {
  loadActiveCommissionRules,
  resolveOrCreateCommissionPerson,
  selectBestMatchingRule,
} from "./commission-rule-engine.js";
import { CommercialTierCache } from "./commission-commercial-tier.server.js";
import { resolveCommissionRateForItem } from "./commission-rate-resolver.server.js";
import { loadCommissionSettings } from "./commission-settings.server.js";
import { loadCommissionOrderSources, resolveCommissionPeriod } from "./commission-source-resolver.server.js";
import type {
  CalculateCommissionsInput,
  CommissionCalculationSummary,
  CommissionOrderSourceBundle,
  CommissionPaymentScheduleDraft,
  CommissionRecordDraft,
  CommissionRuleMatchResult,
} from "./commission-types.js";

const BENEFICIARY_TYPES = ["SELLER", "REPRESENTATIVE"] as const;

type BeneficiaryType = (typeof BENEFICIARY_TYPES)[number];

function itemBaseAmount(
  item: CommissionOrderSourceBundle["items"][number],
  baseType: CommissionRuleMatchResult["baseType"]
): number {
  if (baseType === "RECEIVABLE_AMOUNT") return roundMoney(item.itemNetAmount);
  return roundMoney(item.itemNetAmount);
}

function buildForecastSchedules(
  order: CommissionOrderSourceBundle,
  calculationHash: string,
  commissionAmount: number
): CommissionPaymentScheduleDraft[] {
  const parts = order.forecastInstallments.map((p) => ({
    key: String(p.installmentNumber),
    weight: p.expectedAmount,
  }));
  const allocations = allocateProportional(commissionAmount, parts);
  return order.forecastInstallments.map((inst, idx) => ({
    scheduleKey: buildPaymentScheduleKey({
      calculationHash,
      source: "SALES_ORDER_INSTALLMENT",
      nomusReceivableId: null,
      installmentNumber: inst.installmentNumber,
    }),
    source: "SALES_ORDER_INSTALLMENT" as const,
    status: "FORECAST" as const,
    nomusOrderId: order.nomusOrderId,
    nomusNfeId: null,
    nomusReceivableId: null,
    installmentNumber: inst.installmentNumber,
    dueDate: inst.dueDate,
    expectedAmount: inst.expectedAmount,
    receivableAmount: null,
    receivedAmount: null,
    openBalance: inst.expectedAmount,
    allocationPercent: allocations[idx]?.percent ?? null,
    commissionExpectedAmount: allocations[idx]?.amount ?? 0,
  }));
}

function buildReceivableSchedules(input: {
  order: CommissionOrderSourceBundle;
  nfeExternalId: number;
  calculationHash: string;
  commissionAmount: number;
}): CommissionPaymentScheduleDraft[] {
  const receivables = input.order.receivablesByNfeId.get(input.nfeExternalId) ?? [];
  if (receivables.length === 0) return [];

  const parts = receivables.map((r) => ({
    key: String(r.nomusReceivableId),
    weight: r.amountReceivable,
  }));
  const allocations = allocateProportional(input.commissionAmount, parts);

  return receivables.map((ar, idx) => ({
    scheduleKey: buildPaymentScheduleKey({
      calculationHash: input.calculationHash,
      source: "ACCOUNTS_RECEIVABLE",
      nomusReceivableId: ar.nomusReceivableId,
      installmentNumber: ar.installmentNumber,
    }),
    source: "ACCOUNTS_RECEIVABLE" as const,
    status: "ACTIVE" as const,
    nomusOrderId: input.order.nomusOrderId,
    nomusNfeId: input.nfeExternalId,
    nomusReceivableId: ar.nomusReceivableId,
    installmentNumber: ar.installmentNumber,
    dueDate: ar.dueDate,
    expectedAmount: null,
    receivableAmount: ar.amountReceivable,
    receivedAmount: ar.amountReceived,
    openBalance: ar.balanceReceivable,
    allocationPercent: allocations[idx]?.percent ?? null,
    commissionExpectedAmount: allocations[idx]?.amount ?? 0,
  }));
}

async function upsertCommissionRecord(
  db: Pick<PrismaClient, "commissionRecord" | "commissionPaymentSchedule">,
  runId: string,
  draft: CommissionRecordDraft,
  schedules: CommissionPaymentScheduleDraft[],
  settings: { paidCommissionBlockAutoChange: boolean },
  stats: CommissionCalculationSummary
): Promise<string> {
  const existing = await db.commissionRecord.findUnique({
    where: { calculationHash: draft.calculationHash },
    include: { paymentSchedules: true },
  });

  if (
    existing &&
    shouldBlockAutoChangePaidRecord(existing.status, settings.paidCommissionBlockAutoChange)
  ) {
    stats.errors.push(
      `Registro pago bloqueado para alteração automática: ${draft.calculationHash.slice(0, 12)}…`
    );
    return existing.id;
  }

  const data = {
    calculationRunId: runId,
    source: "INDUSCOST_CALCULATED" as const,
    originStage: draft.originStage,
    status: draft.status,
    nomusOrderId: draft.nomusOrderId,
    orderCode: draft.orderCode,
    nomusOrderItemId: draft.nomusOrderItemId,
    nomusProductId: draft.nomusProductId,
    productCode: draft.productCode,
    productName: draft.productName,
    nomusNfeId: draft.nomusNfeId,
    nfeNumber: draft.nfeNumber,
    nomusOutputDocumentId: draft.nomusOutputDocumentId,
    nomusOutputDocumentItemId: draft.nomusOutputDocumentItemId,
    commissionPersonId: draft.commissionPersonId,
    nomusSellerId: draft.nomusSellerId,
    nomusRepresentativeId: draft.nomusRepresentativeId,
    customerExternalId: draft.customerExternalId,
    customerName: draft.customerName,
    companyExternalId: draft.companyExternalId,
    baseAmount: toPrismaDecimal(draft.baseAmount),
    ratePercent: toPrismaDecimal(draft.ratePercent),
    commissionAmount: toPrismaDecimal(draft.commissionAmount),
    releaseRule: draft.releaseRule,
    confirmedAt: draft.confirmedAt,
    metadataJson: (draft.metadataJson ?? undefined) as Prisma.InputJsonValue | undefined,
  };

  let recordId: string;
  if (existing) {
    await db.commissionRecord.update({
      where: { id: existing.id },
      data: {
        ...data,
        balanceAmount: toPrismaDecimal(
          computeBalanceAfterRelease(
            draft.commissionAmount,
            decimalToNumber(existing.releasedAmount),
            decimalToNumber(existing.paidAmount)
          )
        ),
      },
    });
    recordId = existing.id;
    stats.commissionsUpdated += 1;
  } else {
    const created = await db.commissionRecord.create({
      data: {
        ...data,
        calculationHash: draft.calculationHash,
        releasedAmount: toPrismaDecimal(0),
        paidAmount: toPrismaDecimal(0),
        balanceAmount: toPrismaDecimal(draft.commissionAmount),
      },
    });
    recordId = created.id;
    stats.commissionsCreated += 1;
  }

  for (const schedule of schedules) {
    const scheduleExisting = await db.commissionPaymentSchedule.findFirst({
      where: {
        commissionRecordId: recordId,
        nomusReceivableId: schedule.nomusReceivableId,
        installmentNumber: schedule.installmentNumber,
        source: schedule.source,
      },
    });
    if (scheduleExisting) {
      await db.commissionPaymentSchedule.update({
        where: { id: scheduleExisting.id },
        data: {
          status: schedule.status,
          dueDate: schedule.dueDate,
          expectedAmount:
            schedule.expectedAmount != null ? toPrismaDecimal(schedule.expectedAmount) : null,
          receivableAmount:
            schedule.receivableAmount != null ? toPrismaDecimal(schedule.receivableAmount) : null,
          receivedAmount:
            schedule.receivedAmount != null ? toPrismaDecimal(schedule.receivedAmount) : null,
          openBalance: schedule.openBalance != null ? toPrismaDecimal(schedule.openBalance) : null,
          allocationPercent:
            schedule.allocationPercent != null ? toPrismaDecimal(schedule.allocationPercent) : null,
          commissionExpectedAmount: toPrismaDecimal(schedule.commissionExpectedAmount),
        },
      });
    } else {
      await db.commissionPaymentSchedule.create({
        data: {
          commissionRecordId: recordId,
          source: schedule.source,
          status: schedule.status,
          nomusOrderId: schedule.nomusOrderId,
          nomusNfeId: schedule.nomusNfeId,
          nomusReceivableId: schedule.nomusReceivableId,
          installmentNumber: schedule.installmentNumber,
          dueDate: schedule.dueDate,
          expectedAmount:
            schedule.expectedAmount != null ? toPrismaDecimal(schedule.expectedAmount) : null,
          receivableAmount:
            schedule.receivableAmount != null ? toPrismaDecimal(schedule.receivableAmount) : null,
          receivedAmount:
            schedule.receivedAmount != null ? toPrismaDecimal(schedule.receivedAmount) : null,
          openBalance: schedule.openBalance != null ? toPrismaDecimal(schedule.openBalance) : null,
          allocationPercent:
            schedule.allocationPercent != null ? toPrismaDecimal(schedule.allocationPercent) : null,
          commissionExpectedAmount: toPrismaDecimal(schedule.commissionExpectedAmount),
          commissionReleasedAmount: toPrismaDecimal(0),
        },
      });
    }
  }

  return recordId;
}

async function supersedeForecastRecords(
  db: Pick<PrismaClient, "commissionRecord">,
  input: {
    nomusOrderId: number | null;
    orderCode: string;
    nomusOrderItemId: number | null;
    commissionPersonId: string;
    nomusNfeId: number;
  },
  stats: CommissionCalculationSummary
): Promise<void> {
  const forecasts = await db.commissionRecord.findMany({
    where: {
      status: { in: ["FORECAST_FROM_ORDER", "WAITING_NFE"] },
      originStage: "SALES_ORDER",
      commissionPersonId: input.commissionPersonId,
      OR: [
        input.nomusOrderId != null ? { nomusOrderId: input.nomusOrderId } : { orderCode: input.orderCode },
      ],
      nomusOrderItemId: input.nomusOrderItemId,
      nomusNfeId: null,
    },
    select: { id: true },
  });

  if (forecasts.length === 0) return;

  await db.commissionRecord.updateMany({
    where: { id: { in: forecasts.map((f) => f.id) } },
    data: { status: "SUPERSEDED_BY_OUTPUT_DOCUMENT" },
  });
  stats.commissionsSuperseded += forecasts.length;
}

async function processBeneficiaryForItem(
  db: PrismaClient,
  input: {
    runId: string;
    order: CommissionOrderSourceBundle;
    item: CommissionOrderSourceBundle["items"][number];
    beneficiaryType: BeneficiaryType;
    rules: Awaited<ReturnType<typeof loadActiveCommissionRules>>;
    settings: Awaited<ReturnType<typeof loadCommissionSettings>>;
    referenceDate: Date;
    tierCache: CommercialTierCache;
    auditDrafts: import("./commission-types.js").CommissionAuditIssueDraft[];
    stats: CommissionCalculationSummary;
  }
): Promise<void> {
  const { order, item, beneficiaryType } = input;

  if (beneficiaryType === "SELLER" && !order.seller.nomusSellerId && !order.seller.responsibleName) {
    return;
  }
  if (
    beneficiaryType === "REPRESENTATIVE" &&
    !order.representative.nomusRepresentativeId &&
    !order.representative.name
  ) {
    return;
  }

  const personName =
    beneficiaryType === "SELLER"
      ? order.seller.responsibleName ?? `Vendedor ${order.seller.nomusSellerId ?? "?"}`
      : order.representative.name ?? `Representante ${order.representative.nomusRepresentativeId ?? "?"}`;

  const nomusPersonId =
    beneficiaryType === "SELLER"
      ? order.seller.nomusSellerId
      : order.representative.nomusRepresentativeId;

  const personId = await resolveOrCreateCommissionPerson(db, {
    beneficiaryType,
    nomusPersonId,
    name: personName,
  });
  if (!personId) return;

  const ctx = buildRuleMatchContext(order, item, beneficiaryType, personId, input.referenceDate);
  const match = selectBestMatchingRule(input.rules, ctx);
  if (!match) {
    input.auditDrafts.push(
      buildNoCommissionRuleIssue({
        order,
        itemId: item.localItemId,
        beneficiaryType,
      })
    );
    return;
  }

  const baseAmount = itemBaseAmount(item, match.baseType);

  const rateResolution = await resolveCommissionRateForItem(db, {
    match,
    order,
    item,
    referenceDate: input.referenceDate,
    tierCache: input.tierCache,
  });
  if (!rateResolution.ok) {
    input.auditDrafts.push(rateResolution.auditIssue);
    return;
  }

  const ratePercent = rateResolution.ratePercent;
  const tierMetadata = rateResolution.metadata;
  const commissionAmount = computeCommissionAmount(baseAmount, ratePercent);
  if (commissionAmount <= 0) return;

  const recordMetadataBase = {
    ruleId: match.rule.id,
    ruleName: match.rule.name,
    calculationType: match.calculationType,
    ...tierMetadata,
  };

  const hasAuthorized = order.authorizedOutputNfes.length > 0;

  if (!hasAuthorized && input.settings.forecastEnabled) {
    const hash = buildCommissionCalculationHash({
      nomusOrderId: order.nomusOrderId,
      orderCode: order.orderCode,
      nomusOrderItemId: item.nomusOrderItemId,
      nomusNfeId: null,
      nomusOutputDocumentId: null,
      commissionPersonId: personId,
      beneficiaryType,
      originStage: "SALES_ORDER",
    });
    const draft: CommissionRecordDraft = {
      calculationHash: hash,
      originStage: "SALES_ORDER",
      status: order.linkedNfes.length > 0 ? "WAITING_NFE" : "FORECAST_FROM_ORDER",
      nomusOrderId: order.nomusOrderId,
      orderCode: order.orderCode,
      nomusOrderItemId: item.nomusOrderItemId,
      nomusProductId: item.nomusProductId,
      productCode: item.productCode,
      productName: item.productName,
      nomusNfeId: null,
      nfeNumber: null,
      nomusOutputDocumentId: null,
      nomusOutputDocumentItemId: null,
      commissionPersonId: personId,
      nomusSellerId: order.seller.nomusSellerId,
      nomusRepresentativeId: order.representative.nomusRepresentativeId,
      customerExternalId: order.customerExternalId,
      customerName: order.customerName,
      companyExternalId: order.companyExternalId,
      baseAmount,
      ratePercent,
      commissionAmount,
      releaseRule: match.releaseRule,
      confirmedAt: null,
      metadataJson: { ...recordMetadataBase, mode: "forecast" },
    };
    const schedules = buildForecastSchedules(order, hash, commissionAmount);
    await upsertCommissionRecord(db, input.runId, draft, schedules, input.settings, input.stats);
    return;
  }

  if (!hasAuthorized) return;

  for (const nfe of order.authorizedOutputNfes) {
    const docs = order.outputDocumentsByNfeId.get(nfe.nfeExternalId) ?? [];
    const receivables = order.receivablesByNfeId.get(nfe.nfeExternalId) ?? [];

    if (input.settings.outputDocumentSupersedesForecast) {
      await supersedeForecastRecords(
        db,
        {
          nomusOrderId: order.nomusOrderId,
          orderCode: order.orderCode,
          nomusOrderItemId: item.nomusOrderItemId,
          commissionPersonId: personId,
          nomusNfeId: nfe.nfeExternalId,
        },
        input.stats
      );
    }

    const hash = buildCommissionCalculationHash({
      nomusOrderId: order.nomusOrderId,
      orderCode: order.orderCode,
      nomusOrderItemId: item.nomusOrderItemId,
      nomusNfeId: nfe.nfeExternalId,
      nomusOutputDocumentId: null,
      commissionPersonId: personId,
      beneficiaryType,
      originStage: "OUTPUT_DOCUMENT",
    });

    const confirmedAt = nfe.dataProcessamento ?? new Date();
    const draft: CommissionRecordDraft = {
      calculationHash: hash,
      originStage: "OUTPUT_DOCUMENT",
      status: receivables.length > 0 ? "WAITING_RECEIVABLE" : "CONFIRMED_BY_OUTPUT_DOCUMENT",
      nomusOrderId: order.nomusOrderId,
      orderCode: order.orderCode,
      nomusOrderItemId: item.nomusOrderItemId,
      nomusProductId: item.nomusProductId,
      productCode: item.productCode,
      productName: item.productName,
      nomusNfeId: nfe.nfeExternalId,
      nfeNumber: nfe.nfeNumber,
      nomusOutputDocumentId: null,
      nomusOutputDocumentItemId: null,
      commissionPersonId: personId,
      nomusSellerId: order.seller.nomusSellerId,
      nomusRepresentativeId: order.representative.nomusRepresentativeId,
      customerExternalId: order.customerExternalId,
      customerName: order.customerName,
      companyExternalId: order.companyExternalId,
      baseAmount,
      ratePercent,
      commissionAmount,
      releaseRule: match.releaseRule,
      confirmedAt,
      metadataJson: {
        ...recordMetadataBase,
        mode: "confirmed",
        nfeExternalId: nfe.nfeExternalId,
        localOutputDocumentMovementId: docs[0]?.localMovementId ?? null,
      },
    };

    const schedules =
      receivables.length > 0
        ? buildReceivableSchedules({
            order,
            nfeExternalId: nfe.nfeExternalId,
            calculationHash: hash,
            commissionAmount,
          })
        : buildForecastSchedules(order, hash, commissionAmount);

    await upsertCommissionRecord(db, input.runId, draft, schedules, input.settings, input.stats);

    if (receivables.length > 0) {
      await applyReleaseForRecord(db, hash, input.settings);
    }
  }
}

async function applyReleaseForRecord(
  db: Pick<
    PrismaClient,
    "commissionRecord" | "commissionPaymentSchedule"
  >,
  calculationHash: string,
  settings: Awaited<ReturnType<typeof loadCommissionSettings>>
): Promise<void> {
  const record = await db.commissionRecord.findUnique({
    where: { calculationHash },
    include: { paymentSchedules: true },
  });
  if (!record) return;

  const commissionAmount = decimalToNumber(record.commissionAmount);
  let releasedTotal = decimalToNumber(record.releasedAmount);
  const releaseRule = resolveEffectiveReleaseRule(record.releaseRule, settings);

  const arSchedules = record.paymentSchedules.filter((s) => s.source === "ACCOUNTS_RECEIVABLE");
  let firstPaidSeen = false;

  for (const schedule of arSchedules) {
    const receivable =
      schedule.nomusReceivableId != null
        ? {
            nomusReceivableId: schedule.nomusReceivableId,
            nomusNfeId: schedule.nomusNfeId,
            installmentNumber: schedule.installmentNumber,
            dueDate: schedule.dueDate,
            amountReceivable: decimalToNumber(schedule.receivableAmount),
            amountReceived: decimalToNumber(schedule.receivedAmount),
            balanceReceivable: decimalToNumber(schedule.openBalance),
            settlementDate: null,
          }
        : null;

    const isFirstPaid = !firstPaidSeen && (receivable?.amountReceived ?? 0) > 0;
    if (isFirstPaid) firstPaidSeen = true;

    const computation = computeReleaseForSchedule({
      releaseRule,
      commissionAmount,
      alreadyReleased: releasedTotal,
      receivableAsDefinitiveReleaseSource: settings.receivableAsDefinitiveReleaseSource,
      schedule: {
        scheduleKey: schedule.id,
        source: schedule.source,
        status: schedule.status,
        nomusOrderId: schedule.nomusOrderId,
        nomusNfeId: schedule.nomusNfeId,
        nomusReceivableId: schedule.nomusReceivableId,
        installmentNumber: schedule.installmentNumber,
        dueDate: schedule.dueDate,
        expectedAmount: schedule.expectedAmount != null ? decimalToNumber(schedule.expectedAmount) : null,
        receivableAmount:
          schedule.receivableAmount != null ? decimalToNumber(schedule.receivableAmount) : null,
        receivedAmount:
          schedule.receivedAmount != null ? decimalToNumber(schedule.receivedAmount) : null,
        openBalance: schedule.openBalance != null ? decimalToNumber(schedule.openBalance) : null,
        allocationPercent:
          schedule.allocationPercent != null ? decimalToNumber(schedule.allocationPercent) : null,
        commissionExpectedAmount: decimalToNumber(schedule.commissionExpectedAmount),
        commissionReleasedAmount: decimalToNumber(schedule.commissionReleasedAmount),
      },
      receivable,
      isFirstReceivablePaidInOrder: isFirstPaid,
    });

    if (computation.releasedDelta <= 0) continue;

    releasedTotal = computation.newReleasedTotal;
    await db.commissionPaymentSchedule.update({
      where: { id: schedule.id },
      data: {
        commissionReleasedAmount: toPrismaDecimal(computation.scheduleReleasedAmount),
        status: computation.scheduleStatus,
        receivedAmount:
          receivable?.amountReceived != null ? toPrismaDecimal(receivable.amountReceived) : undefined,
        openBalance:
          receivable?.balanceReceivable != null ? toPrismaDecimal(receivable.balanceReceivable) : undefined,
      },
    });
  }

  const paidAmount = decimalToNumber(record.paidAmount);
  await db.commissionRecord.update({
    where: { id: record.id },
    data: {
      releasedAmount: toPrismaDecimal(releasedTotal),
      status: computationStatus(releasedTotal, commissionAmount, paidAmount),
      releasedAt: releasedTotal > 0 ? new Date() : record.releasedAt,
      balanceAmount: toPrismaDecimal(
        computeBalanceAfterRelease(commissionAmount, releasedTotal, paidAmount)
      ),
    },
  });
}

function computationStatus(
  released: number,
  commission: number,
  paid: number
): "WAITING_PAYMENT" | "PARTIALLY_RELEASED" | "RELEASED" | "PAID_PARTIAL" | "PAID_TOTAL" {
  if (paid >= commission && commission > 0) return "PAID_TOTAL";
  if (paid > 0) return "PAID_PARTIAL";
  if (released >= commission && commission > 0) return "RELEASED";
  if (released > 0) return "PARTIALLY_RELEASED";
  return "WAITING_PAYMENT";
}

export async function calculateCommissions(
  db: PrismaClient,
  input: CalculateCommissionsInput
): Promise<{ runId: string; summary: CommissionCalculationSummary }> {
  const period = resolveCommissionPeriod(input);
  const settings = await loadCommissionSettings(db);
  const rules = filterRulesByScope(await loadActiveCommissionRules(db), settings);
  const beneficiaryTypes = resolveActiveBeneficiaryTypes(settings);
  const auditFlags = extractAuditSettings(settings);

  const run = await db.commissionCalculationRun.create({
    data: {
      periodStart: period.from,
      periodEnd: period.to,
      mode: input.mode,
      status: "RUNNING",
    },
  });

  const stats: CommissionCalculationSummary = {
    ordersEvaluated: 0,
    nfeEvaluated: 0,
    outputDocumentsEvaluated: 0,
    receivablesEvaluated: 0,
    commissionsCreated: 0,
    commissionsUpdated: 0,
    commissionsSuperseded: 0,
    errorsCount: 0,
    issuesCreated: 0,
    errors: [],
  };

  try {
    const orders = await loadCommissionOrderSources(db, input);
    stats.ordersEvaluated = orders.length;

    const auditDrafts = orders.flatMap((order) => collectOrderAuditIssues(order, auditFlags));
    const tierCache = new CommercialTierCache(db);

    for (const order of orders) {
      if (order.status === "CANCELLED") continue;

      stats.nfeEvaluated += order.authorizedOutputNfes.length;
      for (const nfe of order.authorizedOutputNfes) {
        stats.outputDocumentsEvaluated += (order.outputDocumentsByNfeId.get(nfe.nfeExternalId) ?? []).length;
        stats.receivablesEvaluated += (order.receivablesByNfeId.get(nfe.nfeExternalId) ?? []).length;
      }

      for (const item of order.items) {
        for (const beneficiaryType of beneficiaryTypes) {
          try {
            await processBeneficiaryForItem(db, {
              runId: run.id,
              order,
              item,
              beneficiaryType,
              rules,
              settings,
              referenceDate: order.issueDate,
              tierCache,
              auditDrafts,
              stats,
            });
          } catch (err) {
            stats.errorsCount += 1;
            stats.errors.push(
              err instanceof Error
                ? `${order.orderCode}/${item.productCode}: ${err.message}`
                : `${order.orderCode}: erro desconhecido`
            );
          }
        }
      }
    }

    if (settings.auditPaidWithoutRelease) {
      const paidRecords = await db.commissionRecord.findMany({
        where: {
          calculatedAt: { gte: period.from, lte: period.to },
          paidAmount: { gt: 0 },
        },
        select: {
          id: true,
          status: true,
          releasedAmount: true,
          paidAmount: true,
        },
      });
      for (const record of paidRecords) {
        if (
          shouldFlagPaidWithoutRelease({
            status: record.status,
            releasedAmount: decimalToNumber(record.releasedAmount),
            paidAmount: decimalToNumber(record.paidAmount),
          })
        ) {
          auditDrafts.push(buildPaidWithoutReleaseIssue(record.id));
        }
      }
    }

    stats.issuesCreated = await upsertCommissionAuditIssues(db, auditDrafts);

    await db.commissionCalculationRun.update({
      where: { id: run.id },
      data: {
        status: stats.errorsCount > 0 ? "FAILED" : "SUCCESS",
        ordersEvaluated: stats.ordersEvaluated,
        nfeEvaluated: stats.nfeEvaluated,
        outputDocumentsEvaluated: stats.outputDocumentsEvaluated,
        receivablesEvaluated: stats.receivablesEvaluated,
        commissionsCreated: stats.commissionsCreated,
        commissionsUpdated: stats.commissionsUpdated,
        commissionsSuperseded: stats.commissionsSuperseded,
        errorsCount: stats.errorsCount,
        finishedAt: new Date(),
        summaryJson: stats as unknown as Prisma.InputJsonValue,
      },
    });

    return { runId: run.id, summary: stats };
  } catch (err) {
    stats.errorsCount += 1;
    stats.errors.push(err instanceof Error ? err.message : "Erro fatal no cálculo de comissões");
    await db.commissionCalculationRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        errorsCount: stats.errorsCount,
        finishedAt: new Date(),
        summaryJson: stats as unknown as Prisma.InputJsonValue,
      },
    });
    throw err;
  }
}
