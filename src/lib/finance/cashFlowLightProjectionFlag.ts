/**
 * FASE 2C — chave única do caminho leve do Fluxo de Caixa.
 *
 * `INDUSCOST_CASH_FLOW_LIGHT_PROJECTION=1` troca a FONTE da projeção dos
 * pedidos (auditoria 360º → loader leve). Nada mais muda: os builders
 * financeiros e o payload HTTP continuam os mesmos.
 *
 * DEFAULT SEGURO: sem a variável, ou com qualquer valor diferente de `"1"`,
 * o caminho é o legado. Só o valor exato `"1"` liga — `"true"`, `"yes"` e
 * `"on"` NÃO ligam, de propósito: quem liga precisa saber que está ligando.
 *
 * Esta é a ÚNICA leitura da variável no código. Quem precisar decidir recebe
 * `projectionMode` por parâmetro, com default `"legacy"` — assim consumidores
 * fora do Fluxo de Caixa (relatório executivo, tesouraria) permanecem no
 * caminho antigo mesmo com a flag ligada.
 */

export const CASH_FLOW_LIGHT_PROJECTION_ENV =
  "INDUSCOST_CASH_FLOW_LIGHT_PROJECTION";

export type CashFlowProjectionMode = "legacy" | "light";

export function isCashFlowLightProjectionEnabled(): boolean {
  if (typeof process === "undefined" || !process.env) return false;
  return process.env[CASH_FLOW_LIGHT_PROJECTION_ENV] === "1";
}

/** Modo para os três endpoints do Fluxo de Caixa. Demais chamadores: legacy. */
export function resolveCashFlowProjectionMode(): CashFlowProjectionMode {
  return isCashFlowLightProjectionEnabled() ? "light" : "legacy";
}
