/**
 * Recálculo de margem comercial de Propostas existentes — domínio puro.
 * Sem Prisma, sem Pedido, sem I/O.
 */
import {
  calculateProposalItemCommercialMargin,
  PROPOSAL_COMMERCIAL_MARGIN_REASON_LABEL,
  type ProposalCommercialMarginReasonCode,
} from "./proposalCommercialMargin.js";
import type { CommercialMarginTier } from "./commercialMarginCore.js";
import {
  buildProposalCommercialMarginFreeze,
  parseProposalCommercialPricingSnapshot,
  recalculateProposalCommercialMarginFromFrozenFormation,
  serializeProposalCommercialPricingSnapshot,
  toProposalCommercialPricingSnapshot,
  type ProposalCommercialPricingSnapshot,
  PROPOSAL_COMMERCIAL_PRICING_SNAPSHOT_SCHEMA_VERSION,
} from "./proposalCommercialMarginSnapshot.js";
import { roundPricingMoney, roundPricingPercent } from "./pricingCalculations.js";

export const PROPOSAL_COMMERCIAL_RECALC_CONFIRM = "RECALCULATE_PROPOSAL_MARGINS" as const;

export type ProposalCommercialRecalcSourceClass =
  | "EXACT_PROPOSAL_FORMATION_SNAPSHOT"
  | "EXACT_PROPOSAL_PRICE_TABLE_VERSION"
  | "RECONSTRUCTED_FROM_PROPOSAL_DATE"
  | "UNAVAILABLE";

export type ProposalCommercialRecalcCliArgs = {
  dryRun: boolean;
  apply: boolean;
  confirmApply: string | null;
  proposalId: string | null;
  proposalCode: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  source: "INTERNAL" | "IMPORTED" | "ALL";
  limit: number;
  onlyMissing: boolean;
  json: boolean;
  batchSize: number;
};

export type ProposalCommercialRecalcItemInput = {
  proposalItemId: string;
  proposalId: string;
  proposalNumber: number;
  externalProposalCode?: string | null;
  productId: string;
  quantity: number;
  suggestedPrice: number;
  negotiatedPrice: number;
  discountPerc: number;
  discountValue: number;
  priceTableId?: string | null;
  priceTableVersionId?: string | null;
  commercialPricingSnapshotJson?: unknown;
  proposalReferenceDate: string; // yyyy-mm-dd
  isImported: boolean;
};

export type ProposalCommercialFormationInput = {
  formationContextId: string;
  referenceDate: string;
  frozenCostUnit: number;
  taxRate: number;
  freightRate: number;
  freightAbsoluteUnit: number;
  otherVariablesRate: number;
  tiers: CommercialMarginTier[];
};

export type ProposalCommercialRecalcItemResult = {
  proposalItemId: string;
  proposalId: string;
  proposalNumber: number;
  productId: string;
  sourceClass: ProposalCommercialRecalcSourceClass;
  reasonCode: ProposalCommercialMarginReasonCode | null;
  isComplete: boolean;
  changed: boolean;
  netLineValue: number;
  commercialMarginValue: number | null;
  commercialMarginPercent: number | null;
  concessionValue: number | null;
  explicitDiscount: number | null;
  warnings: string[];
  currentSnapshot: ProposalCommercialPricingSnapshot | null;
  nextSnapshot: ProposalCommercialPricingSnapshot | null;
};

export type ProposalCommercialRecalcPreview = {
  proposalsAnalyzed: number;
  itemsAnalyzed: number;
  itemsComplete: number;
  itemsPartialProposal: number;
  itemsUnavailable: number;
  itemsChanged: number;
  coveredNetValue: number;
  totalNetValue: number;
  coveragePercent: number | null;
  bySource: Record<ProposalCommercialRecalcSourceClass, number>;
  byReasonCode: Record<string, number>;
  marginBandCounts: Record<string, number>;
  negativeMarginItems: number;
  totalConcession: number;
  totalExplicitDiscount: number;
  results: ProposalCommercialRecalcItemResult[];
};

function toNum(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "object" && value !== null && "toNumber" in value) {
    const n = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(n) ? n : null;
  }
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.some((a) => a === `--${name}` || a.startsWith(`--${name}=`));
}

function readArg(argv: string[], name: string): string | null {
  const pref = `--${name}=`;
  for (const a of argv) {
    if (a.startsWith(pref)) return a.slice(pref.length) || null;
  }
  const idx = argv.indexOf(`--${name}`);
  if (idx >= 0 && argv[idx + 1] && !argv[idx + 1]!.startsWith("--")) {
    return argv[idx + 1]!;
  }
  return null;
}

export function parseProposalCommercialRecalcCliArgs(
  argv: string[]
): ProposalCommercialRecalcCliArgs {
  const wantApply = hasFlag(argv, "apply");
  const wantDryRun = hasFlag(argv, "dry-run");
  if (wantApply && wantDryRun) {
    throw new Error("Use somente --dry-run ou --apply, não ambos.");
  }
  const apply = wantApply;
  const dryRun = !apply;
  const sourceRaw = (readArg(argv, "source") ?? "ALL").toUpperCase();
  if (sourceRaw !== "INTERNAL" && sourceRaw !== "IMPORTED" && sourceRaw !== "ALL") {
    throw new Error("--source deve ser INTERNAL, IMPORTED ou ALL.");
  }
  const source = sourceRaw as "INTERNAL" | "IMPORTED" | "ALL";
  const limitRaw = Number(readArg(argv, "limit") ?? 200);
  const batchRaw = Number(readArg(argv, "batch-size") ?? 25);
  return {
    dryRun,
    apply,
    confirmApply: readArg(argv, "confirm-apply"),
    proposalId: readArg(argv, "proposal-id"),
    proposalCode: readArg(argv, "proposal-code"),
    dateFrom: readArg(argv, "date-from"),
    dateTo: readArg(argv, "date-to"),
    source,
    limit: Number.isFinite(limitRaw) ? Math.max(1, Math.min(5000, limitRaw)) : 200,
    onlyMissing: hasFlag(argv, "only-missing"),
    json: hasFlag(argv, "json"),
    batchSize: Number.isFinite(batchRaw) ? Math.max(1, Math.min(100, batchRaw)) : 25,
  };
}

export function assertProposalCommercialRecalcApplyConfirmation(
  args: ProposalCommercialRecalcCliArgs
): void {
  if (!args.apply) return;
  if (args.confirmApply !== PROPOSAL_COMMERCIAL_RECALC_CONFIRM) {
    throw new Error(
      `Apply exige --confirm-apply=${PROPOSAL_COMMERCIAL_RECALC_CONFIRM} após revisar o dry-run.`
    );
  }
}

export function isProposalImported(input: {
  externalProposalId?: number | null;
  sourceSystem?: string | null;
}): boolean {
  if (input.externalProposalId != null) return true;
  const sys = typeof input.sourceSystem === "string" ? input.sourceSystem.trim() : "";
  return sys.length > 0;
}

export function snapshotLooksComplete(
  snap: ProposalCommercialPricingSnapshot | null
): boolean {
  if (!snap) return false;
  if (snap.schemaVersion !== PROPOSAL_COMMERCIAL_PRICING_SNAPSHOT_SCHEMA_VERSION) {
    return false;
  }
  if (snap.calculationSource !== "PROPOSAL_PRICE_FORMATION") return false;
  if (!snap.tiers || snap.tiers.length < 2) return false;
  if (snap.frozenCostUnit == null || !(snap.frozenCostUnit > 0)) return false;
  if (snap.taxRate == null || snap.freightRate == null || snap.otherVariablesRate == null) {
    return false;
  }
  if (snap.freightAbsoluteUnit == null) return false;
  return true;
}

export function classifyProposalCommercialMarginSource(input: {
  commercialPricingSnapshotJson?: unknown;
  priceTableVersionId?: string | null;
}): ProposalCommercialRecalcSourceClass {
  const snap = parseProposalCommercialPricingSnapshot(input.commercialPricingSnapshotJson);
  if (snapshotLooksComplete(snap)) return "EXACT_PROPOSAL_FORMATION_SNAPSHOT";
  if (typeof input.priceTableVersionId === "string" && input.priceTableVersionId.trim()) {
    return "EXACT_PROPOSAL_PRICE_TABLE_VERSION";
  }
  return "RECONSTRUCTED_FROM_PROPOSAL_DATE";
}

export function stableSnapshotJson(
  snapshot: ProposalCommercialPricingSnapshot | null
): string {
  if (!snapshot) return "null";
  return JSON.stringify(serializeProposalCommercialPricingSnapshot(snapshot));
}

export function snapshotsDiffer(
  a: ProposalCommercialPricingSnapshot | null,
  b: ProposalCommercialPricingSnapshot | null
): boolean {
  return stableSnapshotJson(a) !== stableSnapshotJson(b);
}

function snapshotToFreeze(
  snapshot: ProposalCommercialPricingSnapshot,
  quantity: number,
  productId: string
) {
  return {
    schemaVersion: 1 as const,
    formationContextId: snapshot.formationContextId,
    priceTableId: snapshot.priceTableId,
    priceTableVersionId: snapshot.priceTableVersionId,
    referenceDate: snapshot.referenceDate,
    productId,
    quantity,
    referenceTableUnitPrice: snapshot.referenceTableUnitPrice,
    negotiatedGrossUnitPrice: snapshot.negotiatedGrossUnitPrice,
    informedDiscountRate: snapshot.informedDiscountRate,
    informedDiscountValue: snapshot.informedDiscountValue,
    finalNetUnitPrice: snapshot.finalNetUnitPrice,
    finalNetLineValue: snapshot.finalNetLineValue,
    frozenCostUnit: snapshot.frozenCostUnit,
    taxRate: snapshot.taxRate,
    freightRate: snapshot.freightRate,
    freightAbsoluteUnit: snapshot.freightAbsoluteUnit,
    otherVariablesRate: snapshot.otherVariablesRate,
    tiers: snapshot.tiers,
    calculatedCommissionRate: snapshot.calculatedCommissionRate,
    commercialMarginRate: snapshot.commercialMarginRate,
    commercialMarginValue: snapshot.commercialMarginValue,
    warnings: snapshot.warnings,
    calculationSource: snapshot.calculationSource,
    reasonCode: null,
    capturedAt: new Date().toISOString(),
  };
}

export function buildUnavailableCommercialPricingSnapshot(input: {
  reasonCode: ProposalCommercialMarginReasonCode;
  priceTableId?: string | null;
  priceTableVersionId?: string | null;
  referenceDate?: string | null;
  referenceTableUnitPrice?: number | null;
  negotiatedGrossUnitPrice?: number | null;
  informedDiscountRate?: number | null;
  informedDiscountValue?: number | null;
  warnings?: string[];
}): ProposalCommercialPricingSnapshot {
  const label = PROPOSAL_COMMERCIAL_MARGIN_REASON_LABEL[input.reasonCode];
  return {
    schemaVersion: PROPOSAL_COMMERCIAL_PRICING_SNAPSHOT_SCHEMA_VERSION,
    formationContextId: null,
    priceTableId: input.priceTableId ?? null,
    priceTableVersionId: input.priceTableVersionId ?? null,
    referenceDate: input.referenceDate ?? null,
    referenceTableUnitPrice: input.referenceTableUnitPrice ?? null,
    negotiatedGrossUnitPrice: input.negotiatedGrossUnitPrice ?? null,
    informedDiscountRate: input.informedDiscountRate ?? null,
    informedDiscountValue: input.informedDiscountValue ?? null,
    finalNetUnitPrice: null,
    finalNetLineValue: null,
    frozenCostUnit: null,
    taxRate: null,
    freightRate: null,
    freightAbsoluteUnit: null,
    otherVariablesRate: null,
    tiers: [],
    calculatedCommissionRate: null,
    commercialMarginRate: null,
    commercialMarginValue: null,
    calculationSource: "UNAVAILABLE",
    warnings: [label, ...(input.warnings ?? [])],
  };
}

export function computeSnapshotFromFormation(input: {
  formation: ProposalCommercialFormationInput;
  productId: string;
  quantity: number;
  suggestedPrice: number;
  negotiatedPrice: number;
  discountPerc: number;
  discountValue: number;
  priceTableId?: string | null;
  priceTableVersionId?: string | null;
}): {
  snapshot: ProposalCommercialPricingSnapshot;
  reasonCode: ProposalCommercialMarginReasonCode | null;
  isComplete: boolean;
  warnings: string[];
  marginValue: number | null;
  marginPercent: number | null;
  netLineValue: number;
  concessionValue: number | null;
  explicitDiscount: number | null;
} {
  const marginItem = calculateProposalItemCommercialMargin({
    quantity: input.quantity,
    referenceTableUnitPrice: input.suggestedPrice,
    negotiatedGrossUnitPrice: input.negotiatedPrice,
    informedDiscountRate: input.discountPerc / 100,
    informedDiscountValue: input.discountValue,
    frozenCostUnit: input.formation.frozenCostUnit,
    taxRate: input.formation.taxRate,
    freightRate: input.formation.freightRate,
    freightAbsoluteUnit: input.formation.freightAbsoluteUnit,
    otherVariablesRate: input.formation.otherVariablesRate,
    tiers: input.formation.tiers,
    formationContextId: input.formation.formationContextId,
    referenceDate: input.formation.referenceDate,
  });

  const freeze = buildProposalCommercialMarginFreeze({
    formationContextId: input.formation.formationContextId,
    priceTableId: input.priceTableId ?? null,
    priceTableVersionId: input.priceTableVersionId ?? null,
    referenceDate: input.formation.referenceDate,
    productId: input.productId,
    marginItem,
    frozenCostUnit: { presence: "value", value: input.formation.frozenCostUnit },
    taxRate: { presence: "value", value: input.formation.taxRate },
    freightRate: { presence: "value", value: input.formation.freightRate },
    freightAbsoluteUnit: {
      presence: "value",
      value: input.formation.freightAbsoluteUnit,
    },
    otherVariablesRate: {
      presence: "value",
      value: input.formation.otherVariablesRate,
    },
    informedDiscountRate: { presence: "value", value: input.discountPerc / 100 },
    informedDiscountValue: { presence: "value", value: input.discountValue },
    tiers: input.formation.tiers,
  });

  const snapshot = toProposalCommercialPricingSnapshot(freeze);
  return {
    snapshot,
    reasonCode: marginItem.reasonCode,
    isComplete: marginItem.isComplete,
    warnings: marginItem.warnings,
    marginValue: marginItem.commercialMarginValue,
    marginPercent: marginItem.commercialMarginPercent,
    netLineValue: marginItem.finalNetLineValue ?? 0,
    concessionValue: marginItem.totalCommercialConcession,
    explicitDiscount: marginItem.explicitDiscount,
  };
}

export function computeSnapshotFromExistingFreeze(input: {
  current: ProposalCommercialPricingSnapshot;
  productId: string;
  quantity: number;
  suggestedPrice: number;
  negotiatedPrice: number;
  discountPerc: number;
  discountValue: number;
}): {
  snapshot: ProposalCommercialPricingSnapshot;
  reasonCode: ProposalCommercialMarginReasonCode | null;
  isComplete: boolean;
  warnings: string[];
  marginValue: number | null;
  marginPercent: number | null;
  netLineValue: number;
  concessionValue: number | null;
  explicitDiscount: number | null;
} {
  const { marginItem, freeze } = recalculateProposalCommercialMarginFromFrozenFormation({
    freeze: snapshotToFreeze(input.current, input.quantity, input.productId),
    quantity: input.quantity,
    negotiatedGrossUnitPrice: input.negotiatedPrice,
    informedDiscountRate: input.discountPerc / 100,
    informedDiscountValue: input.discountValue,
    referenceTableUnitPrice: input.suggestedPrice,
  });
  const snapshot = toProposalCommercialPricingSnapshot(freeze);
  return {
    snapshot,
    reasonCode: marginItem.reasonCode,
    isComplete: marginItem.isComplete,
    warnings: marginItem.warnings,
    marginValue: marginItem.commercialMarginValue,
    marginPercent: marginItem.commercialMarginPercent,
    netLineValue: marginItem.finalNetLineValue ?? 0,
    concessionValue: marginItem.totalCommercialConcession,
    explicitDiscount: marginItem.explicitDiscount,
  };
}

function marginBand(percent: number | null): string {
  if (percent == null || !Number.isFinite(percent)) return "UNAVAILABLE";
  if (percent < 0) return "NEGATIVE";
  if (percent < 20) return "0_20";
  if (percent < 30) return "20_30";
  if (percent < 40) return "30_40";
  if (percent < 50) return "40_50";
  if (percent < 60) return "50_60";
  return "60_PLUS";
}

export function aggregateProposalCommercialRecalcPreview(
  results: ReadonlyArray<ProposalCommercialRecalcItemResult>,
  proposalIds: ReadonlySet<string>
): ProposalCommercialRecalcPreview {
  const bySource: Record<ProposalCommercialRecalcSourceClass, number> = {
    EXACT_PROPOSAL_FORMATION_SNAPSHOT: 0,
    EXACT_PROPOSAL_PRICE_TABLE_VERSION: 0,
    RECONSTRUCTED_FROM_PROPOSAL_DATE: 0,
    UNAVAILABLE: 0,
  };
  const byReasonCode: Record<string, number> = {};
  const marginBandCounts: Record<string, number> = {};
  let itemsComplete = 0;
  let itemsUnavailable = 0;
  let itemsChanged = 0;
  let coveredNetValue = 0;
  let totalNetValue = 0;
  let negativeMarginItems = 0;
  let totalConcession = 0;
  let totalExplicitDiscount = 0;

  for (const row of results) {
    bySource[row.sourceClass] += 1;
    if (row.reasonCode) {
      byReasonCode[row.reasonCode] = (byReasonCode[row.reasonCode] ?? 0) + 1;
    }
    const band = marginBand(row.commercialMarginPercent);
    marginBandCounts[band] = (marginBandCounts[band] ?? 0) + 1;
    totalNetValue += row.netLineValue;
    if (row.isComplete) {
      itemsComplete += 1;
      coveredNetValue += row.netLineValue;
    } else {
      itemsUnavailable += 1;
    }
    if (row.changed) itemsChanged += 1;
    if (row.commercialMarginPercent != null && row.commercialMarginPercent < 0) {
      negativeMarginItems += 1;
    }
    totalConcession += row.concessionValue ?? 0;
    totalExplicitDiscount += row.explicitDiscount ?? 0;
  }

  const coveragePercent =
    totalNetValue > 0
      ? roundPricingPercent((coveredNetValue / totalNetValue) * 100)
      : null;

  // Parcial = proposta com mix de itens calculados e não (contagem por resultado).
  const byProposal = new Map<string, { complete: number; total: number }>();
  for (const row of results) {
    const cur = byProposal.get(row.proposalId) ?? { complete: 0, total: 0 };
    cur.total += 1;
    if (row.isComplete) cur.complete += 1;
    byProposal.set(row.proposalId, cur);
  }
  let itemsPartialProposal = 0;
  for (const stats of byProposal.values()) {
    if (stats.complete > 0 && stats.complete < stats.total) {
      itemsPartialProposal += stats.total - stats.complete;
    }
  }

  return {
    proposalsAnalyzed: proposalIds.size,
    itemsAnalyzed: results.length,
    itemsComplete,
    itemsPartialProposal,
    itemsUnavailable,
    itemsChanged,
    coveredNetValue: roundPricingMoney(coveredNetValue),
    totalNetValue: roundPricingMoney(totalNetValue),
    coveragePercent,
    bySource,
    byReasonCode,
    marginBandCounts,
    negativeMarginItems,
    totalConcession: roundPricingMoney(totalConcession),
    totalExplicitDiscount: roundPricingMoney(totalExplicitDiscount),
    results: [...results],
  };
}

export function itemNeedsRecalc(
  input: ProposalCommercialRecalcItemInput,
  onlyMissing: boolean
): boolean {
  if (!onlyMissing) return true;
  const snap = parseProposalCommercialPricingSnapshot(input.commercialPricingSnapshotJson);
  if (!snap) return true;
  if (snap.calculationSource === "UNAVAILABLE") return true;
  return !snapshotLooksComplete(snap);
}

/**
 * Resolve o próximo snapshot de um item a partir da classificação + formação opcional.
 * Sem I/O. `formation` é obrigatório quando a classe não é EXACT_PROPOSAL_FORMATION_SNAPSHOT.
 */
export function resolveProposalCommercialRecalcItem(input: {
  item: ProposalCommercialRecalcItemInput;
  formation?: ProposalCommercialFormationInput | null;
  formationFailureReason?: ProposalCommercialMarginReasonCode | null;
}): ProposalCommercialRecalcItemResult {
  const { item } = input;
  const current = parseProposalCommercialPricingSnapshot(
    item.commercialPricingSnapshotJson
  );
  let sourceClass = classifyProposalCommercialMarginSource({
    commercialPricingSnapshotJson: item.commercialPricingSnapshotJson,
    priceTableVersionId: item.priceTableVersionId,
  });

  const baseMeta = {
    proposalItemId: item.proposalItemId,
    proposalId: item.proposalId,
    proposalNumber: item.proposalNumber,
    productId: item.productId,
  };

  if (sourceClass === "EXACT_PROPOSAL_FORMATION_SNAPSHOT" && current) {
    const computed = computeSnapshotFromExistingFreeze({
      current,
      productId: item.productId,
      quantity: item.quantity,
      suggestedPrice: item.suggestedPrice,
      negotiatedPrice: item.negotiatedPrice,
      discountPerc: item.discountPerc,
      discountValue: item.discountValue,
    });
    return {
      ...baseMeta,
      sourceClass,
      reasonCode: computed.reasonCode,
      isComplete: computed.isComplete,
      changed: snapshotsDiffer(current, computed.snapshot),
      netLineValue: computed.netLineValue,
      commercialMarginValue: computed.marginValue,
      commercialMarginPercent: computed.marginPercent,
      concessionValue: computed.concessionValue,
      explicitDiscount: computed.explicitDiscount,
      warnings: computed.warnings,
      currentSnapshot: current,
      nextSnapshot: computed.snapshot,
    };
  }

  if (input.formation) {
    const computed = computeSnapshotFromFormation({
      formation: input.formation,
      productId: item.productId,
      quantity: item.quantity,
      suggestedPrice: item.suggestedPrice,
      negotiatedPrice: item.negotiatedPrice,
      discountPerc: item.discountPerc,
      discountValue: item.discountValue,
      priceTableId: item.priceTableId,
      priceTableVersionId: item.priceTableVersionId,
    });
    if (!computed.isComplete) {
      const reasonCode = computed.reasonCode ?? "INCOMPLETE_MARGIN_TIERS";
      const nextSnapshot = buildUnavailableCommercialPricingSnapshot({
        reasonCode,
        priceTableId: item.priceTableId,
        priceTableVersionId: item.priceTableVersionId,
        referenceDate: input.formation.referenceDate,
        referenceTableUnitPrice: item.suggestedPrice,
        negotiatedGrossUnitPrice: item.negotiatedPrice,
        informedDiscountRate: item.discountPerc / 100,
        informedDiscountValue: item.discountValue,
        warnings: computed.warnings,
      });
      return {
        ...baseMeta,
        sourceClass: "UNAVAILABLE",
        reasonCode,
        isComplete: false,
        changed: snapshotsDiffer(current, nextSnapshot),
        netLineValue: computed.netLineValue,
        commercialMarginValue: null,
        commercialMarginPercent: null,
        concessionValue: computed.concessionValue,
        explicitDiscount: computed.explicitDiscount,
        warnings: nextSnapshot.warnings,
        currentSnapshot: current,
        nextSnapshot,
      };
    }
    return {
      ...baseMeta,
      sourceClass,
      reasonCode: computed.reasonCode,
      isComplete: true,
      changed: snapshotsDiffer(current, computed.snapshot),
      netLineValue: computed.netLineValue,
      commercialMarginValue: computed.marginValue,
      commercialMarginPercent: computed.marginPercent,
      concessionValue: computed.concessionValue,
      explicitDiscount: computed.explicitDiscount,
      warnings: computed.warnings,
      currentSnapshot: current,
      nextSnapshot: computed.snapshot,
    };
  }

  const reasonCode: ProposalCommercialMarginReasonCode =
    input.formationFailureReason ??
    (sourceClass === "EXACT_PROPOSAL_PRICE_TABLE_VERSION"
      ? "PRICE_TABLE_VERSION_NOT_FOUND"
      : "HISTORICAL_FORMATION_NOT_FOUND");

  const nextSnapshot = buildUnavailableCommercialPricingSnapshot({
    reasonCode,
    priceTableId: item.priceTableId,
    priceTableVersionId: item.priceTableVersionId,
    referenceDate: item.proposalReferenceDate,
    referenceTableUnitPrice: item.suggestedPrice,
    negotiatedGrossUnitPrice: item.negotiatedPrice,
    informedDiscountRate: item.discountPerc / 100,
    informedDiscountValue: item.discountValue,
  });

  const netLineValue = Math.max(
    0,
    roundPricingMoney(item.negotiatedPrice * item.quantity - item.discountValue)
  );

  return {
    ...baseMeta,
    sourceClass: "UNAVAILABLE",
    reasonCode,
    isComplete: false,
    changed: snapshotsDiffer(current, nextSnapshot),
    netLineValue,
    commercialMarginValue: null,
    commercialMarginPercent: null,
    concessionValue: null,
    explicitDiscount: item.discountValue,
    warnings: nextSnapshot.warnings,
    currentSnapshot: current,
    nextSnapshot,
  };
}

export function formatProposalCommercialRecalcPreview(
  preview: ProposalCommercialRecalcPreview,
  mode: "dry-run" | "apply"
): string {
  const lines = [
    `=== Recálculo margem comercial — Propostas (${mode}) ===`,
    `Propostas analisadas: ${preview.proposalsAnalyzed}`,
    `Itens analisados: ${preview.itemsAnalyzed}`,
    `Margem completa: ${preview.itemsComplete}`,
    `Margem parcial (itens em propostas mistas): ${preview.itemsPartialProposal}`,
    `Sem margem: ${preview.itemsUnavailable}`,
    `Itens a alterar / alterados: ${preview.itemsChanged}`,
    `Valor líquido coberto: ${preview.coveredNetValue}`,
    `Valor líquido total: ${preview.totalNetValue}`,
    `Cobertura: ${preview.coveragePercent == null ? "—" : `${preview.coveragePercent}%`}`,
    `Por fonte: ${JSON.stringify(preview.bySource)}`,
    `Por reasonCode: ${JSON.stringify(preview.byReasonCode)}`,
    `Faixas de margem: ${JSON.stringify(preview.marginBandCounts)}`,
    `Margens negativas: ${preview.negativeMarginItems}`,
    `Concessões: ${preview.totalConcession}`,
    `Descontos explícitos: ${preview.totalExplicitDiscount}`,
  ];
  return lines.join("\n");
}

export { toNum };
