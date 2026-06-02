/**
 * Diagnóstico read-only de conflito Material × Product × Nomus × ProductBOM.
 *
 * Uso:
 *   npm run sync:nomus:registry-conflict-diagnostic -- --code=420.01 --parentCode=610.04AA
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { buildComponentRegistryConflictPreview } from "../src/lib/nomusComponentRegistryConflict.ts";

function parseArgs(): { code: string; parentCode: string | null; out: string | null } {
  let code = "420.01";
  let parentCode: string | null = null;
  let out: string | null = null;
  for (const arg of process.argv.slice(2)) {
    const codeMatch = arg.match(/^--code=(.+)$/);
    if (codeMatch) code = codeMatch[1].trim();
    const parentMatch = arg.match(/^--parentCode=(.+)$/);
    if (parentMatch) parentCode = parentMatch[1].trim();
    const outMatch = arg.match(/^--out=(.+)$/);
    if (outMatch) out = outMatch[1].trim();
  }
  return { code, parentCode, out };
}

async function main(): Promise<void> {
  const { code, parentCode, out } = parseArgs();
  console.warn(
    `[registry-conflict-diagnostic] code=${code}${parentCode ? ` parentCode=${parentCode}` : ""}`
  );

  const preview = await buildComponentRegistryConflictPreview({ codeBase: code, parentCode });
  const json = JSON.stringify(preview, null, 2);

  if (out) {
    writeFileSync(out, json, "utf8");
    console.warn(`[registry-conflict-diagnostic] gravado em ${out}`);
  }
  console.log(json);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
