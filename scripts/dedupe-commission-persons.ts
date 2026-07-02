#!/usr/bin/env npx tsx
/**
 * Saneamento de pessoas comissionadas duplicadas.
 *
 * Uso:
 *   npx tsx scripts/dedupe-commission-persons.ts --preview
 *   npx tsx scripts/dedupe-commission-persons.ts --apply
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import {
  applyCommissionPersonDedupe,
  previewCommissionPersonDedupe,
} from "../src/lib/commissions/commissionPersonResolution.server.ts";
import { normalizeCommissionPersonName } from "../src/lib/commissions/commissionPersonIdentity.ts";
import { parseScriptMode, requireDatabaseUrl } from "./commission-script-utils.ts";

function printGroup(nameFilter: string | null, groups: Awaited<ReturnType<typeof previewCommissionPersonDedupe>>["groups"]) {
  for (const group of groups) {
    if (nameFilter) {
      const normalized = normalizeCommissionPersonName(nameFilter);
      const groupName = normalizeCommissionPersonName(group.canonical.name);
      if (groupName !== normalized && !groupName.includes(normalized)) continue;
    }

    console.log(`\n--- ${group.canonical.name} (${group.canonical.type}) ---`);
    console.log(
      `  Canônico: ${group.canonical.id} | origem=${group.canonical.source} | nomus=${group.canonical.nomusPersonId ?? "—"} | ativo=${group.canonical.active}`
    );
    for (const dup of group.duplicates) {
      const fk = group.fkCounts.find((f) => f.duplicateId === dup.id);
      console.log(
        `  Duplicata: ${dup.id} | origem=${dup.source} | nomus=${dup.nomusPersonId ?? "—"} | ativo=${dup.active} | FKs: records=${fk?.records ?? 0}, batches=${fk?.batches ?? 0}, rules=${fk?.rules ?? 0}`
      );
    }
  }
}

async function main(): Promise<void> {
  requireDatabaseUrl();
  const mode = parseScriptMode();

  console.log("=== Deduplicação de pessoas comissionadas ===");
  console.log(`Modo: ${mode === "preview" ? "preview (sem alterações)" : "apply (grava no banco)"}\n`);

  const preview = await previewCommissionPersonDedupe(prisma);
  console.log(`Total antes: ${preview.totalBefore}`);
  console.log(`Grupos duplicados: ${preview.groups.length}`);
  console.log(`Total estimado depois: ${preview.totalAfter}`);

  printGroup(null, preview.groups.slice(0, 20));
  if (preview.groups.length > 20) {
    console.log(`\n… e mais ${preview.groups.length - 20} grupo(s).`);
  }

  const gisleneGroups = preview.groups.filter(
    (g) => normalizeCommissionPersonName(g.canonical.name) === normalizeCommissionPersonName("GISLENE LIMA")
  );
  if (gisleneGroups.length > 0) {
    console.log("\n=== GISLENE LIMA ===");
    printGroup("GISLENE LIMA", gisleneGroups);
  }

  if (mode === "preview") {
    console.log("\nPreview concluído. Nenhuma alteração foi feita.");
    return;
  }

  console.log("\nExecutando mesclagem…");
  const result = await applyCommissionPersonDedupe(prisma);
  console.log("\n--- Resultado ---");
  console.log(JSON.stringify(result, null, 2));
  console.log("\nDeduplicação concluída.");
}

main()
  .catch((err) => {
    console.error("Erro na deduplicação:", err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
