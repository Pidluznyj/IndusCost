/**
 * Preview/apply de agrupamento canônico. APPLY não roda sozinho.
 * Uso:
 *   npx tsx scripts/legalExposureCanonicalCases.ts --preview
 *   npx tsx scripts/legalExposureCanonicalCases.ts --apply --confirm=LEGAL_EXPOSURE_CANONICAL
 */

import { previewCanonicalGroups } from "../src/lib/legalExposure/legalExposureCanonical.js";
import { createEmptyExposureMemory } from "../src/lib/legalExposure/legalExposureStore.js";

const args = process.argv.slice(2);
const preview = args.includes("--preview") || !args.includes("--apply");
const confirm = args.find((arg) => arg.startsWith("--confirm="))?.slice("--confirm=".length);

if (!preview && confirm !== "LEGAL_EXPOSURE_CANONICAL") {
  console.log(JSON.stringify({ executed: false, reason: "APPLY exige --confirm=LEGAL_EXPOSURE_CANONICAL" }, null, 2));
  process.exit(2);
}

const memory = createEmptyExposureMemory();
const report = previewCanonicalGroups(memory);
console.log(
  JSON.stringify(
    {
      mode: preview ? "preview" : "apply-not-executed-without-repository",
      note: "Este script não apaga duplicatas. Carregue o repositório Prisma no ambiente operacional para preview real.",
      ...report,
    },
    null,
    2
  )
);
