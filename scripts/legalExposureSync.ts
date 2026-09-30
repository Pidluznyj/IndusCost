/**
 * CLI do Exposure. Padrão: preview. userId de auditoria é null (nunca UUID fake).
 * Apply global exige LEGAL_EXPOSURE_AUTOSYNC_ENABLED=1. Não liga a flag.
 */

import {
  legalExposureAutosyncApplyAllowed,
  parseLegalExposureSyncArgs,
} from "../src/lib/legalExposure/legalExposureSyncCli.js";
import { publicSourceConfiguration } from "../src/lib/legalExposure/legalExposureFeatureFlags.js";

const args = parseLegalExposureSyncArgs(process.argv.slice(2));
const gate = legalExposureAutosyncApplyAllowed(args);

if (!gate.ok) {
  console.error(
    JSON.stringify(
      {
        mode: args.mode,
        source: args.source,
        entityId: args.entityId,
        blocked: true,
        message: gate.message,
        configuration: publicSourceConfiguration(),
      },
      null,
      2
    )
  );
  process.exit(gate.exitCode);
}

const { createLegalExposureService } = await import("../src/lib/legalExposure/legalExposureService.server.js");
const { createPrismaExposureRepository } = await import("../src/lib/legalExposure/legalExposureRepository.server.js");
const { prisma } = await import("../src/lib/prisma.js");

const service = createLegalExposureService({
  repository: createPrismaExposureRepository(prisma),
  recordIntegrationRun: async (input) => {
    const startedAt = input.startedAt ?? new Date();
    const finishedAt = input.finishedAt ?? new Date();
    await prisma.integrationRun.create({
      data: {
        sourceSystem: "CNJ",
        target: input.target,
        mode: input.mode,
        status: input.status,
        success: input.status === "SUCCESS" || input.status === "NO_RESULTS" || input.status === "PARTIAL",
        summaryJson: input.summary as object,
        command: input.command ?? null,
        startedAt,
        finishedAt,
        durationMs: input.durationMs ?? Math.max(0, finishedAt.getTime() - startedAt.getTime()),
      },
    });
  },
});

const result = await service.sync(
  {
    mode: args.mode,
    source: args.source,
    entityId: args.entityId ?? undefined,
    trigger: "SCHEDULED",
  },
  null
);
console.log(JSON.stringify(result, null, 2));
await prisma.$disconnect();
