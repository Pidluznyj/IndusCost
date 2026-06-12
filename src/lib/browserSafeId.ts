/**
 * Gera IDs únicos no browser sem depender de `crypto.randomUUID()`.
 * Em contextos HTTP não seguros (ex.: IP interno), `randomUUID` pode não existir.
 */
export function createBrowserSafeId(prefix = "id"): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();

  if (randomUuid) {
    return `${prefix}-${randomUuid}`;
  }

  const cryptoObj = globalThis.crypto;

  if (cryptoObj?.getRandomValues) {
    const bytes = new Uint32Array(2);
    cryptoObj.getRandomValues(bytes);
    return `${prefix}-${Date.now().toString(36)}-${Array.from(bytes)
      .map((value) => value.toString(36))
      .join("-")}`;
  }

  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}
