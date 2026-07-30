/**
 * Comissão estimada da proposta a partir do snapshot de preço publicado.
 * Não usa motor de comissão realizada/recebimento/Nomus.
 * Mesma cadeia do published-price: proposalDefaults/item.commissionPerc → formula.rates.commissionRate.
 */

export type ProposalItemEstimatedCommission = {
  commissionPerc: number | null;
  /** Comissão unitária no preço publicado (quando disponível no snapshot). */
  commissionValuePerUnit: number | null;
  source: "SNAPSHOT" | "UNAVAILABLE";
  pendingReason: string | null;
};

function n(value: unknown): number | null {
  if (value == null || value === "") return null;
  const num = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(num) ? num : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function unavailable(reason: string): ProposalItemEstimatedCommission {
  return {
    commissionPerc: null,
    commissionValuePerUnit: null,
    source: "UNAVAILABLE",
    pendingReason: reason,
  };
}

function fromCommercialPricingSnapshot(
  commercialPricingSnapshotJson: unknown,
  pricingSnapshotJson: unknown
): ProposalItemEstimatedCommission | null {
  // Import dinâmico evitado — leitura local do contrato comercial (fraction 0–1).
  const commercialRoot = asRecord(commercialPricingSnapshotJson);
  const legacyFreeze = asRecord(asRecord(pricingSnapshotJson)?.commercialMarginFreeze);
  const root = commercialRoot ?? legacyFreeze;
  if (!root) return null;

  const rateRaw = n(root.calculatedCommissionRate);
  if (rateRaw == null) return null;

  // Contrato comercial: fraction (0.045 = 4,5%). Valores > 1 tratados como %.
  const rateFraction = rateRaw > 1 ? rateRaw / 100 : rateRaw;
  if (!(rateFraction >= 0) || !Number.isFinite(rateFraction)) return null;

  const sale =
    n(root.finalNetUnitPrice) ??
    n(root.negotiatedGrossUnitPrice) ??
    null;

  return {
    commissionPerc: rateFraction * 100,
    commissionValuePerUnit: sale != null ? sale * rateFraction : null,
    source: "SNAPSHOT",
    pendingReason: null,
  };
}

/**
 * Extrai % de comissão estimado congelado na tabela/formação de preço.
 * Preferência: pricingSnapshotJson (tabela publicada) → commercialPricingSnapshotJson.
 * Não inventa percentual; se não houver regra no snapshot, retorna unavailable.
 */
export function extractProposalItemEstimatedCommission(
  pricingSnapshotJson: unknown,
  commercialPricingSnapshotJson?: unknown
): ProposalItemEstimatedCommission {
  const root = asRecord(pricingSnapshotJson);

  if (root) {
    const defaults = asRecord(root.proposalDefaults);
    const item = asRecord(root.item) ?? asRecord(root.publishedItem) ?? root;

    const fromDefaults = n(defaults?.commissionPerc);
    const fromItem = n(item?.commissionPerc);
    const percColumn =
      fromDefaults != null && fromDefaults > 0
        ? fromDefaults
        : fromItem != null && fromItem > 0
          ? fromItem
          : null;

    if (percColumn != null) {
      const unitValue =
        n(defaults?.commissionValue) ??
        n(item?.commissionValue) ??
        null;
      return {
        commissionPerc: percColumn,
        commissionValuePerUnit: unitValue != null && unitValue >= 0 ? unitValue : null,
        source: "SNAPSHOT",
        pendingReason: null,
      };
    }

    const formula =
      asRecord(item?.formulaSnapshotJson) ?? asRecord(root.formulaSnapshotJson);
    const rates = asRecord(formula?.rates);
    const commissionRate = n(rates?.commissionRate);
    if (commissionRate != null && commissionRate > 0) {
      const perc = commissionRate * 100;
      const sale =
        n(item?.salePrice) ??
        n(defaults?.suggestedPrice) ??
        n(defaults?.negotiatedPrice);
      return {
        commissionPerc: perc,
        commissionValuePerUnit: sale != null ? sale * commissionRate : null,
        source: "SNAPSHOT",
        pendingReason: null,
      };
    }

    // Zero explícito no snapshot (regra resolvida como 0%).
    if (fromDefaults === 0 || fromItem === 0) {
      return {
        commissionPerc: 0,
        commissionValuePerUnit: 0,
        source: "SNAPSHOT",
        pendingReason: null,
      };
    }
  }

  const fromCommercial = fromCommercialPricingSnapshot(
    commercialPricingSnapshotJson,
    pricingSnapshotJson
  );
  if (fromCommercial) return fromCommercial;

  if (!root && !asRecord(commercialPricingSnapshotJson)) {
    return unavailable("Comissão estimada não disponível no snapshot da proposta.");
  }

  return unavailable("Comissão estimada não resolvida no snapshot da proposta.");
}

/**
 * Valor estimado na linha: preferir unitário do snapshot × qtde;
 * senão receita da linha × percentual / 100.
 */
export function estimateProposalItemCommissionValue(input: {
  quantity: number;
  lineRevenue: number;
  commissionPerc: number | null;
  commissionValuePerUnit: number | null;
}): number | null {
  const qty = Number.isFinite(input.quantity) && input.quantity > 0 ? input.quantity : 0;
  if (input.commissionValuePerUnit != null && Number.isFinite(input.commissionValuePerUnit)) {
    return input.commissionValuePerUnit * qty;
  }
  if (input.commissionPerc == null || !Number.isFinite(input.commissionPerc)) return null;
  if (!(input.lineRevenue > 0) && input.commissionPerc !== 0) return null;
  return input.lineRevenue * (input.commissionPerc / 100);
}

export function formatProposalEstimatedCommissionLabel(input: {
  commissionPerc: number | null;
  commissionValue: number | null;
  pending: boolean;
  pendingReason?: string | null;
}): string {
  if (input.pending) {
    return input.pendingReason?.trim()
      ? `Pendente: ${input.pendingReason.trim()}`
      : "Pendente: regra não resolvida";
  }
  const perc =
    input.commissionPerc != null && Number.isFinite(input.commissionPerc)
      ? `${input.commissionPerc.toFixed(2).replace(".", ",")}%`
      : null;
  const money =
    input.commissionValue != null && Number.isFinite(input.commissionValue)
      ? formatMoneyBr(input.commissionValue)
      : null;
  if (perc && money) return `${perc} • ${money}`;
  if (perc && !money) return `${perc} / valor pendente`;
  if (!perc && money) return money;
  return "Pendente: regra não resolvida";
}

function formatMoneyBr(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const [intPart, dec = "00"] = abs.toFixed(2).split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}R$ ${grouped},${dec}`;
}
