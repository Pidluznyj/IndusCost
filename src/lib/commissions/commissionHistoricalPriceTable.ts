/**
 * Resolvedor PONTO-NO-TEMPO da tabela comercial — lógica pura.
 *
 * REGRA (docs/commissions/commission-rules.md, seções 1 e 2)
 * A comissão usa a tabela vigente na DATA COMERCIAL DA VENDA. A data de
 * recebimento serve para liberação e pagamento — nunca para escolher tabela,
 * faixa ou percentual.
 *
 *   effectiveFrom <= referenceDate  AND  effectiveTo > referenceDate
 *
 * DEFEITO QUE ISTO SUBSTITUI
 * `loadCommercialPriceTiersForProduct` consulta apenas `status: "PUBLISHED"`.
 * Versões hoje ARCHIVED que ERAM válidas na data da venda ficam invisíveis, e
 * uma venda passada acaba avaliada contra a tabela publicada hoje. Foi assim
 * que snapshots antigos ficaram `NO_COMMERCIAL_PRICE_TABLE` enquanto os mesmos
 * produtos comissionavam em pedidos posteriores.
 *
 * VERSÃO ARQUIVADA NÃO VALE SÓ POR EXISTIR. Precisa de vigência válida e não
 * ambígua — vigência invertida, de largura zero ou concorrente vira
 * diagnóstico, não escolha silenciosa.
 *
 * Recebe candidatos já carregados; a carga fica no `.server`. Assim a decisão
 * é testável sem banco.
 */

import {
  buildCommissionDiagnostic,
  type CommissionDiagnostic,
} from "./commissionDiagnosticCodes.js";

export type PriceTableVersionCandidate = {
  tableId: string;
  tableCode: string;
  versionId: string;
  versionNumber: number;
  /** Status ATUAL da versão (PUBLISHED/ARCHIVED/DRAFT). Não decide vigência. */
  status: string;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  publishedAt: Date | null;
};

export type CommercialProductPriceCandidate = {
  versionId: string;
  productId: string;
  productSku: string | null;
  salePrice: number | null;
  commissionPercent: number | null;
};

export type HistoricalPriceTableResolution =
  | {
      ok: true;
      tableId: string;
      tableCode: string;
      versionId: string;
      versionNumber: number;
      versionStatus: string;
      effectiveFrom: Date | null;
      effectiveTo: Date | null;
      referenceDate: Date;
      productId: string;
      productSku: string | null;
      salePrice: number;
      commissionPercent: number | null;
      /** Como chegamos nesta versão — para auditoria da decisão. */
      resolutionSource: "POINT_IN_TIME" | "OPEN_ENDED_CURRENT";
    }
  | { ok: false; diagnostic: CommissionDiagnostic };

/** DRAFT nunca vigora: nunca foi publicada, então não valeu em data alguma. */
function isPublishableStatus(status: string): boolean {
  return status !== "DRAFT";
}

/**
 * A versão estava vigente na data?
 *
 * `effectiveTo` nulo = vigência ABERTA (vale de `effectiveFrom` em diante) —
 * contrato oficial do domínio. Limite superior é EXCLUSIVO (`>`), então uma
 * versão que termina no dia D não cobre o dia D.
 */
function isEffectiveAt(v: PriceTableVersionCandidate, at: Date): boolean {
  if (!v.effectiveFrom) return false;
  if (v.effectiveFrom.getTime() > at.getTime()) return false;
  if (v.effectiveTo == null) return true;
  return v.effectiveTo.getTime() > at.getTime();
}

/** Vigência estruturalmente impossível — fim igual ou anterior ao início. */
function hasInvalidValidity(v: PriceTableVersionCandidate): boolean {
  if (!v.effectiveFrom || !v.effectiveTo) return false;
  return v.effectiveTo.getTime() <= v.effectiveFrom.getTime();
}

export function resolveHistoricalCommercialPrice(input: {
  referenceDate: Date;
  productId: string;
  /** Versões da MESMA tabela comercial, em qualquer status. */
  versions: readonly PriceTableVersionCandidate[];
  /** Preços do produto nas versões candidatas. */
  prices: readonly CommercialProductPriceCandidate[];
}): HistoricalPriceTableResolution {
  const { referenceDate, productId } = input;
  const considered = input.versions.filter((v) => isPublishableStatus(v.status));

  const effective = considered.filter((v) => isEffectiveAt(v, referenceDate));

  if (effective.length === 0) {
    // Distingue "não existe versão para a data" de "existe, mas com vigência
    // quebrada" — a segunda é problema de cadastro, não ausência.
    const broken = considered.filter(hasInvalidValidity);
    if (broken.length > 0) {
      return {
        ok: false,
        diagnostic: buildCommissionDiagnostic(
          "INVALID_PRICE_TABLE_VALIDITY",
          `Nenhuma versão vigente em ${referenceDate.toISOString().slice(0, 10)}; ${broken.length} versão(ões) com vigência inconsistente (fim <= início).`,
          {
            referenceDate,
            invalidVersions: broken.map((v) => ({
              versionId: v.versionId,
              versionNumber: v.versionNumber,
              effectiveFrom: v.effectiveFrom,
              effectiveTo: v.effectiveTo,
            })),
            candidateVersionCount: considered.length,
          }
        ),
      };
    }
    return {
      ok: false,
      diagnostic: buildCommissionDiagnostic(
        "NO_EFFECTIVE_PRICE_TABLE_FOR_SALE_DATE",
        `Nenhuma versão de tabela comercial vigente em ${referenceDate.toISOString().slice(0, 10)}.`,
        { referenceDate, candidateVersionCount: considered.length }
      ),
    };
  }

  if (effective.length > 1) {
    // Nunca escolher a "primeira" nem a mais recente: ambiguidade de vigência
    // é erro de cadastro e o cálculo não é seguro.
    return {
      ok: false,
      diagnostic: buildCommissionDiagnostic(
        "MULTIPLE_EFFECTIVE_PRICE_TABLE_VERSIONS",
        `${effective.length} versões vigentes simultaneamente em ${referenceDate.toISOString().slice(0, 10)}.`,
        {
          referenceDate,
          versions: effective.map((v) => ({
            versionId: v.versionId,
            versionNumber: v.versionNumber,
            status: v.status,
            effectiveFrom: v.effectiveFrom,
            effectiveTo: v.effectiveTo,
          })),
        }
      ),
    };
  }

  const version = effective[0]!;
  const productPrices = input.prices.filter(
    (p) => p.versionId === version.versionId && p.productId === productId
  );

  if (productPrices.length === 0) {
    return {
      ok: false,
      diagnostic: buildCommissionDiagnostic(
        "PRODUCT_NOT_FOUND_IN_PRICE_TABLE",
        `Produto ausente da versão ${version.versionNumber} da tabela ${version.tableCode}.`,
        {
          referenceDate,
          productId,
          versionId: version.versionId,
          versionNumber: version.versionNumber,
          tableCode: version.tableCode,
        }
      ),
    };
  }

  if (productPrices.length > 1) {
    return {
      ok: false,
      diagnostic: buildCommissionDiagnostic(
        "PRODUCT_DUPLICATED_IN_PRICE_TABLE",
        `Produto duplicado (${productPrices.length}x) na versão ${version.versionNumber} da tabela ${version.tableCode}.`,
        {
          referenceDate,
          productId,
          versionId: version.versionId,
          duplicatedCount: productPrices.length,
        }
      ),
    };
  }

  const price = productPrices[0]!;

  if (price.salePrice == null) {
    return {
      ok: false,
      diagnostic: buildCommissionDiagnostic(
        "COMMERCIAL_PRICE_MISSING",
        `Produto presente na versão ${version.versionNumber}, mas sem preço comercial.`,
        { referenceDate, productId, versionId: version.versionId }
      ),
    };
  }

  if (!Number.isFinite(price.salePrice) || price.salePrice <= 0) {
    return {
      ok: false,
      diagnostic: buildCommissionDiagnostic(
        "COMMERCIAL_PRICE_INVALID",
        `Preço comercial inválido (${price.salePrice}) na versão ${version.versionNumber}.`,
        {
          referenceDate,
          productId,
          versionId: version.versionId,
          salePrice: price.salePrice,
        }
      ),
    };
  }

  return {
    ok: true,
    tableId: version.tableId,
    tableCode: version.tableCode,
    versionId: version.versionId,
    versionNumber: version.versionNumber,
    versionStatus: version.status,
    effectiveFrom: version.effectiveFrom,
    effectiveTo: version.effectiveTo,
    referenceDate,
    productId,
    productSku: price.productSku,
    salePrice: price.salePrice,
    commissionPercent: price.commissionPercent,
    resolutionSource:
      version.effectiveTo == null ? "OPEN_ENDED_CURRENT" : "POINT_IN_TIME",
  };
}
