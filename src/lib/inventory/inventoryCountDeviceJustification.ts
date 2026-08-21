/**
 * Justificativa canônica do ator DEVICE na conferência física.
 *
 * O operador de chão não digita motivo: o ato de contar já é a origem
 * do ajuste. HUMAN continua obrigado a informar texto quando há
 * divergência efetiva.
 *
 * Constante determinística (sem timestamp) para não quebrar idempotência.
 */
import { requiresCountJustification } from "./inventoryCountObservation.js";
import {
  canonicalCountJustification,
  type CountActorType,
} from "./inventoryCountRequestHash.js";

export const DEVICE_COUNT_JUSTIFICATION = "Contagem física Collector";

/** Alias estável usado pelo Collector autônomo. */
export const COLLECTOR_DEVICE_JUSTIFICATION = DEVICE_COUNT_JUSTIFICATION;

/**
 * Justificativa persistida após o lock (delta efetivo conhecido).
 *
 * DEVICE: ignora texto do client; injeta constante só se a divergência
 * efetiva exigir razão. Sem divergência → null.
 * USER/SYSTEM: texto do usuário, sem injeção.
 */
export function resolveRecordedCountJustification(input: {
  actorType: CountActorType;
  effectiveDelta: number;
  clientJustification: string | null | undefined;
}): string | null {
  if (input.actorType === "DEVICE") {
    return requiresCountJustification(input.effectiveDelta, null)
      ? DEVICE_COUNT_JUSTIFICATION
      : null;
  }
  return canonicalCountJustification(input.clientJustification) || null;
}
