/**
 * Probe DataJud — imprime só caminhos de chaves.
 * Sem --confirm-probe=DATAJUD_PROBE não há rede.
 */

import { isDatajudEnabled, datajudConfigured, LEGAL_EXPOSURE_ENV } from "../src/lib/legalExposure/legalExposureFeatureFlags.js";
import { legalExposureFetch } from "../src/lib/legalExposure/legalExposureHttp.js";
import { datajudProbePlan, datajudSchemaPaths } from "../src/lib/legalExposure/sources/datajud/datajudSchemaProbe.js";

const plan = datajudProbePlan(process.argv.slice(2));
if (!plan.execute) {
  console.log(JSON.stringify({ executed: false, reason: plan.reason }, null, 2));
  process.exit(2);
}

const tribunal = process.argv.find((arg) => arg.startsWith("--tribunal="))?.slice("--tribunal=".length) ?? "";
if (!isDatajudEnabled() || !datajudConfigured() || !tribunal) {
  console.log(
    JSON.stringify(
      {
        executed: false,
        reason: "DATAJUD desligado, sem chave ou sem --tribunal.",
      },
      null,
      2
    )
  );
  process.exit(2);
}

const base = process.env[LEGAL_EXPOSURE_ENV.datajudBaseUrl]?.trim().replace(/\/$/, "") ?? "";
const apiKey = process.env[LEGAL_EXPOSURE_ENV.datajudApiKey]?.trim() ?? "";
const path = `/api_publica_${tribunal.toLowerCase()}/_search`;
const result = await legalExposureFetch({
  fetchImpl: fetch,
  url: `${base}${path}`,
  path,
  init: {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `APIKey ${apiKey}`,
    },
    body: JSON.stringify({ size: 1, query: { match_all: {} } }),
  },
});

console.log(
  JSON.stringify(
    {
      executed: result.outcome === "SUCCESS",
      outcome: result.outcome,
      paths: result.outcome === "SUCCESS" ? datajudSchemaPaths(result.body).slice(0, 200) : [],
      sanitizedError: result.errorMessageSanitized,
    },
    null,
    2
  )
);
process.exit(result.outcome === "SUCCESS" ? 0 : 1);
