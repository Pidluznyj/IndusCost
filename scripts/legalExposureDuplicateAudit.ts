import "dotenv/config";
/**
 * Auditoria somente leitura de duplicatas físicas do mesmo CNJ.
 *
 *   npm run legal-exposure:duplicate-audit
 */

import { previewCanonicalGroups } from "../src/lib/legalExposure/legalExposureCanonical.js";
import { listCanonicalCases } from "../src/lib/legalExposure/legalExposureExecutive.js";
import { canonicalProcessKey } from "../src/lib/legalExposure/legalExposureNormalization.js";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log(
      JSON.stringify(
        {
          readOnly: true,
          aborted: "DATABASE_URL ausente. Nenhuma escrita executada.",
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
          aborted: "Banco local indisponível. Nenhuma escrita executada.",
        },
        null,
        2
      )
    );
    return;
  }
  const preview = previewCanonicalGroups(memory);
  const list = listCanonicalCases(memory, {});
  const duplicateGroups = (preview.duplicatedProcesses ?? []).map((row) => {
    const key = canonicalProcessKey(row.processNumberNormalized || row.processNumber).key;
    return {
      cnj: key.startsWith("invalid:") ? row.processNumber : key,
      physicalRecords: row.physicalCases,
      physicalCaseIds: row.caseIds,
      entityIds: row.companies.map((item: { entityId: string }) => item.entityId),
      empresas: row.companies.map((item: { legalName: string }) => item.legalName),
      uiExpectedRecords: 1,
    };
  });
  console.log(
    JSON.stringify(
      {
        readOnly: true,
        physicalCases: preview.physicalCases,
        validCnjCases: preview.validCnjCases,
        uniqueCanonicalCnj: preview.uniqueCanonicalCnj,
        duplicateCanonicalGroups: preview.duplicateCnjGroups,
        invalidProcessNumbers: preview.invalidProcessNumbers,
        listCanonicalCases: list.length,
        invariantOk: list.length === new Set(list.map((row) => canonicalProcessKey(row.processNumber).key)).size,
        duplicates: duplicateGroups,
      },
      null,
      2
    )
  );
  await prisma.$disconnect().catch(() => undefined);
}

await main();
