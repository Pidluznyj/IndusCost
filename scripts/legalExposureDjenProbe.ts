/**
 * Probe DJEN/Comunica PJe read-only.
 * Não persiste. Não altera banco.
 *
 *   npm run legal-exposure:djen-probe -- --name="LAZARIOS COMERCIO DE PLASTICOS LTDA"
 *   npm run legal-exposure:djen-probe -- --process=0001384-86.2026.5.09.0009
 */

import "dotenv/config";
import { LEGAL_EXPOSURE_ENV } from "../src/lib/legalExposure/legalExposureFeatureFlags.js";
import { normalizeProcessNumber, sanitizeErrorMessage } from "../src/lib/legalExposure/legalExposureNormalization.js";
import { searchDjen } from "../src/lib/legalExposure/sources/djen/djenClient.server.js";
import { createDjenThrottle } from "../src/lib/legalExposure/sources/djen/djenThrottle.js";

const INTERESTING = [
  "id",
  "numeroProcesso",
  "numeroprocessocommascara",
  "numero_processo",
  "siglaTribunal",
  "nomeOrgao",
  "nomeClasse",
  "codigoClasse",
  "tipoDocumento",
  "tipoComunicacao",
  "meio",
  "meiocompleto",
  "dataDisponibilizacao",
  "assunto",
  "destinatarios",
  "destinatario",
  "destinatarioadvogados",
  "texto",
  "textoComunicacao",
  "inteiroTeor",
  "hash",
  "link",
];

function arg(name: string): string {
  return process.argv.find((row) => row.startsWith(`--${name}=`))?.slice(name.length + 3) ?? "";
}

function collectKeys(value: unknown, prefix = "", out = new Set<string>()): string[] {
  if (!value || typeof value !== "object") return [...out];
  if (Array.isArray(value)) {
    if (value[0]) collectKeys(value[0], prefix ? `${prefix}[]` : "[]", out);
    return [...out];
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    out.add(path);
    if (nested && typeof nested === "object") collectKeys(nested, path, out);
  }
  return [...out];
}

const name = arg("name").trim();
const processArg = arg("process").trim();
const numeroProcesso = normalizeProcessNumber(processArg) ?? processArg.replace(/\D/g, "") || "";

if (!name && !numeroProcesso) {
  console.log(JSON.stringify({ executed: false, persisted: false, reason: "Informe --name= ou --process=." }, null, 2));
  process.exit(2);
}

const batch = await searchDjen({
  env: process.env,
  fetchImpl: fetch,
  throttle: createDjenThrottle({ intervalMs: 500 }),
  query: name ? { nomeParte: name } : { numeroProcesso },
});

const sample = (batch.cases[0]?.rawMetadata ?? batch.communications[0]?.rawMetadata ?? null) as Record<string, unknown> | null;
const keys = sample ? collectKeys(sample) : [];

console.log(
  JSON.stringify(
    {
      executed: true,
      persisted: false,
      query: name ? { nomeParte: name } : { numeroProcesso },
      outcome: batch.outcome,
      pagination: batch.pagination ?? null,
      cases: batch.cases.length,
      communications: batch.communications.length,
      uniqueProcessNumbers: [...new Set(batch.cases.map((row) => row.processNumber).filter(Boolean))],
      interestingKeysPresent: INTERESTING.filter((key) => keys.some((path) => path === key || path.endsWith(`.${key}`))),
      sampleKeys: keys.slice(0, 200),
      sampleMetadata: sample,
      officialTextPreview: batch.communications[0]?.officialText?.slice(0, 500) ?? null,
      cnpjDiscovery: process.env[LEGAL_EXPOSURE_ENV.datajudCnpjDiscovery] ?? "0",
      sanitizedError: sanitizeErrorMessage(batch.errorMessageSanitized),
    },
    null,
    2
  )
);
process.exit(batch.outcome === "SUCCESS" || batch.outcome === "NO_RESULTS" || batch.outcome === "PARTIAL" ? 0 : 1);
