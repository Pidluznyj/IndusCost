/**
 * Material.quantity não é campo cadastral. Cadastro/importação/API de
 * Suprimentos não podem definir o saldo físico.
 */
import { roundMaterialStockQuantity } from "./materialStockConferenceMath.js";

export const MATERIAL_QUANTITY_NOT_EDITABLE = "MATERIAL_QUANTITY_NOT_EDITABLE";

export const MATERIAL_QUANTITY_NOT_EDITABLE_MESSAGE =
  "O saldo físico não pode ser editado no cadastro. Informe quantidades pela Conferência Física de Estoque e demais alterações por movimentações oficiais.";

function quantitiesEqual(left: unknown, right: unknown): boolean {
  const a = roundMaterialStockQuantity(left);
  const b = roundMaterialStockQuantity(right);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return a === b;
}

function isOmittedQuantity(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

/**
 * Material novo: quantity inicia em 0. Qualquer valor > 0 no payload é rejeitado.
 */
export function resolveMaterialCreateQuantity(
  bodyQuantity: unknown
):
  | { ok: true; quantity: 0 }
  | { ok: false; error: typeof MATERIAL_QUANTITY_NOT_EDITABLE; message: string; field: "quantity" } {
  if (isOmittedQuantity(bodyQuantity)) {
    return { ok: true, quantity: 0 };
  }
  const parsed = roundMaterialStockQuantity(bodyQuantity);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed !== 0) {
    return {
      ok: false,
      error: MATERIAL_QUANTITY_NOT_EDITABLE,
      message: MATERIAL_QUANTITY_NOT_EDITABLE_MESSAGE,
      field: "quantity",
    };
  }
  return { ok: true, quantity: 0 };
}

/**
 * Edição cadastral: omitir quantity é permitido; valor igual ao atual é
 * ignorado (compatibilidade de payload); valor diferente é rejeitado.
 */
export function resolveMaterialUpdateQuantity(
  bodyQuantity: unknown,
  currentQuantity: unknown
):
  | { ok: true }
  | { ok: false; error: typeof MATERIAL_QUANTITY_NOT_EDITABLE; message: string; field: "quantity" } {
  if (isOmittedQuantity(bodyQuantity)) return { ok: true };
  if (quantitiesEqual(bodyQuantity, currentQuantity)) return { ok: true };
  return {
    ok: false,
    error: MATERIAL_QUANTITY_NOT_EDITABLE,
    message: MATERIAL_QUANTITY_NOT_EDITABLE_MESSAGE,
    field: "quantity",
  };
}

export function materialQuantityPayloadDiffers(
  requestedQuantity: unknown,
  currentQuantity: unknown
): boolean {
  if (isOmittedQuantity(requestedQuantity)) return false;
  return !quantitiesEqual(requestedQuantity, currentQuantity);
}
