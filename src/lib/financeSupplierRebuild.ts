import { Prisma } from "@prisma/client";
import { decimalFieldToNumber } from "@/src/lib/financeAccountsPayableDashboard.js";
import {
  FINANCE_SUPPLIER_REBUILD_AUDIT_ACTION,
  FINANCE_SUPPLIER_REBUILD_AUDIT_ENTITY,
  FINANCE_SUPPLIER_REBUILD_CONFIRMATION_TEXT,
} from "@/src/lib/financeSupplierRebuildShared.js";
import {
  detectPotentialSupplierDuplicates,
  extractSupplierFromAccountsPayable,
  groupAccountsPayableSuppliers,
  normalizeSupplierDocument,
  normalizeSupplierName,
  type AccountsPayableSupplierRecord,
  type FinanceSupplierApGroup,
  type FinanceSupplierDuplicateHint,
} from "@/src/lib/financeSupplierIdentity.js";
import { prisma } from "@/src/lib/prisma.js";

export class FinanceSupplierRebuildError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "FinanceSupplierRebuildError";
    this.code = code;
  }
}

export type FinanceSupplierRebuildApRow = AccountsPayableSupplierRecord & {
  amountPayable?: number;
  balancePayable?: number;
};

export type ExistingFinancialSupplierRow = {
  id: string;
  displayName: string;
  legalName: string | null;
  tradeName: string | null;
  document: string | null;
  normalizedDocument: string | null;
  normalizedName: string | null;
  source: "AUTO_SYNC" | "MANUAL" | "IMPORT" | "NOMUS_BOOTSTRAP";
  status: "ACTIVE" | "NEEDS_REVIEW" | "MERGED" | "INACTIVE";
  confidence: Prisma.Decimal | null;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  titlesCount: number;
  totalAmountSeen: Prisma.Decimal;
  aliases: ExistingFinancialSupplierAliasRow[];
};

export type ExistingFinancialSupplierAliasRow = {
  id: string;
  supplierId: string;
  source: "AUTO_SYNC" | "MANUAL" | "IMPORT" | "NOMUS_BOOTSTRAP";
  externalSupplierId: number | null;
  originalName: string | null;
  originalDocument: string | null;
  normalizedName: string | null;
  normalizedDocument: string | null;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  titlesCount: number;
};

/**
 * Ação de remediação do documento (CNPJ/CPF) de um fornecedor a partir da
 * evidência oficial (títulos AP + espelho de Pedidos Nomus), SEM inventar dado:
 * - SAFE_FILL: documento ausente no cadastro, exatamente UM candidato válido,
 *   amarrado a este fornecedor pelo externalSupplierId (alias) e sem outro
 *   fornecedor dono do mesmo documento → preencher (aditivo, auditado).
 * - NO_CHANGE: cadastro já tem o mesmo documento (ou nenhuma evidência nova).
 * - CONFLICT: candidatos distintos, documento existente diferente da evidência
 *   ou documento já pertencente a outro fornecedor → diagnóstico, nada muda.
 * - UNRESOLVED: sem evidência, evidência inválida ou sem vínculo oficial
 *   (nome sozinho NUNCA autoriza).
 */
export type FinanceSupplierDocumentEnrichmentAction =
  | "SAFE_FILL"
  | "NO_CHANGE"
  | "CONFLICT"
  | "UNRESOLVED";

export type FinanceSupplierDocumentEnrichmentPlan = {
  action: FinanceSupplierDocumentEnrichmentAction;
  currentDocument: string | null;
  currentNormalizedDocument: string | null;
  proposedDocument: string | null;
  proposedNormalizedDocument: string | null;
  externalSupplierId: number | null;
  documentCandidates: string[];
  evidence: string[];
  conflicts: string[];
};

export type FinanceSupplierRebuildPreviewItem = {
  identityKey: string;
  displayName: string;
  normalizedDocument: string | null;
  normalizedName: string | null;
  externalSupplierId: number | null;
  confidence: string;
  titlesCount: number;
  totalAmount: number;
  existingSupplierId: string | null;
  action: "create" | "update" | "stats_only" | "skip";
  statsOnlyBecauseManual: boolean;
  documentEnrichment: FinanceSupplierDocumentEnrichmentPlan;
};

/** Linha do espelho de Pedidos Nomus usada como evidência adicional de documento. */
export type NomusOrderSupplierDocumentRow = {
  supplierExternalId: number | null;
  supplierTaxId: string | null;
};

export type FinanceSupplierRebuildTopSupplier = {
  identityKey: string;
  displayName: string;
  titlesCount: number;
  totalAmount: number;
};

export type FinanceSupplierRebuildSummary = {
  totalTitlesAnalyzed: number;
  suppliersDetected: number;
  newSuppliers: number;
  updatedSuppliers: number;
  statsOnlyUpdates: number;
  skippedSuppliers: number;
  newAliases: number;
  updatedAliases: number;
  unidentifiableRecords: number;
  /** Documentos que podem ser preenchidos com segurança (SAFE_FILL). */
  documentSafeFills: number;
  /** Grupos com evidência de documento conflitante (CONFLICT) — nunca aplicados. */
  documentConflicts: number;
  /** Grupos sem evidência/vínculo oficial suficiente (UNRESOLVED). */
  documentUnresolved: number;
  potentialDuplicates: FinanceSupplierDuplicateHint[];
  topSuppliersByAmount: FinanceSupplierRebuildTopSupplier[];
  topSuppliersByCount: FinanceSupplierRebuildTopSupplier[];
  warnings: string[];
};

export type FinanceSupplierRebuildPreviewPayload = FinanceSupplierRebuildSummary & {
  items: FinanceSupplierRebuildPreviewItem[];
  requiredConfirmationText: string;
};

export type FinanceSupplierRebuildApplyResult = FinanceSupplierRebuildSummary & {
  ok: true;
  appliedAt: string;
};

export type FinanceSupplierRebuildUserContext = {
  userId: string | null;
  userName: string | null;
};

export type FinanceSupplierRebuildDeps = {
  loadApRows: () => Promise<FinanceSupplierRebuildApRow[]>;
  loadExistingSuppliers: () => Promise<ExistingFinancialSupplierRow[]>;
  /**
   * Evidência adicional de documento por supplierExternalId (espelho de Pedidos
   * Nomus, agregado — uma consulta, sem varrer pedido a pedido). Opcional: sem
   * ela, só os títulos AP contam.
   */
  loadNomusOrderSupplierDocuments?: () => Promise<NomusOrderSupplierDocumentRow[]>;
  createSupplier: (data: Prisma.FinancialSupplierCreateInput) => Promise<ExistingFinancialSupplierRow>;
  updateSupplier: (
    id: string,
    data: Prisma.FinancialSupplierUpdateInput
  ) => Promise<ExistingFinancialSupplierRow>;
  createAlias: (data: Prisma.FinancialSupplierAliasCreateInput) => Promise<ExistingFinancialSupplierAliasRow>;
  updateAlias: (
    id: string,
    data: Prisma.FinancialSupplierAliasUpdateInput
  ) => Promise<ExistingFinancialSupplierAliasRow>;
  createAuditLog: (data: {
    entityType: string;
    entityId: string;
    action: string;
    beforeJson?: Prisma.InputJsonValue | null;
    afterJson?: Prisma.InputJsonValue | null;
    userId?: string | null;
    userName?: string | null;
  }) => Promise<void>;
};

const FINANCE_SUPPLIER_REBUILD_AP_SELECT = {
  externalId: true,
  personId: true,
  personName: true,
  personCnpj: true,
  companyId: true,
  companyName: true,
  rawPayload: true,
  amountPayable: true,
  balancePayable: true,
} as const;

const TOP_LIMIT = 50;

function confidenceToDecimal(level: string): Prisma.Decimal {
  if (level === "HIGH") return new Prisma.Decimal(90);
  if (level === "MEDIUM") return new Prisma.Decimal(70);
  return new Prisma.Decimal(40);
}

function decimalToNumber(value: Prisma.Decimal | number | null | undefined): number {
  if (value == null) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  return decimalFieldToNumber(value);
}

export function pickDisplayName(group: FinanceSupplierApGroup): string {
  const fromRecords = group.records
    .map((r) => (r.personName ?? "").trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)[0];
  return fromRecords ?? group.extracted.originalName ?? group.identityKey;
}

function isRebuildEligibleGroup(group: FinanceSupplierApGroup): boolean {
  return !group.identityKey.startsWith("ap-fallback:");
}

function computeGroupAmount(group: FinanceSupplierApGroup): number {
  let total = 0;
  for (const row of group.records) {
    const apRow = row as FinanceSupplierRebuildApRow;
    const amount =
      typeof apRow.amountPayable === "number"
        ? apRow.amountPayable
        : typeof apRow.balancePayable === "number"
          ? apRow.balancePayable
          : 0;
    total += Math.abs(amount);
  }
  return total;
}

function computeSeenBounds(group: FinanceSupplierApGroup): { firstSeenAt: Date; lastSeenAt: Date } {
  const now = new Date();
  return { firstSeenAt: now, lastSeenAt: now };
}

export function assertFinanceSupplierRebuildConfirmation(confirmation: unknown): void {
  const text = typeof confirmation === "string" ? confirmation.trim() : "";
  if (text !== FINANCE_SUPPLIER_REBUILD_CONFIRMATION_TEXT) {
    throw new FinanceSupplierRebuildError(
      "INVALID_CONFIRMATION",
      `Confirmação inválida — envie confirmationText exatamente igual a: "${FINANCE_SUPPLIER_REBUILD_CONFIRMATION_TEXT}".`
    );
  }
}

export type SupplierMatchIndex = {
  byExternalId: Map<number, ExistingFinancialSupplierRow>;
  byDocument: Map<string, ExistingFinancialSupplierRow>;
  byName: Map<string, ExistingFinancialSupplierRow>;
};

export function buildSupplierMatchIndex(
  suppliers: ExistingFinancialSupplierRow[]
): SupplierMatchIndex {
  const byExternalId = new Map<number, ExistingFinancialSupplierRow>();
  const byDocument = new Map<string, ExistingFinancialSupplierRow>();
  const byName = new Map<string, ExistingFinancialSupplierRow>();

  for (const supplier of suppliers) {
    if (supplier.status === "MERGED" || supplier.status === "INACTIVE") continue;

    if (supplier.normalizedDocument && !byDocument.has(supplier.normalizedDocument)) {
      byDocument.set(supplier.normalizedDocument, supplier);
    }
    if (supplier.normalizedName && !byName.has(supplier.normalizedName)) {
      byName.set(supplier.normalizedName, supplier);
    }
    for (const alias of supplier.aliases) {
      if (alias.externalSupplierId != null && !byExternalId.has(alias.externalSupplierId)) {
        byExternalId.set(alias.externalSupplierId, supplier);
      }
      if (alias.normalizedDocument && !byDocument.has(alias.normalizedDocument)) {
        byDocument.set(alias.normalizedDocument, supplier);
      }
      if (alias.normalizedName && !byName.has(alias.normalizedName)) {
        byName.set(alias.normalizedName, supplier);
      }
    }
  }

  return { byExternalId, byDocument, byName };
}

export function findExistingSupplierForGroup(
  group: FinanceSupplierApGroup,
  index: SupplierMatchIndex
): ExistingFinancialSupplierRow | null {
  const { extracted } = group;
  if (extracted.externalSupplierId != null) {
    const hit = index.byExternalId.get(extracted.externalSupplierId);
    if (hit) return hit;
  }
  if (extracted.normalizedDocument) {
    const hit = index.byDocument.get(extracted.normalizedDocument);
    if (hit) return hit;
  }
  if (extracted.normalizedName) {
    const hit = index.byName.get(extracted.normalizedName);
    if (hit) return hit;
  }
  return null;
}

export function isManualLockedSupplier(supplier: ExistingFinancialSupplierRow): boolean {
  return supplier.source === "MANUAL";
}

export function buildSupplierRebuildSummary(input: {
  totalTitlesAnalyzed: number;
  groups: FinanceSupplierApGroup[];
  previewItems: FinanceSupplierRebuildPreviewItem[];
  newAliases: number;
  updatedAliases: number;
  duplicates: FinanceSupplierDuplicateHint[];
  warnings: string[];
}): FinanceSupplierRebuildSummary {
  const eligible = input.groups.filter(isRebuildEligibleGroup);
  const unidentifiableRecords = input.groups
    .filter((g) => !isRebuildEligibleGroup(g))
    .reduce((sum, g) => sum + g.recordCount, 0);

  const topBase = eligible.map((group) => ({
    identityKey: group.identityKey,
    displayName: pickDisplayName(group),
    titlesCount: group.recordCount,
    totalAmount: computeGroupAmount(group),
  }));

  const topSuppliersByAmount = [...topBase]
    .sort((a, b) => b.totalAmount - a.totalAmount || b.titlesCount - a.titlesCount)
    .slice(0, TOP_LIMIT);

  const topSuppliersByCount = [...topBase]
    .sort((a, b) => b.titlesCount - a.titlesCount || b.totalAmount - a.totalAmount)
    .slice(0, TOP_LIMIT);

  return {
    totalTitlesAnalyzed: input.totalTitlesAnalyzed,
    suppliersDetected: eligible.length,
    newSuppliers: input.previewItems.filter((i) => i.action === "create").length,
    updatedSuppliers: input.previewItems.filter((i) => i.action === "update").length,
    statsOnlyUpdates: input.previewItems.filter((i) => i.action === "stats_only").length,
    skippedSuppliers: input.previewItems.filter((i) => i.action === "skip").length,
    newAliases: input.newAliases,
    updatedAliases: input.updatedAliases,
    unidentifiableRecords,
    documentSafeFills: input.previewItems.filter(
      (i) => i.documentEnrichment.action === "SAFE_FILL"
    ).length,
    documentConflicts: input.previewItems.filter(
      (i) => i.documentEnrichment.action === "CONFLICT"
    ).length,
    documentUnresolved: input.previewItems.filter(
      (i) => i.documentEnrichment.action === "UNRESOLVED"
    ).length,
    potentialDuplicates: input.duplicates,
    topSuppliersByAmount,
    topSuppliersByCount,
    warnings: input.warnings,
  };
}

const VALID_SUPPLIER_DOCUMENT_LENGTHS = new Set([11, 14]);

/** Índice supplierExternalId → documentos normalizados distintos vistos nos Pedidos Nomus. */
export function buildNomusOrderDocumentIndex(
  rows: readonly NomusOrderSupplierDocumentRow[]
): Map<number, string[]> {
  const sets = new Map<number, Set<string>>();
  for (const row of rows) {
    if (row.supplierExternalId == null || !Number.isFinite(row.supplierExternalId)) continue;
    const normalized = normalizeSupplierDocument(row.supplierTaxId);
    if (!normalized) continue;
    const set = sets.get(row.supplierExternalId) ?? new Set<string>();
    set.add(normalized);
    sets.set(row.supplierExternalId, set);
  }
  const index = new Map<number, string[]>();
  for (const [id, set] of sets) index.set(id, [...set].sort());
  return index;
}

function currentNormalizedDocumentOf(existing: ExistingFinancialSupplierRow | null): string | null {
  if (!existing) return null;
  return existing.normalizedDocument ?? normalizeSupplierDocument(existing.document);
}

/** Grafia proposta: a observada no AP quando corresponde ao candidato; senão os dígitos. */
function proposedSpellingFor(group: FinanceSupplierApGroup, normalized: string): string {
  const original = group.extracted.originalDocument?.trim();
  if (original && normalizeSupplierDocument(original) === normalized) return original;
  return normalized;
}

/**
 * Plano puro de remediação do documento — ver FinanceSupplierDocumentEnrichmentAction.
 * `index` é o índice de matching dos fornecedores ATIVOS (dono do documento /
 * do externalSupplierId). Sem índice (null) não há como provar a ausência de
 * outro dono: SAFE_FILL é rebaixado para UNRESOLVED (fail closed).
 */
export function planSupplierDocumentEnrichment(input: {
  existing: ExistingFinancialSupplierRow | null;
  group: FinanceSupplierApGroup;
  index: SupplierMatchIndex | null;
  nomusDocumentsByExternalId?: Map<number, string[]> | null;
}): FinanceSupplierDocumentEnrichmentPlan {
  const { existing, group, index } = input;
  const externalSupplierId = group.extracted.externalSupplierId;
  const apCandidates = group.documentCandidates;
  const nomusCandidates =
    externalSupplierId != null
      ? input.nomusDocumentsByExternalId?.get(externalSupplierId) ?? []
      : [];
  const candidates = [...new Set([...apCandidates, ...nomusCandidates])].sort();

  const evidence: string[] = [];
  if (externalSupplierId != null) evidence.push(`EXTERNAL_SUPPLIER_ID:${externalSupplierId}`);
  for (const doc of apCandidates) evidence.push(`AP_DOCUMENT:${doc}`);
  for (const doc of nomusCandidates) evidence.push(`NOMUS_ORDER_DOCUMENT:${doc}`);

  const currentDocument = existing?.document ?? null;
  const currentNormalizedDocument = currentNormalizedDocumentOf(existing);
  const base = {
    currentDocument,
    currentNormalizedDocument,
    proposedDocument: null,
    proposedNormalizedDocument: null,
    externalSupplierId,
    documentCandidates: candidates,
    evidence,
  };
  const finish = (
    action: FinanceSupplierDocumentEnrichmentAction,
    conflicts: string[] = [],
    proposed: string | null = null
  ): FinanceSupplierDocumentEnrichmentPlan => ({
    ...base,
    action,
    conflicts,
    proposedDocument: proposed,
    proposedNormalizedDocument: proposed ? normalizeSupplierDocument(proposed) : null,
  });

  if (candidates.length > 1) {
    return finish("CONFLICT", [`CONFLICTING_DOCUMENTS:${candidates.join("|")}`]);
  }
  if (candidates.length === 0) {
    if (currentNormalizedDocument) return finish("NO_CHANGE");
    return finish("UNRESOLVED", ["NO_DOCUMENT_EVIDENCE"]);
  }

  const candidate = candidates[0]!;
  if (currentNormalizedDocument === candidate) return finish("NO_CHANGE");
  if (currentNormalizedDocument) {
    return finish("CONFLICT", [
      `EXISTING_DOCUMENT_DIFFERS:${currentNormalizedDocument}<>${candidate}`,
    ]);
  }
  if (!VALID_SUPPLIER_DOCUMENT_LENGTHS.has(candidate.length)) {
    return finish("UNRESOLVED", [`INVALID_DOCUMENT:${candidate}`]);
  }
  if (!index) {
    return finish("UNRESOLVED", ["OWNERSHIP_INDEX_UNAVAILABLE"]);
  }

  const owner = index.byDocument.get(candidate);
  if (owner && (!existing || owner.id !== existing.id)) {
    return finish("CONFLICT", [`DOCUMENT_OWNED_BY_OTHER_SUPPLIER:${owner.id}`]);
  }

  if (existing) {
    // Vínculo OFICIAL obrigatório: o grupo precisa estar amarrado a ESTE
    // fornecedor pelo externalSupplierId (alias). Nome sozinho nunca autoriza.
    if (externalSupplierId == null) {
      return finish("UNRESOLVED", ["NO_OFFICIAL_IDENTITY_LINK"]);
    }
    const linked = index.byExternalId.get(externalSupplierId);
    if (!linked || linked.id !== existing.id) {
      return finish("UNRESOLVED", [`EXTERNAL_ID_NOT_LINKED_TO_SUPPLIER:${externalSupplierId}`]);
    }
  }

  return finish("SAFE_FILL", [], proposedSpellingFor(group, candidate));
}

function buildPreviewItems(
  groups: FinanceSupplierApGroup[],
  index: SupplierMatchIndex,
  nomusDocumentsByExternalId: Map<number, string[]>
): FinanceSupplierRebuildPreviewItem[] {
  const items: FinanceSupplierRebuildPreviewItem[] = [];

  for (const group of groups) {
    if (!isRebuildEligibleGroup(group)) continue;

    const existing = findExistingSupplierForGroup(group, index);
    const statsOnlyBecauseManual = existing != null && isManualLockedSupplier(existing);

    let action: FinanceSupplierRebuildPreviewItem["action"] = "create";
    if (existing) {
      action = statsOnlyBecauseManual ? "stats_only" : "update";
    }

    items.push({
      identityKey: group.identityKey,
      displayName: pickDisplayName(group),
      normalizedDocument: group.extracted.normalizedDocument,
      normalizedName: group.extracted.normalizedName,
      externalSupplierId: group.extracted.externalSupplierId,
      confidence: group.extracted.confidence,
      titlesCount: group.recordCount,
      totalAmount: computeGroupAmount(group),
      existingSupplierId: existing?.id ?? null,
      action,
      statsOnlyBecauseManual,
      documentEnrichment: planSupplierDocumentEnrichment({
        existing,
        group,
        index,
        nomusDocumentsByExternalId,
      }),
    });
  }

  return items;
}

async function loadNomusDocumentIndex(
  deps: FinanceSupplierRebuildDeps
): Promise<Map<number, string[]>> {
  if (!deps.loadNomusOrderSupplierDocuments) return new Map();
  return buildNomusOrderDocumentIndex(await deps.loadNomusOrderSupplierDocuments());
}

function countAliasChanges(
  groups: FinanceSupplierApGroup[],
  index: SupplierMatchIndex
): { newAliases: number; updatedAliases: number } {
  let newAliases = 0;
  let updatedAliases = 0;

  for (const group of groups) {
    if (!isRebuildEligibleGroup(group)) continue;
    const supplier = findExistingSupplierForGroup(group, index);
    if (!supplier && group.extracted.source === "FALLBACK") continue;

    for (const record of group.records) {
      const extracted = extractSupplierFromAccountsPayable(record);
      const existingAlias = supplier
        ? findMatchingAlias(supplier.aliases, extracted, record.externalId)
        : null;
      if (existingAlias) updatedAliases += 1;
      else newAliases += 1;
    }
  }

  return { newAliases, updatedAliases };
}

function findMatchingAlias(
  aliases: ExistingFinancialSupplierAliasRow[],
  extracted: ReturnType<typeof extractSupplierFromAccountsPayable>,
  accountsPayableExternalId: number
): ExistingFinancialSupplierAliasRow | null {
  for (const alias of aliases) {
    if (
      extracted.externalSupplierId != null &&
      alias.externalSupplierId === extracted.externalSupplierId
    ) {
      const aliasName = alias.normalizedName ?? normalizeSupplierName(alias.originalName);
      const extractedName = extracted.normalizedName;
      if (aliasName === extractedName) return alias;
      continue;
    }
    if (
      extracted.normalizedDocument &&
      alias.normalizedDocument === extracted.normalizedDocument &&
      (alias.normalizedName ?? null) === (extracted.normalizedName ?? null)
    ) {
      return alias;
    }
    if (
      !extracted.normalizedDocument &&
      extracted.normalizedName &&
      alias.normalizedName === extracted.normalizedName
    ) {
      return alias;
    }
    if (
      !extracted.externalSupplierId &&
      !extracted.normalizedDocument &&
      !extracted.normalizedName &&
      alias.originalName === `AP:${accountsPayableExternalId}`
    ) {
      return alias;
    }
  }
  return null;
}

export async function buildFinancialSuppliersFromAccountsPayablePreview(
  deps: FinanceSupplierRebuildDeps
): Promise<FinanceSupplierRebuildPreviewPayload> {
  const apRows = await deps.loadApRows();
  const existing = await deps.loadExistingSuppliers();
  const index = buildSupplierMatchIndex(existing);
  const groups = groupAccountsPayableSuppliers(apRows);
  const duplicates = detectPotentialSupplierDuplicates(groups);
  const nomusDocumentsByExternalId = await loadNomusDocumentIndex(deps);
  const previewItems = buildPreviewItems(groups, index, nomusDocumentsByExternalId);
  const aliasCounts = countAliasChanges(groups, index);

  const warnings: string[] = [];
  if (duplicates.length > 0) {
    warnings.push(`POTENTIAL_DUPLICATES:${duplicates.length}`);
  }
  if (groups.some((g) => !isRebuildEligibleGroup(g))) {
    warnings.push("UNIDENTIFIABLE_AP_RECORDS_PRESENT");
  }
  const documentConflicts = previewItems.filter(
    (item) => item.documentEnrichment.action === "CONFLICT"
  ).length;
  if (documentConflicts > 0) {
    warnings.push(`DOCUMENT_CONFLICTS:${documentConflicts}`);
  }

  const summary = buildSupplierRebuildSummary({
    totalTitlesAnalyzed: apRows.length,
    groups,
    previewItems,
    newAliases: aliasCounts.newAliases,
    updatedAliases: aliasCounts.updatedAliases,
    duplicates,
    warnings,
  });

  return {
    ...summary,
    items: previewItems,
    requiredConfirmationText: FINANCE_SUPPLIER_REBUILD_CONFIRMATION_TEXT,
  };
}

export type UpsertFinancialSupplierFromGroupOptions = {
  /** Índice de matching dos fornecedores atuais — obrigatório para provar que nenhum outro fornecedor é dono do documento. */
  index: SupplierMatchIndex;
  /** Plano já calculado (apply/preview); ausente → calculado aqui com o índice. */
  enrichment?: FinanceSupplierDocumentEnrichmentPlan;
  nomusDocumentsByExternalId?: Map<number, string[]> | null;
};

export type UpsertFinancialSupplierFromGroupResult = {
  supplier: ExistingFinancialSupplierRow;
  action: "create" | "update" | "stats_only";
  documentEnrichment: FinanceSupplierDocumentEnrichmentPlan;
};

async function auditDocumentEnrichment(
  deps: FinanceSupplierRebuildDeps,
  before: ExistingFinancialSupplierRow,
  after: ExistingFinancialSupplierRow,
  plan: FinanceSupplierDocumentEnrichmentPlan,
  user: FinanceSupplierRebuildUserContext
): Promise<void> {
  await deps.createAuditLog({
    entityType: FINANCE_SUPPLIER_REBUILD_AUDIT_ENTITY.SUPPLIER,
    entityId: after.id,
    action: FINANCE_SUPPLIER_REBUILD_AUDIT_ACTION.DOCUMENT_ENRICH,
    beforeJson: {
      document: before.document,
      normalizedDocument: before.normalizedDocument,
    },
    afterJson: {
      document: after.document,
      normalizedDocument: after.normalizedDocument,
      externalSupplierId: plan.externalSupplierId,
      evidence: plan.evidence,
    },
    userId: user.userId,
    userName: user.userName,
  });
}

/**
 * Cria/atualiza o FinancialSupplier de um grupo AP.
 *
 * Documento: NUNCA sobrescreve um documento existente diferente nem apaga o
 * existente quando o AP não traz documento. Só escreve documento quando o
 * plano de remediação é SAFE_FILL (aditivo, auditado como DOCUMENT_ENRICH).
 * Fornecedor MANUAL continua stats_only para nome/status/origem — mas recebe o
 * preenchimento aditivo do documento quando (e só quando) é SAFE_FILL.
 */
export async function upsertFinancialSupplierFromGroup(
  deps: FinanceSupplierRebuildDeps,
  group: FinanceSupplierApGroup,
  existing: ExistingFinancialSupplierRow | null,
  user: FinanceSupplierRebuildUserContext,
  options: UpsertFinancialSupplierFromGroupOptions
): Promise<UpsertFinancialSupplierFromGroupResult> {
  const displayName = pickDisplayName(group);
  const { extracted } = group;
  const amount = computeGroupAmount(group);
  const bounds = computeSeenBounds(group);
  const plan =
    options.enrichment ??
    planSupplierDocumentEnrichment({
      existing,
      group,
      index: options.index,
      nomusDocumentsByExternalId: options.nomusDocumentsByExternalId ?? null,
    });
  const safeFill = plan.action === "SAFE_FILL" && plan.proposedDocument != null;
  const documentPatch = safeFill
    ? {
        document: plan.proposedDocument,
        normalizedDocument: plan.proposedNormalizedDocument,
      }
    : {};

  if (existing && isManualLockedSupplier(existing)) {
    const before = serializeSupplier(existing);
    const updated = await deps.updateSupplier(existing.id, {
      titlesCount: group.recordCount,
      totalAmountSeen: new Prisma.Decimal(amount),
      firstSeenAt: existing.firstSeenAt ?? bounds.firstSeenAt,
      lastSeenAt: bounds.lastSeenAt,
      ...documentPatch,
    });
    await deps.createAuditLog({
      entityType: FINANCE_SUPPLIER_REBUILD_AUDIT_ENTITY.SUPPLIER,
      entityId: updated.id,
      action: FINANCE_SUPPLIER_REBUILD_AUDIT_ACTION.STATS_UPDATE,
      beforeJson: before,
      afterJson: serializeSupplier(updated),
      userId: user.userId,
      userName: user.userName,
    });
    if (safeFill) await auditDocumentEnrichment(deps, existing, updated, plan, user);
    return { supplier: updated, action: "stats_only", documentEnrichment: plan };
  }

  if (existing) {
    const effectiveNormalizedDocument = safeFill
      ? plan.proposedNormalizedDocument
      : currentNormalizedDocumentOf(existing);
    const status =
      (extracted.confidence === "LOW" || group.documentConflict) && !effectiveNormalizedDocument
        ? "NEEDS_REVIEW"
        : "ACTIVE";
    const before = serializeSupplier(existing);
    const updated = await deps.updateSupplier(existing.id, {
      displayName,
      legalName: displayName,
      tradeName: extracted.originalName,
      normalizedName: extracted.normalizedName,
      source: "NOMUS_BOOTSTRAP",
      status,
      confidence: confidenceToDecimal(extracted.confidence),
      titlesCount: group.recordCount,
      totalAmountSeen: new Prisma.Decimal(amount),
      firstSeenAt: existing.firstSeenAt ?? bounds.firstSeenAt,
      lastSeenAt: bounds.lastSeenAt,
      ...documentPatch,
    });
    await deps.createAuditLog({
      entityType: FINANCE_SUPPLIER_REBUILD_AUDIT_ENTITY.SUPPLIER,
      entityId: updated.id,
      action: FINANCE_SUPPLIER_REBUILD_AUDIT_ACTION.UPDATE,
      beforeJson: before,
      afterJson: serializeSupplier(updated),
      userId: user.userId,
      userName: user.userName,
    });
    if (safeFill) await auditDocumentEnrichment(deps, existing, updated, plan, user);
    return { supplier: updated, action: "update", documentEnrichment: plan };
  }

  const status =
    (extracted.confidence === "LOW" || group.documentConflict) && !safeFill
      ? "NEEDS_REVIEW"
      : "ACTIVE";
  const created = await deps.createSupplier({
    displayName,
    legalName: displayName,
    tradeName: extracted.originalName,
    document: safeFill ? plan.proposedDocument : null,
    normalizedDocument: safeFill ? plan.proposedNormalizedDocument : null,
    normalizedName: extracted.normalizedName,
    source: "NOMUS_BOOTSTRAP",
    status,
    confidence: confidenceToDecimal(extracted.confidence),
    titlesCount: group.recordCount,
    totalAmountSeen: new Prisma.Decimal(amount),
    firstSeenAt: bounds.firstSeenAt,
    lastSeenAt: bounds.lastSeenAt,
  });

  await deps.createAuditLog({
    entityType: FINANCE_SUPPLIER_REBUILD_AUDIT_ENTITY.SUPPLIER,
    entityId: created.id,
    action: FINANCE_SUPPLIER_REBUILD_AUDIT_ACTION.CREATE,
    afterJson: serializeSupplier(created),
    userId: user.userId,
    userName: user.userName,
  });

  return { supplier: created, action: "create", documentEnrichment: plan };
}

export async function upsertFinancialSupplierAliases(
  deps: FinanceSupplierRebuildDeps,
  supplier: ExistingFinancialSupplierRow,
  group: FinanceSupplierApGroup,
  user: FinanceSupplierRebuildUserContext
): Promise<{ newAliases: number; updatedAliases: number }> {
  let newAliases = 0;
  let updatedAliases = 0;

  for (const record of group.records) {
    const extracted = extractSupplierFromAccountsPayable(record);
    const existingAlias = findMatchingAlias(supplier.aliases, extracted, record.externalId);
    const bounds = computeSeenBounds(group);

    if (existingAlias) {
      const before = serializeAlias(existingAlias);
      const updated = await deps.updateAlias(existingAlias.id, {
        originalName: extracted.originalName,
        originalDocument: extracted.originalDocument,
        normalizedName: extracted.normalizedName,
        normalizedDocument: extracted.normalizedDocument,
        externalSupplierId: extracted.externalSupplierId,
        source: "AUTO_SYNC",
        titlesCount: 1,
        lastSeenAt: bounds.lastSeenAt,
      });
      const idx = supplier.aliases.findIndex((a) => a.id === existingAlias.id);
      if (idx >= 0) supplier.aliases[idx] = updated;
      updatedAliases += 1;
      await deps.createAuditLog({
        entityType: FINANCE_SUPPLIER_REBUILD_AUDIT_ENTITY.SUPPLIER_ALIAS,
        entityId: updated.id,
        action: FINANCE_SUPPLIER_REBUILD_AUDIT_ACTION.UPDATE,
        beforeJson: before,
        afterJson: serializeAlias(updated),
        userId: user.userId,
        userName: user.userName,
      });
      continue;
    }

    const created = await deps.createAlias({
      supplier: { connect: { id: supplier.id } },
      source: "AUTO_SYNC",
      externalSupplierId: extracted.externalSupplierId,
      originalName: extracted.originalName ?? `AP:${record.externalId}`,
      originalDocument: extracted.originalDocument,
      normalizedName: extracted.normalizedName,
      normalizedDocument: extracted.normalizedDocument,
      titlesCount: 1,
      firstSeenAt: bounds.firstSeenAt,
      lastSeenAt: bounds.lastSeenAt,
    });
    supplier.aliases.push(created);
    newAliases += 1;
    await deps.createAuditLog({
      entityType: FINANCE_SUPPLIER_REBUILD_AUDIT_ENTITY.SUPPLIER_ALIAS,
      entityId: created.id,
      action: FINANCE_SUPPLIER_REBUILD_AUDIT_ACTION.CREATE,
      afterJson: serializeAlias(created),
      userId: user.userId,
      userName: user.userName,
    });
  }

  return { newAliases, updatedAliases };
}

function serializeSupplier(supplier: ExistingFinancialSupplierRow): Prisma.InputJsonValue {
  return {
    id: supplier.id,
    displayName: supplier.displayName,
    document: supplier.document,
    normalizedDocument: supplier.normalizedDocument,
    normalizedName: supplier.normalizedName,
    source: supplier.source,
    status: supplier.status,
    titlesCount: supplier.titlesCount,
    totalAmountSeen: decimalToNumber(supplier.totalAmountSeen),
  };
}

function serializeAlias(alias: ExistingFinancialSupplierAliasRow): Prisma.InputJsonValue {
  return {
    id: alias.id,
    supplierId: alias.supplierId,
    externalSupplierId: alias.externalSupplierId,
    originalName: alias.originalName,
    normalizedDocument: alias.normalizedDocument,
    normalizedName: alias.normalizedName,
    titlesCount: alias.titlesCount,
  };
}

export async function applyFinancialSuppliersFromAccountsPayable(
  deps: FinanceSupplierRebuildDeps,
  input: { confirmationText: string } & FinanceSupplierRebuildUserContext
): Promise<FinanceSupplierRebuildApplyResult> {
  assertFinanceSupplierRebuildConfirmation(input.confirmationText);

  const preview = await buildFinancialSuppliersFromAccountsPayablePreview(deps);
  const existing = await deps.loadExistingSuppliers();
  let index = buildSupplierMatchIndex(existing);
  const apRows = await deps.loadApRows();
  const groups = groupAccountsPayableSuppliers(apRows).filter(isRebuildEligibleGroup);
  const nomusDocumentsByExternalId = await loadNomusDocumentIndex(deps);

  let newSuppliers = 0;
  let updatedSuppliers = 0;
  let statsOnlyUpdates = 0;
  let newAliases = 0;
  let updatedAliases = 0;
  let documentSafeFills = 0;
  let documentConflicts = 0;
  let documentUnresolved = 0;

  for (const group of groups) {
    const currentExisting = findExistingSupplierForGroup(group, index);
    // Plano calculado sobre o índice ATUAL (fornecedores já criados nesta
    // execução contam como donos de documento/externalSupplierId).
    const enrichment = planSupplierDocumentEnrichment({
      existing: currentExisting,
      group,
      index,
      nomusDocumentsByExternalId,
    });
    const { supplier, action } = await upsertFinancialSupplierFromGroup(
      deps,
      group,
      currentExisting,
      input,
      { index, enrichment, nomusDocumentsByExternalId }
    );

    if (action === "create") newSuppliers += 1;
    else if (action === "update") updatedSuppliers += 1;
    else statsOnlyUpdates += 1;
    if (enrichment.action === "SAFE_FILL") documentSafeFills += 1;
    else if (enrichment.action === "CONFLICT") documentConflicts += 1;
    else if (enrichment.action === "UNRESOLVED") documentUnresolved += 1;

    const aliasResult = await upsertFinancialSupplierAliases(deps, supplier, group, input);
    newAliases += aliasResult.newAliases;
    updatedAliases += aliasResult.updatedAliases;

    const refreshed = await deps.loadExistingSuppliers();
    index = buildSupplierMatchIndex(refreshed);
  }

  await deps.createAuditLog({
    entityType: FINANCE_SUPPLIER_REBUILD_AUDIT_ENTITY.REBUILD_RUN,
    entityId: `rebuild-${Date.now()}`,
    action: FINANCE_SUPPLIER_REBUILD_AUDIT_ACTION.BATCH_APPLY,
    afterJson: {
      newSuppliers,
      updatedSuppliers,
      statsOnlyUpdates,
      newAliases,
      updatedAliases,
      documentSafeFills,
      documentConflicts,
      documentUnresolved,
    },
    userId: input.userId,
    userName: input.userName,
  });

  return {
    ok: true,
    appliedAt: new Date().toISOString(),
    totalTitlesAnalyzed: preview.totalTitlesAnalyzed,
    suppliersDetected: preview.suppliersDetected,
    newSuppliers,
    updatedSuppliers,
    statsOnlyUpdates,
    skippedSuppliers: preview.skippedSuppliers,
    newAliases,
    updatedAliases,
    unidentifiableRecords: preview.unidentifiableRecords,
    documentSafeFills,
    documentConflicts,
    documentUnresolved,
    potentialDuplicates: preview.potentialDuplicates,
    topSuppliersByAmount: preview.topSuppliersByAmount,
    topSuppliersByCount: preview.topSuppliersByCount,
    warnings: preview.warnings,
  };
}

export function mapNomusApRowToSupplierRebuildRow(row: {
  externalId: number;
  personId: number | null;
  personName: string | null;
  personCnpj: string | null;
  companyId: number | null;
  companyName: string | null;
  rawPayload: unknown;
  amountPayable: Prisma.Decimal | null;
  balancePayable: Prisma.Decimal | null;
}): FinanceSupplierRebuildApRow {
  return {
    externalId: row.externalId,
    personId: row.personId,
    personName: row.personName,
    personCnpj: row.personCnpj,
    companyId: row.companyId,
    companyName: row.companyName,
    rawPayload: row.rawPayload,
    amountPayable: decimalFieldToNumber(row.amountPayable),
    balancePayable: decimalFieldToNumber(row.balancePayable),
  };
}

export function createDefaultFinanceSupplierRebuildDeps(): FinanceSupplierRebuildDeps {
  return {
    loadApRows: async () => {
      const rows = await prisma.nomusAccountsPayable.findMany({
        select: FINANCE_SUPPLIER_REBUILD_AP_SELECT,
        orderBy: { externalId: "asc" },
      });
      return rows.map(mapNomusApRowToSupplierRebuildRow);
    },
    loadExistingSuppliers: async () => {
      const rows = await prisma.financialSupplier.findMany({
        include: { aliases: true },
        orderBy: { displayName: "asc" },
      });
      return rows.map((row) => ({
        ...row,
        aliases: row.aliases.map((alias) => ({ ...alias })),
      }));
    },
    // Evidência agregada do espelho de Pedidos Nomus: uma consulta, sem varrer
    // pedido a pedido. Leitura pura — nenhum writeback Nomus.
    loadNomusOrderSupplierDocuments: async () => {
      const rows = await prisma.nomusPurchaseOrder.groupBy({
        by: ["supplierExternalId", "supplierTaxId"],
        where: { supplierExternalId: { not: null }, supplierTaxId: { not: null } },
      });
      return rows.map((row) => ({
        supplierExternalId: row.supplierExternalId,
        supplierTaxId: row.supplierTaxId,
      }));
    },
    createSupplier: async (data) => {
      const row = await prisma.financialSupplier.create({ data, include: { aliases: true } });
      return { ...row, aliases: row.aliases.map((a) => ({ ...a })) };
    },
    updateSupplier: async (id, data) => {
      const row = await prisma.financialSupplier.update({
        where: { id },
        data,
        include: { aliases: true },
      });
      return { ...row, aliases: row.aliases.map((a) => ({ ...a })) };
    },
    createAlias: async (data) => prisma.financialSupplierAlias.create({ data }),
    updateAlias: async (id, data) =>
      prisma.financialSupplierAlias.update({ where: { id }, data }),
    createAuditLog: async (data) => {
      await prisma.financialCostCenterAuditLog.create({ data });
    },
  };
}

export async function buildFinancialSuppliersFromAccountsPayablePreviewDefault(): Promise<FinanceSupplierRebuildPreviewPayload> {
  return buildFinancialSuppliersFromAccountsPayablePreview(createDefaultFinanceSupplierRebuildDeps());
}

export async function applyFinancialSuppliersFromAccountsPayableDefault(
  input: { confirmationText: string } & FinanceSupplierRebuildUserContext
): Promise<FinanceSupplierRebuildApplyResult> {
  return applyFinancialSuppliersFromAccountsPayable(createDefaultFinanceSupplierRebuildDeps(), input);
}
