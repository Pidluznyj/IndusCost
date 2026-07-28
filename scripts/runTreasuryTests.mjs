/**
 * Runner Windows-safe para `npm run test:treasury`.
 * Evita "Linha de comando muito longa" ao particionar os arquivos.
 */

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const BATCH_SIZE = 35;

function walkTests(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTests(full, acc);
      continue;
    }
    if (/\.test\.(ts|tsx)$/.test(entry.name)) {
      acc.push(relative(root, full).replace(/\\/g, "/"));
    }
  }
  return acc;
}

const files = [
  ...walkTests(join(root, "src/lib/treasury")),
  ...walkTests(join(root, "src/components/finance/treasury")),
].sort((a, b) => a.localeCompare(b));

if (files.length === 0) {
  console.error("[test:treasury] nenhum arquivo *.test.ts(x) encontrado");
  process.exit(1);
}

console.log(`[test:treasury] ${files.length} arquivo(s) em lotes de ${BATCH_SIZE}`);

let failed = 0;
for (let i = 0; i < files.length; i += BATCH_SIZE) {
  const batch = files.slice(i, i + BATCH_SIZE);
  const batchNo = Math.floor(i / BATCH_SIZE) + 1;
  const totalBatches = Math.ceil(files.length / BATCH_SIZE);
  console.log(
    `[test:treasury] lote ${batchNo}/${totalBatches} (${batch.length} arquivos)`
  );
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", ...batch],
    {
      cwd: root,
      stdio: "inherit",
      env: process.env,
      shell: false,
    }
  );
  if (result.status !== 0) {
    failed = result.status ?? 1;
    break;
  }
}

process.exit(failed);
