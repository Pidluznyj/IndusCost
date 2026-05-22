/**
 * Helpers puros do fluxo "Igualar bases".
 *
 * NÃO importar Prisma, @prisma/client ou libs server-side neste arquivo.
 */

import type { EqualizeAction } from "@/src/lib/nomusMasterDataEqualizeTypes";
import type { ProductChangeActionLabel } from "@/src/lib/productChangeHistoryTypes";

export const EQUALIZE_ACTION_LABEL: Record<EqualizeAction, string> = {
  CREATE_PRODUCT: "Criar Produto",
  CREATE_MATERIAL: "Criar Material",
  UPDATE_PRODUCT: "Atualizar Produto (Nomus)",
  UPDATE_MATERIAL: "Atualizar Material (Nomus)",
  DEACTIVATE_PRODUCT: "Inativar Produto (fora do Nomus)",
  DEACTIVATE_MATERIAL: "Inativar Material (fora do Nomus)",
  PRESERVE_LOCAL: "Preservar — local/manual no IndusCost",
  PRESERVE_NOMUS_CONTROLLED: "Preservar — sem diferença com Nomus",
  AMBIGUOUS_REVIEW: "Ambíguo — revisão manual",
  BLOCKED_LOCAL_PROCESS_CODE: "Bloqueado — montagem local (800.xx)",
  BLOCKED_MISSING_DESCRIPTION: "Bloqueado — descrição vazia",
  NO_CHANGES: "Sem alteração",
};

export function equalizeActionLabel(action: EqualizeAction): string {
  return EQUALIZE_ACTION_LABEL[action] ?? "—";
}

export const PRODUCT_CHANGE_ACTION_LABEL: Record<ProductChangeActionLabel, string> = {
  CREATED: "Criado",
  UPDATED: "Atualizado",
  DEACTIVATED: "Inativado",
  REACTIVATED: "Reativado",
  SKIPPED: "Ignorado",
  BLOCKED: "Bloqueado",
  IMPORTED: "Importado do Nomus",
  EQUALIZED: "Igualado com Nomus",
};

export function productChangeActionLabel(action: ProductChangeActionLabel): string {
  return PRODUCT_CHANGE_ACTION_LABEL[action] ?? "—";
}

export function summarizeFieldName(fieldName: string | null | undefined): string {
  if (!fieldName) return "";
  const map: Record<string, string> = {
    name: "Nome",
    description: "Descrição",
    status: "Status",
    sourceSystem: "Origem (sourceSystem)",
    isNomusControlled: "Controle Nomus",
    type: "Tipo",
    category: "Categoria",
  };
  return map[fieldName] ?? fieldName;
}
