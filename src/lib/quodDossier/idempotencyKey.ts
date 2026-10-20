/**
 * UUID v4 criptograficamente seguro para a chave de idempotência da consulta paga.
 *
 * `crypto.randomUUID` não existe em contexto HTTP inseguro em vários navegadores.
 * A ordem é: randomUUID quando houver, senão getRandomValues. Nunca Math.random.
 * Sem fonte segura, lança: a consulta paga não pode seguir sem chave confiável.
 */

export class SecureRandomUnavailableError extends Error {
  readonly code = "SECURE_RANDOM_UNAVAILABLE";
  constructor() {
    super(
      "Gerador aleatório seguro indisponível neste navegador. A consulta paga foi bloqueada para evitar cobrança sem chave de idempotência confiável."
    );
    this.name = "SecureRandomUnavailableError";
  }
}

type CryptoLike = {
  randomUUID?: () => string;
  getRandomValues?: <T extends ArrayBufferView | null>(array: T) => T;
};

function resolveCrypto(provided?: CryptoLike): CryptoLike | null {
  if (provided) return provided;
  if (typeof globalThis !== "undefined" && (globalThis as { crypto?: CryptoLike }).crypto) {
    return (globalThis as { crypto?: CryptoLike }).crypto ?? null;
  }
  return null;
}

function formatUuidV4(bytes: Uint8Array): string {
  // Versão 4 e variante RFC 4122.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex: string[] = [];
  for (let i = 0; i < 16; i += 1) hex.push(bytes[i]!.toString(16).padStart(2, "0"));
  return `${hex[0]}${hex[1]}${hex[2]}${hex[3]}-${hex[4]}${hex[5]}-${hex[6]}${hex[7]}-${hex[8]}${hex[9]}-${hex[10]}${hex[11]}${hex[12]}${hex[13]}${hex[14]}${hex[15]}`;
}

export function generateIdempotencyKey(provided?: CryptoLike): string {
  const source = resolveCrypto(provided);
  if (source?.randomUUID) {
    const value = source.randomUUID();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      return value;
    }
  }
  if (source?.getRandomValues) {
    const bytes = new Uint8Array(16);
    source.getRandomValues(bytes);
    return formatUuidV4(bytes);
  }
  throw new SecureRandomUnavailableError();
}
