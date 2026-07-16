#!/usr/bin/env npx tsx
/**
 * OP-14.2 — Probe read-only do seletor RSQL dataHoraEdicao em GET /rest/ordens.
 *
 * Não grava banco, não avança estado incremental, não expõe token.
 *
 *   npm run sync:nomus:production-orders:probe-selector
 *   npx tsx scripts/nomusProductionOrdersProbeSelector.ts --selector=dataHoraEdicao
 *   npx tsx scripts/nomusProductionOrdersProbeSelector.ts --selector=dataHoraCriacao
 */
import "dotenv/config";
import {
  createNomusProductionOrdersClient,
} from "../src/lib/nomusProductionOrdersClient.ts";
import {
  buildProductionOrdersIncrementalRsql,
  formatProductionOrdersIncrementalCutoffBrDate,
} from "../src/lib/nomusProductionOrdersIncremental.ts";
import {
  classifyProductionOrdersSelectorProbeOutcome,
  homologationFromProbeStatus,
  NOMUS_PRODUCTION_ORDERS_INCREMENTAL_PREFERRED_SELECTOR,
  type ProductionOrdersRsqlSelectorProbeStatus,
} from "../src/lib/nomusProductionOrdersSelectorProbe.ts";
import { fetchNomusJson } from "../src/lib/nomusRestClient.ts";

const LOG_PREFIX = "[nomus-production-orders-probe-selector]";

function parseSelector(argv: string[]): "dataHoraEdicao" | "dataHoraCriacao" {
  for (const arg of argv) {
    if (arg.startsWith("--selector=")) {
      const value = arg.slice("--selector=".length).trim();
      if (value === "dataHoraCriacao") return "dataHoraCriacao";
      return "dataHoraEdicao";
    }
  }
  return NOMUS_PRODUCTION_ORDERS_INCREMENTAL_PREFERRED_SELECTOR;
}

async function main() {
  const selector = parseSelector(process.argv.slice(2));
  const cutoff = new Date(Date.now() - 72 * 3600 * 1000);
  const rsql = buildProductionOrdersIncrementalRsql(selector, cutoff);

  const client = createNomusProductionOrdersClient({
    pageSize: 1,
    maxPages: 1,
    logger: (m) => console.warn(m),
    fetchJson: async (url, options) => fetchNomusJson(url, options),
  });

  let status: ProductionOrdersRsqlSelectorProbeStatus = "INCONCLUSIVE";
  let httpStatus: number | null = null;
  let recordsReceived: number | null = null;
  let errorMessage: string | null = null;
  let endpointRedacted: string | null = null;

  try {
    const page = await client.listPage({ page: 1, pageSize: 1, query: rsql });
    recordsReceived = page.items.length;
    httpStatus = 200;
    endpointRedacted = page.urlForLog;
    status = classifyProductionOrdersSelectorProbeOutcome({
      httpStatus,
      bodyText: null,
      recordsReceived,
      threw: false,
    });
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
    const statusMatch = errorMessage.match(/\b(400|401|403|422|429|5\d\d)\b/);
    httpStatus = statusMatch ? Number(statusMatch[1]) : null;
    status = classifyProductionOrdersSelectorProbeOutcome({
      httpStatus,
      bodyText: errorMessage,
      recordsReceived: null,
      threw: true,
      errorMessage,
    });
  }

  const result = {
    ok: true,
    probe: true,
    writes: false,
    stateAdvanced: false,
    selector,
    rsql,
    cutoffBr: formatProductionOrdersIncrementalCutoffBrDate(cutoff),
    status,
    homologationHint: homologationFromProbeStatus(status),
    httpStatus,
    recordsReceived,
    endpointRedacted,
    errorMessage: errorMessage
      ? errorMessage.replace(/(Bearer|token|Authorization)\s*[:=]\s*\S+/gi, "$1:***")
      : null,
    envHint:
      status === "ACCEPTED"
        ? `NOMUS_PRODUCTION_ORDERS_INCREMENTAL_SELECTOR_HOMOLOGATION=${selector}:accepted`
        : status === "REJECTED"
          ? `NOMUS_PRODUCTION_ORDERS_INCREMENTAL_SELECTOR_HOMOLOGATION=${selector}:rejected`
          : `NOMUS_PRODUCTION_ORDERS_INCREMENTAL_SELECTOR_HOMOLOGATION=${selector}:unverified`,
  };

  console.log(`${LOG_PREFIX} status=${status}`);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = status === "INCONCLUSIVE" ? 2 : 0;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
