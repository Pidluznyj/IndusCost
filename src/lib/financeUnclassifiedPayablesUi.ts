/** Textos e helpers client-safe — UX da aba Títulos sem Classificação. */

export type UnclassifiedCauseUi =
  | "MANUAL_LOCKED"
  | "PARTIAL_ALLOCATION"
  | "NO_SUPPLIER"
  | "SUPPLIER_NO_RULE"
  | "RULE_NOT_APPLIED";

export const UNCLASSIFIED_CAUSE_LABEL: Record<UnclassifiedCauseUi, string> = {
  MANUAL_LOCKED: "Manual bloqueado",
  PARTIAL_ALLOCATION: "Rateio incompleto",
  NO_SUPPLIER: "Fornecedor não casado",
  SUPPLIER_NO_RULE: "Fornecedor sem regra ativa",
  RULE_NOT_APPLIED: "Regra ativa, alocação pendente",
};

export const UNCLASSIFIED_CAUSE_HINT: Record<UnclassifiedCauseUi, string> = {
  MANUAL_LOCKED: "Classificação manual protegida — não será sobrescrita.",
  PARTIAL_ALLOCATION: "Complete o rateio para 100% na aba de regras.",
  NO_SUPPLIER: "Vincule um fornecedor gerencial antes de classificar.",
  SUPPLIER_NO_RULE: "Cadastre uma regra de centro de custo.",
  RULE_NOT_APPLIED: "Aplique a regra existente aos títulos pendentes.",
};

/** Texto curto para coluna Sugestão na tabela. */
export const UNCLASSIFIED_CAUSE_SUGGESTION: Record<UnclassifiedCauseUi, string> = {
  MANUAL_LOCKED: "Revisar manualmente",
  PARTIAL_ALLOCATION: "Completar rateio",
  NO_SUPPLIER: "Vincular fornecedor",
  SUPPLIER_NO_RULE: "Criar regra de CC",
  RULE_NOT_APPLIED: "Aplicar regra existente",
};

export const UNCLASSIFIED_CLASSIFY_FLOW_HINT: Record<UnclassifiedCauseUi, string> = {
  MANUAL_LOCKED:
    "Este grupo possui classificação manual bloqueada. Ações automáticas não sobrescrevem esses títulos.",
  PARTIAL_ALLOCATION:
    "Há rateio parcial. Complete as alocações ou crie uma regra que feche 100% do saldo.",
  NO_SUPPLIER:
    "Primeiro será criado ou vinculado um fornecedor gerencial no IndusCost — sem alterar dados no Nomus.",
  SUPPLIER_NO_RULE:
    "Será criada uma regra de classificação por centro de custo para este fornecedor.",
  RULE_NOT_APPLIED:
    "Já existe regra ativa. A confirmação aplicará a regra aos títulos elegíveis deste fornecedor.",
};

export const UNCLASSIFIED_CAUSE_CHIP_CLASS: Record<UnclassifiedCauseUi, string> = {
  MANUAL_LOCKED: "border-slate-300 bg-slate-50 text-slate-800",
  PARTIAL_ALLOCATION: "border-violet-300 bg-violet-50 text-violet-900",
  NO_SUPPLIER: "border-amber-300 bg-amber-50 text-amber-900",
  SUPPLIER_NO_RULE: "border-orange-300 bg-orange-50 text-orange-900",
  RULE_NOT_APPLIED: "border-sky-300 bg-sky-50 text-sky-900",
};

export const IMPORT_APPLY_LOADING_TITLE = "Aplicando classificação…";
export const IMPORT_APPLY_LOADING_MESSAGE =
  "Estamos criando/vinculando fornecedores, criando regras e classificando os títulos. Não feche esta janela.";

export const CLASSIFY_APPLY_LOADING_TITLE = "Classificando fornecedor…";
export const CLASSIFY_APPLY_LOADING_MESSAGE =
  "Criando a regra e aplicando aos títulos elegíveis. Não feche esta janela.";

export type ImportApplyResultSummary = {
  suppliersCreated: number;
  suppliersLinked: number;
  rulesCreated: number;
  titlesAllocated: number;
  titlesIgnoredManualLocked: number;
  skippedSensitiveUnconfirmed: number;
};

export function formatImportApplySuccessMessage(result: ImportApplyResultSummary): string {
  const parts = ["Importação aplicada com sucesso."];
  if (result.suppliersCreated > 0) {
    parts.push(`${result.suppliersCreated} fornecedor(es) criado(s).`);
  }
  if (result.suppliersLinked > 0) {
    parts.push(`${result.suppliersLinked} fornecedor(es) vinculado(s).`);
  }
  parts.push(`${result.rulesCreated} regra(s) criada(s).`);
  parts.push(`${result.titlesAllocated} título(s) classificado(s).`);
  if (result.titlesIgnoredManualLocked > 0) {
    parts.push(`${result.titlesIgnoredManualLocked} título(s) com classificação manual preservados.`);
  }
  if (result.skippedSensitiveUnconfirmed > 0) {
    parts.push(
      `${result.skippedSensitiveUnconfirmed} linha(s) sensível(is) ignorada(s) sem confirmação.`
    );
  }
  return parts.join(" ");
}

export function importApplyButtonDisabled(input: {
  applying: boolean;
  loadingPreview: boolean;
  sensitiveCount: number;
  confirmSensitive: boolean;
  canApply: boolean;
}): boolean {
  if (input.applying || input.loadingPreview) return true;
  if (!input.canApply) return true;
  if (input.sensitiveCount > 0 && !input.confirmSensitive) return true;
  return false;
}
