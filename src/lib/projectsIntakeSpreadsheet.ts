import * as XLSX from "xlsx";
import {
  PROJECT_INTAKE_QUICK_DELIVERABLES,
  PROJECT_INTAKE_QUICK_ESTIMATE_ITEMS,
  PROJECT_INTAKE_QUICK_PENDING_ITEMS,
  buildQuickIntakeFormFromDetail,
  type ProjectQuickFormContext,
} from "./projectsIntakeQuickForm.js";
import { isGuidedOtherCostItem, OTHER_COST_GROUP_LABEL, parseOtherCostMeta, parseOtherCostUserNotes, resolveOtherCostItemLineTotal } from "./projectsOtherCostGroups.js";
import { isLaborStructureLine } from "./projectsUiUtils.js";
import { documentUserNotes } from "./projectsDocumentCodes.js";
import { PROJECT_TYPE_LABEL } from "./projectsExecutiveReport.js";
import { projectPriorityLabel } from "./projectsCommercialTerms.js";
import {
  formatDocumentDateTime,
  type ProjectDocumentHeader,
} from "./projectsDocumentHeader.js";
import type { ProjectDetail } from "@/src/types/projects.js";

export const PROJECT_INTAKE_SPREADSHEET_VERSION = "2.0";
/** Aba com o exemplo ilustrativo (610.51AA) — separada dos dados reais. */
export const PROJECT_INTAKE_SPREADSHEET_EXAMPLE_SHEET = "99_Exemplo";
/** Aba de identificação do documento (emitente, cliente, projeto, emissão, origem dos valores). */
export const PROJECT_INTAKE_SPREADSHEET_DOCUMENT_SHEET = "00_Documento";
export const PROJECT_INTAKE_SPREADSHEET_EXAMPLE_NOTE = "EXEMPLO ILUSTRATIVO — não é dado do projeto; não importar";
export const PROJECT_INTAKE_SPREADSHEET_FILENAME = "modelo-projeto-induscost.xlsx";
export const PROJECT_INTAKE_SPREADSHEET_BUTTON_LABEL = "Baixar planilha modelo";

export const PROJECT_INTAKE_SPREADSHEET_SHEETS = [
  "01_Projeto",
  "02_Entregaveis",
  "03_Itens",
  "04_Composicao_BOM",
  "05_Processos_HH",
  "06_Moldes_Ferramentas",
  "07_Custos_Extras",
  "08_Pendencias",
] as const;

export type ProjectIntakeSpreadsheetSheet = (typeof PROJECT_INTAKE_SPREADSHEET_SHEETS)[number];

export const PROJECT_INTAKE_SHEET_01_COLUMNS = [
  "nome_projeto",
  "cliente",
  "tipo_projeto",
  "prioridade",
  "responsavel_comercial",
  "responsavel_tecnico",
  "prazo_desejado",
  "volume_mensal",
  "volume_anual",
  "preco_alvo",
  "margem_desejada",
  "observacoes",
] as const;

export const PROJECT_INTAKE_SHEET_01_REQUIRED = [
  "nome_projeto",
  "cliente",
  "tipo_projeto",
  "responsavel_comercial",
] as const;

export const PROJECT_INTAKE_SHEET_02_COLUMNS = ["entregavel", "marcar_x", "observacao"] as const;

export const PROJECT_INTAKE_SHEET_03_COLUMNS = [
  "item",
  "codigo_sku",
  "produto_entregavel",
  "tipo",
  "unidade",
  "quantidade_prevista",
  "observacao",
] as const;

export const PROJECT_INTAKE_SHEET_03_DELIVERABLE_TYPES = [
  "Produto novo",
  "Componente novo",
  "Produto alterado",
  "Componente alterado",
  "Molde/ferramenta",
  "Serviço",
  "Outro",
] as const;

export const PROJECT_INTAKE_SHEET_04_COLUMNS = [
  "produto_entregavel",
  "nivel",
  "item_pai",
  "tipo",
  "codigo",
  "descricao",
  "um",
  "quantidade_por_unidade",
  "horas_quantidade_servico",
  "custo_estimado",
  "observacao",
] as const;

export const PROJECT_INTAKE_SHEET_05_COLUMNS = [
  "processo",
  "interno_externo",
  "setor_maquina",
  "tempo_hh",
  "valor_hora",
  "custo_estimado",
  "observacao",
] as const;

export const PROJECT_INTAKE_SHEET_06_COLUMNS = [
  "tipo",
  "descricao",
  "cavidades",
  "material",
  "fornecedor",
  "custo_estimado",
  "amortizar_sim_nao",
  "quantidade_amortizacao",
  "observacao",
] as const;

export const PROJECT_INTAKE_SHEET_07_COLUMNS = [
  "categoria",
  "descricao",
  "valor_estimado",
  "amortizar_sim_nao",
  "observacao",
] as const;

export const PROJECT_INTAKE_SHEET_07_CATEGORIES = [
  "Protótipo",
  "Teste",
  "Frete",
  "Serviço externo",
  "Desenvolvimento",
  "Embalagem",
  "Outro",
] as const;

export const PROJECT_INTAKE_SHEET_08_COLUMNS = [
  "pendencia",
  "responsavel",
  "prioridade",
  "prazo",
  "status",
  "observacao",
] as const;

export const PROJECT_INTAKE_SPREADSHEET_SCHEMA: Record<
  ProjectIntakeSpreadsheetSheet,
  { columns: readonly string[]; description: string }
> = {
  "01_Projeto": {
    columns: PROJECT_INTAKE_SHEET_01_COLUMNS,
    description: "Dados gerais do projeto para abertura e estimativa.",
  },
  "02_Entregaveis": {
    columns: PROJECT_INTAKE_SHEET_02_COLUMNS,
    description: "Entregáveis esperados — marcar X na coluna marcar_x.",
  },
  "03_Itens": {
    columns: PROJECT_INTAKE_SHEET_03_COLUMNS,
    description: "Produtos e entregáveis raiz do projeto (seção 5.1 da ficha rápida).",
  },
  "04_Composicao_BOM": {
    columns: PROJECT_INTAKE_SHEET_04_COLUMNS,
    description:
      "Estrutura preliminar / BOM hierárquica (seção 5.2). Use item_pai para MPs e serviços filhos de componentes.",
  },
  "05_Processos_HH": {
    columns: PROJECT_INTAKE_SHEET_05_COLUMNS,
    description: "Processos produtivos e horas-homem.",
  },
  "06_Moldes_Ferramentas": {
    columns: PROJECT_INTAKE_SHEET_06_COLUMNS,
    description: "Moldes, ferramentas e dispositivos.",
  },
  "07_Custos_Extras": {
    columns: PROJECT_INTAKE_SHEET_07_COLUMNS,
    description: "Custos adicionais fora da composição principal.",
  },
  "08_Pendencias": {
    columns: PROJECT_INTAKE_SHEET_08_COLUMNS,
    description: "Pendências e bloqueios para estimativa.",
  },
};

const DELIVERABLE_ROWS = [
  "Estimativa de custo",
  "Preço sugerido",
  "Lista de materiais",
  "Estudo de molde",
  "Estudo de processo/HH",
  "Cotação externa",
  "Amostra/protótipo",
  "Desenho técnico",
  "Modelo 3D",
  "Proposta comercial",
];

function sheetFromRows<T extends Record<string, string>>(rows: T[], columns: readonly string[]): XLSX.WorkSheet {
  return XLSX.utils.json_to_sheet(rows, { header: [...columns], skipHeader: false });
}

const EXAMPLE_BOM_ROWS: Record<string, string>[] = [
        {
          produto_entregavel: "610.51AA",
          nivel: "0",
          item_pai: "—",
          tipo: "Produto",
          codigo: "610.51AA",
          descricao: "Torneira Longa Branca",
          um: "UN",
          quantidade_por_unidade: "1",
          horas_quantidade_servico: "",
          custo_estimado: "",
          observacao: "",
        },
        {
          produto_entregavel: "610.51AA",
          nivel: "1",
          item_pai: "610.51AA",
          tipo: "Componente",
          codigo: "306.02AA",
          descricao: "Porca Grossa Branca da Torneira",
          um: "PC",
          quantidade_por_unidade: "1",
          horas_quantidade_servico: "",
          custo_estimado: "",
          observacao: "",
        },
        {
          produto_entregavel: "610.51AA",
          nivel: "2",
          item_pai: "306.02AA",
          tipo: "MP",
          codigo: "115.01--",
          descricao: "PP Polipropileno H 503",
          um: "KG",
          quantidade_por_unidade: "0,002900",
          horas_quantidade_servico: "",
          custo_estimado: "",
          observacao: "",
        },
        {
          produto_entregavel: "610.51AA",
          nivel: "2",
          item_pai: "306.02AA",
          tipo: "MP",
          codigo: "121.16--",
          descricao: "MasterBatch Branco",
          um: "KG",
          quantidade_por_unidade: "0,000087",
          horas_quantidade_servico: "",
          custo_estimado: "",
          observacao: "",
        },
        {
          produto_entregavel: "Mini-mangote novo",
          nivel: "1",
          item_pai: "Mini-mangote novo",
          tipo: "Serviço",
          codigo: "",
          descricao: "CNC",
          um: "H",
          quantidade_por_unidade: "",
          horas_quantidade_servico: "15",
          custo_estimado: "",
          observacao: "Valor hora calculado depois pelo sistema",
        }
];

function appendExampleSheet(wb: XLSX.WorkBook): void {
  const rows = EXAMPLE_BOM_ROWS.map((row) => ({
    ...row,
    observacao: [PROJECT_INTAKE_SPREADSHEET_EXAMPLE_NOTE, row.observacao].filter(Boolean).join(" — "),
  }));
  XLSX.utils.book_append_sheet(
    wb,
    sheetFromRows(rows, PROJECT_INTAKE_SHEET_04_COLUMNS),
    PROJECT_INTAKE_SPREADSHEET_EXAMPLE_SHEET
  );
}

type SheetCell = string | number | null;
export type ProjectSpreadsheetSheetData = { columns: readonly string[]; rows: Record<string, SheetCell>[] };
/** Conteúdo da planilha com dados reais (congelado na emissão). */
export type ProjectSpreadsheetData = {
  version: string;
  sheets: Record<ProjectIntakeSpreadsheetSheet, ProjectSpreadsheetSheetData>;
};

/** "R$ 1.234,56" / "0,0029" / "15 h" → número; texto não numérico → o próprio texto. */
export function toSheetNumber(value: string | null | undefined): SheetCell {
  if (value == null) return null;
  const t = value.replace(/R\$|\s|h$|%$/g, "").trim();
  if (!/^-?[\d.]*,?\d+$/.test(t)) return value;
  const n = Number(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : value;
}

const hourUnit = (u: string | null | undefined) => /^(HH|H|HR|HORA|HORAS)$/i.test(u?.trim() ?? "");
const fmtDay = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : null);

/**
 * Dados reais do projeto nas abas 01–08 (mesma fonte da Ficha rápida). Sem linhas de exemplo:
 * o exemplo fica na aba 99_Exemplo.
 */
export function buildProjectSpreadsheetData(
  detail: ProjectDetail,
  ctx: ProjectQuickFormContext & { generatedBy?: string | null; generatedAt?: Date } = {}
): ProjectSpreadsheetData {
  const quick = buildQuickIntakeFormFromDetail(detail, ctx);
  const marginSaved = detail.documentValueSource?.view.config.defaultMarginPercent ?? null;
  const sheets: ProjectSpreadsheetData["sheets"] = {
    "01_Projeto": {
      columns: PROJECT_INTAKE_SHEET_01_COLUMNS,
      rows: [
        {
          nome_projeto: `${detail.code} — ${detail.title}`,
          cliente: detail.customerDocument ? `${detail.customerName} (${detail.customerDocument})` : detail.customerName,
          tipo_projeto: PROJECT_TYPE_LABEL[detail.projectType] ?? detail.projectType,
          prioridade: projectPriorityLabel(detail.priority),
          responsavel_comercial: detail.commercialOwner,
          responsavel_tecnico: detail.technicalOwner,
          prazo_desejado: fmtDay(detail.desiredDeadline),
          volume_mensal: detail.expectedMonthlyVolume,
          volume_anual: detail.expectedMonthlyVolume != null ? detail.expectedMonthlyVolume * 12 : null,
          preco_alvo: detail.targetPrice,
          margem_desejada: detail.targetMarginPercent ?? marginSaved,
          observacoes: detail.notes,
        },
      ],
    },
    "02_Entregaveis": {
      columns: PROJECT_INTAKE_SHEET_02_COLUMNS,
      rows: quick.deliverables.map((d) => ({ entregavel: d.label, marcar_x: d.checked ? "X" : "", observacao: "" })),
    },
    "03_Itens": {
      columns: PROJECT_INTAKE_SHEET_03_COLUMNS,
      rows: quick.deliverableProducts.map((p) => ({
        item: p.item,
        codigo_sku: p.codeSku,
        produto_entregavel: p.name,
        tipo: p.type,
        unidade: p.unit,
        quantidade_prevista: toSheetNumber(p.plannedQuantity),
        observacao: p.notes,
      })),
    },
    "04_Composicao_BOM": {
      columns: PROJECT_INTAKE_SHEET_04_COLUMNS,
      rows: quick.structureRows.map((r) => ({
        produto_entregavel: r.productDeliverable,
        nivel: r.level,
        item_pai: r.parentItem,
        tipo: r.type,
        codigo: r.code,
        descricao: r.description,
        um: r.unit,
        quantidade_por_unidade: toSheetNumber(r.quantityPerUnit),
        horas_quantidade_servico: toSheetNumber(r.serviceHours),
        custo_estimado: toSheetNumber(r.estimatedCost),
        observacao: r.notes,
      })),
    },
    "05_Processos_HH": {
      columns: PROJECT_INTAKE_SHEET_05_COLUMNS,
      rows: detail.structureLines
        .filter((l) => isLaborStructureLine(l) || l.lineType === "PROCESS" || l.lineType === "SERVICE")
        .map((l) => ({
          processo: l.descriptionSnapshot,
          interno_externo: l.sourceType === "MANUAL" ? "Interno" : "Externo",
          setor_maquina: null,
          // Horas só quando a unidade é hora; valor hora = custo unitário da linha em hora.
          tempo_hh: hourUnit(l.unitSnapshot) ? l.quantity : null,
          valor_hora: hourUnit(l.unitSnapshot) ? l.unitCostSnapshot : null,
          custo_estimado: l.totalCost,
          observacao: documentUserNotes(l.notes),
        })),
    },
    "06_Moldes_Ferramentas": {
      columns: PROJECT_INTAKE_SHEET_06_COLUMNS,
      rows: detail.molds.map((m) => ({
        tipo: m.moldType ?? "Molde",
        descricao: m.name,
        cavidades: m.cavities,
        material: null,
        fornecedor: m.supplierName,
        custo_estimado: m.constructionCost,
        amortizar_sim_nao: m.chargeMode === "AMORTIZED_IN_PRODUCT" ? "Sim" : "Não",
        quantidade_amortizacao: m.amortizationQuantity,
        observacao: null,
      })),
    },
    "07_Custos_Extras": {
      columns: PROJECT_INTAKE_SHEET_07_COLUMNS,
      rows: detail.simulatedItems
        .filter((i) => isGuidedOtherCostItem(i.notes))
        .map((i) => ({
          categoria: OTHER_COST_GROUP_LABEL[parseOtherCostMeta(i.notes).group] ?? "Outro",
          descricao: i.description,
          valor_estimado: resolveOtherCostItemLineTotal(i),
          amortizar_sim_nao: null,
          observacao: parseOtherCostUserNotes(i.notes),
        })),
    },
    "08_Pendencias": {
      columns: PROJECT_INTAKE_SHEET_08_COLUMNS,
      rows: quick.pendingItems
        .filter((p) => p.checked)
        .map((p) => ({ pendencia: p.label, responsavel: null, prioridade: null, prazo: null, status: "Pendente", observacao: null })),
    },
  };
  return { version: PROJECT_INTAKE_SPREADSHEET_VERSION, sheets };
}

/** Aba 00_Documento: bloco documental comum (mesmos campos dos demais documentos). */
export function buildSpreadsheetDocumentRows(header: ProjectDocumentHeader): { campo: string; valor: string }[] {
  const rows: [string, string | null][] = [
    ["Documento", header.documentTitle],
    ["Número", header.documentNumber ?? "PRÉVIA — não emitido"],
    ["Revisão", header.revision != null ? String(header.revision) : "—"],
    ["Situação", header.status === "ISSUED" ? "Emitido" : "Prévia (sem valor de emissão)"],
    [header.status === "ISSUED" ? "Emitido em" : "Gerado em", formatDocumentDateTime(header.issuedAt)],
    [header.status === "ISSUED" ? "Emitido por" : "Gerado por", header.issuedBy.name],
    ["Emitente", header.issuer.legalName],
    ["CNPJ do emitente", header.issuer.document],
    ["Cliente", header.customer.name],
    ["CNPJ/CPF do cliente", header.customer.document],
    ["Vínculo com cadastro", header.customer.linked ? "Sim" : "Não"],
    ["Projeto", `${header.project.code} — ${header.project.title}`],
    ["Versão do projeto", header.project.versionNumber != null ? `v${header.project.versionNumber}` : null],
    ["Origem dos valores", header.values.modeLabel],
    ["Precificação salva em", header.values.pricingSavedAt ? formatDocumentDateTime(header.values.pricingSavedAt) : null],
    ["Abas de dados", "01 a 08 = dados reais do projeto. 99_Exemplo = exemplo ilustrativo, não importar."],
    ...header.values.staleReasons.map((r): [string, string] => ["Divergência", r]),
    ...header.warnings.map((w): [string, string] => ["Aviso", w]),
  ];
  return rows.map(([campo, valor]) => ({ campo, valor: valor ?? "—" }));
}

/** Monta o XLSX a partir dos dados congelados (emissão) — sem consultar o projeto de novo. */
export function buildProjectSpreadsheetWorkbookFromData(
  data: ProjectSpreadsheetData,
  header: ProjectDocumentHeader
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(buildSpreadsheetDocumentRows(header), { header: ["campo", "valor"] }),
    PROJECT_INTAKE_SPREADSHEET_DOCUMENT_SHEET
  );
  for (const name of PROJECT_INTAKE_SPREADSHEET_SHEETS) {
    const sheet = data.sheets[name];
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(sheet.rows, { header: [...sheet.columns] }),
      name
    );
  }
  appendExampleSheet(wb);
  return wb;
}

export function buildProjectSpreadsheetFilename(header: ProjectDocumentHeader): string {
  const base = (header.documentNumber ?? `${header.project.code}-PL-PREVIA`).replace(/[^\w.-]+/g, "_");
  return `${base}.xlsx`;
}

/** Modelo em branco (sem projeto): abas vazias + aba 99_Exemplo separada. */
export function buildProjectIntakeSpreadsheetWorkbook(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    wb,
    sheetFromRows(
      [
        {
          nome_projeto: "",
          cliente: "",
          tipo_projeto: "",
          prioridade: "",
          responsavel_comercial: "",
          responsavel_tecnico: "",
          prazo_desejado: "",
          volume_mensal: "",
          volume_anual: "",
          preco_alvo: "",
          margem_desejada: "",
          observacoes: "",
        },
      ],
      PROJECT_INTAKE_SHEET_01_COLUMNS
    ),
    "01_Projeto"
  );

  XLSX.utils.book_append_sheet(
    wb,
    sheetFromRows(
      DELIVERABLE_ROWS.map((entregavel) => ({ entregavel, marcar_x: "", observacao: "" })),
      PROJECT_INTAKE_SHEET_02_COLUMNS
    ),
    "02_Entregaveis"
  );

  XLSX.utils.book_append_sheet(
    wb,
    sheetFromRows(
      Array.from({ length: 5 }, (_, index) => ({
        item: String(index + 1),
        codigo_sku: "",
        produto_entregavel: "",
        tipo: "",
        unidade: "",
        quantidade_prevista: "",
        observacao: "",
      })),
      PROJECT_INTAKE_SHEET_03_COLUMNS
    ),
    "03_Itens"
  );

  XLSX.utils.book_append_sheet(
    wb,
    sheetFromRows(
      [
        ...Array.from({ length: 19 }, () => ({
          produto_entregavel: "",
          nivel: "",
          item_pai: "",
          tipo: "",
          codigo: "",
          descricao: "",
          um: "",
          quantidade_por_unidade: "",
          horas_quantidade_servico: "",
          custo_estimado: "",
          observacao: "",
        })),
      ],
      PROJECT_INTAKE_SHEET_04_COLUMNS
    ),
    "04_Composicao_BOM"
  );

  XLSX.utils.book_append_sheet(
    wb,
    sheetFromRows(
      [
        { processo: "", interno_externo: "", setor_maquina: "", tempo_hh: "", valor_hora: "", custo_estimado: "", observacao: "" },
        { processo: "", interno_externo: "", setor_maquina: "", tempo_hh: "", valor_hora: "", custo_estimado: "", observacao: "" },
      ],
      PROJECT_INTAKE_SHEET_05_COLUMNS
    ),
    "05_Processos_HH"
  );

  XLSX.utils.book_append_sheet(
    wb,
    sheetFromRows(
      [{ tipo: "", descricao: "", cavidades: "", material: "", fornecedor: "", custo_estimado: "", amortizar_sim_nao: "", quantidade_amortizacao: "", observacao: "" }],
      PROJECT_INTAKE_SHEET_06_COLUMNS
    ),
    "06_Moldes_Ferramentas"
  );

  XLSX.utils.book_append_sheet(
    wb,
    sheetFromRows(
      PROJECT_INTAKE_SHEET_07_CATEGORIES.map((categoria) => ({
        categoria,
        descricao: "",
        valor_estimado: "",
        amortizar_sim_nao: "",
        observacao: "",
      })),
      PROJECT_INTAKE_SHEET_07_COLUMNS
    ),
    "07_Custos_Extras"
  );

  XLSX.utils.book_append_sheet(
    wb,
    sheetFromRows(
      PROJECT_INTAKE_QUICK_PENDING_ITEMS.map((pendencia) => ({
        pendencia,
        responsavel: "",
        prioridade: "",
        prazo: "",
        status: "",
        observacao: "",
      })),
      PROJECT_INTAKE_SHEET_08_COLUMNS
    ),
    "08_Pendencias"
  );

  appendExampleSheet(wb);
  return wb;
}

export function projectIntakeSpreadsheetToBytes(workbook: XLSX.WorkBook): Uint8Array {
  const arr = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return new Uint8Array(arr);
}

export function downloadWorkbook(workbook: XLSX.WorkBook, filename: string): void {
  const bytes = projectIntakeSpreadsheetToBytes(workbook);
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Modelo em branco (sem projeto). Com projeto, use a emissão da planilha (dados reais). */
export function downloadProjectIntakeSpreadsheet(): void {
  downloadWorkbook(buildProjectIntakeSpreadsheetWorkbook(), PROJECT_INTAKE_SPREADSHEET_FILENAME);
}

export function listSpreadsheetSheetColumns(sheet: ProjectIntakeSpreadsheetSheet): readonly string[] {
  return PROJECT_INTAKE_SPREADSHEET_SCHEMA[sheet].columns;
}

/** Linhas de referência para validação futura da importação. */
export function getSpreadsheetReferenceRowCounts(): Record<ProjectIntakeSpreadsheetSheet, number> {
  return {
    "01_Projeto": 1,
    "02_Entregaveis": DELIVERABLE_ROWS.length,
    "03_Itens": 5,
    "04_Composicao_BOM": 19,
    // O exemplo ilustrativo fica na aba 99_Exemplo (fora da contagem de referência).
    "05_Processos_HH": 2,
    "06_Moldes_Ferramentas": 1,
    "07_Custos_Extras": PROJECT_INTAKE_SHEET_07_CATEGORIES.length,
    "08_Pendencias": PROJECT_INTAKE_QUICK_PENDING_ITEMS.length,
  };
}

export function quickEstimateItemsForSpreadsheetCrossCheck(): readonly string[] {
  return PROJECT_INTAKE_QUICK_ESTIMATE_ITEMS;
}

export function quickDeliverablesForSpreadsheetCrossCheck(): readonly string[] {
  return PROJECT_INTAKE_QUICK_DELIVERABLES;
}
