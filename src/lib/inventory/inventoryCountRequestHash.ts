/**
 * FASE 2B — representação canônica de uma operação de contagem. Motor puro.
 *
 * A idempotência compara SIGNIFICADO, não JSON cru: dois requests que pedem a
 * mesma coisa precisam colidir mesmo escritos de formas diferentes, e dois que
 * pedem coisas diferentes precisam divergir sempre.
 *
 * Serialização: JSON com chaves fixas em ordem fixa. Nada de concatenar com
 * separador — `justification` é texto livre e poderia conter o delimitador,
 * permitindo que payloads distintos produzissem a mesma string.
 */
import { createHash } from "node:crypto";
import { roundInventoryQuantity } from "./inventoryTypes.js";

/** Ator canônico da operação. DEVICE/SYSTEM nunca vêm do browser humano. */
export const COUNT_ACTOR_TYPES = ["USER", "DEVICE", "SYSTEM"] as const;
export type CountActorType = (typeof COUNT_ACTOR_TYPES)[number];

export function isCountActorType(value: unknown): value is CountActorType {
  return typeof value === "string" && (COUNT_ACTOR_TYPES as readonly string[]).includes(value);
}

export type CountRequestCanonicalInput = {
  lineId: string;
  countedQuantity: number;
  justification: string | null | undefined;
  expectedVersion: number;
  actorType: CountActorType;
  userId: string | null | undefined;
  deviceId: string | null | undefined;
};

/**
 * Quantidade na precisão do Inventory: Decimal(20,6).
 * 1, 1.0 e 1.000000 produzem exatamente "1.000000".
 */
export function canonicalCountQuantity(value: number): string {
  return roundInventoryQuantity(value).toFixed(6);
}

/** Justificativa normalizada do mesmo jeito que é persistida (trim, vazio = ""). */
export function canonicalCountJustification(value: string | null | undefined): string {
  return (value ?? "").trim();
}

/**
 * Payload canônico da operação — exatamente os campos que mudam o resultado.
 * Ficam de fora: timestamps, ordem de propriedades do JSON recebido, sessionId
 * (derivável de lineId) e qualquer dado de apresentação.
 */
export function buildCountRequestCanonicalPayload(
  input: CountRequestCanonicalInput
): Record<string, string | number> {
  return {
    lineId: input.lineId,
    countedQuantity: canonicalCountQuantity(input.countedQuantity),
    justification: canonicalCountJustification(input.justification),
    expectedVersion: Math.trunc(input.expectedVersion),
    actorType: input.actorType,
    userId: input.userId ?? "",
    deviceId: input.deviceId ?? "",
  };
}

/** SHA-256 do payload canônico. */
export function buildCountRequestHash(input: CountRequestCanonicalInput): string {
  const payload = buildCountRequestCanonicalPayload(input);
  // JSON.stringify com lista explícita de chaves: ordem determinística,
  // independente da ordem em que o objeto foi montado.
  const serialized = JSON.stringify(payload, [
    "lineId",
    "countedQuantity",
    "justification",
    "expectedVersion",
    "actorType",
    "userId",
    "deviceId",
  ]);
  return createHash("sha256").update(serialized, "utf8").digest("hex");
}
