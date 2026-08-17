/**
 * FASE 2C — telemetria de EXECUÇÃO do caminho do Fluxo de Caixa.
 *
 * Existe para responder, por execução e não por leitura de código: quando a
 * flag está ligada, o caminho leve realmente rodou e a auditoria 360º
 * realmente NÃO foi usada para montar as projeções do Fluxo de Caixa?
 *
 * São três contadores inteiros e o último modo observado. Nada mais:
 * nenhum SQL, nenhum payload, nenhum nome, CNPJ, comentário ou rawPayload.
 * Não entra em resposta HTTP — só é lido por teste/diagnóstico.
 *
 * O custo é um incremento de inteiro por pedido; por isso pode ficar sempre
 * ligado sem gate de ambiente.
 */

import type { CashFlowProjectionMode } from "./cashFlowLightProjectionFlag.js";

export type CashFlowProjectionTelemetry = {
  /** Último modo com que o builder de contextos foi invocado. */
  lastProjectionMode: CashFlowProjectionMode | null;
  /** Execuções de `loadCashFlowOrderProjections` (caminho leve). */
  lightLoaderCalls: number;
  /** Execuções de `getOrderFullAudit` para montar contexto do Fluxo de Caixa. */
  fullAuditCalls: number;
};

const state: CashFlowProjectionTelemetry = {
  lastProjectionMode: null,
  lightLoaderCalls: 0,
  fullAuditCalls: 0,
};

export function recordCashFlowProjectionMode(mode: CashFlowProjectionMode): void {
  state.lastProjectionMode = mode;
}

export function recordCashFlowLightLoaderCall(): void {
  state.lightLoaderCalls += 1;
}

export function recordCashFlowFullAuditCall(): void {
  state.fullAuditCalls += 1;
}

export function getCashFlowProjectionTelemetry(): CashFlowProjectionTelemetry {
  return { ...state };
}

export function resetCashFlowProjectionTelemetry(): void {
  state.lastProjectionMode = null;
  state.lightLoaderCalls = 0;
  state.fullAuditCalls = 0;
}
