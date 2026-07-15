#!/usr/bin/env npx tsx
/**
 * Preflight de migrations Person/RH — não aplica em produção.
 *
 * Uso:
 *   npx tsx scripts/canonical-person-migration-preflight.ts
 *   DATABASE_URL_TEST=postgresql://... npx tsx scripts/canonical-person-migration-preflight.ts --db-validate
 *
 * --db-validate: só roda `prisma migrate diff` / validate se DATABASE_URL_TEST estiver setado.
 * Nunca usa DATABASE_URL de produção implicitamente para migrate deploy.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const MIG = join(ROOT, "prisma", "migrations");

const REQUIRED = [
  "20260715180000_employee_registration_lookups",
  "20260715190000_canonical_person",
  "20260715200000_canonical_person_core_harden",
  "20260715210000_employee_corporate_email_normalize",
  "20260715220000_customer_contact_person",
] as const;

function main(): void {
  console.log("=== Person/RH migration preflight ===");
  let failed = 0;

  for (const name of REQUIRED) {
    const sqlPath = join(MIG, name, "migration.sql");
    if (!existsSync(sqlPath)) {
      console.error(`FAIL missing ${name}/migration.sql`);
      failed += 1;
      continue;
    }
    const sql = readFileSync(sqlPath, "utf8");
    if (sql.trim().length < 20) {
      console.error(`FAIL empty SQL ${name}`);
      failed += 1;
      continue;
    }
    if (/DROP\s+TABLE\s+"Person"/i.test(sql)) {
      console.error(`FAIL ${name} drops Person`);
      failed += 1;
      continue;
    }
    console.log(`OK ${name}`);
  }

  const dirs = readdirSync(MIG, { withFileTypes: true }).filter((d) => d.isDirectory());
  for (const d of dirs) {
    if (!existsSync(join(MIG, d.name, "migration.sql"))) {
      console.error(`FAIL folder without SQL: ${d.name}`);
      failed += 1;
    }
  }

  if (process.argv.includes("--db-validate")) {
    const testUrl = process.env.DATABASE_URL_TEST;
    if (!testUrl) {
      console.error(
        "FAIL --db-validate exige DATABASE_URL_TEST (banco isolado). Não usar DATABASE_URL de produção."
      );
      failed += 1;
    } else {
      console.log("Validando schema com DATABASE_URL_TEST…");
      try {
        execSync("npx prisma validate", {
          stdio: "inherit",
          env: { ...process.env, DATABASE_URL: testUrl },
        });
        console.log(
          "OK prisma validate (DATABASE_URL_TEST). Para deploy isolado no host de homolog:\n" +
            "  DATABASE_URL=$DATABASE_URL_TEST npx prisma migrate deploy"
        );
      } catch {
        failed += 1;
      }
    }
  } else {
    console.log(
      "Dica: banco isolado → DATABASE_URL_TEST=... npx tsx scripts/canonical-person-migration-preflight.ts --db-validate"
    );
  }

  if (failed > 0) {
    console.error(`\nPreflight FAIL (${failed})`);
    process.exit(1);
  }
  console.log("\nPreflight OK — nenhuma migration foi aplicada.");
}

main();
