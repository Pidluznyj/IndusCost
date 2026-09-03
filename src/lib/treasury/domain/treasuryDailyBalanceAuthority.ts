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
  const result: TreasuryConsolidatedAccountRef[] = [];
  for (const acc of accounts) {
    const isExpected = acc.memberships.some(
      (m) => civilDate >= m.validFrom && (m.validUntil == null || civilDate <= m.validUntil)
    );
    if (isExpected) {
      result.push({
        accountId: acc.accountId,
        accountName: acc.accountName,
        companyCode: acc.companyCode,
      });
    }
  }
  return result;
}

/** Pega, dentre as evidências de uma conta+dia, a de maior `version` (empate: a última do array). */
function pickLatestManualEvidence(
  entries: readonly TreasuryManualBalanceEvidenceInput[],
  accountId: string,
  civilDate: string
): TreasuryManualBalanceEvidenceInput | null {
  let best: TreasuryManualBalanceEvidenceInput | null = null;
  for (const e of entries) {
    if (e.accountId !== accountId || e.civilDate !== civilDate) continue;
    if (!best) {
      best = e;
      continue;
    }
    const bestVersion = best.version ?? Number.NEGATIVE_INFINITY;
    const version = e.version ?? Number.NEGATIVE_INFINITY;
    if (version >= bestVersion) best = e;
  }
  return best;
}

type ClosingCoverageResolution = {
  coverage: TreasuryBalanceCoverage;
  /** Soma quando cobertura COMPLETA; null caso contrário. Nunca ancora parcial. */
  sum: number | null;
  anyFormal: boolean;
  warnings: TreasuryDailyBalanceWarning[];
};

/**
 * Cobertura/proveniência de FECHAMENTO de um dia. Fechamento formal é POR
 * EMPRESA (uma única `observedBalance` cobre todas as contas daquela
 * `companyCode` naquele dia) — por isso agrupa as contas esperadas por
 * empresa antes de aplicar a precedência FORMAL_CLOSING > MANUAL_CLOSING >
 * GENERIC_MANUAL (esta última só quando `genericSnapshotPolicy` não for
 * "IGNORE"). Nunca soma subtotal de contas pendentes na `closingInformed`.
 */
function resolveClosingCoverage(input: {
  civilDate: string;
  expectedAccounts: readonly TreasuryConsolidatedAccountRef[];
  manualClosings: readonly TreasuryManualBalanceEvidenceInput[];
  genericSnapshots: readonly TreasuryManualBalanceEvidenceInput[];
  formalClosingsByCompanyDay: ReadonlyMap<string, TreasuryFormalClosingEvidenceInput>;
  allFormalClosingsForDay: readonly TreasuryFormalClosingEvidenceInput[];
  genericSnapshotPolicy: TreasuryGenericSnapshotPolicy;
}): ClosingCoverageResolution {
  const warnings: TreasuryDailyBalanceWarning[] = [];
  const accounts: TreasuryAccountBalanceEvidence[] = [];
  const pendingAccounts: TreasuryConsolidatedAccountRef[] = [];
  let sum = 0;
  let anyFormal = false;
  let ignoredGeneric = false;

  const byCompany = new Map<string, TreasuryConsolidatedAccountRef[]>();
  for (const acc of input.expectedAccounts) {
    const list = byCompany.get(acc.companyCode);
    if (list) list.push(acc);
    else byCompany.set(acc.companyCode, [acc]);
  }

  for (const [companyCode, refs] of byCompany) {
    const formal = input.formalClosingsByCompanyDay.get(`${companyCode}|${input.civilDate}`);
    if (formal) {
      anyFormal = true;
      sum += formal.observedBalance;
      for (const ref of refs) {
        accounts.push({
          accountId: ref.accountId,
          accountName: ref.accountName,
          companyCode: ref.companyCode,
          source: "FORMAL_CLOSING",
          amount: formal.observedBalance,
          informedAt: formal.closedAt,
          referenceDate: input.civilDate,
        });
      }
      continue;
    }
    for (const ref of refs) {
      const manual = pickLatestManualEvidence(input.manualClosings, ref.accountId, input.civilDate);
      if (manual) {
        sum += manual.amount;
        accounts.push({
          accountId: ref.accountId,
          accountName: ref.accountName,
          companyCode: ref.companyCode,
          source: "MANUAL_CLOSING",
          amount: manual.amount,
          informedAt: manual.informedAt,
          referenceDate: input.civilDate,
        });
        continue;
      }
      const generic = pickLatestManualEvidence(input.genericSnapshots, ref.accountId, input.civilDate);
      if (generic) {
        if (input.genericSnapshotPolicy === "IGNORE") {
          ignoredGeneric = true;
          pendingAccounts.push(ref);
          continue;
        }
        sum += generic.amount;
        accounts.push({
          accountId: ref.accountId,
          accountName: ref.accountName,
          companyCode: ref.companyCode,
          source: "GENERIC_MANUAL",
          amount: generic.amount,
          informedAt: generic.informedAt,
          referenceDate: input.civilDate,
        });
        continue;
      }
      pendingAccounts.push(ref);
    }
  }

  for (const formal of input.allFormalClosingsForDay) {
    if (!byCompany.has(formal.companyCode)) {
      warnings.push({
        code: "FORMAL_CLOSING_OTHER_COMPANY_IGNORED",
        message: `Fechamento formal de ${formal.companyCode} em ${input.civilDate} ignorado — nenhuma conta esperada dessa empresa neste dia.`,
      });
    }
  }
  if (ignoredGeneric) {
    warnings.push({
      code: "GENERIC_SNAPSHOT_IGNORED",
      message: `Saldo genérico informado em ${input.civilDate} foi ignorado (política de cobertura IGNORE) e não conta como fechamento.`,
    });
  }

  const accountsExpected = input.expectedAccounts.length;
  const accountsCovered = accounts.length;
  const complete = accountsExpected > 0 && accountsCovered === accountsExpected;
  if (accountsExpected > 0 && accountsCovered > 0 && accountsCovered < accountsExpected) {
    warnings.push({
      code: "PARTIAL_CLOSING_COVERAGE",
      message: `Fechamento informado incompleto em ${input.civilDate}: ${accountsCovered}/${accountsExpected} contas — o subtotal NÃO foi usado como saldo consolidado.`,
    });
  }

  const coverage: TreasuryBalanceCoverage = {
    accountsExpected,
    accountsCovered,
    complete,
    accounts,
    pendingAccounts,
    partialSum: complete || accountsCovered === 0 ? null : roundTreasuryBalanceMoney(sum),
  };

  return {
    coverage,
    sum: complete ? roundTreasuryBalanceMoney(sum) : null,
    anyFormal,
    warnings,
  };
}

type OpeningCoverageResolution = {
  coverage: TreasuryBalanceCoverage;
  sum: number | null;
  warnings: TreasuryDailyBalanceWarning[];
};

/** Cobertura/proveniência de ABERTURA de um dia — só `manualOpenings` conta (sem análogo formal). */
function resolveOpeningCoverage(input: {
  civilDate: string;
  expectedAccounts: readonly TreasuryConsolidatedAccountRef[];
  manualOpenings: readonly TreasuryManualBalanceEvidenceInput[];
}): OpeningCoverageResolution {
  const warnings: TreasuryDailyBalanceWarning[] = [];
  const accounts: TreasuryAccountBalanceEvidence[] = [];
  const pendingAccounts: TreasuryConsolidatedAccountRef[] = [];
  let sum = 0;

  for (const ref of input.expectedAccounts) {
    const manual = pickLatestManualEvidence(input.manualOpenings, ref.accountId, input.civilDate);
    if (manual) {
      sum += manual.amount;
      accounts.push({
        accountId: ref.accountId,
        accountName: ref.accountName,
        companyCode: ref.companyCode,
        source: "MANUAL_OPENING",
        amount: manual.amount,
        informedAt: manual.informedAt,
        referenceDate: input.civilDate,
      });
    } else {
      pendingAccounts.push(ref);
    }
  }

  const accountsExpected = input.expectedAccounts.length;
  const accountsCovered = accounts.length;
  const complete = accountsExpected > 0 && accountsCovered === accountsExpected;
  if (accountsExpected > 0 && accountsCovered > 0 && accountsCovered < accountsExpected) {
    warnings.push({
      code: "PARTIAL_OPENING_COVERAGE",
      message: `Abertura informada incompleta em ${input.civilDate}: ${accountsCovered}/${accountsExpected} contas — "Começou" segue o fechamento efetivo do dia anterior.`,
    });
  }

  const coverage: TreasuryBalanceCoverage = {
    accountsExpected,
    accountsCovered,
    complete,
    accounts,
    pendingAccounts,
    partialSum: complete || accountsCovered === 0 ? null : roundTreasuryBalanceMoney(sum),
  };

  return { coverage, sum: complete ? roundTreasuryBalanceMoney(sum) : null, warnings };
}

/**
 * Resolve a autoridade de saldo dia a dia, encadeando o fechamento efetivo.
 *
 * Cadeia: `opening(D) = closingEffective(D-1)` (ou saldo inicial manual
 * COMPLETO de D, ou zero na gênese sem predecessor). `closingEffective(D) =
 * closingInformed(D) ?? closingCalculated(D)` — nunca um subtotal parcial.
 */
export function resolveTreasuryDailyBalanceAuthority(
  input: TreasuryDailyBalanceAuthorityInput
): TreasuryDailyBalanceAuthorityResult {
  const genesisCivilDate = input.genesisCivilDate ?? "1970-01-01";
  const genericSnapshotPolicy = input.genericSnapshotPolicy ?? "CLOSING_EVIDENCE";

  const formalClosingsByCompanyDay = new Map<string, TreasuryFormalClosingEvidenceInput>();
  for (const fc of input.formalClosings) {
    const key = `${fc.companyCode}|${fc.civilDate}`;
    const existing = formalClosingsByCompanyDay.get(key);
    if (!existing || fc.version > existing.version) formalClosingsByCompanyDay.set(key, fc);
  }
  const formalClosingsByDay = new Map<string, TreasuryFormalClosingEvidenceInput[]>();
  for (const fc of formalClosingsByCompanyDay.values()) {
    const list = formalClosingsByDay.get(fc.civilDate);
    if (list) list.push(fc);
    else formalClosingsByDay.set(fc.civilDate, [fc]);
  }

  const flowsByDay = new Map<string, TreasuryDailyFlowInput>();
  for (const f of input.flows) flowsByDay.set(f.civilDate, f);

  const civilDates = [...new Set(input.civilDates)].sort((a, b) => a.localeCompare(b));

  const days: TreasuryDailyBalanceAuthorityDay[] = [];
  const byCivilDate = new Map<string, TreasuryDailyBalanceAuthorityDay>();
  let previousEffectiveClosing: number | null = null;

  for (const civilDate of civilDates) {
    const kind: TreasuryDailyBalanceKind = civilDate === input.todayCivilDate ? "TODAY" : "REALIZED";
    const expectedAccounts = resolveTreasuryExpectedAccountsOn(input.accounts, civilDate);
    const warnings: TreasuryDailyBalanceWarning[] = [];

    if (expectedAccounts.length === 0) {
      warnings.push({
        code: "NO_EXPECTED_ACCOUNTS",
        message: `Nenhuma conta esperada no consolidado em ${civilDate} — sem cobertura possível.`,
      });
    }

    if (civilDate < genesisCivilDate) {
      const emptyCoverage = emptyTreasuryBalanceCoverage(expectedAccounts);
      const day: TreasuryDailyBalanceAuthorityDay = {
        civilDate,
        kind,
        expectedAccounts,
        openingCoverage: emptyCoverage,
        closingCoverage: emptyCoverage,
        previousEffectiveClosing: null,
        opening: null,
        openingSource: "NONE",
        openingManual: null,
        openingAdjustment: null,
        inflows: 0,
        outflows: 0,
        predictedInflows: 0,
        predictedOutflows: 0,
        closingCalculated: null,
        closingRealized: null,
        closingInformed: null,
        closingSource: "NONE",
        closingEffective: null,
        divergence: null,
        divergenceBaseline: kind === "TODAY" ? "REALIZED" : "CALCULATED",
        warnings,
      };
      days.push(day);
      byCivilDate.set(civilDate, day);
      continue;
    }

    const openingResult = resolveOpeningCoverage({
      civilDate,
      expectedAccounts,
      manualOpenings: input.manualOpenings,
    });
    warnings.push(...openingResult.warnings);

    let opening: number;
    let openingSource: TreasuryDailyBalanceOpeningSource;
    let openingAdjustment: number | null = null;
    if (openingResult.sum != null) {
      opening = openingResult.sum;
      openingSource = "MANUAL_OPENING";
      if (previousEffectiveClosing != null) {
        openingAdjustment = roundTreasuryBalanceMoney(opening - previousEffectiveClosing);
        if (openingAdjustment !== 0) {
          warnings.push({
            code: "OPENING_ADJUSTMENT",
            message: `Saldo inicial informado de ${civilDate} ficou ${
              openingAdjustment > 0 ? "acima" : "abaixo"
            } do fechamento efetivo do dia anterior (ajuste de ${openingAdjustment}).`,
          });
        }
      }
    } else if (previousEffectiveClosing != null) {
      opening = previousEffectiveClosing;
      openingSource = "PREVIOUS_CLOSING";
    } else {
      opening = 0;
      openingSource = "GENESIS";
    }

    const flow = flowsByDay.get(civilDate);
    const inflows = flow ? roundTreasuryBalanceMoney(flow.inflows) : 0;
    const outflows = flow ? roundTreasuryBalanceMoney(flow.outflows) : 0;
    const predictedInflows =
      kind === "TODAY" ? roundTreasuryBalanceMoney(input.todayPredicted?.inflows ?? 0) : 0;
    const predictedOutflows =
      kind === "TODAY" ? roundTreasuryBalanceMoney(input.todayPredicted?.outflows ?? 0) : 0;

    const closingRealized = roundTreasuryBalanceMoney(opening + inflows - outflows);
    const closingCalculated = roundTreasuryBalanceMoney(
      closingRealized + predictedInflows - predictedOutflows
    );

    const closingResult = resolveClosingCoverage({
      civilDate,
      expectedAccounts,
      manualClosings: input.manualClosings,
      genericSnapshots: input.genericSnapshots,
      formalClosingsByCompanyDay,
      allFormalClosingsForDay: formalClosingsByDay.get(civilDate) ?? [],
      genericSnapshotPolicy,
    });
    warnings.push(...closingResult.warnings);

    const closingInformed = closingResult.sum;
    const closingSource: TreasuryDailyBalanceClosingSource =
      closingInformed != null ? (closingResult.anyFormal ? "FORMAL_CLOSING" : "MANUAL_CLOSING") : "CALCULATED";
    const closingEffective = closingInformed ?? closingCalculated;

    const divergenceBaseline: TreasuryDailyBalanceDivergenceBaseline =
      kind === "TODAY" ? "REALIZED" : "CALCULATED";
    const divergenceBase = divergenceBaseline === "REALIZED" ? closingRealized : closingCalculated;
    const divergence =
      closingInformed != null ? roundTreasuryBalanceMoney(closingInformed - divergenceBase) : null;

    const day: TreasuryDailyBalanceAuthorityDay = {
      civilDate,
      kind,
      expectedAccounts,
      openingCoverage: openingResult.coverage,
      closingCoverage: closingResult.coverage,
      previousEffectiveClosing,
      opening,
      openingSource,
      openingManual: openingResult.sum,
      openingAdjustment,
      inflows,
      outflows,
      predictedInflows,
      predictedOutflows,
      closingCalculated,
      closingRealized,
      closingInformed,
      closingSource,
      closingEffective,
      divergence,
      divergenceBaseline,
      warnings,
    };
    days.push(day);
    byCivilDate.set(civilDate, day);
    previousEffectiveClosing = closingEffective;
  }

  return { days, byCivilDate, warnings: [] };
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
