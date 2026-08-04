/**
 * Taxonomia de diagnóstico do motor de comissão.
 *
 * PROBLEMA QUE RESOLVE
 * `NO_MARGIN` — "Margem ou tabela comercial indisponível para cálculo de
 * comissão" — funde causas distintas: não havia tabela vigente, o produto não
 * está na versão, o preço é inválido, o custo faltou, a margem não fechou.
 * Quem lê não sabe o que corrigir.
 *
 * COMPATIBILIDADE
 * Os códigos existentes (`CommissionOrderItemSnapshotStatus`,
 * `CommissionReceiptLedgerLineStatus`) NÃO são renomeados — são contrato de
 * banco e de tela. Esta taxonomia é uma camada de CAUSA, mais específica, que
 * mapeia PARA os códigos oficiais via {@link toLegacyItemStatus}. `NO_MARGIN`
 * continua válido como categoria agrupadora na interface; deixa de ser a única
 * explicação técnica.
 */

/** Causa específica apurada pelo motor. */
export const COMMISSION_DIAGNOSTIC_CODES = [
  // Tabela comercial
  "NO_EFFECTIVE_PRICE_TABLE_FOR_SALE_DATE",
  "MULTIPLE_EFFECTIVE_PRICE_TABLE_VERSIONS",
  "INVALID_PRICE_TABLE_VALIDITY",
  "PRODUCT_NOT_FOUND_IN_PRICE_TABLE",
  "PRODUCT_DUPLICATED_IN_PRICE_TABLE",
  "COMMERCIAL_PRICE_MISSING",
  "COMMERCIAL_PRICE_INVALID",
  // Custo e margem
  "COST_UNAVAILABLE",
  "MARGIN_INVALID",
  // Cadastro e regra
  "NO_SELLER",
  "CUSTOMER_NOT_COMMISSIONABLE",
  "COMMISSION_RULE_NOT_FOUND",
  // Ciclo de vida
  "SNAPSHOT_STALE",
  "REPROCESS_PROTECTED",
  // Falha
  "INTERNAL_CALCULATION_ERROR",
] as const;

export type CommissionDiagnosticCode =
  (typeof COMMISSION_DIAGNOSTIC_CODES)[number];

export type CommissionDiagnosticCategory =
  | "PRICE_TABLE"
  | "COST_MARGIN"
  | "REGISTRATION"
  | "LIFECYCLE"
  | "FAILURE";

type DiagnosticSpec = {
  category: CommissionDiagnosticCategory;
  /** Texto para o usuário: o que aconteceu e o que fazer. Sem jargão interno. */
  userMessage: string;
  /**
   * Status oficial equivalente em `CommissionOrderItemSnapshotStatus`.
   * `null` quando a causa não pertence ao item (ex.: proteção de reprocesso).
   */
  legacyItemStatus: string | null;
};

const SPECS: Record<CommissionDiagnosticCode, DiagnosticSpec> = {
  NO_EFFECTIVE_PRICE_TABLE_FOR_SALE_DATE: {
    category: "PRICE_TABLE",
    userMessage:
      "Não existe tabela comercial vigente para a data da venda. Publique uma versão que cubra essa data ou ajuste a vigência.",
    legacyItemStatus: "NO_COMMERCIAL_PRICE_TABLE",
  },
  MULTIPLE_EFFECTIVE_PRICE_TABLE_VERSIONS: {
    category: "PRICE_TABLE",
    userMessage:
      "Existe mais de uma versão de tabela válida para esta data. O cálculo não é seguro até resolver a ambiguidade.",
    legacyItemStatus: "NO_COMMERCIAL_PRICE_TABLE",
  },
  INVALID_PRICE_TABLE_VALIDITY: {
    category: "PRICE_TABLE",
    userMessage:
      "A vigência da tabela está inconsistente (fim igual ou anterior ao início). Corrija a vigência antes de recalcular.",
    legacyItemStatus: "NO_COMMERCIAL_PRICE_TABLE",
  },
  PRODUCT_NOT_FOUND_IN_PRICE_TABLE: {
    category: "PRICE_TABLE",
    userMessage:
      "O produto não está na versão da tabela comercial vigente na data da venda.",
    legacyItemStatus: "NO_COMMERCIAL_PRICE_TABLE",
  },
  PRODUCT_DUPLICATED_IN_PRICE_TABLE: {
    category: "PRICE_TABLE",
    userMessage:
      "O produto aparece duplicado na mesma versão da tabela. O preço fica ambíguo e o cálculo é bloqueado.",
    legacyItemStatus: "NO_COMMERCIAL_PRICE_TABLE",
  },
  COMMERCIAL_PRICE_MISSING: {
    category: "PRICE_TABLE",
    userMessage: "O produto está na tabela, mas sem preço comercial informado.",
    legacyItemStatus: "NO_COMMERCIAL_PRICE_TABLE",
  },
  COMMERCIAL_PRICE_INVALID: {
    category: "PRICE_TABLE",
    userMessage:
      "O preço comercial da tabela é zero ou inválido. Não é possível enquadrar a faixa.",
    legacyItemStatus: "INVALID_COMMERCIAL_PRICE_RANGE",
  },
  COST_UNAVAILABLE: {
    category: "COST_MARGIN",
    userMessage:
      "O custo do produto não pôde ser apurado na data da venda, então a margem não fecha.",
    legacyItemStatus: "ERROR",
  },
  MARGIN_INVALID: {
    category: "COST_MARGIN",
    userMessage:
      "A margem calculada não é utilizável para enquadrar a faixa de comissão.",
    legacyItemStatus: "INVALID_COMMERCIAL_PRICE_RANGE",
  },
  NO_SELLER: {
    category: "REGISTRATION",
    userMessage:
      "O pedido não tem vendedor resolvido. Sem vendedor não há a quem comissionar.",
    legacyItemStatus: "SELLER_UNRESOLVED",
  },
  CUSTOMER_NOT_COMMISSIONABLE: {
    category: "REGISTRATION",
    userMessage:
      "Cliente excluído de comissão por regra. Comissão zero é o resultado correto.",
    legacyItemStatus: "CUSTOMER_EXCLUDED",
  },
  COMMISSION_RULE_NOT_FOUND: {
    category: "REGISTRATION",
    userMessage:
      "Nenhuma regra de comissão vigente se aplica ao item na data da venda.",
    legacyItemStatus: "NO_RULE",
  },
  SNAPSHOT_STALE: {
    category: "LIFECYCLE",
    userMessage:
      "O cálculo foi congelado com uma versão anterior das tabelas. Existe versão aplicável mais recente — o pedido precisa passar pelo reprocessamento.",
    legacyItemStatus: null,
  },
  REPROCESS_PROTECTED: {
    category: "LIFECYCLE",
    userMessage:
      "O pedido está protegido por histórico financeiro e não é alterado automaticamente.",
    legacyItemStatus: null,
  },
  INTERNAL_CALCULATION_ERROR: {
    category: "FAILURE",
    userMessage:
      "Falha inesperada ao calcular a comissão deste pedido. O time técnico precisa analisar.",
    legacyItemStatus: "ERROR",
  },
};

export type CommissionDiagnostic = {
  code: CommissionDiagnosticCode;
  category: CommissionDiagnosticCategory;
  userMessage: string;
  /** Detalhe para log/auditoria. Nunca stack trace nem segredo. */
  technicalMessage: string;
  /** Fatos que sustentam o diagnóstico (ids, datas, contagens). */
  evidence: Record<string, unknown>;
};

export function buildCommissionDiagnostic(
  code: CommissionDiagnosticCode,
  technicalMessage: string,
  evidence: Record<string, unknown> = {}
): CommissionDiagnostic {
  const spec = SPECS[code];
  return {
    code,
    category: spec.category,
    userMessage: spec.userMessage,
    technicalMessage,
    evidence,
  };
}

/** Status oficial equivalente, para gravar no snapshot sem quebrar contrato. */
export function toLegacyItemStatus(
  code: CommissionDiagnosticCode
): string | null {
  return SPECS[code].legacyItemStatus;
}

export function commissionDiagnosticCategory(
  code: CommissionDiagnosticCode
): CommissionDiagnosticCategory {
  return SPECS[code].category;
}

/**
 * `NO_MARGIN` continua servindo como AGRUPADOR visual, nunca como causa raiz.
 * Estas são as causas específicas que a interface pode agrupar sob ele.
 */
export const CODES_GROUPED_UNDER_NO_MARGIN: readonly CommissionDiagnosticCode[] =
  [
    "NO_EFFECTIVE_PRICE_TABLE_FOR_SALE_DATE",
    "MULTIPLE_EFFECTIVE_PRICE_TABLE_VERSIONS",
    "INVALID_PRICE_TABLE_VALIDITY",
    "PRODUCT_NOT_FOUND_IN_PRICE_TABLE",
    "PRODUCT_DUPLICATED_IN_PRICE_TABLE",
    "COMMERCIAL_PRICE_MISSING",
    "COMMERCIAL_PRICE_INVALID",
    "COST_UNAVAILABLE",
    "MARGIN_INVALID",
  ];
