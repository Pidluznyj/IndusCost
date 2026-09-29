/**
 * CLI do Exposure. Padrão: preview, sem rede quando as flags estão desligadas.
 * Apply só escreve no banco do processo atual e exige confirmação explícita.
 * Este script não deve ser apontado para homologação/produção a partir do Cursor.
 */

import { publicSourceConfiguration } from "../src/lib/legalExposure/legalExposureFeatureFlags.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const confirmed = args.includes("--confirm-apply=LEGAL_EXPOSURE_APPLY");
const sourceArg = args.find((arg) => arg.startsWith("--source="))?.slice("--source=".length) ?? "ALL";

if (apply && !confirmed) {
  console.error("Apply recusado. Use preview ou --confirm-apply=LEGAL_EXPOSURE_APPLY no ambiente autorizado.");
  process.exit(2);
}

const configuration = publicSourceConfiguration();
console.log(
  JSON.stringify(
    {
      mode: apply ? "apply" : "preview",
      source: sourceArg,
      externalCall: false,
      configuration,
      note: "Flags desligadas ou preview: nenhuma chamada externa neste processo.",
    },
    null,
    2
  )
);

if (!apply) process.exit(0);

const { createLegalExposureService } = await import("../src/lib/legalExposure/legalExposureService.server.js");
const { createPrismaExposureRepository } = await import("../src/lib/legalExposure/legalExposureRepository.server.js");
const { prisma } = await import("../src/lib/prisma.js");

const service = createLegalExposureService({
  repository: createPrismaExposureRepository(prisma),
  recordIntegrationRun: async (input) => {
    await prisma.integrationRun.create({
      data: {
        sourceSystem: "CNJ",
        target: input.target,
        mode: input.mode,
        status: input.status,
        success: input.status === "SUCCESS" || input.status === "NO_RESULTS",
        summaryJson: input.summary as object,
        startedAt: new Date(),
        finishedAt: new Date(),
      },
    });
  },
});

const source = sourceArg.toUpperCase();
const result = await service.sync(
  {
    mode: "apply",
    source: source === "ALL" ? "ALL" : (source as "DOMICILIO" | "DATAJUD" | "DJEN"),
  },
  "cli"
);
console.log(JSON.stringify(result, null, 2));
await prisma.$disconnect();
