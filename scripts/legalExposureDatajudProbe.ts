/**
 * Probe DataJud read-only por número CNJ explícito.
 * Sem persistência, sem descoberta por CNPJ.
 *
 * npm run legal-exposure:datajud-probe -- --process=0001234-56.2024.5.09.0001 --tribunal=trt9 --confirm-probe=DATAJUD_PROBE
 */

import { datajudConfigured, isDatajudEnabled, LEGAL_EXPOSURE_ENV } from "../src/lib/legalExposure/legalExposureFeatureFlags.js";
import { legalExposureFetch } from "../src/lib/legalExposure/legalExposureHttp.js";
import { normalizeProcessNumber, sanitizeErrorMessage } from "../src/lib/legalExposure/legalExposureNormalization.js";
import { buildDatajudProcessQuery } from "../src/lib/legalExposure/sources/datajud/datajudContracts.js";
import { datajudProbePlan, datajudSchemaPaths } from "../src/lib/legalExposure/sources/datajud/datajudSchemaProbe.js";

const args = process.argv.slice(2);
const plan = datajudProbePlan(args);
const processArg = args.find((arg) => arg.startsWith("--process="))?.slice("--process=".length) ?? "";
const tribunal = args.find((arg) => arg.startsWith("--tribunal="))?.slice("--tribunal=".length) ?? "";
const normalized = normalizeProcessNumber(processArg);

if (!plan.execute) {
  console.log(JSON.stringify({ executed: false, reason: plan.reason }, null, 2));
  process.exit(2);
}

if (!normalized) {
  console.log(JSON.stringify({ executed: false, reason: "Informe --process= com número CNJ de 20 dígitos." }, null, 2));
  process.exit(2);
}

if (!isDatajudEnabled() || !datajudConfigured() || !tribunal) {
  console.log(
    JSON.stringify({ executed: false, reason: "DATAJUD desligado, sem chave ou sem --tribunal." }, null, 2)
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
    body: JSON.stringify(buildDatajudProcessQuery(normalized)),
  },
});

console.log(
  JSON.stringify(
    {
      executed: result.outcome === "SUCCESS",
      outcome: result.outcome,
      process: normalized,
      paths: result.outcome === "SUCCESS" ? datajudSchemaPaths(result.body).slice(0, 200) : [],
      sanitizedError: sanitizeErrorMessage(result.errorMessageSanitized),
    },
    null,
    2
  )
);
process.exit(result.outcome === "SUCCESS" ? 0 : 1);
