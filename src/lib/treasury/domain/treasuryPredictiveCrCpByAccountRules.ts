/**
 * Agrupamento CR/CP por conta local via ID oficial Nomus (bankAccountId).
 * Domínio puro — sem Prisma / sem HTTP.
 */

import {
  addTreasuryMoney,
  compareTreasuryMoney,
  normalizeTreasuryMoneyString,
  subtractTreasuryMoney,
  type TreasuryMoneyString,
} from "../treasuryMoney.js";

export const TREASURY_CRCP_UNLINKED_ID = "__UNLINKED__" as const;

export const TREASURY_CRCP_UNLINKED_LABEL = "Contas sem vínculo" as const;

export type TreasuryCrCpUnlinkedReason =
  | "MISSING_NOMUS_ACCOUNT"
  | "NOMUS_WITHOUT_LOCAL_LINK"
  | "LOCAL_ACCOUNT_INACTIVE"
  | "INVALID_LINK";

export const TREASURY_CRCP_UNLINKED_REASON_LABELS: Record<
  TreasuryCrCpUnlinkedReason,
  string
> = {
  MISSING_NOMUS_ACCOUNT: "Título sem conta financeira informada",
  NOMUS_WITHOUT_LOCAL_LINK: "Conta Nomus sem vínculo local",
  LOCAL_ACCOUNT_INACTIVE: "Conta local vinculada está inativa",
  INVALID_LINK: "Vínculo inválido ou conta local inativa",
};

export type TreasuryCrCpTitleSide = "RECEIVABLE" | "PAYABLE";

export type TreasuryCrCpTitleSeed = {
  id: string;
  side: TreasuryCrCpTitleSide;
  /** YYYY-MM-DD ou null */
  dueDate: string | null;
  openBalance: string;
  originalAmount: string;
  settledAmount: string;
  counterpartyName: string | null;
  documentNumber: string | null;
  installmentLabel: string | null;
  /** ID oficial Nomus (ex.: "8"), já normalizado ou bruto */
  nomusFinancialAccountId: string | number | null;
  nomusFinancialAccountName: string | null;
  /** Overlay operacional (conta local preferida) */
  plannedAccountId?: string | null;
};

export type TreasuryCrCpLocalAccount = {
  id: string;
  code: string;
  name: string;
  institutionName: string;
  nomusBankAccountId: string | null;
  isActive: boolean;
  includeInConsolidated: boolean;
  sortOrder: number;
  currentBalance: string | null;
};

export type TreasuryCrCpTitleDto = {
  id: string;
  side: TreasuryCrCpTitleSide;
  dueDate: string | null;
  effectiveDate: string;
  situation: "OVERDUE" | "UPCOMING";
  counterpartyName: string | null;
  documentNumber: string | null;
  installmentLabel: string | null;
  originalAmount: TreasuryMoneyString;
  settledAmount: TreasuryMoneyString;
  openBalance: TreasuryMoneyString;
  nomusFinancialAccountId: string | null;
  nomusFinancialAccountName: string | null;
  destinationBucketId: string;
  destinationBucketLabel: string;
  unlinkedReason: TreasuryCrCpUnlinkedReason | null;
  unlinkedReasonLabel: string | null;
};

export type TreasuryCrCpAccountGroupDto = {
  treasuryAccountId: string;
  accountCode: string | null;
  accountName: string;
  institutionName: string | null;
  nomusFinancialAccountId: string | null;
  currentBalance: TreasuryMoneyString | null;
  accountsReceivableTotal: TreasuryMoneyString;
  accountsReceivableCount: number;
  accountsPayableTotal: TreasuryMoneyString;
  accountsPayableCount: number;
  netMovement: TreasuryMoneyString;
  projectedBalance: TreasuryMoneyString | null;
  isUnlinked: boolean;
  receivableTitles: TreasuryCrCpTitleDto[];
  payableTitles: TreasuryCrCpTitleDto[];
};

export type TreasuryCrCpByAccountBoardDto = {
  fromDate: string;
  toDate: string;
  groups: TreasuryCrCpAccountGroupDto[];
  totals: {
    accountsReceivableTotal: TreasuryMoneyString;
    accountsReceivableCount: number;
    accountsPayableTotal: TreasuryMoneyString;
    accountsPayableCount: number;
    netMovement: TreasuryMoneyString;
  };
  diagnostics: {
    loadedReceivableCount: number;
    loadedReceivableTotal: TreasuryMoneyString;
    loadedPayableCount: number;
    loadedPayableTotal: TreasuryMoneyString;
    linkedReceivableCount: number;
    linkedReceivableTotal: TreasuryMoneyString;
    linkedPayableCount: number;
    linkedPayableTotal: TreasuryMoneyString;
    unlinkedReceivableCount: number;
    unlinkedReceivableTotal: TreasuryMoneyString;
    unlinkedPayableCount: number;
    unlinkedPayableTotal: TreasuryMoneyString;
    receivableDiff: TreasuryMoneyString;
    payableDiff: TreasuryMoneyString;
  };
};

export type TreasuryAccountLinkResolution =
  | {
      kind: "LINKED";
      accountId: string;
    }
  | {
      kind: "UNLINKED";
      reason: TreasuryCrCpUnlinkedReason;
    };

function money(value: string | null | undefined): TreasuryMoneyString {
  if (value == null || value === "") return "0.00";
  return normalizeTreasuryMoneyString(value);
}

/** Normaliza ID oficial Nomus (Int) para string canônica sem zeros à esquerda inválidos. */
export function normalizeNomusFinancialAccountId(
  value: string | number | null | undefined
): string | null {
  if (value == null) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    const n = Math.trunc(value);
    return n >= 0 ? String(n) : null;
  }
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n)) return null;
  return String(n);
}

export function effectiveTreasuryCrCpFlowDate(
  dueDate: string | null,
  horizonStart: string
): string {
  if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return horizonStart;
  return dueDate < horizonStart ? horizonStart : dueDate;
}

export function isTreasuryCrCpTitleInHorizon(input: {
  dueDate: string | null;
  horizonStart: string;
  horizonEnd: string;
}): boolean {
  const { dueDate, horizonStart, horizonEnd } = input;
  if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    return true;
  }
  if (dueDate > horizonEnd) return false;
  // Vencidos antes do início entram (efetivos no dia inicial).
  void horizonStart;
  return true;
}

/**
 * Mapa Nomus ID → conta local ativa (includeInConsolidated).
 * Contas inativas ficam em inactiveByNomusId para motivo correto.
 */
export function buildTreasuryNomusAccountLinkIndex(
  accounts: readonly TreasuryCrCpLocalAccount[]
): {
  activeByNomusId: Map<string, TreasuryCrCpLocalAccount>;
  inactiveByNomusId: Map<string, TreasuryCrCpLocalAccount>;
  byLocalId: Map<string, TreasuryCrCpLocalAccount>;
} {
  const activeByNomusId = new Map<string, TreasuryCrCpLocalAccount>();
  const inactiveByNomusId = new Map<string, TreasuryCrCpLocalAccount>();
  const byLocalId = new Map<string, TreasuryCrCpLocalAccount>();

  const sorted = [...accounts].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.name.localeCompare(b.name, "pt-BR");
  });

  for (const acc of sorted) {
    byLocalId.set(acc.id, acc);
    const nomusId = normalizeNomusFinancialAccountId(acc.nomusBankAccountId);
    if (!nomusId) continue;
    if (acc.isActive) {
      if (!activeByNomusId.has(nomusId)) {
        activeByNomusId.set(nomusId, acc);
      }
    } else if (!inactiveByNomusId.has(nomusId)) {
      inactiveByNomusId.set(nomusId, acc);
    }
  }

  return { activeByNomusId, inactiveByNomusId, byLocalId };
}

/**
 * Resolução única CR/CP: Nomus financial account ID → conta local ou UNLINKED.
 */
export function resolveTreasuryAccountByNomusFinancialAccountId(
  index: ReturnType<typeof buildTreasuryNomusAccountLinkIndex>,
  nomusFinancialAccountId: string | number | null | undefined,
  options?: { plannedAccountId?: string | null }
): TreasuryAccountLinkResolution {
  const planned = options?.plannedAccountId?.trim() || null;
  if (planned) {
    const local = index.byLocalId.get(planned);
    if (local?.isActive) {
      return { kind: "LINKED", accountId: local.id };
    }
    if (local && !local.isActive) {
      return { kind: "UNLINKED", reason: "LOCAL_ACCOUNT_INACTIVE" };
    }
  }

  const nomusId = normalizeNomusFinancialAccountId(nomusFinancialAccountId);
  if (!nomusId) {
    return { kind: "UNLINKED", reason: "MISSING_NOMUS_ACCOUNT" };
  }

  const active = index.activeByNomusId.get(nomusId);
  if (active) {
    return { kind: "LINKED", accountId: active.id };
  }

  if (index.inactiveByNomusId.has(nomusId)) {
    return { kind: "UNLINKED", reason: "LOCAL_ACCOUNT_INACTIVE" };
  }

  return { kind: "UNLINKED", reason: "NOMUS_WITHOUT_LOCAL_LINK" };
}

function emptyGroup(
  partial: Omit<
    TreasuryCrCpAccountGroupDto,
    | "accountsReceivableTotal"
    | "accountsReceivableCount"
    | "accountsPayableTotal"
    | "accountsPayableCount"
    | "netMovement"
    | "projectedBalance"
    | "receivableTitles"
    | "payableTitles"
  > & { currentBalance: TreasuryMoneyString | null }
): TreasuryCrCpAccountGroupDto {
  return {
    ...partial,
    accountsReceivableTotal: "0.00",
    accountsReceivableCount: 0,
    accountsPayableTotal: "0.00",
    accountsPayableCount: 0,
    netMovement: "0.00",
    projectedBalance: null,
    receivableTitles: [],
    payableTitles: [],
  };
}

function sortTitles(titles: TreasuryCrCpTitleDto[]): TreasuryCrCpTitleDto[] {
  return [...titles].sort((a, b) => {
    if (a.situation !== b.situation) {
      return a.situation === "OVERDUE" ? -1 : 1;
    }
    const byDue = (a.dueDate ?? "").localeCompare(b.dueDate ?? "");
    if (byDue !== 0) return byDue;
    const byDoc = (a.documentNumber ?? "").localeCompare(
      b.documentNumber ?? "",
      "pt-BR"
    );
    if (byDoc !== 0) return byDoc;
    return (a.installmentLabel ?? "").localeCompare(
      b.installmentLabel ?? "",
      "pt-BR"
    );
  });
}

function finalizeGroup(
  group: TreasuryCrCpAccountGroupDto
): TreasuryCrCpAccountGroupDto {
  group.receivableTitles = sortTitles(group.receivableTitles);
  group.payableTitles = sortTitles(group.payableTitles);
  group.netMovement = subtractTreasuryMoney(
    group.accountsReceivableTotal,
    group.accountsPayableTotal
  );
  if (!group.isUnlinked && group.currentBalance != null) {
    group.projectedBalance = addTreasuryMoney(
      group.currentBalance,
      group.netMovement
    );
  } else {
    group.projectedBalance = null;
  }
  return group;
}

/**
 * Agrupa títulos abertos do horizonte por conta local (ou Contas sem vínculo).
 * Cada título cai em exatamente um bucket.
 */
export function buildTreasuryCrCpByAccountBoard(input: {
  fromDate: string;
  toDate: string;
  accounts: readonly TreasuryCrCpLocalAccount[];
  titles: readonly TreasuryCrCpTitleSeed[];
}): TreasuryCrCpByAccountBoardDto {
  const index = buildTreasuryNomusAccountLinkIndex(input.accounts);
  const operational = [...input.accounts]
    .filter((a) => a.isActive && a.includeInConsolidated)
    .sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.name.localeCompare(b.name, "pt-BR");
    });

  const groupsById = new Map<string, TreasuryCrCpAccountGroupDto>();
  for (const acc of operational) {
    groupsById.set(
      acc.id,
      emptyGroup({
        treasuryAccountId: acc.id,
        accountCode: acc.code,
        accountName: acc.name,
        institutionName: acc.institutionName,
        nomusFinancialAccountId: normalizeNomusFinancialAccountId(
          acc.nomusBankAccountId
        ),
        currentBalance: acc.currentBalance != null ? money(acc.currentBalance) : "0.00",
        isUnlinked: false,
      })
    );
  }

  const unlinked = emptyGroup({
    treasuryAccountId: TREASURY_CRCP_UNLINKED_ID,
    accountCode: null,
    accountName: TREASURY_CRCP_UNLINKED_LABEL,
    institutionName: null,
    nomusFinancialAccountId: null,
    currentBalance: null,
    isUnlinked: true,
  });
  groupsById.set(TREASURY_CRCP_UNLINKED_ID, unlinked);

  let loadedReceivableCount = 0;
  let loadedReceivableTotal: TreasuryMoneyString = "0.00";
  let loadedPayableCount = 0;
  let loadedPayableTotal: TreasuryMoneyString = "0.00";
  let linkedReceivableCount = 0;
  let linkedReceivableTotal: TreasuryMoneyString = "0.00";
  let linkedPayableCount = 0;
  let linkedPayableTotal: TreasuryMoneyString = "0.00";
  let unlinkedReceivableCount = 0;
  let unlinkedReceivableTotal: TreasuryMoneyString = "0.00";
  let unlinkedPayableCount = 0;
  let unlinkedPayableTotal: TreasuryMoneyString = "0.00";

  for (const seed of input.titles) {
    const open = money(seed.openBalance);
    if (compareTreasuryMoney(open, "0.00") <= 0) continue;
    if (
      !isTreasuryCrCpTitleInHorizon({
        dueDate: seed.dueDate,
        horizonStart: input.fromDate,
        horizonEnd: input.toDate,
      })
    ) {
      continue;
    }

    const resolution = resolveTreasuryAccountByNomusFinancialAccountId(
      index,
      seed.nomusFinancialAccountId,
      { plannedAccountId: seed.plannedAccountId }
    );

    let bucketId: string;
    let unlinkedReason: TreasuryCrCpUnlinkedReason | null = null;
    if (resolution.kind === "LINKED") {
      bucketId = resolution.accountId;
      if (!groupsById.has(bucketId)) {
        // Conta ativa mas fora do consolidado → sem vínculo operacional
        bucketId = TREASURY_CRCP_UNLINKED_ID;
        unlinkedReason = "INVALID_LINK";
      }
    } else {
      bucketId = TREASURY_CRCP_UNLINKED_ID;
      unlinkedReason = resolution.reason;
    }

    const group = groupsById.get(bucketId)!;
    const effectiveDate = effectiveTreasuryCrCpFlowDate(
      seed.dueDate,
      input.fromDate
    );
    const situation: "OVERDUE" | "UPCOMING" =
      seed.dueDate && seed.dueDate < input.fromDate ? "OVERDUE" : "UPCOMING";

    const nomusId = normalizeNomusFinancialAccountId(
      seed.nomusFinancialAccountId
    );
    const title: TreasuryCrCpTitleDto = {
      id: seed.id,
      side: seed.side,
      dueDate: seed.dueDate,
      effectiveDate,
      situation,
      counterpartyName: seed.counterpartyName,
      documentNumber: seed.documentNumber,
      installmentLabel: seed.installmentLabel,
      originalAmount: money(seed.originalAmount),
      settledAmount: money(seed.settledAmount),
      openBalance: open,
      nomusFinancialAccountId: nomusId,
      nomusFinancialAccountName: seed.nomusFinancialAccountName,
      destinationBucketId: bucketId,
      destinationBucketLabel: group.accountName,
      unlinkedReason,
      unlinkedReasonLabel: unlinkedReason
        ? TREASURY_CRCP_UNLINKED_REASON_LABELS[unlinkedReason]
        : null,
    };

    if (seed.side === "RECEIVABLE") {
      loadedReceivableCount += 1;
      loadedReceivableTotal = addTreasuryMoney(loadedReceivableTotal, open);
      group.accountsReceivableTotal = addTreasuryMoney(
        group.accountsReceivableTotal,
        open
      );
      group.accountsReceivableCount += 1;
      group.receivableTitles.push(title);
      if (bucketId === TREASURY_CRCP_UNLINKED_ID) {
        unlinkedReceivableCount += 1;
        unlinkedReceivableTotal = addTreasuryMoney(
          unlinkedReceivableTotal,
          open
        );
      } else {
        linkedReceivableCount += 1;
        linkedReceivableTotal = addTreasuryMoney(linkedReceivableTotal, open);
      }
    } else {
      loadedPayableCount += 1;
      loadedPayableTotal = addTreasuryMoney(loadedPayableTotal, open);
      group.accountsPayableTotal = addTreasuryMoney(
        group.accountsPayableTotal,
        open
      );
      group.accountsPayableCount += 1;
      group.payableTitles.push(title);
      if (bucketId === TREASURY_CRCP_UNLINKED_ID) {
        unlinkedPayableCount += 1;
        unlinkedPayableTotal = addTreasuryMoney(unlinkedPayableTotal, open);
      } else {
        linkedPayableCount += 1;
        linkedPayableTotal = addTreasuryMoney(linkedPayableTotal, open);
      }
    }
  }

  const groups: TreasuryCrCpAccountGroupDto[] = [];
  for (const acc of operational) {
    groups.push(finalizeGroup(groupsById.get(acc.id)!));
  }
  const unlinkedFinal = finalizeGroup(groupsById.get(TREASURY_CRCP_UNLINKED_ID)!);
  if (
    unlinkedFinal.accountsReceivableCount > 0 ||
    unlinkedFinal.accountsPayableCount > 0
  ) {
    groups.push(unlinkedFinal);
  }

  const totals = {
    accountsReceivableTotal: "0.00" as TreasuryMoneyString,
    accountsReceivableCount: 0,
    accountsPayableTotal: "0.00" as TreasuryMoneyString,
    accountsPayableCount: 0,
    netMovement: "0.00" as TreasuryMoneyString,
  };
  for (const g of groups) {
    totals.accountsReceivableTotal = addTreasuryMoney(
      totals.accountsReceivableTotal,
      g.accountsReceivableTotal
    );
    totals.accountsPayableTotal = addTreasuryMoney(
      totals.accountsPayableTotal,
      g.accountsPayableTotal
    );
    totals.accountsReceivableCount += g.accountsReceivableCount;
    totals.accountsPayableCount += g.accountsPayableCount;
  }
  totals.netMovement = subtractTreasuryMoney(
    totals.accountsReceivableTotal,
    totals.accountsPayableTotal
  );

  const receivableDiff = subtractTreasuryMoney(
    loadedReceivableTotal,
    addTreasuryMoney(linkedReceivableTotal, unlinkedReceivableTotal)
  );
  const payableDiff = subtractTreasuryMoney(
    loadedPayableTotal,
    addTreasuryMoney(linkedPayableTotal, unlinkedPayableTotal)
  );

  return {
    fromDate: input.fromDate,
    toDate: input.toDate,
    groups,
    totals,
    diagnostics: {
      loadedReceivableCount,
      loadedReceivableTotal,
      loadedPayableCount,
      loadedPayableTotal,
      linkedReceivableCount,
      linkedReceivableTotal,
      linkedPayableCount,
      linkedPayableTotal,
      unlinkedReceivableCount,
      unlinkedReceivableTotal,
      unlinkedPayableCount,
      unlinkedPayableTotal,
      receivableDiff,
      payableDiff,
    },
  };
}

/**
 * Valida se o Nomus ID já está vinculado a outra conta local ativa.
 * Retorna a conta conflitante ou null.
 */
export function findActiveDuplicateNomusBankAccountLink(input: {
  accounts: readonly Pick<
    TreasuryCrCpLocalAccount,
    "id" | "name" | "isActive" | "nomusBankAccountId"
  >[];
  nomusBankAccountId: string | number | null | undefined;
  excludeAccountId?: string | null;
}): { id: string; name: string; nomusBankAccountId: string } | null {
  const nomusId = normalizeNomusFinancialAccountId(input.nomusBankAccountId);
  if (!nomusId) return null;
  for (const acc of input.accounts) {
    if (!acc.isActive) continue;
    if (input.excludeAccountId && acc.id === input.excludeAccountId) continue;
    const other = normalizeNomusFinancialAccountId(acc.nomusBankAccountId);
    if (other === nomusId) {
      return {
        id: acc.id,
        name: acc.name,
        nomusBankAccountId: nomusId,
      };
    }
  }
  return null;
}
