/**
 * Guardrail de separação Frontend × Backend (rastreador de GRAFO de imports).
 *
 * Diferente de uma varredura plana, este script percorre o grafo de imports a
 * partir dos pontos de entrada do bundle React e falha (exit 1) se QUALQUER
 * arquivo alcançável (direta ou transitivamente) importar:
 *   - `@prisma/client` (qualquer forma, inclusive type-only — some no build, mas
 *     puxa `.prisma/client/index-browser` para o bundle);
 *   - `src/lib/prisma` (a instância do PrismaClient), por qualquer caminho
 *     (relativo `./prisma.js`, alias `@/src/lib/prisma`, etc.);
 *   - um arquivo com sufixo `.server.ts`/`.server.tsx`.
 *
 * IMPORTANTE: o alias do vite que troca `@/src/lib/prisma` por um stub é
 * IGNORADO aqui de propósito — queremos enxergar a dependência real, não a
 * máscara. O objetivo é que o build não precise do alias.
 *
 * Uso: npm run check:frontend-server-imports
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

/** Pontos de entrada reais do bundle do navegador. */
const ENTRYPOINTS = [
  path.join("src", "main.tsx"),
  path.join("src", "App.tsx"),
];

/** Diretórios cujo conteúdo nunca pode alcançar Prisma. */
const FRONTEND_DIRS = [
  path.join("src", "components"),
  path.join("src", "pages"),
  path.join("src", "hooks"),
  path.join("src", "contexts"),
  path.join("src", "views"),
];

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

/** Resolve um specifier de import para um caminho absoluto de arquivo do projeto. */
function resolveImport(fromFile: string, spec: string): string | null {
  // Pacotes (não relativos / não alias) não são seguidos como arquivos locais.
  let base: string | null = null;

  if (spec.startsWith("@/")) {
    base = path.join(ROOT, spec.slice(2));
  } else if (spec === "@") {
    base = ROOT;
  } else if (spec.startsWith("./") || spec.startsWith("../") || spec === ".") {
    base = path.resolve(path.dirname(fromFile), spec);
  } else {
    return null; // bare package specifier
  }

  // Normaliza extensões .js/.jsx -> .ts/.tsx e tenta variações.
  const candidates: string[] = [];
  const withoutExt = base.replace(/\.(js|jsx|mjs|cjs|ts|tsx)$/i, "");

  // 1) caminho exato (se já tem extensão de fonte)
  candidates.push(base);
  // 2) trocando extensão JS->TS e adicionando extensões
  for (const ext of EXTENSIONS) candidates.push(withoutExt + ext);
  // 3) index dentro de diretório
  for (const ext of EXTENSIONS) candidates.push(path.join(base, "index" + ext));
  for (const ext of EXTENSIONS) candidates.push(path.join(withoutExt, "index" + ext));

  for (const cand of candidates) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand;
  }
  return null;
}

/** Statement de import/export ... from "spec", capturando a "cabeça" e o specifier. */
const IMPORT_STMT_RE =
  /(?:^|\n)\s*(import|export)\b([\s\S]*?)\bfrom\s+['"]([^'"]+)['"]/g;
const SIDE_EFFECT_IMPORT_RE = /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g;
// Captura `import("x")` e o eventual `.Membro` logo após. Em posição de TIPO o
// TS usa `import("x").Tipo` (membro inicia em maiúscula / namespace), e é
// apagado no build. `await import("x")` / `import("x").then(...)` são runtime.
const DYNAMIC_IMPORT_RE = /import\s*\(\s*['"]([^'"]+)['"]\s*\)(?:\s*\.\s*([A-Za-z_$][\w$]*))?/g;
const REQUIRE_RE = /require\(\s*['"]([^'"]+)['"]\s*\)/g;

type Edge = { spec: string; typeOnly: boolean };

/** Um import named é type-only se for `import type ...` ou se TODOS os membros forem `type X`. */
function isTypeOnlyHead(keyword: string, head: string): boolean {
  const trimmed = head.trim();
  // `import type {...}` / `export type {...}` / `import type X`
  if (/^type\b/.test(trimmed)) return true;
  // named import com todos os membros prefixados por `type`
  const brace = trimmed.match(/\{([\s\S]*)\}/);
  if (brace) {
    const members = brace[1]
      .split(",")
      .map((m) => m.trim())
      .filter((m) => m.length > 0);
    if (members.length > 0 && members.every((m) => /^type\s+/.test(m))) {
      // mas se houver também um default/namespace fora das chaves, é valor
      const beforeBrace = trimmed.slice(0, trimmed.indexOf("{")).replace(/,/g, "").trim();
      if (beforeBrace === "" || beforeBrace === "type") return true;
    }
  }
  return false;
}

function extractEdges(text: string): Edge[] {
  const edges: Edge[] = [];
  IMPORT_STMT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMPORT_STMT_RE.exec(text)) != null) {
    const [, keyword, head, spec] = m;
    edges.push({ spec, typeOnly: isTypeOnlyHead(keyword, head) });
  }
  SIDE_EFFECT_IMPORT_RE.lastIndex = 0;
  let se: RegExpExecArray | null;
  while ((se = SIDE_EFFECT_IMPORT_RE.exec(text)) != null) {
    edges.push({ spec: se[1], typeOnly: false });
  }
  DYNAMIC_IMPORT_RE.lastIndex = 0;
  let dy: RegExpExecArray | null;
  while ((dy = DYNAMIC_IMPORT_RE.exec(text)) != null) {
    const member = dy[2];
    // `import("x").Tipo` (membro com inicial maiúscula) é type-query, apagado no build.
    const typeQuery = member != null && /^[A-Z]/.test(member);
    edges.push({ spec: dy[1], typeOnly: typeQuery });
  }
  REQUIRE_RE.lastIndex = 0;
  let rq: RegExpExecArray | null;
  while ((rq = REQUIRE_RE.exec(text)) != null) {
    edges.push({ spec: rq[1], typeOnly: false });
  }
  return edges;
}

type LeakKind = "@prisma/client" | "src/lib/prisma" | ".server module";

function classifyTerminal(spec: string, resolved: string | null): LeakKind | null {
  if (spec === "@prisma/client" || spec.startsWith("@prisma/client/")) {
    return "@prisma/client";
  }
  if (resolved) {
    const rel = toPosix(path.relative(ROOT, resolved));
    if (rel === "src/lib/prisma.ts" || rel === "src/lib/prisma.js") {
      return "src/lib/prisma";
    }
    if (/\.server\.(ts|tsx|js|jsx)$/.test(rel)) {
      return ".server module";
    }
  }
  return null;
}

function listFilesRecursive(absPath: string): string[] {
  if (!existsSync(absPath)) return [];
  const s = statSync(absPath);
  if (s.isFile()) return [absPath];
  const out: string[] = [];
  for (const entry of readdirSync(absPath)) {
    const full = path.join(absPath, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listFilesRecursive(full));
    else if (/\.(ts|tsx|js|jsx)$/i.test(entry) && !/\.test\.(ts|tsx)$/i.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

type Chain = { entry: string; path: string[]; spec: string; kind: LeakKind };

/** BFS/DFS a partir de um arquivo, retornando a 1ª cadeia que atinge Prisma. */
function traceFromEntry(entryAbs: string, fileCache: Map<string, string>): Chain | null {
  const startRel = toPosix(path.relative(ROOT, entryAbs));
  const visited = new Set<string>();
  const stack: Array<{ file: string; trail: string[] }> = [
    { file: entryAbs, trail: [startRel] },
  ];

  while (stack.length > 0) {
    const { file, trail } = stack.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);

    let text = fileCache.get(file);
    if (text == null) {
      try {
        text = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      fileCache.set(file, text);
    }

    for (const edge of extractEdges(text)) {
      // Imports type-only são apagados no build — não contaminam o bundle.
      if (edge.typeOnly) continue;
      const spec = edge.spec;
      const resolved = resolveImport(file, spec);
      const kind = classifyTerminal(spec, resolved);
      if (kind) {
        return { entry: startRel, path: trail, spec, kind };
      }
      if (resolved && !visited.has(resolved)) {
        stack.push({ file: resolved, trail: [...trail, toPosix(path.relative(ROOT, resolved))] });
      }
    }
  }
  return null;
}

function main(): void {
  const entryFiles = new Set<string>();
  for (const rel of ENTRYPOINTS) {
    const abs = path.join(ROOT, rel);
    if (existsSync(abs)) entryFiles.add(abs);
  }
  for (const dir of FRONTEND_DIRS) {
    for (const f of listFilesRecursive(path.join(ROOT, dir))) entryFiles.add(f);
  }

  const fileCache = new Map<string, string>();
  const leaks: Chain[] = [];
  const seenEntryLeak = new Set<string>();

  for (const entry of entryFiles) {
    const chain = traceFromEntry(entry, fileCache);
    if (chain) {
      // Deduplica por (arquivo imediatamente importador + terminal).
      const importer = chain.path[chain.path.length - 1];
      const dedupeKey = `${importer} => ${chain.spec}`;
      if (!seenEntryLeak.has(dedupeKey)) {
        seenEntryLeak.add(dedupeKey);
        leaks.push(chain);
      }
    }
  }

  if (leaks.length === 0) {
    console.log(
      `[check:frontend-server-imports] OK — ${entryFiles.size} arquivo(s) frontend rastreado(s); nenhum caminho até Prisma/server.`
    );
    process.exit(0);
  }

  console.error(
    `[check:frontend-server-imports] FALHA — ${leaks.length} cadeia(s) de import frontend → Prisma/server:\n`
  );
  for (const leak of leaks) {
    console.error(`  ✗ ${leak.kind} via "${leak.spec}"`);
    console.error(`    ${leak.path.join("\n      -> ")}`);
    console.error("");
  }
  console.error(
    "Correção: o arquivo final da cadeia importa Prisma. Mova tipos/labels/helpers puros\n" +
      "para *.types.ts / *.shared.ts / *.presentation.ts e faça o componente importar só os puros.\n" +
      "Carregamento de dados deve ir para *.server.ts e ser consumido via endpoint HTTP."
  );
  process.exit(1);
}

main();
