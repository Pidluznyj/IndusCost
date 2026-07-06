import * as XLSX from "xlsx";
import {
  PROJECT_INTAKE_QUICK_DELIVERABLES,
  PROJECT_INTAKE_QUICK_ESTIMATE_ITEMS,
  PROJECT_INTAKE_QUICK_PENDING_ITEMS,
} from "./projectsIntakeQuickForm.js";

export const PROJECT_INTAKE_SPREADSHEET_VERSION = "1.2";
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
        },
        ...Array.from({ length: 14 }, () => ({
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

  return wb;
}

export function projectIntakeSpreadsheetToBytes(workbook: XLSX.WorkBook): Uint8Array {
  const arr = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return new Uint8Array(arr);
}

export function downloadProjectIntakeSpreadsheet(): void {
  const bytes = projectIntakeSpreadsheetToBytes(buildProjectIntakeSpreadsheetWorkbook());
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = PROJECT_INTAKE_SPREADSHEET_FILENAME;
  anchor.click();
  URL.revokeObjectURL(url);
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
