import {
  asBoolean,
  asString,
  parseNomusBrDate,
  parseNomusBrDateTime,
  parseNomusOptionalMoney,
  toInt,
} from "@/src/lib/nomusAccountsReceivableParser.js";
import type { JsonObject } from "./nomusPurchaseOrderTypes.js";

export {
  asBoolean,
  asString,
  parseNomusBrDate,
  parseNomusBrDateTime,
  parseNomusOptionalMoney,
  toInt,
};

function firstDefined(raw: JsonObject, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(raw, key) && raw[key] != null) {
      return raw[key];
    }
  }
  return undefined;
}

export function pickFirstString(raw: JsonObject, keys: readonly string[]): string | null {
  return asString(firstDefined(raw, keys));
}

export function pickFirstInt(raw: JsonObject, keys: readonly string[]): number | null {
  return toInt(firstDefined(raw, keys));
}

export function pickFirstBoolean(raw: JsonObject, keys: readonly string[]): boolean | null {
  return asBoolean(firstDefined(raw, keys));
}

export function pickFirstMoney(raw: JsonObject, keys: readonly string[]): number | null {
  return parseNomusOptionalMoney(firstDefined(raw, keys));
}

export function pickFirstDate(raw: JsonObject, keys: readonly string[]): Date | null {
  return parseNomusBrDate(firstDefined(raw, keys));
}

export function pickFirstDateTime(raw: JsonObject, keys: readonly string[]): Date | null {
  return parseNomusBrDateTime(firstDefined(raw, keys));
}

export function pickPurchaseOrderItemsArray(raw: JsonObject): JsonObject[] {
  const candidates = [
    raw.itens,
    raw.items,
    raw.pedidosCompraItens,
    raw.pedidoCompraItens,
    raw.itensPedido,
    raw.linhas,
  ];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    return candidate.filter(
      (item): item is JsonObject => !!item && typeof item === "object" && !Array.isArray(item)
    );
  }
  return [];
}

export function pickPurchaseOrderArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const data = payload as JsonObject;
  const nested = data.data && typeof data.data === "object" && !Array.isArray(data.data)
    ? (data.data as JsonObject)
    : undefined;
  const candidates = [
    data.pedidoscompra,
    data.pedidosCompra,
    data.pedidos_compra,
    data.dados,
    data.data,
    data.results,
    data.items,
    data.itens,
    nested?.pedidoscompra,
    nested?.pedidosCompra,
    nested?.dados,
    nested?.items,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

export function sumNullable(values: Array<number | null>): number | null {
  let total = 0;
  let seen = false;
  for (const value of values) {
    if (value == null || !Number.isFinite(value)) continue;
    total += value;
    seen = true;
  }
  return seen ? total : null;
}
