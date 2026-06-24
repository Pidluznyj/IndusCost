/**
 * Verificação do bundle de produção (`dist`).
 *
 * Falha (exit 1) se QUALQUER artefato do `dist` contiver vestígios de Prisma.
 * Roda DEPOIS de `npm run build`. Pega conteúdo minificado, pois procura as
 * strings literais que sobrevivem à minificação.
 *
 * Uso: npm run check:browser-bundle
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DIST = path.join(ROOT, "dist");

const FORBIDDEN: Array<{ label: string; re: RegExp }> = [
  { label: ".prisma/client", re: /\.prisma\/client/ },
  { label: "@prisma/client", re: /@prisma\/client/ },
  { label: "PrismaClient", re: /PrismaClient/ },
  { label: "PRISMA_QUERY_LOG", re: /PRISMA_QUERY_LOG/ },
  { label: "src/lib/prisma", re: /src\/lib\/prisma/ },
  { label: "lib/prisma", re: /(^|[^.\w])lib\/prisma/ },
];

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

type Hit = { file: string; label: string; snippet: string };

function main(): void {
  if (!existsSync(DIST)) {
    console.error("[check:browser-bundle] FALHA — pasta dist/ não existe. Rode `npm run build` antes.");
    process.exit(1);
  }

  const files = listFiles(DIST).filter((f) => /\.(js|mjs|cjs|css|html)$/i.test(f));
  if (files.length === 0) {
    console.error("[check:browser-bundle] FALHA — nenhum artefato js/css/html em dist/.");
    process.exit(1);
  }

  const hits: Hit[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const rule of FORBIDDEN) {
      const m = rule.re.exec(text);
      if (m) {
        const start = Math.max(0, m.index - 40);
        const end = Math.min(text.length, m.index + 60);
        hits.push({
          file: path.relative(ROOT, file).replace(/\\/g, "/"),
          label: rule.label,
          snippet: text.slice(start, end).replace(/\s+/g, " "),
        });
      }
    }
  }

  if (hits.length === 0) {
    console.log(
      `[check:browser-bundle] OK — ${files.length} artefato(s) verificado(s); dist/ livre de Prisma.`
    );
    process.exit(0);
  }

  console.error(`[check:browser-bundle] FALHA — ${hits.length} vestígio(s) de Prisma no dist/:\n`);
  for (const h of hits) {
    console.error(`  ✗ [${h.label}] ${h.file}`);
    console.error(`    …${h.snippet}…\n`);
  }
  console.error(
    "O bundle do navegador está contaminado com Prisma. Rode `npm run check:frontend-server-imports`\n" +
      "para localizar a cadeia de import frontend → Prisma e corrija na origem."
  );
  process.exit(1);
}

main();
