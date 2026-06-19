import * as XLSX from "xlsx";
import {
  PROJECT_INTAKE_QUICK_DELIVERABLES,
  PROJECT_INTAKE_QUICK_ESTIMATE_ITEMS,
  PROJECT_INTAKE_QUICK_PENDING_ITEMS,
} from "./projectsIntakeQuickForm.js";

export const PROJECT_INTAKE_SPREADSHEET_VERSION = "1.1";
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
  "tipo_item",
  "codigo_existente",
  "descricao",
  "produto_base",
  "unidade",
  "quantidade",
  "custo_estimado_unitario",
  "origem",
  "observacao",
] as const;

export const PROJECT_INTAKE_SHEET_03_ITEM_TYPES = [
  "Produto",
  "Componente",
  "Matéria-prima",
  "Serviço",
  "Embalagem",
  "Outro",
] as const;

export const PROJECT_INTAKE_SHEET_04_COLUMNS = [
  "produto_grupo",
  "nivel",
  "tipo",
  "codigo",
  "descricao",
  "quantidade_horas",
  "unidade",
  "custo_unitario_estimado",
  "custo_total_estimado",
  "origem",
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
    description: "Itens principais do projeto (produto, componentes, MP, serviços).",
  },
  "04_Composicao_BOM": {
    columns: PROJECT_INTAKE_SHEET_04_COLUMNS,
    description:
      "Estrutura preliminar / composição do projeto (BOM hierárquica). Serviços entram nesta aba; valor hora será calculado depois pelo sistema.",
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
      PROJECT_INTAKE_SHEET_03_ITEM_TYPES.map((tipo_item) => ({
        tipo_item,
        codigo_existente: "",
        descricao: "",
        produto_base: "",
        unidade: "",
        quantidade: "",
        custo_estimado_unitario: "",
        origem: "",
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
          produto_grupo: "Produto 1",
          nivel: "0",
          tipo: "Produto",
          codigo: "",
          descricao: "Torneira nova",
          quantidade_horas: "1",
          unidade: "UN",
          custo_unitario_estimado: "",
          custo_total_estimado: "",
          origem: "",
          observacao: "",
        },
        {
          produto_grupo: "Produto 1",
          nivel: "1",
          tipo: "Componente",
          codigo: "",
          descricao: "Haste",
          quantidade_horas: "1",
          unidade: "UN",
          custo_unitario_estimado: "",
          custo_total_estimado: "",
          origem: "",
          observacao: "",
        },
        {
          produto_grupo: "Produto 1",
          nivel: "2",
          tipo: "MP",
          codigo: "",
          descricao: "ABS",
          quantidade_horas: "0,080",
          unidade: "KG",
          custo_unitario_estimado: "",
          custo_total_estimado: "",
          origem: "",
          observacao: "",
        },
        {
          produto_grupo: "Produto 1",
          nivel: "2",
          tipo: "Serviço",
          codigo: "",
          descricao: "Usinagem",
          quantidade_horas: "20",
          unidade: "H",
          custo_unitario_estimado: "",
          custo_total_estimado: "",
          origem: "",
          observacao: "Valor hora calculado depois pelo sistema",
        },
        {
          produto_grupo: "Produto 2",
          nivel: "0",
          tipo: "Produto",
          codigo: "",
          descricao: "Componente novo",
          quantidade_horas: "1",
          unidade: "UN",
          custo_unitario_estimado: "",
          custo_total_estimado: "",
          origem: "",
          observacao: "",
        },
        {
          produto_grupo: "Produto 2",
          nivel: "1",
          tipo: "MP",
          codigo: "",
          descricao: "Polipropileno",
          quantidade_horas: "0,120",
          unidade: "KG",
          custo_unitario_estimado: "",
          custo_total_estimado: "",
          origem: "",
          observacao: "",
        },
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
    "03_Itens": PROJECT_INTAKE_SHEET_03_ITEM_TYPES.length,
    "04_Composicao_BOM": 6,
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
