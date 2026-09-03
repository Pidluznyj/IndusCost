/**
 * Tesouraria › Caixa — AUTORIDADE ÚNICA DE SALDOS POR DIA CIVIL.
 *
 * Um só resolvedor decide, para cada dia civil, de onde vem a abertura, o
 * fechamento, a divergência e a cobertura de contas — e TODAS as superfícies
 * (linha do tempo diária/mensal, HOJE, card "Caixa hoje", motor único-de-dia,
 * cenários) consomem o MESMO resultado. Nenhuma delas recalcula saldo.
 *
 * Regras não negociáveis (missão 03/09/2026):
 *  - A Tesouraria trabalha com SALDOS POR CONTA e depois consolida.
 *  - MANUAL > AUTOMÁTICO, mas a prioridade é POR CONTA: o saldo manual de
 *    uma conta nunca substitui o consolidado inteiro.
 *  - Um subtotal de 1/3 ou 2/3 das contas esperadas NUNCA vira saldo
 *    consolidado. Sem cobertura completa, a série segue a cadeia calculada e
 *    a cobertura parcial fica visível (auditoria), não ancora.
 *  - Abertura manual COMPLETA prevalece sobre o fechamento efetivo anterior;
 *    a diferença é registrada em `openingAdjustment` (nunca escondida).
 *  - O universo de contas esperadas é TEMPORAL: "esta conta fazia parte do
 *    consolidado NESTE dia?" — conta nova não contamina o passado.
 *  - Fechamento formal (`TreasuryDailyClosing` CLOSED) cobre só as contas do
 *    seu `companyCode`; nunca fecha o consolidado de outra empresa.
 *  - Nada é inventado: "abertura = fechamento do próprio dia" e "último saldo
 *    conhecido = fechamento do dia" NÃO são adotados como fato.
 *
 * Este módulo é puro (zero I/O). Os carregadores ficam em
 * `services/treasuryConsolidatedAccountUniverse.server.ts` e
 * `services/treasuryDailyBalanceEvidence.server.ts`.
 */

/** Mesma regra de arredondamento monetário de `treasuryCaixaRules` (2 casas). */
export function roundTreasuryBalanceMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// ───────────────────────────────────────────────────────────────────────────
// Tipos de evidência / cobertura / proveniência
// ───────────────────────────────────────────────────────────────────────────

/** De onde veio um saldo (por conta ou consolidado). */
export type TreasuryBalanceSource =
  | "FORMAL_CLOSING"
  | "MANUAL_OPENING"
  | "MANUAL_CLOSING"
  | "GENERIC_MANUAL"
  | "CALCULATED"
  | "LATEST_POSITION"
  | "NONE";

/** Evidência de saldo de UMA conta num dia civil. */
export type TreasuryAccountBalanceEvidence = {
  accountId: string;
  accountName: string;
  companyCode: string;
  source: TreasuryBalanceSource;
  /** null quando a conta ficou sem evidência (source NONE). */
  amount: number | null;
  /** Instante em que a informação foi registrada (ISO), quando a fonte guarda. */
  informedAt: string | null;
  /** Dia civil a que a evidência se refere (YYYY-MM-DD). */
  referenceDate: string | null;
};

export type TreasuryConsolidatedAccountRef = {
  accountId: string;
  accountName: string;
  companyCode: string;
};

/** Cobertura de um lado (abertura ou fechamento) do dia. */
export type TreasuryBalanceCoverage = {
  accountsExpected: number;
  accountsCovered: number;
  /** true ⇔ TODA conta esperada tem evidência válida (accountsExpected > 0). */
  complete: boolean;
  accounts: readonly TreasuryAccountBalanceEvidence[];
  pendingAccounts: readonly TreasuryConsolidatedAccountRef[];
  /**
   * Soma das contas cobertas quando a cobertura é PARCIAL — só para
   * auditoria/UI ("subtotal informado, não usado"). Nunca vira âncora.
   * null quando não há nenhuma conta coberta ou quando a cobertura é completa
   * (aí o total está em `openingManual`/`closingInformed`).
   */
  partialSum: number | null;
};

export type TreasuryDailyBalanceWarningCode =
  | "NO_EXPECTED_ACCOUNTS"
  | "PARTIAL_OPENING_COVERAGE"
  | "PARTIAL_CLOSING_COVERAGE"
  | "OPENING_ADJUSTMENT"
  | "MEMBERSHIP_DERIVED_FROM_ACCOUNT_FIELDS"
  | "GENERIC_SNAPSHOT_IGNORED"
  | "FORMAL_CLOSING_OTHER_COMPANY_IGNORED";

export type TreasuryDailyBalanceWarning = {
  code: TreasuryDailyBalanceWarningCode;
  message: string;
};

export type TreasuryDailyBalanceOpeningSource =
  | "MANUAL_OPENING"
  | "PREVIOUS_CLOSING"
  | "GENESIS"
  | "NONE";

export type TreasuryDailyBalanceClosingSource =
  | "FORMAL_CLOSING"
  | "MANUAL_CLOSING"
  | "CALCULATED"
  | "NONE";

export type TreasuryDailyBalanceDivergenceBaseline = "REALIZED" | "CALCULATED";

export type TreasuryDailyBalanceKind = "REALIZED" | "TODAY";

/** Resultado da autoridade para UM dia civil. */
export type TreasuryDailyBalanceAuthorityDay = {
  civilDate: string;
  kind: TreasuryDailyBalanceKind;

  expectedAccounts: readonly TreasuryConsolidatedAccountRef[];
  openingCoverage: TreasuryBalanceCoverage;
  closingCoverage: TreasuryBalanceCoverage;

  /** Fechamento efetivo do dia anterior na cadeia (null antes da gênese). */
  previousEffectiveClosing: number | null;

  /** Abertura efetiva. */
  opening: number | null;
  openingSource: TreasuryDailyBalanceOpeningSource;
  /** Soma das aberturas manuais quando a cobertura de abertura é completa. */
  openingManual: number | null;
  /** openingManual − previousEffectiveClosing (só quando ambos existem). */
  openingAdjustment: number | null;

  /** Realizado consolidado do dia (CR baixado / CP pago). */
  inflows: number;
  outflows: number;
  /** Previsto do próprio dia (só TODAY — regra D+1); 0 no passado. */
  predictedInflows: number;
  predictedOutflows: number;

  /** opening + inflows − outflows (+ predicted em TODAY). */
  closingCalculated: number | null;
  /** opening + inflows − outflows (sem previsto). No passado = closingCalculated. */
  closingRealized: number | null;
  /** Soma manual/formal quando a cobertura de fechamento é COMPLETA. */
  closingInformed: number | null;
  closingSource: TreasuryDailyBalanceClosingSource;
  /** closingInformed ?? closingCalculated. */
  closingEffective: number | null;

  /** closingInformed − baseline; null sem informado completo. */
  divergence: number | null;
  divergenceBaseline: TreasuryDailyBalanceDivergenceBaseline;

  warnings: readonly TreasuryDailyBalanceWarning[];
};

// ───────────────────────────────────────────────────────────────────────────
// Entrada do resolvedor (tudo pré-carregado; zero I/O aqui)
// ───────────────────────────────────────────────────────────────────────────

export type TreasuryConsolidatedMembershipInterval = {
  /** Primeiro dia civil (inclusivo). */
  validFrom: string;
  /** Último dia civil (inclusivo); null = vigente. */
  validUntil: string | null;
};

export type TreasuryConsolidatedAccountMembershipView = TreasuryConsolidatedAccountRef & {
  memberships: readonly TreasuryConsolidatedMembershipInterval[];
  /** TABLE = TreasuryConsolidatedAccountMembership; DERIVED = fallback por campos da conta. */
  membershipSource: "TABLE" | "DERIVED";
};

export type TreasuryManualBalanceEvidenceInput = {
  accountId: string;
  civilDate: string;
  amount: number;
  /** ISO do instante de registro. */
  informedAt: string | null;
  version?: number | null;
};

export type TreasuryFormalClosingEvidenceInput = {
  companyCode: string;
  civilDate: string;
  observedBalance: number;
  openingBalance: number | null;
  closedAt: string | null;
  version: number;
};

export type TreasuryDailyFlowInput = {
  civilDate: string;
  inflows: number;
  outflows: number;
};

/**
 * Semântica do snapshot MANUAL genérico (tela "Saldo"): decidida pela
 * auditoria e fixada em teste. "CLOSING_EVIDENCE" = vale como saldo final da
 * conta no dia civil (America/Sao_Paulo) de `referenceAt`.
 */
export type TreasuryGenericSnapshotPolicy = "CLOSING_EVIDENCE" | "IGNORE";

export type TreasuryDailyBalanceAuthorityInput = {
  /** Dias civis a resolver, ordenados asc. Devem começar na gênese ou depois. */
  civilDates: readonly string[];
  genesisCivilDate?: string;
  todayCivilDate: string;
  accounts: readonly TreasuryConsolidatedAccountMembershipView[];
  manualOpenings: readonly TreasuryManualBalanceEvidenceInput[];
  manualClosings: readonly TreasuryManualBalanceEvidenceInput[];
  genericSnapshots: readonly TreasuryManualBalanceEvidenceInput[];
  formalClosings: readonly TreasuryFormalClosingEvidenceInput[];
  /** Realizado consolidado por dia (dias sem linha = 0/0). */
  flows: readonly TreasuryDailyFlowInput[];
  /** Previsto de HOJE (regra D+1). Ausente = 0/0. */
  todayPredicted?: { inflows: number; outflows: number } | null;
  genericSnapshotPolicy?: TreasuryGenericSnapshotPolicy;
};

export type TreasuryDailyBalanceAuthorityResult = {
  days: readonly TreasuryDailyBalanceAuthorityDay[];
  byCivilDate: ReadonlyMap<string, TreasuryDailyBalanceAuthorityDay>;
  /** Avisos globais (ex.: membership derivado por campos). */
  warnings: readonly TreasuryDailyBalanceWarning[];
};

// ───────────────────────────────────────────────────────────────────────────
// API pública
// ───────────────────────────────────────────────────────────────────────────

/** Contas esperadas no consolidado NUM dia civil (membership temporal). */
export function resolveTreasuryExpectedAccountsOn(
  accounts: readonly TreasuryConsolidatedAccountMembershipView[],
  civilDate: string
): TreasuryConsolidatedAccountRef[] {
  void accounts;
  void civilDate;
  throw new Error("not implemented: resolveTreasuryExpectedAccountsOn");
}

/** Resolve a autoridade de saldo dia a dia, encadeando o fechamento efetivo. */
export function resolveTreasuryDailyBalanceAuthority(
  input: TreasuryDailyBalanceAuthorityInput
): TreasuryDailyBalanceAuthorityResult {
  void input;
  throw new Error("not implemented: resolveTreasuryDailyBalanceAuthority");
}

/** Cobertura vazia (helper para testes e para dias sem contas esperadas). */
export function emptyTreasuryBalanceCoverage(
  expected: readonly TreasuryConsolidatedAccountRef[] = []
): TreasuryBalanceCoverage {
  return {
    accountsExpected: expected.length,
    accountsCovered: 0,
    complete: false,
    accounts: [],
    pendingAccounts: [...expected],
    partialSum: null,
  };
}
