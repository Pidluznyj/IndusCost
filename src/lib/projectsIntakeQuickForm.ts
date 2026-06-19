import { PROJECT_STATUS_LABEL, PROJECT_TYPE_LABEL } from "./projectsExecutiveReport.js";
import { isLaborStructureLine } from "./projectsUiUtils.js";
import type { ProjectDetail, ProjectType } from "@/src/types/projects.js";

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

export type QuickCompositionRow = {
  type: string;
  code: string | null;
  description: string | null;
  quantity: string | null;
  unit: string | null;
  estimatedCost: string | null;
  notes: string | null;
};

export type QuickProcessRow = {
  process: string | null;
  internalExternal: string | null;
  timeHh: string | null;
  hourRate: string | null;
  estimatedCost: string | null;
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
  compositionRows: QuickCompositionRow[];
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
  processRows: QuickProcessRow[];
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

function compositionFromDetail(detail: ProjectDetail | null): QuickCompositionRow[] {
  const rows: QuickCompositionRow[] = [];
  if (!detail) {
    return [
      { type: "MP", code: null, description: null, quantity: null, unit: null, estimatedCost: null, notes: null },
      { type: "Componente", code: null, description: null, quantity: null, unit: null, estimatedCost: null, notes: null },
      { type: "Serviço", code: null, description: null, quantity: null, unit: null, estimatedCost: null, notes: null },
      { type: "Embalagem", code: null, description: null, quantity: null, unit: null, estimatedCost: null, notes: null },
    ];
  }
  for (const item of detail.simulatedItems.slice(0, 6)) {
    const type =
      item.itemType === "RAW_MATERIAL"
        ? "MP"
        : item.itemType === "COMPONENT"
          ? "Componente"
          : item.itemType === "OUTSOURCED_PROCESS"
            ? "Serviço"
            : item.itemType === "PACKAGING"
              ? "Embalagem"
              : "Outro";
    rows.push({
      type,
      code: strOrNull(item.provisionalCode),
      description: strOrNull(item.description),
      quantity: null,
      unit: strOrNull(item.unit),
      estimatedCost: fmtMoney(item.estimatedUnitCost ?? item.quotedUnitCost),
      notes: strOrNull(item.notes),
    });
  }
  while (rows.length < 4) {
    const defaults = ["MP", "Componente", "Serviço", "Embalagem"];
    rows.push({
      type: defaults[rows.length] ?? "Outro",
      code: null,
      description: null,
      quantity: null,
      unit: null,
      estimatedCost: null,
      notes: null,
    });
  }
  return rows.slice(0, 6);
}

function processesFromDetail(detail: ProjectDetail | null): QuickProcessRow[] {
  const rows: QuickProcessRow[] = [];
  if (detail) {
    for (const line of detail.structureLines
      .filter((l) => isLaborStructureLine(l) || l.lineType === "PROCESS" || l.lineType === "SERVICE")
      .slice(0, 4)) {
      rows.push({
        process: strOrNull(line.descriptionSnapshot),
        internalExternal: line.lineType === "SERVICE" ? "Externo" : "Interno",
        timeHh: fmtNum(line.quantity),
        hourRate: fmtMoney(line.unitCostSnapshot),
        estimatedCost: fmtMoney(line.totalCost),
      });
    }
  }
  while (rows.length < 3) {
    rows.push({ process: null, internalExternal: null, timeHh: null, hourRate: null, estimatedCost: null });
  }
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
    compositionRows: compositionFromDetail(detail),
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
    processRows: processesFromDetail(detail),
    pendingItems: pendingFromDetail(detail),
    decisions: PROJECT_INTAKE_QUICK_DECISIONS.map((label) => ({ label, checked: false })),
    signatures: [
      { role: "Comercial", line: detail?.commercialOwner ?? "" },
      { role: "Engenharia", line: detail?.technicalOwner ?? "" },
      { role: "Custos", line: "" },
    ],
  };
}

export function countQuickFormSections(payload: ProjectIntakeQuickFormPayload): number {
  return 10;
}

export function isQuickFormMoreCompactThanFull(quickSectionCount: number, fullSectionCount: number): boolean {
  return quickSectionCount < fullSectionCount;
}
