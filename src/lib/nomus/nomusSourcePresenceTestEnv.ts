/**
 * Testes — estado EXPLÍCITO da flag de presença Nomus de Pedidos de Venda
 * (`NOMUS_OPS_EXCLUDE_MISSING_SALES_ORDERS_ENABLED`).
 *
 * A regra de produção (`isNomusOpsExcludeMissingSalesOrdersEnabled`) lê
 * `process.env` na hora da chamada, e o where canônico de Pedidos de Venda
 * (`buildSalesOrderListWhere` e todos os consumidores) depende dela: com a flag
 * ligada, pedido MISSING_CONFIRMED sai das visões operacionais. Teste que não
 * declara o estado herda o valor do shell/.env de quem chamou `npm` — ligada na
 * homologação, ausente no dev — e o mesmo teste passa numa máquina e falha na
 * outra.
 *
 * Uso:
 *   - arquivo inteiro: `useSalesOrderPresenceFlag("OFF")` no topo, ANTES dos
 *     `describe` — cada teste começa no estado declarado e o valor herdado
 *     volta ao fim de cada teste;
 *   - cenário pontual: `await withSalesOrderPresenceFlag("ON", async () => …)`.
 *
 * Fixture cujo resultado depende da flag chama
 * `assertSalesOrderPresenceFlagDeclared()`: sem declaração o teste falha alto em
 * qualquer máquina, em vez de mudar de resultado conforme o ambiente.
 *
 * A regra em si não muda aqui — só o ambiente em que cada teste a exercita.
 *
 * Uso exclusivo de testes.
 */

import { afterEach, beforeEach } from "node:test";
import {
  NOMUS_OPS_EXCLUDE_MISSING_SALES_ORDERS_ENV,
  isNomusOpsExcludeMissingSalesOrdersEnabled,
} from "./nomusSourcePresencePolicy.js";

export type SalesOrderPresenceFlagState = "ON" | "OFF";

/** Valor gravado nos DOIS estados: um "OFF" explícito não é reescrito por um .env carregado depois. */
const ENV_VALUE: Record<SalesOrderPresenceFlagState, string> = { ON: "true", OFF: "false" };

let declared: SalesOrderPresenceFlagState | null = null;

/** Fixa o estado e devolve quem restaura exatamente o que havia antes (valor e declaração). */
function pinSalesOrderPresenceFlag(state: SalesOrderPresenceFlagState): () => void {
  const previousValue = process.env[NOMUS_OPS_EXCLUDE_MISSING_SALES_ORDERS_ENV];
  const previousDeclared = declared;
  process.env[NOMUS_OPS_EXCLUDE_MISSING_SALES_ORDERS_ENV] = ENV_VALUE[state];
  declared = state;
  return () => {
    if (previousValue === undefined) delete process.env[NOMUS_OPS_EXCLUDE_MISSING_SALES_ORDERS_ENV];
    else process.env[NOMUS_OPS_EXCLUDE_MISSING_SALES_ORDERS_ENV] = previousValue;
    declared = previousDeclared;
  };
}

/** Roda `run` com a flag no estado pedido; restaura o anterior mesmo se `run` falhar. */
export async function withSalesOrderPresenceFlag<T>(
  state: SalesOrderPresenceFlagState,
  run: () => T | Promise<T>
): Promise<T> {
  const restore = pinSalesOrderPresenceFlag(state);
  try {
    return await run();
  } finally {
    restore();
  }
}

/**
 * Declara o estado da flag para todos os testes do escopo em que é chamada
 * (topo do arquivo = arquivo inteiro; dentro de um `describe` = aquela suíte).
 */
export function useSalesOrderPresenceFlag(state: SalesOrderPresenceFlagState): void {
  let restore: (() => void) | null = null;
  beforeEach(() => {
    restore = pinSalesOrderPresenceFlag(state);
  });
  afterEach(() => {
    restore?.();
    restore = null;
  });
}

/** Estado declarado agora (`null` = nenhum teste declarou). */
export function declaredSalesOrderPresenceFlag(): SalesOrderPresenceFlagState | null {
  return declared;
}

/**
 * Para fixtures que dependem da flag: falha sem declaração, ou se o env foi
 * alterado por fora do helper depois de declarado.
 */
export function assertSalesOrderPresenceFlagDeclared(consumer: string): SalesOrderPresenceFlagState {
  if (declared === null) {
    throw new Error(
      `${consumer}: o resultado depende de ${NOMUS_OPS_EXCLUDE_MISSING_SALES_ORDERS_ENV}. ` +
        `Declare o estado no teste — useSalesOrderPresenceFlag("OFF" | "ON") no arquivo ou ` +
        `withSalesOrderPresenceFlag(...) no cenário — em vez de herdar o valor do shell/.env.`
    );
  }
  const effective: SalesOrderPresenceFlagState = isNomusOpsExcludeMissingSalesOrdersEnabled() ? "ON" : "OFF";
  if (effective !== declared) {
    throw new Error(
      `${consumer}: flag de presença declarada ${declared}, mas process.env resolve ${effective} — ` +
        `${NOMUS_OPS_EXCLUDE_MISSING_SALES_ORDERS_ENV} foi alterada fora do helper.`
    );
  }
  return declared;
}
