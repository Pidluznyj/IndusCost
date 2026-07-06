import { buildProjectEngineeringTree, type ProjectEngineeringTreeNode } from "./projectsEngineeringTree.js";
import { PROJECT_STATUS_LABEL, PROJECT_TYPE_LABEL } from "./projectsExecutiveReport.js";
import { isLaborStructureLine } from "./projectsUiUtils.js";
import type {
  ProjectDetail,
  ProjectSimulatedItemRow,
  ProjectStructureLineRow,
  ProjectType,
} from "@/src/types/projects.js";

export const PROJECT_INTAKE_QUICK_FORM_TITLE = "Ficha Rápida de Estimativa do Projeto";
export const PROJECT_INTAKE_QUICK_BUTTON_LABEL = "Ficha rápida";
export const PROJECT_INTAKE_FULL_BUTTON_LABEL = "Ficha completa";
export const PROJECT_INTAKE_SPREADSHEET_BUTTON_LABEL = "Baixar planilha modelo";
export const PROJECT_INTAKE_QUICK_PENDING_LABEL = "Pendente";

export const PROJECT_INTAKE_QUICK_PROJECT_TYPES = [
  "Produto novo",
  "Componente novo",
  "Alteração de produto existente",
  "Alteração de componente existente",
  "Molde novo",
  "Alteração de molde",
  "Postiço / inserto / macho",
  "Dispositivo / gabarito",
  "Redução de custo",
  "Simulação de preço",
  "Serviço externo",
  "Outro",
] as const;

export const PROJECT_INTAKE_QUICK_DELIVERABLES = [
  "Estimativa de custo",
  "Preço sugerido",
  "Lista de materiais / composição",
  "Estudo de molde",
  "Estudo de processo / HH",
  "Cotação de fornecedor externo",
  "Amostra / protótipo",
  "Desenho técnico",
  "Modelo 3D",
  "Relatório técnico",
  "Proposta comercial",
] as const;

export const PROJECT_INTAKE_QUICK_ESTIMATE_ITEMS = [
  "Matéria-prima",
  "Componentes comprados",
  "Componentes fabricados",
  "Processo interno / HH",
  "Serviço externo",
  "Molde / ferramenta",
  "Postiços / machos / insertos",
  "Dispositivo / gabarito",
  "Embalagem",
  "Protótipo / amostra",
  "Testes / validações",
  "Outros custos",
] as const;

export const PROJECT_INTAKE_QUICK_PENDING_ITEMS = [
  "Falta desenho técnico",
  "Falta modelo 3D",
  "Falta amostra física",
  "Falta especificação do cliente",
  "Falta volume estimado",
  "Falta preço alvo",
  "Falta definição de material",
  "Falta cotação de fornecedor",
  "Falta validação de engenharia",
  "Falta validação comercial",
] as const;

export const PROJECT_INTAKE_QUICK_DECISIONS = [
  "Pode estimar com os dados atuais",
  "Precisa complementar informações",
  "Aguardar cliente",
  "Aguardar engenharia",
  "Aguardar compras / fornecedor",
  "Não seguir",
] as const;

export const PROJECT_INTAKE_QUICK_MOLD_TYPES = [
  "Molde novo",
  "Alteração de molde existente",
  "Postiço",
  "Macho",
  "Inserto",
  "Dispositivo",
  "Gabarito",
] as const;

export const PROJECT_INTAKE_QUICK_PRIORITIES = ["Baixa", "Média", "Alta", "Urgente"] as const;

export const PROJECT_INTAKE_QUICK_STRUCTURE_SECTION_TITLE = "Estrutura preliminar / BOM do projeto";

export const PROJECT_INTAKE_QUICK_DELIVERABLE_PRODUCT_TYPES = [
  "Produto novo",
  "Componente novo",
  "Produto alterado",
  "Componente alterado",
  "Molde/ferramenta",
  "Serviço",
  "Outro",
] as const;

export const PROJECT_INTAKE_QUICK_STRUCTURE_INSTRUCTION =
  "Use uma linha por item da estrutura. Informe o item pai para representar componentes, matérias-primas e serviços.";

export const PROJECT_INTAKE_QUICK_STRUCTURE_LEVEL_HINT =
  "Ex.: Produto raiz nível 0; componente nível 1; MP/serviço nível 2.";

export const PROJECT_INTAKE_QUICK_STRUCTURE_CONTINUATION_NOTE =
  "Se necessário, continue na planilha modelo.";

export const PROJECT_INTAKE_QUICK_BLANK_STRUCTURE_ROW_COUNT = 20;
export const PROJECT_INTAKE_QUICK_BLANK_DELIVERABLE_ROW_COUNT = 5;

export const PROJECT_INTAKE_QUICK_STRUCTURE_TYPES = [
  "Produto",
  "Componente",
  "MP",
  "Serviço",
  "Embalagem",
  "Molde/Ferramenta",
  "Outro",
] as const;

export const PROJECT_INTAKE_QUICK_FORM_SECTION_COUNT = 8;

export type QuickChecklistItem = {
  label: string;
  checked: boolean;
  otherText?: string | null;
};

export type QuickEstimateRow = {
  label: string;
  checked: boolean;
  estimatedValue: string | null;
};

export type QuickProductRow = {
  label: string;
  value: string | null;
};

export type QuickDeliverableProductRow = {
  item: number;
  codeSku: string | null;
  name: string | null;
  type: string | null;
  unit: string | null;
  plannedQuantity: string | null;
  notes: string | null;
};

export type QuickStructureRow = {
  productDeliverable: string | null;
  level: number | null;
  parentItem: string | null;
  type: string | null;
  code: string | null;
  description: string | null;
  unit: string | null;
  quantityPerUnit: string | null;
  serviceHours: string | null;
  estimatedCost: string | null;
  notes: string | null;
};

export type QuickSignatureRow = {
  role: string;
  line: string;
};

export type ProjectIntakeQuickFormPayload = {
  mode: "blank" | "prefilled";
  title: string;
  generatedAt: string;
  generatedBy: string | null;
  header: {
    projectName: string | null;
    customerName: string | null;
    date: string | null;
    commercialOwner: string | null;
    technicalOwner: string | null;
    desiredDeadline: string | null;
    priority: string | null;
    status: string | null;
  };
  projectTypes: QuickChecklistItem[];
  deliverables: QuickChecklistItem[];
  productFields: QuickProductRow[];
  estimateItems: QuickEstimateRow[];
  deliverableProducts: QuickDeliverableProductRow[];
  structureInstruction: string;
  structureLevelHint: string;
  structureContinuationNote: string | null;
  structureRows: QuickStructureRow[];
  mold: {
    requiresTooling: boolean | null;
    types: QuickChecklistItem[];
    cavities: string | null;
    material: string | null;
    supplier: string | null;
    estimatedCost: string | null;
    amortize: boolean | null;
    amortizationQty: string | null;
  };
  pendingItems: QuickChecklistItem[];
  decisions: QuickChecklistItem[];
  signatures: QuickSignatureRow[];
};

function fmtDate(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("pt-BR");
}

function fmtMoney(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtQty(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 8 });
}

function fmtNum(value: number | null | undefined, suffix = ""): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return `${value.toLocaleString("pt-BR")}${suffix}`;
}

function strOrNull(value: string | null | undefined): string | null {
  const t = value?.trim();
  return t ? t : null;
}

function mapProjectTypeToQuickLabel(type: ProjectType | null | undefined): string | null {
  if (!type) return null;
  const map: Partial<Record<ProjectType, string>> = {
    NEW_PRODUCT: "Produto novo",
    NEW_COMPONENT: "Componente novo",
    PRODUCT_CHANGE: "Alteração de produto existente",
    PRODUCT_WITH_NEW_COMPONENT: "Componente novo",
    MOLD: "Molde novo",
    FULL_DEVELOPMENT: "Produto novo",
    QUICK_ESTIMATE: "Simulação de preço",
  };
  return map[type] ?? PROJECT_TYPE_LABEL[type] ?? null;
}

function checklist(
  options: readonly string[],
  selected: string | null | undefined,
  extra?: { otherText?: string | null }
): QuickChecklistItem[] {
  return options.map((label) => ({
    label,
    checked: selected === label,
    otherText: label === "Outro" ? extra?.otherText ?? null : undefined,
  }));
}

function deliverablesFromDetail(detail: ProjectDetail | null): string[] {
  if (!detail) return [];
  const selected: string[] = ["Estimativa de custo", "Preço sugerido"];
  if (detail.simulatedItems.length > 0 || detail.structureLines.length > 0) {
    selected.push("Lista de materiais / composição");
  }
  if (detail.molds.length > 0) selected.push("Estudo de molde");
  if (detail.structureLines.some((l) => isLaborStructureLine(l) || l.lineType === "PROCESS")) {
    selected.push("Estudo de processo / HH");
  }
  if (detail.simulatedItems.some((i) => i.itemType === "OUTSOURCED_PROCESS")) {
    selected.push("Cotação de fornecedor externo");
  }
  return selected;
}

function estimateRowsFromDetail(detail: ProjectDetail | null): QuickEstimateRow[] {
  const cb = detail?.costBreakdown;
  const costMap: Partial<Record<(typeof PROJECT_INTAKE_QUICK_ESTIMATE_ITEMS)[number], string | null>> = {
    "Matéria-prima": fmtMoney(cb?.rawMaterialCost),
    "Componentes comprados": fmtMoney(cb?.componentCost),
    "Processo interno / HH": fmtMoney(cb?.serviceCost),
    "Molde / ferramenta": fmtMoney(
      cb?.separateMoldCost != null && cb.separateMoldCost > 0
        ? cb.separateMoldCost
        : detail?.molds[0]?.constructionCost
    ),
    Embalagem: fmtMoney(cb?.packagingCost),
  };
  const checkedMap: Partial<Record<(typeof PROJECT_INTAKE_QUICK_ESTIMATE_ITEMS)[number], boolean>> = {
    "Matéria-prima": (detail?.simulatedItems.some((i) => i.itemType === "RAW_MATERIAL") ?? false) || (cb?.rawMaterialCost ?? 0) > 0,
    "Componentes comprados":
      (detail?.simulatedItems.some((i) => i.itemType === "COMPONENT") ?? false) || (cb?.componentCost ?? 0) > 0,
    "Processo interno / HH":
      (detail?.structureLines.some((l) => isLaborStructureLine(l)) ?? false) || (cb?.serviceCost ?? 0) > 0,
    "Molde / ferramenta": (detail?.molds.length ?? 0) > 0,
    Embalagem: (cb?.packagingCost ?? 0) > 0,
  };
  return PROJECT_INTAKE_QUICK_ESTIMATE_ITEMS.map((label) => ({
    label,
    checked: checkedMap[label] ?? false,
    estimatedValue: costMap[label] ?? null,
  }));
}

function blankDeliverableProductRow(item: number): QuickDeliverableProductRow {
  return {
    item,
    codeSku: null,
    name: null,
    type: null,
    unit: null,
    plannedQuantity: null,
    notes: null,
  };
}

function blankDeliverableProducts(): QuickDeliverableProductRow[] {
  return Array.from({ length: PROJECT_INTAKE_QUICK_BLANK_DELIVERABLE_ROW_COUNT }, (_, index) =>
    blankDeliverableProductRow(index + 1)
  );
}

function blankStructureRow(): QuickStructureRow {
  return {
    productDeliverable: null,
    level: null,
    parentItem: null,
    type: null,
    code: null,
    description: null,
    unit: null,
    quantityPerUnit: null,
    serviceHours: null,
    estimatedCost: null,
    notes: null,
  };
}

function blankStructureRows(): QuickStructureRow[] {
  return Array.from({ length: PROJECT_INTAKE_QUICK_BLANK_STRUCTURE_ROW_COUNT }, () => blankStructureRow());
}

function productDeliverableKey(product: { provisionalCode: string | null; description: string }): string {
  return strOrNull(product.provisionalCode) ?? product.description.trim();
}

function mapSimulatedProductDeliverableType(projectType: ProjectType | null | undefined): string {
  switch (projectType) {
    case "NEW_COMPONENT":
    case "PRODUCT_WITH_NEW_COMPONENT":
      return "Componente novo";
    case "PRODUCT_CHANGE":
      return "Produto alterado";
    case "MOLD":
      return "Molde/ferramenta";
    default:
      return "Produto novo";
  }
}

export function deliverableProductsFromDetail(detail: ProjectDetail | null): QuickDeliverableProductRow[] {
  if (!detail || detail.simulatedProducts.length === 0) {
    return blankDeliverableProducts();
  }
  return detail.simulatedProducts.map((product, index) => ({
    item: index + 1,
    codeSku: strOrNull(product.provisionalCode),
    name: strOrNull(product.description),
    type: mapSimulatedProductDeliverableType(detail.projectType),
    unit: strOrNull(product.unit) ?? "UN",
    plannedQuantity: "1",
    notes: strOrNull(product.notes),
  }));
}

function mapStructureLineToQuickType(line: ProjectStructureLineRow): string {
  if (isLaborStructureLine(line) || line.lineType === "PROCESS" || line.lineType === "SERVICE") {
    return "Serviço";
  }
  switch (line.lineType) {
    case "RAW_MATERIAL":
      return "MP";
    case "COMPONENT":
      return "Componente";
    case "PACKAGING":
      return "Embalagem";
    case "MOLD_AMORTIZATION":
      return "Molde/Ferramenta";
    default:
      return "Outro";
  }
}

function structureUnitForLine(line: ProjectStructureLineRow): string {
  const unit = line.unitSnapshot?.trim() || "";
  if (unit === "HH") return "H";
  if (isLaborStructureLine(line) && !unit) return "H";
  return unit || "UN";
}

function codeFromStructureLine(
  line: ProjectStructureLineRow,
  simulatedItems: ProjectSimulatedItemRow[]
): string | null {
  if (line.simulatedItemId) {
    const item = simulatedItems.find((i) => i.id === line.simulatedItemId);
    return strOrNull(item?.provisionalCode);
  }
  return null;
}

function lineItemKey(line: ProjectStructureLineRow, simulatedItems: ProjectSimulatedItemRow[]): string {
  return codeFromStructureLine(line, simulatedItems) ?? line.descriptionSnapshot.trim();
}

function mergeStructureNotes(...parts: Array<string | null | undefined>): string | null {
  const merged = parts.map((p) => p?.trim()).filter(Boolean).join("; ");
  return merged || null;
}

function structureRowFromLine(
  productDeliverable: string,
  line: ProjectStructureLineRow,
  level: number,
  parentItem: string,
  simulatedItems: ProjectSimulatedItemRow[],
  extraNotes: string | null = null
): QuickStructureRow {
  const quickType = mapStructureLineToQuickType(line);
  const isService = quickType === "Serviço";
  return {
    productDeliverable,
    level,
    parentItem,
    type: quickType,
    code: codeFromStructureLine(line, simulatedItems),
    description: strOrNull(line.descriptionSnapshot),
    unit: structureUnitForLine(line),
    quantityPerUnit: isService ? null : fmtQty(line.quantity),
    serviceHours: isService ? fmtQty(line.quantity) : null,
    estimatedCost: isService ? null : fmtMoney(line.unitCostSnapshot > 0 ? line.unitCostSnapshot : null),
    notes: mergeStructureNotes(line.notes, extraNotes),
  };
}

function resolveStructureParentItem(
  line: ProjectStructureLineRow,
  level: number,
  productRootKey: string,
  lineKeyById: Map<string, string>
): { parentItem: string; extraNotes: string | null } {
  if (level <= 0) {
    return { parentItem: "—", extraNotes: null };
  }
  if (line.parentLineId) {
    const parent = lineKeyById.get(line.parentLineId);
    if (parent) return { parentItem: parent, extraNotes: null };
    return { parentItem: productRootKey, extraNotes: "Relação pai não informada" };
  }
  if (level === 1) {
    return { parentItem: productRootKey, extraNotes: null };
  }
  return { parentItem: productRootKey, extraNotes: "Relação pai não informada" };
}

function appendStructureTreeRows(
  productDeliverable: string,
  lines: ProjectStructureLineRow[],
  productId: string,
  product: { description: string; provisionalCode: string | null; unit: string },
  simulatedItems: ProjectSimulatedItemRow[],
  rows: QuickStructureRow[]
): void {
  const productRootKey = strOrNull(product.provisionalCode) ?? productDeliverable;
  rows.push({
    productDeliverable,
    level: 0,
    parentItem: "—",
    type: "Produto",
    code: strOrNull(product.provisionalCode),
    description: strOrNull(product.description),
    unit: strOrNull(product.unit) ?? "UN",
    quantityPerUnit: "1",
    serviceHours: null,
    estimatedCost: null,
    notes: null,
  });

  const scopedLines = lines.filter(
    (line) => line.simulatedProductId === productId && line.snapshotRootProductId == null
  );
  const lineKeyById = new Map<string, string>();
  for (const line of scopedLines) {
    lineKeyById.set(line.id, lineItemKey(line, simulatedItems));
  }

  const tree = buildProjectEngineeringTree(
    {
      productId,
      sku: product.provisionalCode?.trim() || productId.slice(0, 8),
      name: product.description,
    },
    lines,
    { kind: "simulated_product", simulatedProductId: productId }
  );

  const walk = (children: ProjectEngineeringTreeNode[], depth: number) => {
    for (const node of children) {
      if (!node.line) continue;
      const line = node.line;
      const level = line.level != null && line.level > 0 ? line.level : depth;
      const { parentItem, extraNotes } = resolveStructureParentItem(
        line,
        level,
        productRootKey,
        lineKeyById
      );
      rows.push(
        structureRowFromLine(productDeliverable, line, level, parentItem, simulatedItems, extraNotes)
      );
      walk(node.children, depth + 1);
    }
  };

  walk(tree.children, 1);
}

export function structureRowsFromDetail(detail: ProjectDetail | null): QuickStructureRow[] {
  if (!detail) return blankStructureRows();

  const rows: QuickStructureRow[] = [];
  const products = detail.simulatedProducts;

  if (products.length > 0) {
    for (const product of products) {
      appendStructureTreeRows(
        productDeliverableKey(product),
        detail.structureLines,
        product.id,
        product,
        detail.simulatedItems,
        rows
      );
    }
  } else if (detail.structureLines.length > 0) {
    const productDeliverable = primaryProductName(detail) ?? "Produto";
    const productRootKey = productDeliverable;
    const orphanLines = detail.structureLines.filter((line) => line.snapshotRootProductId == null);
    const lineKeyById = new Map<string, string>();
    for (const line of orphanLines) {
      lineKeyById.set(line.id, lineItemKey(line, detail.simulatedItems));
    }

    rows.push({
      productDeliverable,
      level: 0,
      parentItem: "—",
      type: "Produto",
      code: null,
      description: productDeliverable,
      unit: "UN",
      quantityPerUnit: "1",
      serviceHours: null,
      estimatedCost: null,
      notes: null,
    });

    for (const line of orphanLines.sort((a, b) => a.sortOrder - b.sortOrder)) {
      const level = line.level != null && line.level >= 0 ? Math.max(line.level, 1) : 1;
      const { parentItem, extraNotes } = resolveStructureParentItem(
        line,
        level,
        productRootKey,
        lineKeyById
      );
      rows.push(
        structureRowFromLine(productDeliverable, line, level, parentItem, detail.simulatedItems, extraNotes)
      );
    }
  } else if (detail.simulatedItems.length > 0) {
    const productDeliverable = primaryProductName(detail) ?? "Produto";
    rows.push({
      productDeliverable,
      level: 0,
      parentItem: "—",
      type: "Produto",
      code: null,
      description: productDeliverable,
      unit: "UN",
      quantityPerUnit: "1",
      serviceHours: null,
      estimatedCost: null,
      notes: null,
    });
    for (const item of detail.simulatedItems) {
      const type =
        item.itemType === "RAW_MATERIAL"
          ? "MP"
          : item.itemType === "COMPONENT"
            ? "Componente"
            : item.itemType === "OUTSOURCED_PROCESS" || item.itemType === "SERVICE"
              ? "Serviço"
              : item.itemType === "PACKAGING"
                ? "Embalagem"
                : item.itemType === "MOLD" || item.itemType === "TOOLING"
                  ? "Molde/Ferramenta"
                  : "Outro";
      const isService = type === "Serviço";
      rows.push({
        productDeliverable,
        level: 1,
        parentItem: productDeliverable,
        type,
        code: strOrNull(item.provisionalCode),
        description: strOrNull(item.description),
        unit: strOrNull(item.unit),
        quantityPerUnit: isService ? null : null,
        serviceHours: null,
        estimatedCost: fmtMoney(item.estimatedUnitCost ?? item.quotedUnitCost),
        notes: strOrNull(item.notes),
      });
    }
  }

  if (rows.length === 0) return blankStructureRows();
  return rows;
}

function pendingFromDetail(detail: ProjectDetail | null): QuickChecklistItem[] {
  const flags: Partial<Record<(typeof PROJECT_INTAKE_QUICK_PENDING_ITEMS)[number], boolean>> = {};
  if (detail) {
    if (!detail.expectedMonthlyVolume) flags["Falta volume estimado"] = true;
    if (!detail.targetPrice) flags["Falta preço alvo"] = true;
    if (!detail.simulatedItems.some((i) => i.itemType === "RAW_MATERIAL")) {
      flags["Falta definição de material"] = true;
    }
  }
  return PROJECT_INTAKE_QUICK_PENDING_ITEMS.map((label) => ({
    label,
    checked: flags[label] ?? false,
  }));
}

function primaryProductName(detail: ProjectDetail | null): string | null {
  if (!detail) return null;
  return (
    strOrNull(detail.simulatedProducts[0]?.description) ??
    strOrNull(detail.simulatedItems[0]?.description) ??
    null
  );
}

function officialSkus(detail: ProjectDetail | null): string | null {
  if (!detail) return null;
  const skus = Object.values(detail.snapshotRootProducts)
    .map((p) => p.sku)
    .filter(Boolean);
  return skus.length > 0 ? skus.join(", ") : null;
}

export function buildBlankQuickIntakeForm(options?: { generatedBy?: string | null }): ProjectIntakeQuickFormPayload {
  return buildQuickIntakeFormFromDetail(null, options);
}

export function buildQuickIntakeFormFromDetail(
  detail: ProjectDetail | null,
  options?: { generatedBy?: string | null }
): ProjectIntakeQuickFormPayload {
  const product = detail?.simulatedProducts[0] ?? null;
  const mold = detail?.molds[0] ?? null;
  const typeLabel = mapProjectTypeToQuickLabel(detail?.projectType);
  const selectedDeliverables = deliverablesFromDetail(detail);

  return {
    mode: detail ? "prefilled" : "blank",
    title: PROJECT_INTAKE_QUICK_FORM_TITLE,
    generatedAt: new Date().toISOString(),
    generatedBy: options?.generatedBy ?? null,
    header: {
      projectName: strOrNull(detail?.title),
      customerName: strOrNull(detail?.customerName),
      date: fmtDate(detail?.createdAt ?? new Date().toISOString()),
      commercialOwner: strOrNull(detail?.commercialOwner),
      technicalOwner: strOrNull(detail?.technicalOwner),
      desiredDeadline: null,
      priority: null,
      status: detail ? PROJECT_STATUS_LABEL[detail.status] : null,
    },
    projectTypes: checklist(PROJECT_INTAKE_QUICK_PROJECT_TYPES, typeLabel),
    deliverables: PROJECT_INTAKE_QUICK_DELIVERABLES.map((label) => ({
      label,
      checked: selectedDeliverables.includes(label),
    })),
    productFields: [
      { label: "Produto/componente", value: primaryProductName(detail) },
      { label: "Código existente, se houver", value: strOrNull(product?.provisionalCode) },
      { label: "Produto base para copiar, se houver", value: officialSkus(detail) },
      { label: "Aplicação", value: null },
      { label: "Unidade", value: strOrNull(product?.unit) ?? "UN" },
      { label: "Volume mensal estimado", value: fmtNum(detail?.expectedMonthlyVolume) },
      {
        label: "Volume anual estimado",
        value: fmtNum(detail?.expectedMonthlyVolume ? detail.expectedMonthlyVolume * 12 : null),
      },
      { label: "Preço alvo, se existir", value: fmtMoney(detail?.targetPrice) },
      {
        label: "Margem desejada",
        value: fmtNum(detail?.targetMarginPercent ?? detail?.costBreakdown?.targetMarginPercent, "%"),
      },
    ],
    estimateItems: estimateRowsFromDetail(detail),
    deliverableProducts: deliverableProductsFromDetail(detail),
    structureInstruction: PROJECT_INTAKE_QUICK_STRUCTURE_INSTRUCTION,
    structureLevelHint: PROJECT_INTAKE_QUICK_STRUCTURE_LEVEL_HINT,
    structureContinuationNote: detail ? null : PROJECT_INTAKE_QUICK_STRUCTURE_CONTINUATION_NOTE,
    structureRows: structureRowsFromDetail(detail),
    mold: {
      requiresTooling: detail ? (detail.molds.length > 0 ? true : null) : null,
      types: checklist(PROJECT_INTAKE_QUICK_MOLD_TYPES, mold ? "Molde novo" : null),
      cavities: fmtNum(mold?.cavities),
      material: null,
      supplier: strOrNull(mold?.supplierName),
      estimatedCost: fmtMoney(mold?.constructionCost),
      amortize: mold ? mold.chargeMode === "AMORTIZED_IN_PRODUCT" : null,
      amortizationQty: fmtNum(mold?.amortizationQuantity),
    },
    pendingItems: pendingFromDetail(detail),
    decisions: PROJECT_INTAKE_QUICK_DECISIONS.map((label) => ({ label, checked: false })),
    signatures: [
      { role: "Comercial", line: detail?.commercialOwner ?? "" },
      { role: "Engenharia", line: detail?.technicalOwner ?? "" },
      { role: "Custos", line: "" },
    ],
  };
}

export function countQuickFormSections(_payload: ProjectIntakeQuickFormPayload): number {
  return PROJECT_INTAKE_QUICK_FORM_SECTION_COUNT;
}

export function isQuickFormMoreCompactThanFull(quickSectionCount: number, fullSectionCount: number): boolean {
  return quickSectionCount < fullSectionCount;
}
