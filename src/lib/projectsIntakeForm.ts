import {
  PROJECT_STATUS_LABEL,
  PROJECT_TYPE_LABEL,
} from "./projectsExecutiveReport.js";
import { isGuidedOtherCostItem } from "./projectsOtherCostGroups.js";
import { isLaborStructureLine } from "./projectsUiUtils.js";
import type {
  ProjectDetail,
  ProjectSimulatedItemRow,
  ProjectStructureLineRow,
  ProjectType,
} from "@/src/types/projects.js";

export const PROJECT_INTAKE_FORM_VERSION = "1.0";
export const PROJECT_INTAKE_FORM_TITLE = "Ficha de Abertura de Projeto";
export const PROJECT_INTAKE_FORM_BUTTON_LABEL = "Imprimir Ficha de Abertura";
export const PROJECT_INTAKE_FORM_BLANK_BUTTON_LABEL = "Ficha em branco";
export const PROJECT_INTAKE_FORM_ROUTE_SUFFIX = "intake-form";
export const PROJECT_INTAKE_FORM_PENDING_LABEL = "PENDENTE";
export const PROJECT_INTAKE_FORM_NOT_INFORMED = "—";

export const PROJECT_INTAKE_NATURE_OPTIONS = [
  "Novo produto completo",
  "Novo componente",
  "Alteração de produto existente",
  "Alteração de molde existente",
  "Construção de novo molde",
  "Construção de postiço/inserto",
  "Troca de matéria-prima",
  "Redução de custo",
  "Nacionalização de item",
  "Desenvolvimento para novo cliente",
  "Ajuste de qualidade",
  "Simulação de preço",
  "Projeto interno",
  "Outro",
] as const;

export const PROJECT_INTAKE_MINIMUM_FIELD_KEYS = [
  "projectName",
  "projectType",
  "customerName",
  "commercialOwner",
  "technicalOwner",
  "demandSummary",
  "productName",
  "projectObjective",
  "expectedMonthlyVolume",
  "budgetDeadline",
  "hasTechnicalDrawing",
  "requiresMoldOrTooling",
  "targetMarginOrPrice",
] as const;

export type ProjectIntakeMinimumFieldKey = (typeof PROJECT_INTAKE_MINIMUM_FIELD_KEYS)[number];

export const PROJECT_INTAKE_MINIMUM_FIELD_LABELS: Record<ProjectIntakeMinimumFieldKey, string> = {
  projectName: "Nome do projeto",
  projectType: "Tipo do projeto",
  customerName: "Cliente",
  commercialOwner: "Responsável comercial",
  technicalOwner: "Responsável técnico ou área",
  demandSummary: "Descrição da demanda",
  productName: "Produto/componente envolvido",
  projectObjective: "Objetivo do projeto",
  expectedMonthlyVolume: "Volume estimado",
  budgetDeadline: "Prazo esperado para orçamento",
  hasTechnicalDrawing: "Indicação de desenho/amostra/especificação",
  requiresMoldOrTooling: "Indicação de molde/ferramenta",
  targetMarginOrPrice: "Margem ou preço alvo",
};

export type IntakeFormMode = "blank" | "prefilled";

export type IntakeFieldRow = {
  key: string;
  label: string;
  value: string | null;
  required?: boolean;
  fullWidth?: boolean;
};

export type IntakeTableRow = Record<string, string | null>;

export type IntakeChecklistRow = {
  label: string;
  required: boolean;
  received: boolean | null;
  notes: string | null;
};

export type IntakeSignatureRow = {
  area: string;
  name: string | null;
  signature: string | null;
  date: string | null;
};

export type ProjectIntakeFormSection = {
  id: string;
  title: string;
  fields: IntakeFieldRow[];
  notes?: string | null;
  pageBreakBefore?: boolean;
};

export type ProjectIntakeFormPayload = {
  version: string;
  mode: IntakeFormMode;
  generatedAt: string;
  generatedBy: string | null;
  header: {
    projectCode: string | null;
    projectName: string | null;
    customerName: string | null;
    projectTypeLabel: string | null;
    openedAt: string | null;
    commercialOwner: string | null;
    statusLabel: string | null;
  };
  sections: ProjectIntakeFormSection[];
  materialsTable: IntakeTableRow[];
  bomTable: IntakeTableRow[];
  processesTable: IntakeTableRow[];
  moldInvestmentsTable: IntakeTableRow[];
  additionalCostsTable: IntakeTableRow[];
  scenariosTable: IntakeTableRow[];
  milestonesTable: IntakeTableRow[];
  testsTable: IntakeTableRow[];
  documentsChecklist: IntakeChecklistRow[];
  risksTable: IntakeTableRow[];
  signatures: IntakeSignatureRow[];
  pendingMinimumFields: string[];
  canAdvanceBeyondDraft: boolean;
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

function field(
  key: string,
  label: string,
  value: string | null | undefined,
  options?: { required?: boolean; fullWidth?: boolean }
): IntakeFieldRow {
  const trimmed = value?.trim();
  return {
    key,
    label,
    value: trimmed && trimmed.length > 0 ? trimmed : null,
    required: options?.required,
    fullWidth: options?.fullWidth,
  };
}

function yesNoFromBool(value: boolean | null | undefined): string | null {
  if (value == null) return null;
  return value ? "Sim" : "Não";
}

function mapProjectNature(type: ProjectType | null | undefined): string | null {
  if (!type) return null;
  return PROJECT_TYPE_LABEL[type] ?? null;
}

function structureOriginLabel(line: ProjectStructureLineRow): string {
  switch (line.sourceType) {
    case "EXISTING_PRODUCT":
    case "EXISTING_MATERIAL":
      return "Oficial";
    case "SIMULATED_ITEM":
      return "Simulado";
    case "MANUAL":
      return "Manual";
    default:
      return line.sourceType;
  }
}

function itemTypeLabel(item: ProjectSimulatedItemRow): string {
  const map: Record<string, string> = {
    RAW_MATERIAL: "MP",
    COMPONENT: "Componente",
    PACKAGING: "Embalagem",
    SERVICE: "Serviço",
    MOLD: "Molde",
    TOOLING: "Ferramenta",
    OUTSOURCED_PROCESS: "Terceiro",
    OTHER: "Outro",
    FINISHED_PRODUCT: "Produto acabado",
  };
  return map[item.itemType] ?? item.itemType;
}

function emptyTableRows(
  columns: string[],
  count: number,
  fill?: IntakeTableRow[]
): IntakeTableRow[] {
  const rows = [...(fill ?? [])];
  while (rows.length < count) {
    rows.push(Object.fromEntries(columns.map((c) => [c, null])));
  }
  return rows;
}

function buildMaterialsTable(detail: ProjectDetail | null): IntakeTableRow[] {
  if (!detail) {
    return emptyTableRows(
      ["type", "code", "description", "quantity", "unit", "estimatedCost", "supplier", "notes"],
      4
    );
  }
  const rows: IntakeTableRow[] = detail.simulatedItems.map((item) => ({
    type: itemTypeLabel(item),
    code: item.provisionalCode,
    description: item.description,
    quantity: null,
    unit: item.unit,
    estimatedCost: fmtMoney(item.estimatedUnitCost ?? item.quotedUnitCost),
    supplier: item.supplierName,
    notes: item.notes,
  }));
  return emptyTableRows(
    ["type", "code", "description", "quantity", "unit", "estimatedCost", "supplier", "notes"],
    Math.max(4, rows.length),
    rows
  );
}

function buildBomTable(detail: ProjectDetail | null): IntakeTableRow[] {
  if (!detail) {
    return emptyTableRows(
      ["level", "itemType", "code", "description", "quantity", "unit", "lossPercent", "unitCost", "origin", "notes"],
      4
    );
  }
  const rows: IntakeTableRow[] = detail.structureLines
    .filter((l) => l.countsInSimulatedProductCost !== false)
    .map((line) => ({
      level: line.level != null ? String(line.level) : null,
      itemType: line.lineType,
      code: line.simulatedItemId ?? line.existingProductId ?? line.existingMaterialId,
      description: line.descriptionSnapshot,
      quantity: fmtNum(line.quantity),
      unit: line.unitSnapshot,
      lossPercent: fmtNum(line.lossPercent, "%"),
      unitCost: fmtMoney(line.unitCostSnapshot),
      origin: structureOriginLabel(line),
      notes: line.notes,
    }));
  return emptyTableRows(
    ["level", "itemType", "code", "description", "quantity", "unit", "lossPercent", "unitCost", "origin", "notes"],
    Math.max(4, rows.length),
    rows
  );
}

function buildProcessesTable(detail: ProjectDetail | null): IntakeTableRow[] {
  if (!detail) {
    return emptyTableRows(
      ["process", "internalExternal", "machine", "timeHh", "hourlyRate", "totalCost", "notes"],
      3
    );
  }
  const rows: IntakeTableRow[] = detail.structureLines
    .filter((l) => isLaborStructureLine(l) || l.lineType === "PROCESS" || l.lineType === "SERVICE")
    .map((line) => ({
      process: line.descriptionSnapshot,
      internalExternal: line.sourceType === "MANUAL" ? "Interno" : structureOriginLabel(line),
      machine: line.costSource,
      timeHh: fmtNum(line.quantity),
      hourlyRate: fmtMoney(line.unitCostSnapshot),
      totalCost: fmtMoney(line.totalCost),
      notes: line.notes,
    }));
  return emptyTableRows(
    ["process", "internalExternal", "machine", "timeHh", "hourlyRate", "totalCost", "notes"],
    Math.max(3, rows.length),
    rows
  );
}

function buildMoldTable(detail: ProjectDetail | null): IntakeTableRow[] {
  if (!detail) {
    return emptyTableRows(
      ["item", "description", "internalExternal", "supplier", "estimatedCost", "amortizes", "amortizationQty", "notes"],
      3
    );
  }
  const rows: IntakeTableRow[] = detail.molds.map((mold) => ({
    item: "Molde",
    description: mold.name,
    internalExternal: mold.supplierName ? "Externo" : "Interno",
    supplier: mold.supplierName,
    estimatedCost: fmtMoney(mold.constructionCost),
    amortizes: mold.chargeMode === "AMORTIZED_IN_PRODUCT" ? "Sim" : "Não",
    amortizationQty: fmtNum(mold.amortizationQuantity),
    notes: mold.notes,
  }));
  return emptyTableRows(
    ["item", "description", "internalExternal", "supplier", "estimatedCost", "amortizes", "amortizationQty", "notes"],
    Math.max(3, rows.length),
    rows
  );
}

function buildAdditionalCostsTable(detail: ProjectDetail | null): IntakeTableRow[] {
  if (!detail) {
    return emptyTableRows(
      ["category", "description", "estimatedValue", "recurring", "amortizes", "notes"],
      3
    );
  }
  const rows: IntakeTableRow[] = detail.simulatedItems
    .filter((i) => isGuidedOtherCostItem(i.notes))
    .map((item) => ({
      category: itemTypeLabel(item),
      description: item.description,
      estimatedValue: fmtMoney(item.estimatedUnitCost ?? item.quotedUnitCost),
      recurring: "Não",
      amortizes: null,
      notes: item.notes,
    }));
  return emptyTableRows(
    ["category", "description", "estimatedValue", "recurring", "amortizes", "notes"],
    Math.max(3, rows.length),
    rows
  );
}

function buildScenariosTable(detail: ProjectDetail | null): IntakeTableRow[] {
  const base: IntakeTableRow[] = [
    { scenario: "Conservador", volume: null, estimatedCost: null, margin: null, suggestedPrice: null, notes: null },
    { scenario: "Provável", volume: null, estimatedCost: null, margin: null, suggestedPrice: null, notes: null },
    { scenario: "Otimista", volume: null, estimatedCost: null, margin: null, suggestedPrice: null, notes: null },
  ];
  if (!detail) return base;
  const unitCost = detail.costBreakdown?.unitCost;
  const margin =
    detail.targetMarginPercent ??
    detail.currentVersion?.marginPercent ??
    detail.projectPricing?.config.defaultMarginPercent ??
    null;
  const price =
    detail.targetPrice ??
    detail.currentVersion?.suggestedPrice ??
    detail.costBreakdown?.suggestedPrice ??
    null;
  base[1] = {
    scenario: "Provável",
    volume: fmtNum(detail.expectedMonthlyVolume),
    estimatedCost: fmtMoney(unitCost),
    margin: fmtNum(margin, "%"),
    suggestedPrice: fmtMoney(price),
    notes: detail.projectPricing?.hasSavedPricing ? "Pricing salvo no projeto" : null,
  };
  return base;
}

const DEFAULT_MILESTONES = [
  "Receber dados técnicos",
  "Validar engenharia",
  "Estimar custos",
  "Cotar terceiros",
  "Simular preço",
  "Aprovar internamente",
  "Enviar proposta",
  "Retorno do cliente",
];

const DEFAULT_DOCUMENTS: IntakeChecklistRow[] = [
  { label: "Desenho técnico 2D", required: true, received: null, notes: null },
  { label: "Modelo 3D", required: false, received: null, notes: null },
  { label: "Amostra física", required: false, received: null, notes: null },
  { label: "Foto do produto", required: false, received: null, notes: null },
  { label: "Especificação técnica", required: true, received: null, notes: null },
  { label: "BOM do cliente", required: false, received: null, notes: null },
  { label: "Norma técnica", required: false, received: null, notes: null },
  { label: "Embalagem/referência", required: false, received: null, notes: null },
  { label: "Produto similar", required: false, received: null, notes: null },
  { label: "Cotação de fornecedor", required: false, received: null, notes: null },
  { label: "Pedido/proposta vinculada", required: false, received: null, notes: null },
];

const DEFAULT_SIGNATURES: IntakeSignatureRow[] = [
  { area: "Comercial", name: null, signature: null, date: null },
  { area: "Engenharia", name: null, signature: null, date: null },
  { area: "Custos/Orçamento", name: null, signature: null, date: null },
  { area: "Produção", name: null, signature: null, date: null },
  { area: "Qualidade", name: null, signature: null, date: null },
  { area: "Diretoria, se necessário", name: null, signature: null, date: null },
];

function primaryProductName(detail: ProjectDetail | null): string | null {
  if (!detail) return null;
  if (detail.simulatedProducts[0]?.description) return detail.simulatedProducts[0].description;
  if (detail.simulatedItems[0]?.description) return detail.simulatedItems[0].description;
  const official = Object.values(detail.snapshotRootProducts ?? {})[0];
  return official?.name ?? null;
}

function hasOfficialSnapshot(detail: ProjectDetail | null): boolean {
  return !!detail && Object.keys(detail.snapshotRootProducts ?? {}).length > 0;
}

function buildSections(detail: ProjectDetail | null): ProjectIntakeFormSection[] {
  const product = detail?.simulatedProducts[0] ?? null;
  const hasBom = (detail?.structureLines.length ?? 0) > 0;
  const hasProcesses = (detail?.structureLines.some((l) => isLaborStructureLine(l) || l.lineType === "PROCESS") ?? false);
  const hasMolds = (detail?.molds.length ?? 0) > 0;
  const officialSkus = detail
    ? Object.values(detail.snapshotRootProducts)
        .map((p) => p.sku)
        .join(", ")
    : null;

  return [
    {
      id: "identification",
      title: "1. Identificação do projeto",
      fields: [
        field("projectCode", "Código interno do projeto", detail?.code, { required: true }),
        field("projectName", "Nome do projeto", detail?.title, { required: true }),
        field("projectType", "Tipo de projeto", mapProjectNature(detail?.projectType), { required: true }),
        field("priority", "Prioridade", null, { required: true }),
        field("initialStatus", "Status inicial", detail ? PROJECT_STATUS_LABEL[detail.status] : null, { required: true }),
        field("openedAt", "Data de abertura", fmtDate(detail?.createdAt ?? null), { required: true }),
        field("internalRequester", "Solicitante interno", null, { required: true }),
        field("requestingArea", "Área solicitante", null, { required: true }),
        field("commercialOwner", "Responsável comercial", detail?.commercialOwner, { required: true }),
        field("technicalOwner", "Responsável técnico/engenharia", detail?.technicalOwner, { required: true }),
        field("companyGroup", "Empresa do grupo", detail?.notes?.includes("Koppetel") ? "Koppetel" : null, { required: true }),
        field("developmentSite", "Unidade/local de desenvolvimento", null),
        field("demandSummary", "Resumo / descrição inicial da demanda", detail?.description, {
          required: true,
          fullWidth: true,
        }),
      ],
    },
    {
      id: "customer",
      title: "2. Dados do cliente",
      pageBreakBefore: true,
      fields: [
        field("customerInSystem", "Cliente existente no sistema", detail?.customerName ? "Sim" : null),
        field("customerLegalName", "Nome/Razão social", detail?.customerName, { required: true }),
        field("customerDocument", "CNPJ/CPF", detail?.customerDocument, { required: true }),
        field("tradeName", "Nome fantasia", null),
        field("mainContact", "Contato principal", null, { required: true }),
        field("contactRole", "Cargo do contato", null),
        field("phone", "Telefone", null, { required: true }),
        field("whatsapp", "WhatsApp", null),
        field("email", "E-mail", null, { required: true }),
        field("cityState", "Cidade/Estado", null, { required: true }),
        field("segment", "Segmento de atuação", null),
        field("customerRecurrence", "Cliente novo ou recorrente", null, { required: true }),
        field("commercialAgreement", "Existe contrato ou acordo comercial?", null),
        field("customerSpecProvided", "Cliente forneceu especificação técnica?", null, { required: true }),
        field("customerNotes", "Informações comerciais relevantes", detail?.notes, { fullWidth: true }),
      ],
    },
    {
      id: "classification",
      title: "3. Classificação do projeto",
      pageBreakBefore: true,
      fields: [
        field("projectNature", "Natureza do projeto", mapProjectNature(detail?.projectType), { required: true }),
        field("relatedOfficialProduct", "Produto oficial relacionado", officialSkus),
        field("currentProductCode", "Código do produto atual", officialSkus),
        field("currentProductName", "Nome do produto atual", primaryProductName(detail)),
        field("linkedProposalOrder", "Vinculado a pedido/proposta?", null),
        field("replacesCurrentItem", "É substituição de item atual?", null),
        field("physicalSample", "Existe amostra física?", null),
        field("hasTechnicalDrawing", "Existe desenho técnico?", hasOfficialSnapshot(detail) ? "Em desenvolvimento" : null, {
          required: true,
        }),
        field("has3dModel", "Existe modelo 3D?", null),
        field("similarInSystem", "Existe peça similar no sistema?", hasOfficialSnapshot(detail) ? "Sim" : null),
      ],
    },
    {
      id: "technical-objective",
      title: "4. Objetivo técnico do projeto",
      pageBreakBefore: true,
      fields: [
        field("problemOpportunity", "Problema ou oportunidade", detail?.description, { required: true }),
        field("expectedResult", "Resultado esperado", null, { required: true }),
        field("criticalRequirements", "Requisitos críticos", null, { required: true }),
        field("technicalConstraints", "Restrições técnicas", null),
        field("qualityRequirements", "Requisitos de qualidade", null, { required: true }),
        field("packagingRequirements", "Requisitos de embalagem", null),
        field("assemblyRequirements", "Requisitos de montagem", null),
        field("traceabilityRequirements", "Requisitos de rastreabilidade", null),
        field("legalRequirements", "Requisitos legais/normativos", null),
        field("knownTechnicalRisks", "Riscos técnicos conhecidos", null),
        field("detailedTechnicalDescription", "Descrição técnica detalhada", detail?.description, {
          required: true,
          fullWidth: true,
        }),
      ],
    },
    {
      id: "product",
      title: "5. Produto ou componente a desenvolver",
      pageBreakBefore: true,
      fields: [
        field("productName", "Nome do item/produto", product?.description ?? primaryProductName(detail), { required: true }),
        field("suggestedCode", "Código sugerido", product?.provisionalCode),
        field("productFamily", "Família do produto", null),
        field("unit", "Unidade de medida", product?.unit ?? "UN", { required: true }),
        field("estimatedWeight", "Peso estimado", fmtNum(product?.estimatedWeight, " kg")),
        field("mainDimensions", "Dimensões principais", null),
        field("colorFinish", "Cor/acabamento", null),
        field("application", "Aplicação do produto", null, { required: true }),
        field("parentProduct", "Produto pai", null),
        field("childComponent", "Produto filho/componente", null),
        field("purchasedOrManufactured", "Item comprado ou fabricado", null, { required: true }),
        field("expectedProcess", "Processo produtivo esperado", hasProcesses ? "Definido parcialmente no projeto" : null),
      ],
    },
    {
      id: "materials",
      title: "6. Materiais e componentes",
      pageBreakBefore: true,
      fields: [
        field("mainMaterialKnown", "Matéria-prima principal conhecida?", detail?.simulatedItems.some((i) => i.itemType === "RAW_MATERIAL") ? "Sim" : null, { required: true }),
        field("mainMaterialCode", "Código da matéria-prima oficial", null),
        field("materialName", "Nome/material", null),
        field("suggestedSupplier", "Fornecedor sugerido", null),
        field("estimatedConsumption", "Consumo estimado por peça", null),
        field("consumptionUnit", "Unidade de consumo", null),
        field("estimatedLossPercent", "Perda estimada %", null),
        field("estimatedUnitCost", "Custo estimado unitário", fmtMoney(detail?.costBreakdown?.rawMaterialCost)),
        field("alternativeMaterialAllowed", "Material alternativo permitido?", null),
        field("purchasedComponentsNeeded", "Componentes comprados necessários?", detail?.simulatedItems.some((i) => i.itemType === "COMPONENT") ? "Sim" : null),
        field("manufacturedComponentsNeeded", "Componentes fabricados necessários?", null),
        field("supplierRestriction", "Restrição de marca/fornecedor?", null),
      ],
    },
    {
      id: "bom",
      title: "7. Estrutura / BOM prevista",
      pageBreakBefore: true,
      fields: [
        field("willHaveBom", "Produto terá estrutura/BOM?", yesNoFromBool(hasBom), { required: true }),
        field("existingBomToCopy", "Existe BOM atual para copiar?", yesNoFromBool(hasOfficialSnapshot(detail))),
        field("officialBaseProduct", "Produto oficial base", officialSkus),
        field("newStructure", "A estrutura será nova?", yesNoFromBool(hasBom && !hasOfficialSnapshot(detail))),
        field("simulatedComponent", "Haverá componente simulado?", yesNoFromBool((detail?.simulatedItems.length ?? 0) > 0)),
        field("manualLines", "Haverá linha manual?", yesNoFromBool(detail?.structureLines.some((l) => l.sourceType === "MANUAL") ?? false)),
        field("outsourcedItems", "Haverá item de terceiros?", yesNoFromBool(detail?.simulatedItems.some((i) => i.itemType === "OUTSOURCED_PROCESS") ?? false)),
      ],
    },
    {
      id: "process",
      title: "8. Processo produtivo / HH",
      pageBreakBefore: true,
      fields: [
        field("processDefined", "Existe processo produtivo definido?", yesNoFromBool(hasProcesses), { required: true }),
        field("canCopyOfficialRouting", "Pode copiar roteiro oficial?", yesNoFromBool(hasOfficialSnapshot(detail))),
        field("mainProcess", "Processo principal", hasProcesses ? "Ver tabela de processos" : null, { required: true }),
        field("machineEquipment", "Máquina/equipamento necessário", null),
        field("cycleTime", "Tempo de ciclo estimado", null),
        field("cavities", "Cavidades", fmtNum(detail?.molds[0]?.cavities)),
        field("partsPerCycle", "Peças por ciclo", null),
        field("setupRequired", "Setup necessário", null),
        field("setupTime", "Tempo de setup (HH)", null),
        field("directLabor", "Mão de obra direta (HH)", fmtNum(detail?.costBreakdown?.serviceCost ? detail.costBreakdown.serviceCost : null)),
        field("indirectLabor", "Mão de obra indireta (HH)", null),
        field("externalService", "Serviço externo", null),
        field("internalHourCost", "Custo hora interno", null),
        field("externalHourCost", "Custo hora externo", null),
      ],
    },
    {
      id: "mold",
      title: "9. Molde, ferramenta ou dispositivo",
      pageBreakBefore: true,
      fields: [
        field("requiresMoldOrTooling", "Projeto exige molde/ferramenta?", yesNoFromBool(hasMolds), { required: true }),
        field("toolingType", "Tipo", detail?.molds[0]?.moldType),
        field("relatedExistingMold", "Molde existente relacionado", null),
        field("cavityCount", "Número de cavidades", fmtNum(detail?.molds[0]?.cavities)),
        field("moldMaterial", "Material do molde/postiço", null),
        field("estimatedLife", "Vida útil estimada", fmtNum(detail?.molds[0]?.estimatedLifeCycles, " ciclos")),
        field("estimatedMoldCost", "Custo estimado", fmtMoney(detail?.molds[0]?.constructionCost)),
        field("toolingSupplier", "Fornecedor/ferramenteiro", detail?.molds[0]?.supplierName),
        field("constructionLeadTime", "Prazo de construção (dias)", fmtNum(detail?.molds[0]?.leadTimeDays)),
        field("needsT0Sample", "Precisa de amostra T0/T1?", null),
        field("needsCustomerApproval", "Precisa de aprovação do cliente?", null),
        field("amortizedInPrice", "Será amortizado no preço?", detail?.molds[0] ? (detail.molds[0].chargeMode === "AMORTIZED_IN_PRODUCT" ? "Sim" : "Não") : null, { required: true }),
        field("amortizationQuantity", "Quantidade para amortização", fmtNum(detail?.molds[0]?.amortizationQuantity)),
        field("amortizedUnitValue", "Valor unitário amortizado", fmtMoney(detail?.molds[0]?.amortizedCostPerUnit)),
      ],
    },
    {
      id: "additional-costs",
      title: "10. Custos adicionais",
      pageBreakBefore: true,
      fields: [
        field("developmentCost", "Custo de desenvolvimento?", null),
        field("prototypeCost", "Custo de amostra/protótipo?", null),
        field("packagingDevCost", "Custo de embalagem?", null),
        field("specialLogistics", "Custo logístico especial?", null),
        field("certificationCost", "Custo de certificação/teste?", null),
        field("outsourcingCost", "Custo de terceirização?", null),
        field("technicalVisitCost", "Custo de visita técnica?", null),
      ],
    },
    {
      id: "commercial",
      title: "11. Volume, preço e condições comerciais",
      pageBreakBefore: true,
      fields: [
        field("expectedMonthlyVolume", "Volume mensal estimado", fmtNum(detail?.expectedMonthlyVolume), { required: true }),
        field("expectedAnnualVolume", "Volume anual estimado", fmtNum(detail?.expectedMonthlyVolume ? detail.expectedMonthlyVolume * 12 : null), { required: true }),
        field("minimumLot", "Lote mínimo esperado (MOQ)", fmtNum(product?.batchSize)),
        field("purchaseFrequency", "Frequência de compra", null),
        field("targetCustomerPrice", "Preço alvo do cliente", fmtMoney(detail?.targetPrice)),
        field("currentPrice", "Preço atual", null),
        field("targetMarginOrPrice", "Margem desejada", fmtNum(detail?.targetMarginPercent ?? detail?.projectPricing?.config.defaultMarginPercent, "%"), { required: true }),
        field("desiredMarkup", "Markup desejado", fmtNum(detail?.costBreakdown?.markupPercent, "%")),
        field("paymentTerms", "Condição de pagamento esperada", null),
        field("freightIncoterm", "Incoterm/frete", null),
        field("taxesConsidered", "Impostos considerados", detail?.projectPricing?.config.fiscalRuleId ? "Sim" : null),
        field("amortizationInPrice", "Amortização embutida no preço?", yesNoFromBool((detail?.molds.length ?? 0) > 0)),
        field("proposalValidityDays", "Prazo de validade da proposta (dias)", null),
        field("calculatedUnitCost", "Custo unitário calculado", fmtMoney(detail?.costBreakdown?.unitCost)),
        field("suggestedPrice", "Preço sugerido calculado", fmtMoney(detail?.costBreakdown?.suggestedPrice ?? detail?.currentVersion?.suggestedPrice)),
      ],
    },
    {
      id: "schedule",
      title: "12. Prazos e marcos do projeto",
      pageBreakBefore: true,
      fields: [
        field("budgetDeadline", "Data limite para orçamento", null, { required: true }),
        field("prototypeDesiredDate", "Data desejada para protótipo", null),
        field("sampleDesiredDate", "Data desejada para amostra", null),
        field("productionStartDesired", "Data desejada para início de produção", null),
        field("criticalDeadline", "Prazo do cliente é crítico?", null, { required: true }),
        field("penaltyForDelay", "Existe penalidade por atraso?", null),
        field("commercialPriority", "Prioridade comercial", null, { required: true }),
      ],
    },
    {
      id: "quality",
      title: "13. Qualidade, testes e validações",
      pageBreakBefore: true,
      fields: [
        field("dimensionalTest", "Exige teste dimensional?", null),
        field("functionalTest", "Exige teste funcional?", null),
        field("sealTest", "Exige teste de vedação?", null),
        field("strengthTest", "Exige teste de resistência?", null),
        field("certificateRequired", "Exige laudo/certificado?", null),
        field("customerSampleApproval", "Exige aprovação de amostra pelo cliente?", null),
        field("approvalCriteria", "Critérios de aprovação", null, { required: true }),
        field("criticalTolerances", "Tolerâncias críticas", null),
        field("similarProblemHistory", "Histórico de problema semelhante", null),
      ],
    },
    {
      id: "documents",
      title: "14. Documentos e anexos necessários",
      pageBreakBefore: true,
      fields: [
        field("attachmentsList", "Lista de anexos recebidos ou pendentes", null, { fullWidth: true }),
      ],
    },
    {
      id: "risks",
      title: "15. Riscos e pendências",
      pageBreakBefore: true,
      fields: [
        field("incompleteTechnicalData", "Dados técnicos incompletos?", null, { required: true }),
        field("undefinedMaterialCost", "Custo de material indefinido?", null, { required: true }),
        field("undefinedProcess", "Processo indefinido?", yesNoFromBool(!hasProcesses), { required: true }),
        field("undefinedMold", "Molde/ferramenta indefinido?", null, { required: true }),
        field("undefinedVolume", "Volume indefinido?", yesNoFromBool(!detail?.expectedMonthlyVolume), { required: true }),
        field("criticalSchedule", "Prazo crítico?", null, { required: true }),
        field("supplierDependency", "Dependência de fornecedor?", null),
        field("customerApprovalDependency", "Dependência de aprovação do cliente?", null),
        field("technicalFeasibilityRisk", "Risco de inviabilidade técnica?", null),
        field("commercialFeasibilityRisk", "Risco de inviabilidade comercial?", null),
      ],
    },
    {
      id: "approval",
      title: "16. Aprovação para seguir com o estudo",
      pageBreakBefore: true,
      fields: [
        field("canProceedSimulation", "Projeto pode seguir para simulação?", null, { required: true }),
        field("minimumDataReceived", "Dados mínimos recebidos?", null, { required: true }),
        field("engineeringApproves", "Engenharia aprova análise inicial?", null, { required: true }),
        field("commercialApproves", "Comercial aprova análise inicial?", null, { required: true }),
        field("directorApprovalNeeded", "Diretoria precisa aprovar?", null),
        field("approvalNotes", "Observações da aprovação", null, { fullWidth: true }),
      ],
    },
  ];
}

function collectMinimumFieldValues(detail: ProjectDetail | null): Record<ProjectIntakeMinimumFieldKey, string | null> {
  const productName = primaryProductName(detail);
  const marginOrPrice =
    detail?.targetMarginPercent != null
      ? fmtNum(detail.targetMarginPercent, "%")
      : detail?.targetPrice != null
        ? fmtMoney(detail.targetPrice)
        : null;
  return {
    projectName: detail?.title?.trim() ?? null,
    projectType: detail ? PROJECT_TYPE_LABEL[detail.projectType] : null,
    customerName: detail?.customerName?.trim() ?? null,
    commercialOwner: detail?.commercialOwner?.trim() ?? null,
    technicalOwner: detail?.technicalOwner?.trim() ?? null,
    demandSummary: detail?.description?.trim() ?? null,
    productName: productName?.trim() ?? null,
    projectObjective: detail?.description?.trim() ?? null,
    expectedMonthlyVolume: fmtNum(detail?.expectedMonthlyVolume),
    budgetDeadline: null,
    hasTechnicalDrawing: hasOfficialSnapshot(detail) ? "Parcial" : null,
    requiresMoldOrTooling: detail ? yesNoFromBool(detail.molds.length > 0) : null,
    targetMarginOrPrice: marginOrPrice,
  };
}

export function listIntakeFormPendingMinimumFields(
  detail: ProjectDetail | null
): string[] {
  const values = collectMinimumFieldValues(detail);
  const pending: string[] = [];
  for (const key of PROJECT_INTAKE_MINIMUM_FIELD_KEYS) {
    const value = values[key];
    if (!value?.trim()) {
      pending.push(PROJECT_INTAKE_MINIMUM_FIELD_LABELS[key]);
    }
  }
  return pending;
}

export function buildBlankProjectIntakeForm(options?: {
  generatedAt?: Date;
  generatedBy?: string | null;
}): ProjectIntakeFormPayload {
  const generatedAt = (options?.generatedAt ?? new Date()).toISOString();
  const pending = listIntakeFormPendingMinimumFields(null);
  return {
    version: PROJECT_INTAKE_FORM_VERSION,
    mode: "blank",
    generatedAt,
    generatedBy: options?.generatedBy ?? null,
    header: {
      projectCode: null,
      projectName: null,
      customerName: null,
      projectTypeLabel: null,
      openedAt: fmtDate(generatedAt),
      commercialOwner: null,
      statusLabel: "Rascunho",
    },
    sections: buildSections(null),
    materialsTable: buildMaterialsTable(null),
    bomTable: buildBomTable(null),
    processesTable: buildProcessesTable(null),
    moldInvestmentsTable: buildMoldTable(null),
    additionalCostsTable: buildAdditionalCostsTable(null),
    scenariosTable: buildScenariosTable(null),
    milestonesTable: DEFAULT_MILESTONES.map((name) => ({
      milestone: name,
      owner: null,
      plannedDate: null,
      status: null,
      notes: null,
    })),
    testsTable: [
      { test: "Dimensional", required: null, owner: null, acceptanceCriteria: null, notes: null },
      { test: "Funcional", required: null, owner: null, acceptanceCriteria: null, notes: null },
      { test: "Vedação", required: null, owner: null, acceptanceCriteria: null, notes: null },
      { test: "Resistência", required: null, owner: null, acceptanceCriteria: null, notes: null },
      { test: "Cliente", required: null, owner: null, acceptanceCriteria: null, notes: null },
    ],
    documentsChecklist: DEFAULT_DOCUMENTS.map((row) => ({ ...row })),
    risksTable: emptyTableRows(["risk", "ownerArea", "impact", "resolveBy", "status"], 3),
    signatures: DEFAULT_SIGNATURES.map((row) => ({ ...row })),
    pendingMinimumFields: pending,
    canAdvanceBeyondDraft: false,
  };
}

export function buildProjectIntakeFormFromDetail(
  detail: ProjectDetail,
  options?: { generatedAt?: Date; generatedBy?: string | null }
): ProjectIntakeFormPayload {
  const generatedAt = (options?.generatedAt ?? new Date()).toISOString();
  const pending = listIntakeFormPendingMinimumFields(detail);
  return {
    version: PROJECT_INTAKE_FORM_VERSION,
    mode: "prefilled",
    generatedAt,
    generatedBy: options?.generatedBy ?? null,
    header: {
      projectCode: detail.code,
      projectName: detail.title,
      customerName: detail.customerName,
      projectTypeLabel: PROJECT_TYPE_LABEL[detail.projectType],
      openedAt: fmtDate(detail.createdAt),
      commercialOwner: detail.commercialOwner,
      statusLabel: PROJECT_STATUS_LABEL[detail.status],
    },
    sections: buildSections(detail),
    materialsTable: buildMaterialsTable(detail),
    bomTable: buildBomTable(detail),
    processesTable: buildProcessesTable(detail),
    moldInvestmentsTable: buildMoldTable(detail),
    additionalCostsTable: buildAdditionalCostsTable(detail),
    scenariosTable: buildScenariosTable(detail),
    milestonesTable: DEFAULT_MILESTONES.map((name) => ({
      milestone: name,
      owner: null,
      plannedDate: null,
      status: null,
      notes: null,
    })),
    testsTable: [
      { test: "Dimensional", required: null, owner: null, acceptanceCriteria: null, notes: null },
      { test: "Funcional", required: null, owner: null, acceptanceCriteria: null, notes: null },
      { test: "Vedação", required: null, owner: null, acceptanceCriteria: null, notes: null },
      { test: "Resistência", required: null, owner: null, acceptanceCriteria: null, notes: null },
      { test: "Cliente", required: null, owner: null, acceptanceCriteria: null, notes: null },
    ],
    documentsChecklist: DEFAULT_DOCUMENTS.map((row) => ({ ...row })),
    risksTable: emptyTableRows(["risk", "ownerArea", "impact", "resolveBy", "status"], 3),
    signatures: DEFAULT_SIGNATURES.map((row) => ({
      ...row,
      name:
        row.area === "Comercial"
          ? detail.commercialOwner
          : row.area === "Engenharia"
            ? detail.technicalOwner
            : null,
    })),
    pendingMinimumFields: pending,
    canAdvanceBeyondDraft: pending.length === 0,
  };
}

export const PROJECT_INTAKE_FORM_BLANK_PATH = `/projects/${PROJECT_INTAKE_FORM_ROUTE_SUFFIX}`;

export function getProjectIntakeFormPath(projectId: string): string {
  return `/projects/${projectId}/${PROJECT_INTAKE_FORM_ROUTE_SUFFIX}`;
}

export function getProjectIntakeFormPrintPath(projectId: string): string {
  return `${getProjectIntakeFormPath(projectId)}/print`;
}

export function getBlankIntakeFormPrintPath(): string {
  return `${PROJECT_INTAKE_FORM_BLANK_PATH}/print`;
}

export function isProjectIntakeFormPath(pathname: string): boolean {
  const parts = pathname.replace(/^\//, "").split("/").filter(Boolean);
  if (parts[0] !== "projects") return false;
  if (parts[1] === PROJECT_INTAKE_FORM_ROUTE_SUFFIX) return true;
  return !!parts[1] && parts[2] === PROJECT_INTAKE_FORM_ROUTE_SUFFIX;
}

export function isBlankProjectIntakeFormPath(pathname: string): boolean {
  const parts = pathname.replace(/^\//, "").split("/").filter(Boolean);
  return parts[0] === "projects" && parts[1] === PROJECT_INTAKE_FORM_ROUTE_SUFFIX;
}

export function parseProjectIntakeFormProjectId(pathname: string): string | null {
  const parts = pathname.replace(/^\//, "").split("/").filter(Boolean);
  if (parts[0] !== "projects" || !parts[1] || parts[1] === PROJECT_INTAKE_FORM_ROUTE_SUFFIX) return null;
  if (parts[2] !== PROJECT_INTAKE_FORM_ROUTE_SUFFIX) return null;
  return parts[1];
}

export function intakeFormPathRequestsPrint(pathname: string): boolean {
  const parts = pathname.replace(/^\//, "").split("/").filter(Boolean);
  return parts[parts.length - 1] === "print";
}
