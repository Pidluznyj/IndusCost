import type { PrismaClient } from "@prisma/client";
import {
  buildCommissionCalculationHash,
  buildRuleMatchContext,
} from "./commission-calculation-hash.js";
import { computeCommissionAmount, roundMoney } from "./commission-money.js";
import {
  filterRulesByScope,
  resolveActiveBeneficiaryTypes,
} from "./commissionSettings.server.js";
import { loadCommissionSettings } from "./commission-settings.server.js";
import {
  loadActiveCommissionRules,
  selectBestMatchingRule,
} from "./commission-rule-engine.js";
import { CommercialTierCache } from "./commission-commercial-tier.server.js";
import { resolveCommissionRateForItem } from "./commission-rate-resolver.server.js";
import { loadCommissionOrderSources } from "./commission-source-resolver.server.js";
import type { CommissionOrderSourceBundle, CommissionPeriodInput } from "./commission-types.js";
import { activeCommissionRecordWhere } from "./commission-record-status.js";

const BENEFICIARY_TYPES = ["SELLER", "REPRESENTATIVE"] as const;
type BeneficiaryType = (typeof BENEFICIARY_TYPES)[number];

export type CommissionPreviewLine = {
  orderCode: string;
  issueDate: string;
  productCode: string | null;
  customerName: string | null;
  sellerName: string | null;
  commissionPersonName: string;
  beneficiaryType: BeneficiaryType;
  mode: "forecast" | "confirmed" | "blocked";
  status: string;
  ruleName: string | null;
  rulePercent: number | null;
  baseAmount: number;
  commissionAmount: number;
  nfeNumber: string | null;
  blockReason: string | null;
};

export type CommissionPreviewResult = {
  periodLabel: string;
  ordersAnalyzed: number;
  ordersActive: number;
  itemsAnalyzed: number;
  forecastLines: number;
  confirmedLines: number;
  waitingNfeLines: number;
  noRuleLines: number;
  noSellerLines: number;
  forecastAmount: number;
  confirmedAmount: number;
  waitingNfeAmount: number;
  noRuleAmount: number;
  activeRulesCount: number;
  existingActiveRecords: number;
  existingPaidRecords: number;
  existingHashes: number;
  wouldUpsertLines: number;
  blockers: string[];
  topSellers: Array<{ name: string; amount: number; count: number }>;
  topCustomers: Array<{ name: string; amount: number; count: number }>;
  sampleLines: CommissionPreviewLine[];
};

function itemBaseAmount(item: CommissionOrderSourceBundle["items"][number]): number {
  return roundMoney(item.itemNetAmount);
}

async function resolvePersonIdPreview(
  db: Pick<PrismaClient, "commissionPerson">,
  input: {
    beneficiaryType: BeneficiaryType;
    nomusPersonId: number | null;
    name: string;
  }
): Promise<{ personId: string | null; personName: string; exists: boolean }> {
  if (input.nomusPersonId != null) {
    const existing = await db.commissionPerson.findFirst({
      where: { nomusPersonId: input.nomusPersonId, active: true },
      select: { id: true, name: true },
    });
    if (existing) {
      return { personId: existing.id, personName: existing.name, exists: true };
    }
  }
  return {
    personId:
      input.nomusPersonId != null
        ? `preview-${input.beneficiaryType}-${input.nomusPersonId}`
        : null,
    personName: input.name,
    exists: false,
  };
}

function pushLine(lines: CommissionPreviewLine[], line: CommissionPreviewLine, max = 500): void {
  if (lines.length < max) lines.push(line);
}

export async function previewCommissionCalculation(
  db: PrismaClient,
  period: CommissionPeriodInput & { label?: string }
): Promise<CommissionPreviewResult> {
  const settings = await loadCommissionSettings(db);
  const rules = filterRulesByScope(await loadActiveCommissionRules(db), settings);
  const beneficiaryTypes = resolveActiveBeneficiaryTypes(settings);
  const orders = await loadCommissionOrderSources(db, period);
  const activeOrders = orders.filter((o) => o.status !== "CANCELLED");

  const range =
    period.from && period.to ? { from: period.from, to: period.to } : undefined;

  const [existingActiveRecords, existingPaidRecords, existingHashRows] = await Promise.all([
    db.commissionRecord.count({
      where: range ? activeCommissionRecordWhere(range) : activeCommissionRecordWhere(),
    }),
    db.commissionRecord.count({
      where: {
        ...(range ? { calculatedAt: { gte: range.from, lte: range.to } } : {}),
        status: { in: ["PAID_PARTIAL", "PAID_TOTAL"] },
      },
    }),
    db.commissionRecord.findMany({
      where: range ? { calculatedAt: { gte: range.from, lte: range.to } } : {},
      select: { calculationHash: true },
    }),
  ]);

  const blockers: string[] = [];
  if (rules.length === 0) {
    blockers.push("Nenhuma regra de comissão ativa — cálculo apply bloqueado.");
  }

  const lines: CommissionPreviewLine[] = [];
  let itemsAnalyzed = 0;
  let forecastLines = 0;
  let confirmedLines = 0;
  let waitingNfeLines = 0;
  let noRuleLines = 0;
  let noSellerLines = 0;
  let tierBlockedLines = 0;
  let forecastAmount = 0;
  let confirmedAmount = 0;
  let waitingNfeAmount = 0;
  let noRuleAmount = 0;
  let wouldUpsertLines = 0;

  const sellerTotals = new Map<string, { amount: number; count: number }>();
  const customerTotals = new Map<string, { amount: number; count: number }>();
  const tierCache = new CommercialTierCache(db);

  for (const order of activeOrders) {
    for (const item of order.items) {
      for (const beneficiaryType of beneficiaryTypes) {
        itemsAnalyzed += 1;

        if (
          beneficiaryType === "SELLER" &&
          !order.seller.nomusSellerId &&
          !order.seller.responsibleName
        ) {
          noSellerLines += 1;
          continue;
        }
        if (
          beneficiaryType === "REPRESENTATIVE" &&
          !order.representative.nomusRepresentativeId &&
          !order.representative.name
        ) {
          continue;
        }

        const personName =
          beneficiaryType === "SELLER"
            ? order.seller.responsibleName ?? `Vendedor ${order.seller.nomusSellerId ?? "?"}`
            : order.representative.name ??
              `Representante ${order.representative.nomusRepresentativeId ?? "?"}`;

        const nomusPersonId =
          beneficiaryType === "SELLER"
            ? order.seller.nomusSellerId
            : order.representative.nomusRepresentativeId;

        const person = await resolvePersonIdPreview(db, {
          beneficiaryType,
          nomusPersonId,
          name: personName,
        });
        if (!person.personId) continue;

        const ctx = buildRuleMatchContext(
          order,
          item,
          beneficiaryType,
          person.personId,
          order.issueDate
        );
        const match = selectBestMatchingRule(rules, ctx);
        if (!match) {
          noRuleLines += 1;
          noRuleAmount = roundMoney(noRuleAmount + itemBaseAmount(item));
          pushLine(lines, {
            orderCode: order.orderCode,
            issueDate: order.issueDate.toISOString().slice(0, 10),
            productCode: item.productCode,
            customerName: order.customerName,
            sellerName: order.seller.responsibleName,
            commissionPersonName: person.personName,
            beneficiaryType,
            mode: "blocked",
            status: "NO_RULE",
            ruleName: null,
            rulePercent: null,
            baseAmount: itemBaseAmount(item),
            commissionAmount: 0,
            nfeNumber: null,
            blockReason: "Sem regra aplicável",
          });
          continue;
        }

        const baseAmount = itemBaseAmount(item);

        const rateResolution = await resolveCommissionRateForItem(db, {
          match,
          order,
          item,
          referenceDate: order.issueDate,
          tierCache,
        });
        if (!rateResolution.ok) {
          tierBlockedLines += 1;
          pushLine(lines, {
            orderCode: order.orderCode,
            issueDate: order.issueDate.toISOString().slice(0, 10),
            productCode: item.productCode,
            customerName: order.customerName,
            sellerName: order.seller.responsibleName,
            commissionPersonName: person.personName,
            beneficiaryType,
            mode: "blocked",
            status: rateResolution.auditIssue.type,
            ruleName: match.rule.name,
            rulePercent: null,
            baseAmount,
            commissionAmount: 0,
            nfeNumber: null,
            blockReason: rateResolution.auditIssue.message,
          });
          continue;
        }

        const commissionAmount = computeCommissionAmount(baseAmount, rateResolution.ratePercent);
        if (commissionAmount <= 0) continue;
        const rulePercent = rateResolution.ratePercent;

        const hasAuthorized = order.authorizedOutputNfes.length > 0;

        const addTotals = (amount: number, sellerKey: string, customerKey: string) => {
          const s = sellerTotals.get(sellerKey) ?? { amount: 0, count: 0 };
          sellerTotals.set(sellerKey, {
            amount: roundMoney(s.amount + amount),
            count: s.count + 1,
          });
          const c = customerTotals.get(customerKey) ?? { amount: 0, count: 0 };
          customerTotals.set(customerKey, {
            amount: roundMoney(c.amount + amount),
            count: c.count + 1,
          });
        };

        if (!hasAuthorized && settings.forecastEnabled) {
          const status = order.linkedNfes.length > 0 ? "WAITING_NFE" : "FORECAST_FROM_ORDER";
          const hash = buildCommissionCalculationHash({
            nomusOrderId: order.nomusOrderId,
            orderCode: order.orderCode,
            nomusOrderItemId: item.nomusOrderItemId,
            nomusNfeId: null,
            nomusOutputDocumentId: null,
            commissionPersonId: person.personId,
            beneficiaryType,
            originStage: "SALES_ORDER",
          });
          if (!existingHashRows.some((h) => h.calculationHash === hash)) wouldUpsertLines += 1;

          if (status === "WAITING_NFE") {
            waitingNfeLines += 1;
            waitingNfeAmount = roundMoney(waitingNfeAmount + commissionAmount);
          } else {
            forecastLines += 1;
            forecastAmount = roundMoney(forecastAmount + commissionAmount);
          }

          addTotals(commissionAmount, person.personName, order.customerName ?? "—");
          pushLine(lines, {
            orderCode: order.orderCode,
            issueDate: order.issueDate.toISOString().slice(0, 10),
            productCode: item.productCode,
            customerName: order.customerName,
            sellerName: order.seller.responsibleName,
            commissionPersonName: person.personName,
            beneficiaryType,
            mode: "forecast",
            status,
            ruleName: match.rule.name,
            rulePercent: rulePercent,
            baseAmount,
            commissionAmount,
            nfeNumber: null,
            blockReason: null,
          });
          continue;
        }

        if (!hasAuthorized) continue;

        for (const nfe of order.authorizedOutputNfes) {
          const receivables = order.receivablesByNfeId.get(nfe.nfeExternalId) ?? [];
          const hash = buildCommissionCalculationHash({
            nomusOrderId: order.nomusOrderId,
            orderCode: order.orderCode,
            nomusOrderItemId: item.nomusOrderItemId,
            nomusNfeId: nfe.nfeExternalId,
            nomusOutputDocumentId: null,
            commissionPersonId: person.personId,
            beneficiaryType,
            originStage: "OUTPUT_DOCUMENT",
          });
          if (!existingHashRows.some((h) => h.calculationHash === hash)) wouldUpsertLines += 1;

          const status =
            receivables.length > 0 ? "WAITING_RECEIVABLE" : "CONFIRMED_BY_OUTPUT_DOCUMENT";
          confirmedLines += 1;
          confirmedAmount = roundMoney(confirmedAmount + commissionAmount);
          addTotals(commissionAmount, person.personName, order.customerName ?? "—");

          pushLine(lines, {
            orderCode: order.orderCode,
            issueDate: order.issueDate.toISOString().slice(0, 10),
            productCode: item.productCode,
            customerName: order.customerName,
            sellerName: order.seller.responsibleName,
            commissionPersonName: person.personName,
            beneficiaryType,
            mode: "confirmed",
            status,
            ruleName: match.rule.name,
            rulePercent: rulePercent,
            baseAmount,
            commissionAmount,
            nfeNumber: nfe.nfeNumber,
            blockReason: null,
          });
        }
      }
    }
  }

  const topSellers = [...sellerTotals.entries()]
    .map(([name, v]) => ({ name, amount: v.amount, count: v.count }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10);

  const topCustomers = [...customerTotals.entries()]
    .map(([name, v]) => ({ name, amount: v.amount, count: v.count }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10);

  return {
    periodLabel: period.label ?? "período",
    ordersAnalyzed: orders.length,
    ordersActive: activeOrders.length,
    itemsAnalyzed,
    forecastLines,
    confirmedLines,
    waitingNfeLines,
    noRuleLines,
    noSellerLines,
    forecastAmount,
    confirmedAmount,
    waitingNfeAmount,
    noRuleAmount,
    activeRulesCount: rules.length,
    existingActiveRecords,
    existingPaidRecords,
    existingHashes: existingHashRows.length,
    wouldUpsertLines,
    blockers,
    topSellers,
    topCustomers,
    sampleLines: lines.slice(0, 20),
  };
}

export async function evaluateApplySafety(
  db: PrismaClient,
  period: CommissionPeriodInput & { label?: string }
): Promise<{ safe: boolean; reasons: string[]; preview: CommissionPreviewResult }> {
  const preview = await previewCommissionCalculation(db, period);
  const reasons: string[] = [...preview.blockers];

  if (preview.activeRulesCount === 0) {
    reasons.push("Sem regras ativas.");
  }
  if (preview.forecastLines + preview.confirmedLines === 0 && preview.existingActiveRecords === 0) {
    reasons.push("Preview não identificou linhas calculáveis e não há registros existentes.");
  }

  return { safe: reasons.length === 0, reasons: [...new Set(reasons)], preview };
}
