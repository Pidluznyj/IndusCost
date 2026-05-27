/**
 * Helpers puros do dashboard de auto apply BOM — seguros para frontend e backend.
 */
import type { NomusMaintenanceTab } from "@/src/lib/nomusMaintenanceWorkspaceTypes";
import type {
  AutoApplyBlockingReasonBucket,
  AutoApplyBomDashboardProductRow,
  AutoApplyDashboardFilter,
} from "@/src/lib/nomusAutoApplyBomDashboardTypes";

export type AutoApplyBlockBucketFilter =
  | "ALL"
  | "LOCAL_ITEM_PENDING"
  | "OPTIONAL_PENDING"
  | "NOT_IN_INDUS"
  | "AMBIGUOUS"
  | "UNRESOLVED_COMPONENT"
  | "EFFECTIVE_BOM_BLOCKED"
  | "TECHNICAL_ERROR"
  | "OTHER";

function matchesReason(text: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(text));
}

export function deriveBlockBucket(row: AutoApplyBomDashboardProductRow): AutoApplyBlockBucketFilter {
  const reasons = [...row.blockingReasons, row.primaryReason, row.errorMessage ?? ""].join(" ");
  if (row.status === "ERROR") return "TECHNICAL_ERROR";
  if (matchesReason(reasons, [/Produto não cadastrado/i, /NO_PRODUCT/i, /não encontrado no IndusCost/i])) {
    return "NOT_IN_INDUS";
  }
  if (matchesReason(reasons, [/opcionais?/i, /OPTIONAL/i, /precifica/i])) return "OPTIONAL_PENDING";
  if (
    matchesReason(reasons, [/local/i, /somente IndusCost/i, /revisão de engenharia/i, /LOCAL_REVIEW/i]) ||
    row.localOnlyLineCodes.length > 0
  ) {
    return "LOCAL_ITEM_PENDING";
  }
  if (matchesReason(reasons, [/ambig/i, /Produto e Material/i])) return "AMBIGUOUS";
  if (matchesReason(reasons, [/sem resolução/i, /UNRESOLVED/i, /Material ou Produto/i, /não resolvido/i])) {
    return "UNRESOLVED_COMPONENT";
  }
  if (matchesReason(reasons, [/BOM efetiva bloqueada/i, /EFFECTIVE_BOM/i, /incompleta/i])) {
    return "EFFECTIVE_BOM_BLOCKED";
  }
  if (row.status === "BLOCKED" || row.status === "SKIPPED") return "OTHER";
  return "ALL";
}

export function derivePendingTypeLabel(row: AutoApplyBomDashboardProductRow): string {
  const bucket = deriveBlockBucket(row);
  switch (bucket) {
    case "LOCAL_ITEM_PENDING":
      return "Item local pendente";
    case "OPTIONAL_PENDING":
      return "Opcional pendente";
    case "NOT_IN_INDUS":
      return "Produto não cadastrado";
    case "AMBIGUOUS":
      return "Ambiguidade Product/Material";
    case "UNRESOLVED_COMPONENT":
      return "Componente não encontrado";
    case "EFFECTIVE_BOM_BLOCKED":
      return "BOM efetiva incompleta";
    case "TECHNICAL_ERROR":
      return "Erro técnico";
    case "OTHER":
      if (row.status === "BLOCKED") return "Bloqueio operacional";
      if (row.status === "SKIPPED") return "Ignorado";
      if (row.quantityDiffCount > 0) return "Divergência de quantidade";
      if (row.metadataOnlyCount > 0) return "Metadata Nomus pendente";
      return "Sem pendência";
    default:
      if (row.status === "NO_CHANGES") return "Alinhado";
      if (row.status === "APPLIED") return "Aplicado";
      return "—";
  }
}

export function deriveRecommendedTab(row: AutoApplyBomDashboardProductRow): NomusMaintenanceTab {
  const bucket = deriveBlockBucket(row);
  switch (bucket) {
    case "OPTIONAL_PENDING":
      return "pending";
    case "NOT_IN_INDUS":
      return "product-import";
    case "TECHNICAL_ERROR":
      return "diagnostic";
    case "LOCAL_ITEM_PENDING":
    case "EFFECTIVE_BOM_BLOCKED":
      return "effective-pricing-bom";
    case "UNRESOLVED_COMPONENT":
    case "AMBIGUOUS":
      return "product-import";
    default:
      if (row.quantityDiffCount > 0 || row.metadataOnlyCount > 0) return "apply-plan";
      if (row.status === "BLOCKED") return "effective-pricing-bom";
      return "overview";
  }
}

export function deriveRecommendedAction(row: AutoApplyBomDashboardProductRow): string {
  const bucket = deriveBlockBucket(row);
  switch (bucket) {
    case "LOCAL_ITEM_PENDING":
      return "Abrir revisão de itens locais / BOM efetiva para decidir preservar ou remover.";
    case "OPTIONAL_PENDING":
      return "Abrir Opcionais de Precificação e selecionar a opção válida.";
    case "NOT_IN_INDUS":
      return "Abrir Carga Mestre Nomus para importar/corrigir cadastro.";
    case "TECHNICAL_ERROR":
      return "Abrir Diagnóstico Técnico e revisar o erro registrado.";
    case "AMBIGUOUS":
      return "Revisar ambiguidade Product/Material na Carga Mestre ou Igualar bases.";
    case "UNRESOLVED_COMPONENT":
      return "Cadastrar ou resolver componentes faltantes antes de aplicar BOM.";
    case "EFFECTIVE_BOM_BLOCKED":
      return "Abrir BOM efetiva e resolver bloqueios estruturais.";
    default:
      if (row.quantityDiffCount > 0) {
        return "Revisar Plano de aplicação / BOM efetiva e aplicar quando liberado.";
      }
      if (row.metadataOnlyCount > 0) {
        return "Corrigir metadata Nomus nas linhas pendentes (apply automático na próxima rotina).";
      }
      if (row.status === "NO_CHANGES") return "Nenhuma ação necessária nesta rotina.";
      return "Abrir manutenção do produto para revisar pendências.";
  }
}

export function formatActionPreviewLine(action: NonNullable<AutoApplyBomDashboardProductRow["actionsPreview"]>[number]): string {
  const code = action.componentCode;
  switch (action.actionType) {
    case "UPDATE_PRODUCT_BOM_QUANTITY":
      return `Atualizar ${code}: ${action.currentQuantity ?? "—"} → ${action.effectiveQuantity ?? "—"}`;
    case "UPDATE_PRODUCT_BOM_NOMUS_METADATA":
      return `Corrigir metadata Nomus ${code}`;
    case "CREATE_PRODUCT_BOM_LINE":
      return `Criar linha ${code} (qty ${action.effectiveQuantity ?? "—"})`;
    case "REMOVE_PRODUCT_BOM_LINE":
      return `Remover ${code} (somente IndusCost / decisão pendente)`;
    case "KEEP_PRODUCT_BOM_LINE":
      if (/115\.08|local/i.test(code)) return `Resolver item local ${code}`;
      return `Manter ${code}`;
    case "CONSOLIDATE_DUPLICATE_PRODUCT_BOM_LINES":
      return `Consolidar duplicatas ${code}`;
    case "BLOCKED":
      return `Bloqueado ${code}`;
    case "SKIP_UNRESOLVED":
      return `Não resolvido ${code}`;
    default:
      return `${action.actionType} ${code}`;
  }
}

export function deriveSeverity(row: AutoApplyBomDashboardProductRow): number {
  if (row.status === "ERROR") return 100;
  if (row.status === "BLOCKED") {
    const bucket = deriveBlockBucket(row);
    if (bucket === "LOCAL_ITEM_PENDING") return 90;
    if (bucket === "OPTIONAL_PENDING") return 85;
    if (bucket === "NOT_IN_INDUS") return 80;
    if (row.quantityDiffCount > 0) return 75;
    return 70;
  }
  if (row.status === "SKIPPED") return 60;
  if (row.status === "APPLIED") return 20;
  return 10;
}

export function matchesDashboardSearch(row: AutoApplyBomDashboardProductRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  if (row.parentCode.toLowerCase().includes(q)) return true;
  if (row.primaryReason.toLowerCase().includes(q)) return true;
  if (row.blockingReasons.some((b) => b.toLowerCase().includes(q))) return true;
  if ((row.errorMessage ?? "").toLowerCase().includes(q)) return true;
  if (row.pendingTypeLabel.toLowerCase().includes(q)) return true;

  for (const action of row.actionsPreview ?? []) {
    if (action.componentCode.toLowerCase().includes(q)) return true;
    if (action.actionType.toLowerCase().includes(q)) return true;
  }

  for (const line of row.actionsSummaryLines) {
    if (line.toLowerCase().includes(q)) return true;
  }

  return false;
}

export function matchesStatusFilter(
  row: AutoApplyBomDashboardProductRow,
  filter: AutoApplyDashboardFilter
): boolean {
  if (filter === "ALL") return true;
  return row.filterBuckets.includes(filter);
}

export function matchesBlockBucketFilter(
  row: AutoApplyBomDashboardProductRow,
  blockBucket: AutoApplyBlockBucketFilter
): boolean {
  if (blockBucket === "ALL") return true;
  return deriveBlockBucket(row) === blockBucket;
}

export function filterDashboardProducts(
  rows: AutoApplyBomDashboardProductRow[],
  input: {
    filter?: AutoApplyDashboardFilter;
    search?: string;
    blockBucket?: AutoApplyBlockBucketFilter;
  }
): AutoApplyBomDashboardProductRow[] {
  const filter = input.filter ?? "ALL";
  const search = input.search?.trim() ?? "";
  const blockBucket = input.blockBucket ?? "ALL";

  return rows.filter(
    (row) =>
      matchesStatusFilter(row, filter) &&
      matchesBlockBucketFilter(row, blockBucket) &&
      matchesDashboardSearch(row, search)
  );
}

export function computeFilterCounts(
  rows: AutoApplyBomDashboardProductRow[]
): Record<AutoApplyDashboardFilter, number> {
  const counts: Record<AutoApplyDashboardFilter, number> = {
    ALL: rows.length,
    BLOCKED: 0,
    DIVERGENT: 0,
    OPTIONAL_PENDING: 0,
    LOCAL_PENDING: 0,
    SKIPPED: 0,
    NO_CHANGES: 0,
    APPLIED: 0,
    ERROR: 0,
  };
  for (const row of rows) {
    for (const bucket of row.filterBuckets) {
      if (bucket in counts) counts[bucket] += 1;
    }
  }
  return counts;
}

export function computeBlockBucketCounts(
  rows: AutoApplyBomDashboardProductRow[]
): AutoApplyBlockingReasonBucket[] {
  const defs: Array<{ key: AutoApplyBlockBucketFilter; label: string }> = [
    { key: "LOCAL_ITEM_PENDING", label: "Itens locais pendentes" },
    { key: "OPTIONAL_PENDING", label: "Opcionais pendentes" },
    { key: "NOT_IN_INDUS", label: "Produto não cadastrado" },
    { key: "AMBIGUOUS", label: "Ambiguidade Product/Material" },
    { key: "UNRESOLVED_COMPONENT", label: "Componente não encontrado" },
    { key: "EFFECTIVE_BOM_BLOCKED", label: "BOM efetiva incompleta" },
    { key: "TECHNICAL_ERROR", label: "Erro técnico" },
    { key: "OTHER", label: "Outros" },
  ];
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.status !== "BLOCKED" && row.status !== "SKIPPED" && row.status !== "ERROR") continue;
    const key = deriveBlockBucket(row);
    if (key === "ALL") continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return defs
    .map((d) => ({ key: d.key, label: d.label, count: counts.get(d.key) ?? 0 }))
    .filter((b) => b.count > 0)
    .sort((a, b) => b.count - a.count);
}

export function sortDashboardProducts(
  rows: AutoApplyBomDashboardProductRow[],
  sortBy: "product" | "severity"
): AutoApplyBomDashboardProductRow[] {
  const copy = [...rows];
  if (sortBy === "severity") {
    copy.sort((a, b) => deriveSeverity(b) - deriveSeverity(a) || a.parentCode.localeCompare(b.parentCode));
  } else {
    copy.sort((a, b) => a.parentCode.localeCompare(b.parentCode));
  }
  return copy;
}

export function enrichDashboardProductRow(
  row: AutoApplyBomDashboardProductRow
): AutoApplyBomDashboardProductRow {
  const actionsSummaryLines = (row.actionsPreview ?? []).map(formatActionPreviewLine);
  const actionsCount = row.actionsPreview?.length ?? 0;
  return {
    ...row,
    pendingTypeLabel: derivePendingTypeLabel(row),
    recommendedAction: deriveRecommendedAction(row),
    recommendedTab: deriveRecommendedTab(row),
    severity: deriveSeverity(row),
    actionsCount,
    actionsSummaryLines,
  };
}
