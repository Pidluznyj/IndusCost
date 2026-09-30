import "dotenv/config";
/**
 * Auditoria somente leitura da cobertura executiva dos processos.
 *
 *   npm run legal-exposure:coverage-audit
 *   npm run legal-exposure:coverage-audit -- --preview-sample
 *
 * --preview-sample consulta fontes autorizadas na amostra 5 TRT9 + 5 TJPR
 * sem persistir. Complementares pagas só se habilitadas.
 */

import { publicSourceConfiguration } from "../src/lib/legalExposure/legalExposureFeatureFlags.js";
import { listCanonicalCases } from "../src/lib/legalExposure/legalExposureExecutive.js";
import { buildCoverageAuditReport, selectControlSample } from "../src/lib/legalExposure/legalExposureCoverageAudit.js";

function wantsPreview(): boolean {
  return process.argv.includes("--preview-sample");
}

async function main() {
  const configuration = publicSourceConfiguration();
  const previewRequested = wantsPreview();
  if (!process.env.DATABASE_URL) {
    console.log(
      JSON.stringify(
        {
          readOnly: true,
          externalCall: false,
          aborted: "DATABASE_URL ausente. Nenhuma escrita executada.",
          configuration,
        },
        null,
        2
      )
    );
    return;
  }
  const { createPrismaExposureRepository } = await import("../src/lib/legalExposure/legalExposureRepository.server.js");
  const { prisma } = await import("../src/lib/prisma.js");
  let memory;
  try {
    memory = await createPrismaExposureRepository(prisma).load();
  } catch {
    await prisma.$disconnect().catch(() => undefined);
    console.log(
      JSON.stringify(
        {
          readOnly: true,
          externalCall: false,
          aborted: "Banco local indisponível. Nenhuma escrita executada.",
          configuration,
        },
        null,
        2
      )
    );
    return;
  }
  const items = listCanonicalCases(memory, {});
  const previewSample: Array<{
    cnj: string;
    tribunal: string | null;
    before: (typeof items)[number]["coverage"] | null;
    after: (typeof items)[number]["coverage"] | null;
    steps: Array<{ source: string; outcome: string; errorCode: string | null; message: string | null }>;
  }> = [];

  if (previewRequested) {
    const sample = selectControlSample(items, 5);
    const targets = [...sample.trt9, ...sample.tjpr];
    const { previewLegalProcessEnrichment } = await import("../src/lib/legalExposure/legalProcessEnrichment.server.js");
    const { defaultRunners } = await import("../src/lib/legalExposure/legalExposureService.server.js");
    let runners;
    try {
      runners = await defaultRunners();
    } catch (error) {
      previewSample.push({
        cnj: "(amostra)",
        tribunal: null,
        before: null,
        after: null,
        steps: [
          {
            source: "DATAJUD",
            outcome: "SOURCE_ERROR",
            errorCode: "TECHNICAL_ERROR",
            message: error instanceof Error ? error.message : "Falha ao iniciar runners.",
          },
        ],
      });
      runners = null;
    }
    if (runners) {
      let n = 0;
      const createId = () => `preview-${++n}`;
      for (const item of targets) {
        try {
          const result = await previewLegalProcessEnrichment({
            memory,
            entityId: item.entityId,
            processNumber: item.processNumber,
            tribunal: item.tribunal,
            system: item.systemName,
            runners,
            now: new Date().toISOString(),
            createId,
            force: true,
          });
          previewSample.push({
            cnj: item.processNumber,
            tribunal: item.tribunal,
            before: result.coverageBefore,
            after: result.coverageAfter,
            steps: result.steps.map((step) => ({
              source: step.source,
              outcome: step.outcome,
              errorCode: step.errorCode,
              message: step.message,
            })),
          });
        } catch (error) {
          previewSample.push({
            cnj: item.processNumber,
            tribunal: item.tribunal,
            before: item.coverage ?? null,
            after: item.coverage ?? null,
            steps: [
              {
                source: "DATAJUD",
                outcome: "SOURCE_ERROR",
                errorCode: "TECHNICAL_ERROR",
                message: error instanceof Error ? error.message : "Falha no preview.",
              },
            ],
          });
        }
      }
    }
  }

  const report = buildCoverageAuditReport({
    items,
    configuration,
    previewSample: previewRequested ? previewSample : [],
  });
  const summary = {
    readOnly: true,
    persisted: false,
    uniqueProcesses: report.uniqueProcesses,
    coverage: report.coverage,
    topIncomplete: report.topIncomplete,
    controlSampleCounts: {
      trt9: report.controlSample.trt9.length,
      tjpr: report.controlSample.tjpr.length,
    },
    previewSample: report.previewSample,
    processes: report.processes,
    configuration: report.configuration,
  };
  console.log(JSON.stringify(summary, null, 2));
  await prisma.$disconnect().catch(() => undefined);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Falha na auditoria de cobertura.");
  process.exitCode = 1;
});
