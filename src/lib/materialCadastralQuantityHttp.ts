/**
 * Contrato HTTP do cadastro de MP para Material.quantity.
 * Super Admin não tem bypass: saldo físico não é campo cadastral.
 */
import {
  MATERIAL_QUANTITY_NOT_EDITABLE,
  resolveMaterialCreateQuantity,
  resolveMaterialUpdateQuantity,
} from "./materialQuantityWriteGuard.js";

export type MaterialQuantityHttpRejection = {
  ok: false;
  status: 400;
  body: {
    error: typeof MATERIAL_QUANTITY_NOT_EDITABLE;
    field: "quantity";
    message: string;
  };
};

export function materialCreateQuantityHttpResult(
  bodyQuantity: unknown
): { ok: true; quantity: 0 } | MaterialQuantityHttpRejection {
  const policy = resolveMaterialCreateQuantity(bodyQuantity);
  if (policy.ok === false) {
    return {
      ok: false,
      status: 400,
      body: {
        error: policy.error,
        field: policy.field,
        message: policy.message,
      },
    };
  }
  return { ok: true, quantity: policy.quantity };
}

export function materialUpdateQuantityHttpResult(
  bodyQuantity: unknown,
  currentQuantity: unknown
): { ok: true } | MaterialQuantityHttpRejection {
  const policy = resolveMaterialUpdateQuantity(bodyQuantity, currentQuantity);
  if (policy.ok === false) {
    return {
      ok: false,
      status: 400,
      body: {
        error: policy.error,
        field: policy.field,
        message: policy.message,
      },
    };
  }
  return { ok: true };
}
