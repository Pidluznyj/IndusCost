import "dotenv/config";
/**
 * Auditoria somente leitura da agenda oficial das fontes.
 * Não consulta DJEN/DataJud/Escavador/tribunal.
 *
 *   npm run legal-exposure:source-schedule-audit
 */

import { publicSourceConfiguration } from "../src/lib/legalExposure/legalExposureFeatureFlags.js";
import { buildSourceOperations } from "../src/lib/legalExposure/legalExposureSourceOperations.js";
import { LEGAL_EXPOSURE_SOURCE_SCHEDULE, sourceReadinessOf } from "../src/lib/legalExposure/legalExposureSourceSchedule.js";
import { createEmptyExposureMemory } from "../src/lib/legalExposure/legalExposureStore.js";

async function main() {
  const now = new Date();
  let memory = createEmptyExposureMemory();
  let runs: Parameters<typeof buildSourceOperations>[0]["runs"] = [];
  if (process.env.DATABASE_URL) {
    try {
      const { createPrismaExposureRepository } = await import("../src/lib/legalExposure/legalExposureRepository.server.js");
      const { prisma } = await import("../src/lib/prisma.js");
      const { listExposureIntegrationRuns } = await import("../src/lib/legalExposure/legalExposureIntegrationRun.server.js");
      memory = await createPrismaExposureRepository(prisma).load();
      runs = await listExposureIntegrationRuns(prisma, { take: 50 });
      await prisma.$disconnect().catch(() => undefined);
    } catch {
      /* agenda ainda pode ser auditada sem banco */
    }
  }
  const operations = buildSourceOperations({ memory, now, runs });
  console.log(
    JSON.stringify(
      {
        readOnly: true,
        healthCheckExternalCall: false,
        timezone: "America/Sao_Paulo",
        schedule: LEGAL_EXPOSURE_SOURCE_SCHEDULE,
        configuration: publicSourceConfiguration(),
        readiness: (["DJEN", "DATAJUD", "TRIBUNAL_PUBLIC", "ESCAVADOR", "JUSBRASIL", "DOMICILIO"] as const).map((source) =>
          sourceReadinessOf(source)
        ),
        operations: operations.map((row) => ({
          source: row.source,
          readiness: row.readiness,
          configured: row.configured,
          enabled: row.enabled,
          running: row.running,
          lastRun: row.lastRun?.startedAt ?? null,
          durationMs: row.lastRun?.durationMs ?? null,
          nextScheduledAt: row.nextScheduledAt,
          frequency: row.frequencyLabel,
          missingEnvVars: row.missingEnvVars,
        })),
      },
      null,
      2
    )
  );
}

await main();
