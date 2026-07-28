/**
 * Runtime guard — rejeita writes em motores oficiais a partir da SC.
 */

import {
  isOfficialEngineForbiddenWriteMethod,
  isOfficialEngineProtectedModel,
  OfficialEngineWriteForbiddenError,
} from "./officialEngineBoundary.js";

/**
 * Barreira técnica: qualquer tentativa de escrita em modelo protegido lança.
 * Usar antes de delegar a Prisma em código SC (ou em proxies de teste).
 */
export function assertOfficialEngineReadOnlyAccess(
  model: string,
  method: string
): void {
  if (
    isOfficialEngineProtectedModel(model) &&
    isOfficialEngineForbiddenWriteMethod(method)
  ) {
    throw new OfficialEngineWriteForbiddenError(model, method);
  }
}

/**
 * Proxy de delegate Prisma: permite findUnique, count e aggregate; bloqueia writes.
 */
export function createOfficialEngineReadOnlyDelegateProxy<T extends object>(
  model: string,
  delegate: T
): T {
  return new Proxy(delegate, {
    get(target, prop, receiver) {
      if (typeof prop === "string") {
        assertOfficialEngineReadOnlyAccess(model, prop);
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
