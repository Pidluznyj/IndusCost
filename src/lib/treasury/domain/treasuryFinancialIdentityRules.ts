/**
 * Resolvedor puro — identidade lógica e precedência financeira (anti-dupla contagem).
 *
 * Precedência de evidência para caixa:
 * 1. movimento conciliado
 * 2. baixa oficial
 * 3. movimento realizado não conciliado
 * 4. previsão
 *
 * Pedido / NF / Documento de Saída nunca somam com título.
 * Transferências não alteram consolidado. Cancelados não projetam.
 */

import {
  addTreasuryMoney,
  compareTreasuryMoney,
  normalizeTreasuryMoneyString,
  type TreasuryMoneyString,
} from "../treasuryMoney.js";

/** Fontes candidatas a evidência financeira. */
export const TREASURY_FINANCIAL_CLAIM_SOURCES = [
  "RECONCILED_MOVEMENT",
  "OFFICIAL_SETTLEMENT",
  "REALIZED_UNRECONCILED",
  "FORECAST",
  "SALES_ORDER",
  "NFE",
  "OUTPUT_DOCUMENT",
  "TRANSFER",
] as const;

export type TreasuryFinancialClaimSource =
  (typeof TREASURY_FINANCIAL_CLAIM_SOURCES)[number];

/** Menor número = maior precedência (somente fontes de caixa). */
export const TREASURY_FINANCIAL_PRECEDENCE: Record<
  TreasuryFinancialClaimSource,
  number
> = {
  RECONCILED_MOVEMENT: 1,
  OFFICIAL_SETTLEMENT: 2,
  REALIZED_UNRECONCILED: 3,
  FORECAST: 4,
  /** Contextuais — nunca vencem disputa de caixa. */
  SALES_ORDER: 100,
  NFE: 101,
  OUTPUT_DOCUMENT: 102,
  TRANSFER: 50,
};

export const TREASURY_NON_CASH_CLAIM_SOURCES = [
  "SALES_ORDER",
  "NFE",
  "OUTPUT_DOCUMENT",
] as const;

export type TreasuryFinancialClaimSide = "AR" | "AP" | "INTERNAL";

export type TreasuryFinancialClaim = {
  /** Id estável do candidato (rastreio). */
  id: string;
  source: TreasuryFinancialClaimSource;
  side: TreasuryFinancialClaimSide;
  /** Valor nominal da evidência. */
  amount: string;
  /** Saldo aberto (parcela parcial) — usado na fatia FORECAST. */
  openBalance?: string | null;
  /** Valor já baixado/realizado na evidência. */
  settledAmount?: string | null;
  installmentNumber?: number | null;
  officialTitleId?: string | null;
  nomusExternalId?: number | null;
  salesOrderExternalId?: number | null;
  nfeExternalId?: number | null;
  outputDocumentExternalId?: number | null;
  transferGroupId?: string | null;
  ledgerEntryId?: string | null;
  reconciliationMatchId?: string | null;
  isCancelled?: boolean;
};

export type TreasuryFinancialResolvedSlice = {
  /** Chave lógica rastreável: lado|fonte|sujeito|parcela. */
  logicalKey: string;
  /** Chave de agrupamento para precedência (sem a fonte). */
  groupKey: string;
  claimId: string;
  source: TreasuryFinancialClaimSource;
  amount: TreasuryMoneyString;
  includeInCashProjection: boolean;
  affectsConsolidated: boolean;
  role:
    | "REALIZED"
    | "FORECAST"
    | "TRANSFER"
    | "CONTEXTUAL_SUPPRESSED"
    | "CANCELLED"
    | "DUPLICATE_SUPPRESSED";
  detail: string;
};

export type TreasuryFinancialIdentityResolution = {
  slices: TreasuryFinancialResolvedSlice[];
  /** Soma das fatias com includeInCashProjection e affectsConsolidated. */
  consolidatedCashTotal: TreasuryMoneyString;
  /** Soma de todas as fatias de caixa (inclui transferências). */
  cashProjectionTotal: TreasuryMoneyString;
  suppressedClaimIds: string[];
};

function installmentKey(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "none";
  return String(Math.trunc(n));
}

function subjectAnchor(claim: TreasuryFinancialClaim): string {
  if (claim.officialTitleId) return `title:${claim.officialTitleId}`;
  if (claim.nomusExternalId != null) return `ext:${claim.nomusExternalId}`;
  if (claim.transferGroupId) return `xfer:${claim.transferGroupId}`;
  if (claim.ledgerEntryId) return `ledger:${claim.ledgerEntryId}`;
  if (claim.outputDocumentExternalId != null) {
    return `out:${claim.outputDocumentExternalId}`;
  }
  if (claim.nfeExternalId != null) return `nfe:${claim.nfeExternalId}`;
  if (claim.salesOrderExternalId != null) {
    return `order:${claim.salesOrderExternalId}`;
  }
  return `claim:${claim.id}`;
}

/**
 * Chave lógica rastreável por fonte e parcela.
 * Formato: `{side}|{source}|{subject}|inst:{n|none}`
 */
export function buildTreasuryFinancialLogicalKey(
  claim: TreasuryFinancialClaim
): string {
  return [
    claim.side,
    claim.source,
    subjectAnchor(claim),
    `inst:${installmentKey(claim.installmentNumber)}`,
  ].join("|");
}

/**
 * Chave de grupo para disputa de precedência (mesmo título/cadeia/parcela).
 * Pedido/NF/DS ligados ao mesmo título colidem no grupo do título.
 */
export function buildTreasuryFinancialGroupKey(
  claim: TreasuryFinancialClaim
): string {
  const inst = `inst:${installmentKey(claim.installmentNumber)}`;

  if (claim.transferGroupId) {
    return `INTERNAL|xfer:${claim.transferGroupId}|${inst}`;
  }

  if (claim.officialTitleId || claim.nomusExternalId != null) {
    const title =
      claim.officialTitleId != null
        ? `title:${claim.officialTitleId}`
        : `ext:${claim.nomusExternalId}`;
    return `${claim.side}|${title}|${inst}`;
  }

  // Cadeia comercial sem título — ainda agrupável, mas nunca vira caixa.
  if (claim.salesOrderExternalId != null) {
    return `${claim.side}|chain:order:${claim.salesOrderExternalId}|${inst}`;
  }
  if (claim.nfeExternalId != null) {
    return `${claim.side}|chain:nfe:${claim.nfeExternalId}|${inst}`;
  }
  if (claim.outputDocumentExternalId != null) {
    return `${claim.side}|chain:out:${claim.outputDocumentExternalId}|${inst}`;
  }

  return `${claim.side}|${subjectAnchor(claim)}|${inst}`;
}

export function isTreasuryNonCashClaimSource(
  source: TreasuryFinancialClaimSource
): boolean {
  return (TREASURY_NON_CASH_CLAIM_SOURCES as readonly string[]).includes(source);
}

export function isTreasuryRealizedClaimSource(
  source: TreasuryFinancialClaimSource
): boolean {
  return (
    source === "RECONCILED_MOVEMENT" ||
    source === "OFFICIAL_SETTLEMENT" ||
    source === "REALIZED_UNRECONCILED"
  );
}

function money(value: string | null | undefined, fallback = "0.00"): TreasuryMoneyString {
  if (value == null || value === "") return normalizeTreasuryMoneyString(fallback);
  return normalizeTreasuryMoneyString(value);
}

function pickBestByPrecedence(
  claims: TreasuryFinancialClaim[]
): TreasuryFinancialClaim | null {
  if (claims.length === 0) return null;
  let best = claims[0]!;
  for (let i = 1; i < claims.length; i++) {
    const c = claims[i]!;
    if (
      TREASURY_FINANCIAL_PRECEDENCE[c.source] <
      TREASURY_FINANCIAL_PRECEDENCE[best.source]
    ) {
      best = c;
    }
  }
  return best;
}

function realizedAmount(claim: TreasuryFinancialClaim): TreasuryMoneyString {
  if (claim.settledAmount != null && claim.settledAmount !== "") {
    return money(claim.settledAmount);
  }
  return money(claim.amount);
}

function forecastAmount(claim: TreasuryFinancialClaim): TreasuryMoneyString {
  if (claim.openBalance != null && claim.openBalance !== "") {
    return money(claim.openBalance);
  }
  return money(claim.amount);
}

function suppressedSlice(
  claim: TreasuryFinancialClaim,
  role: TreasuryFinancialResolvedSlice["role"],
  detail: string
): TreasuryFinancialResolvedSlice {
  return {
    logicalKey: buildTreasuryFinancialLogicalKey(claim),
    groupKey: buildTreasuryFinancialGroupKey(claim),
    claimId: claim.id,
    source: claim.source,
    amount: "0.00",
    includeInCashProjection: false,
    affectsConsolidated: false,
    role,
    detail,
  };
}

/**
 * Resolve um grupo de claims competindo pela mesma identidade econômica.
 */
export function resolveTreasuryFinancialIdentityGroup(
  claims: readonly TreasuryFinancialClaim[]
): TreasuryFinancialResolvedSlice[] {
  if (claims.length === 0) return [];

  const slices: TreasuryFinancialResolvedSlice[] = [];
  const active: TreasuryFinancialClaim[] = [];

  for (const claim of claims) {
    if (claim.isCancelled) {
      slices.push(
        suppressedSlice(
          claim,
          "CANCELLED",
          "Cancelado não projeta caixa."
        )
      );
      continue;
    }
    active.push(claim);
  }

  if (active.length === 0) return slices;

  const transfers = active.filter((c) => c.source === "TRANSFER");
  const nonCash = active.filter((c) => isTreasuryNonCashClaimSource(c.source));
  const cash = active.filter(
    (c) => c.source !== "TRANSFER" && !isTreasuryNonCashClaimSource(c.source)
  );

  // Pedido / NF / DS: nunca somam com título (nem entre si como caixa).
  for (const claim of nonCash) {
    const hasTitleCash = cash.some(
      (c) =>
        c.officialTitleId != null ||
        c.nomusExternalId != null ||
        isTreasuryRealizedClaimSource(c.source) ||
        c.source === "FORECAST"
    );
    slices.push(
      suppressedSlice(
        claim,
        "CONTEXTUAL_SUPPRESSED",
        hasTitleCash
          ? "Evidência contextual (pedido/NF/DS) não é somada ao título."
          : "Pedido/NF/Documento de Saída não entram como caixa bancário da Tesouraria."
      )
    );
  }

  for (const claim of transfers) {
    slices.push({
      logicalKey: buildTreasuryFinancialLogicalKey(claim),
      groupKey: buildTreasuryFinancialGroupKey(claim),
      claimId: claim.id,
      source: "TRANSFER",
      amount: money(claim.amount),
      includeInCashProjection: true,
      affectsConsolidated: false,
      role: "TRANSFER",
      detail:
        "Transferência interna entra na conta mas não altera caixa consolidado.",
    });
  }

  if (cash.length === 0) return slices;

  const realizedCandidates = cash.filter((c) =>
    isTreasuryRealizedClaimSource(c.source)
  );
  const forecastCandidates = cash.filter((c) => c.source === "FORECAST");

  /**
   * Baixas distintas (claim.id / reconciliationMatchId) somam todas.
   * REALIZED_UNRECONCILED compete com OFFICIAL/RECONCILED do mesmo valor
   * no título (mesma evidência econômica, não segunda parcial).
   */
  const realizedClusters = clusterRealizedClaims(realizedCandidates);
  const realizedWinners: TreasuryFinancialClaim[] = [];
  for (const cluster of realizedClusters) {
    const best = pickBestByPrecedence(cluster);
    if (!best) continue;
    realizedWinners.push(best);
    slices.push({
      logicalKey: buildTreasuryFinancialLogicalKey(best),
      groupKey: buildTreasuryFinancialGroupKey(best),
      claimId: best.id,
      source: best.source,
      amount: realizedAmount(best),
      includeInCashProjection: true,
      affectsConsolidated: true,
      role: "REALIZED",
      detail: `Camada realizada vencedora por precedência (${best.source}).`,
    });
    for (const claim of cluster) {
      if (claim.id === best.id) continue;
      slices.push(
        suppressedSlice(
          claim,
          "DUPLICATE_SUPPRESSED",
          "Baixa/conciliação/realizado duplicado — prevalece evidência de maior precedência."
        )
      );
    }
  }

  const hasAnyRealized = realizedWinners.length > 0;
  const bestForecast = pickBestByPrecedence(forecastCandidates);
  if (bestForecast) {
    const open = forecastAmount(bestForecast);
    const hasOpen = compareTreasuryMoney(open, "0.00") > 0;

    if (hasAnyRealized && !hasOpen) {
      // Título liquidado: previsão não entra.
      slices.push(
        suppressedSlice(
          bestForecast,
          "DUPLICATE_SUPPRESSED",
          "Previsão não é somada ao realizado — saldo aberto zerado."
        )
      );
    } else if (hasAnyRealized && hasOpen) {
      // Parcial: só saldo aberto na previsão.
      slices.push({
        logicalKey: buildTreasuryFinancialLogicalKey(bestForecast),
        groupKey: buildTreasuryFinancialGroupKey(bestForecast),
        claimId: bestForecast.id,
        source: "FORECAST",
        amount: open,
        includeInCashProjection: true,
        affectsConsolidated: true,
        role: "FORECAST",
        detail:
          "Parcela parcial: previsão considera somente saldo aberto (não soma nominal ao realizado).",
      });
    } else {
      slices.push({
        logicalKey: buildTreasuryFinancialLogicalKey(bestForecast),
        groupKey: buildTreasuryFinancialGroupKey(bestForecast),
        claimId: bestForecast.id,
        source: "FORECAST",
        amount: open,
        includeInCashProjection: compareTreasuryMoney(open, "0.00") > 0,
        affectsConsolidated: compareTreasuryMoney(open, "0.00") > 0,
        role: "FORECAST",
        detail: "Previsão sem realização superior.",
      });
    }

    for (const claim of forecastCandidates) {
      if (claim.id === bestForecast.id) continue;
      slices.push(
        suppressedSlice(
          claim,
          "DUPLICATE_SUPPRESSED",
          "Previsão duplicada no mesmo título/parcela."
        )
      );
    }
  }

  return slices;
}

/**
 * Agrupa evidências realizadas que competem pelo mesmo evento de caixa.
 * - `reconciliationMatchId` une conciliação + baixa do mesmo match.
 * - OFFICIAL junta-se a RECONCILED do mesmo valor (não a outra OFFICIAL).
 * - Cada OFFICIAL distinta = baixa parcial distinta.
 * - REALIZED_UNRECONCILED junta-se à baixa/conciliação de mesmo valor.
 */
export function clusterRealizedClaims(
  claims: readonly TreasuryFinancialClaim[]
): TreasuryFinancialClaim[][] {
  if (claims.length === 0) return [];

  const clusters = new Map<string, TreasuryFinancialClaim[]>();
  const amountToCluster = new Map<string, string>();

  const amtKeyOf = (c: TreasuryFinancialClaim) =>
    [
      c.side,
      subjectAnchor(c),
      installmentKey(c.installmentNumber),
      realizedAmount(c),
    ].join("|");

  const put = (key: string, c: TreasuryFinancialClaim) => {
    const list = clusters.get(key) ?? [];
    list.push(c);
    clusters.set(key, list);
  };

  const reconciled = claims.filter((c) => c.source === "RECONCILED_MOVEMENT");
  const official = claims.filter((c) => c.source === "OFFICIAL_SETTLEMENT");
  const unreconciled = claims.filter(
    (c) => c.source === "REALIZED_UNRECONCILED"
  );

  for (const c of reconciled) {
    const key = c.reconciliationMatchId
      ? `match:${c.reconciliationMatchId}`
      : `settlement:${c.id}`;
    put(key, c);
    amountToCluster.set(amtKeyOf(c), key);
  }

  for (const c of official) {
    const amtKey = amtKeyOf(c);
    let key: string;
    if (c.reconciliationMatchId) {
      key = `match:${c.reconciliationMatchId}`;
    } else {
      const candidate = amountToCluster.get(amtKey);
      const joinsReconciled =
        candidate != null &&
        (clusters.get(candidate) ?? []).some(
          (x) => x.source === "RECONCILED_MOVEMENT"
        );
      key = joinsReconciled ? candidate! : `settlement:${c.id}`;
    }
    put(key, c);
    if (!amountToCluster.has(amtKey)) amountToCluster.set(amtKey, key);
  }

  for (const c of unreconciled) {
    const key = amountToCluster.get(amtKeyOf(c)) ?? `unrec:${c.id}`;
    put(key, c);
  }

  return [...clusters.values()];
}

/**
 * Une claims de cadeia (pedido/NF/DS) ao grupo do título quando compartilham
 * o mesmo âncora comercial — evita somar pedido+título em grupos separados.
 */
function mergeChainClaimsIntoTitleGroups(
  byGroup: Map<string, TreasuryFinancialClaim[]>
): Map<string, TreasuryFinancialClaim[]> {
  const titleGroups = [...byGroup.entries()].filter(([key]) =>
    key.includes("|title:") || key.includes("|ext:")
  );

  const orderToTitleKey = new Map<string, string>();
  const nfeToTitleKey = new Map<string, string>();
  const outToTitleKey = new Map<string, string>();

  for (const [key, group] of titleGroups) {
    for (const c of group) {
      if (c.salesOrderExternalId != null) {
        orderToTitleKey.set(`${c.side}:order:${c.salesOrderExternalId}`, key);
      }
      if (c.nfeExternalId != null) {
        nfeToTitleKey.set(`${c.side}:nfe:${c.nfeExternalId}`, key);
      }
      if (c.outputDocumentExternalId != null) {
        outToTitleKey.set(`${c.side}:out:${c.outputDocumentExternalId}`, key);
      }
    }
  }

  const merged = new Map<string, TreasuryFinancialClaim[]>();
  for (const [key, group] of byGroup) {
    let target = key;
    if (key.includes("|chain:order:")) {
      const sample = group[0];
      if (sample?.salesOrderExternalId != null) {
        const hit = orderToTitleKey.get(
          `${sample.side}:order:${sample.salesOrderExternalId}`
        );
        if (hit) target = hit;
      }
    } else if (key.includes("|chain:nfe:")) {
      const sample = group[0];
      if (sample?.nfeExternalId != null) {
        const hit = nfeToTitleKey.get(
          `${sample.side}:nfe:${sample.nfeExternalId}`
        );
        if (hit) target = hit;
      }
    } else if (key.includes("|chain:out:")) {
      const sample = group[0];
      if (sample?.outputDocumentExternalId != null) {
        const hit = outToTitleKey.get(
          `${sample.side}:out:${sample.outputDocumentExternalId}`
        );
        if (hit) target = hit;
      }
    }

    const list = merged.get(target) ?? [];
    list.push(...group);
    merged.set(target, list);
  }
  return merged;
}

/**
 * Resolve o universo de claims: agrupa por identidade e aplica precedência.
 */
export function resolveTreasuryFinancialIdentities(
  claims: readonly TreasuryFinancialClaim[]
): TreasuryFinancialIdentityResolution {
  const byGroup = new Map<string, TreasuryFinancialClaim[]>();
  for (const claim of claims) {
    const key = buildTreasuryFinancialGroupKey(claim);
    const list = byGroup.get(key);
    if (list) list.push(claim);
    else byGroup.set(key, [claim]);
  }

  const grouped = mergeChainClaimsIntoTitleGroups(byGroup);

  const slices: TreasuryFinancialResolvedSlice[] = [];
  for (const group of grouped.values()) {
    slices.push(...resolveTreasuryFinancialIdentityGroup(group));
  }

  let consolidatedCashTotal = "0.00";
  let cashProjectionTotal = "0.00";
  const suppressedClaimIds: string[] = [];

  for (const slice of slices) {
    if (
      slice.role === "CONTEXTUAL_SUPPRESSED" ||
      slice.role === "CANCELLED" ||
      slice.role === "DUPLICATE_SUPPRESSED"
    ) {
      suppressedClaimIds.push(slice.claimId);
    }
    if (!slice.includeInCashProjection) continue;
    cashProjectionTotal = addTreasuryMoney(cashProjectionTotal, slice.amount);
    if (slice.affectsConsolidated) {
      consolidatedCashTotal = addTreasuryMoney(
        consolidatedCashTotal,
        slice.amount
      );
    }
  }

  return {
    slices,
    consolidatedCashTotal,
    cashProjectionTotal,
    suppressedClaimIds,
  };
}

/**
 * Helper de teste/agregação: impacto consolidado de um par de transferências.
 * Invariante: soma das pernas com sinal oposto = 0 no consolidado.
 */
export function treasuryTransferConsolidatedImpact(
  legs: readonly { amount: string; sign: 1 | -1 }[]
): TreasuryMoneyString {
  let net = "0.00";
  for (const leg of legs) {
    const amt = money(leg.amount);
    const signed =
      leg.sign < 0
        ? normalizeTreasuryMoneyString(
            amt.startsWith("-") ? amt.slice(1) : `-${amt}`
          )
        : amt;
    // Transferências não alteram consolidado — impacto reportado é sempre 0
    // após o par; esta função valida o neto das pernas e o caller deve
    // tratar affectsConsolidated=false. Retornamos o neto bruto para assert.
    net = addTreasuryMoney(net, signed);
  }
  return net;
}
