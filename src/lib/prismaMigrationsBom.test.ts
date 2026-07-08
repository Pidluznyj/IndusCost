/**
 * Previne BOM UTF-8 (EF BB BF) no início de migrations Prisma —
 * causa P3018 / syntax error at "\u{feff}" no PostgreSQL.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const MIGRATIONS_ROOT = join(process.cwd(), "prisma", "migrations");
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

function listMigrationSqlFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...listMigrationSqlFiles(full));
      continue;
    }
    if (name === "migration.sql") out.push(full);
  }
  return out.sort();
}

describe("prismaMigrationsBom", () => {
  it("nenhum migration.sql começa com BOM UTF-8", () => {
    const files = listMigrationSqlFiles(MIGRATIONS_ROOT);
    assert.ok(files.length > 0, "deve existir ao menos uma migration.sql");

    const withBom = files.filter((file) => {
      const buf = readFileSync(file);
      return buf.length >= 3 && buf.subarray(0, 3).equals(UTF8_BOM);
    });

    assert.deepEqual(
      withBom.map((f) => f.replace(process.cwd() + "\\", "").replace(process.cwd() + "/", "")),
      [],
      `Migrations com BOM UTF-8 (remova EF BB BF do início): ${withBom.join(", ")}`
    );
  });
});
