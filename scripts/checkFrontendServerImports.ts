/**
 * Guardrail de separação Frontend × Backend (rastreador de GRAFO de imports).
 *
 * Percorre o grafo a partir dos pontos de entrada do bundle React e falha se
 * QUALQUER arquivo alcançável (direta ou transitivamente) importar (valor):
 *   - `@prisma/client`
 *   - `src/lib/prisma`
 *   - arquivo `*.server.ts` / `*.server.tsx`
 *   - módulos Node (crypto, util, fs, path, os, child_process, …)
 *
 * Imports type-only são ignorados (apagados no build).
 *
 * Uso: npm run check:frontend-server-imports
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

/** Pontos de entrada reais do bundle do navegador. */
export const ENTRYPOINTS = [
  path.join("src", "main.tsx"),
  path.join("src", "App.tsx"),
];

/** Diretórios cujo conteúdo nunca pode alcançar Prisma/Node. */
export const FRONTEND_DIRS = [
  path.join("src", "components"),
  path.join("src", "pages"),
  path.join("src", "hooks"),
  path.join("src", "contexts"),
  path.join("src", "views"),
];

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

/** Builtins Node que não podem entrar no grafo do frontend. */
export const FORBIDDEN_NODE_BUILTINS = new Set([
  "crypto",
  "node:crypto",
  "util",
  "node:util",
  "fs",
  "node:fs",
  "path",
  "node:path",
  "os",
  "node:os",
  "child_process",
  "node:child_process",
  "worker_threads",
  "node:worker_threads",
  "net",
  "node:net",
  "tls",
  "node:tls",
]);

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

/** Resolve um specifier de import para um caminho absoluto de arquivo do projeto. */
export function resolveImport(fromFile: string, spec: string): string | null {
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

  const candidates: string[] = [];
  const withoutExt = base.replace(/\.(js|jsx|mjs|cjs|ts|tsx)$/i, "");

  candidates.push(base);
  for (const ext of EXTENSIONS) candidates.push(withoutExt + ext);
  for (const ext of EXTENSIONS) candidates.push(path.join(base, "index" + ext));
  for (const ext of EXTENSIONS) candidates.push(path.join(withoutExt, "index" + ext));

  for (const cand of candidates) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand;
  }
  return null;
}

const IMPORT_STMT_RE =
  /(?:^|\n)\s*(import|export)\b([\s\S]*?)\bfrom\s+['"]([^'"]+)['"]/g;
const SIDE_EFFECT_IMPORT_RE = /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_RE =
  /import\s*\(\s*['"]([^'"]+)['"]\s*\)(?:\s*\.\s*([A-Za-z_$][\w$]*))?/g;
const REQUIRE_RE = /require\(\s*['"]([^'"]+)['"]\s*\)/g;

export type Edge = { spec: string; typeOnly: boolean };

/** Um import named é type-only se for `import type ...` ou se TODOS os membros forem `type X`. */
export function isTypeOnlyHead(keyword: string, head: string): boolean {
  const trimmed = head.trim();
  if (/^type\b/.test(trimmed)) return true;
  const brace = trimmed.match(/\{([\s\S]*)\}/);
  if (brace) {
    const members = brace[1]
      .split(",")
      .map((m) => m.trim())
      .filter((m) => m.length > 0);
    if (members.length > 0 && members.every((m) => /^type\s+/.test(m))) {
      const beforeBrace = trimmed
        .slice(0, trimmed.indexOf("{"))
        .replace(/,/g, "")
        .trim();
      if (beforeBrace === "" || beforeBrace === "type") return true;
    }
  }
  return false;
}

export function extractEdges(text: string): Edge[] {
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

export type LeakKind =
  | "@prisma/client"
  | "src/lib/prisma"
  | ".server module"
  | "node builtin";

export function classifyTerminal(
  spec: string,
  resolved: string | null
): LeakKind | null {
  if (FORBIDDEN_NODE_BUILTINS.has(spec)) {
    return "node builtin";
  }
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

export function listFilesRecursive(absPath: string): string[] {
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

export type Chain = {
  entry: string;
  path: string[];
  spec: string;
  kind: LeakKind;
};

export type TraceOptions = {
  /** Raiz do projeto (default: process.cwd()). */
  root?: string;
  resolveImportFn?: typeof resolveImport;
};

/** BFS/DFS a partir de um arquivo, retornando a 1ª cadeia que atinge terminal proibido. */
export function traceFromEntry(
  entryAbs: string,
  fileCache: Map<string, string> = new Map(),
  options: TraceOptions = {}
): Chain | null {
  const root = options.root ?? ROOT;
  const resolve = options.resolveImportFn ?? resolveImport;
  const startRel = toPosix(path.relative(root, entryAbs));
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
      if (edge.typeOnly) continue;
      const spec = edge.spec;
      const resolved = resolve(file, spec);
      const kind = classifyTerminal(spec, resolved);
      if (kind) {
        return { entry: startRel, path: trail, spec, kind };
      }
      if (resolved && !visited.has(resolved)) {
        stack.push({
          file: resolved,
          trail: [...trail, toPosix(path.relative(root, resolved))],
        });
      }
    }
  }
  return null;
}

export function collectFrontendEntryFiles(
  root: string = ROOT
): string[] {
  const entryFiles = new Set<string>();
  for (const rel of ENTRYPOINTS) {
    const abs = path.join(root, rel);
    if (existsSync(abs)) entryFiles.add(abs);
  }
  for (const dir of FRONTEND_DIRS) {
    for (const f of listFilesRecursive(path.join(root, dir))) {
      entryFiles.add(f);
    }
  }
  return [...entryFiles];
}

export function findFrontendServerImportLeaks(
  root: string = ROOT
): Chain[] {
  const entryFiles = collectFrontendEntryFiles(root);
  const fileCache = new Map<string, string>();
  const leaks: Chain[] = [];
  const seenEntryLeak = new Set<string>();

  for (const entry of entryFiles) {
    const chain = traceFromEntry(entry, fileCache, {
      root,
      resolveImportFn: (from, spec) => {
        // Resolve relativo ao root informado (fixtures em tmp).
        if (spec.startsWith("@/")) {
          const base = path.join(root, spec.slice(2));
          const withoutExt = base.replace(/\.(js|jsx|mjs|cjs|ts|tsx)$/i, "");
          const candidates = [
            base,
            ...EXTENSIONS.map((ext) => withoutExt + ext),
            ...EXTENSIONS.map((ext) => path.join(base, "index" + ext)),
            ...EXTENSIONS.map((ext) => path.join(withoutExt, "index" + ext)),
          ];
          for (const cand of candidates) {
            if (existsSync(cand) && statSync(cand).isFile()) return cand;
          }
          return null;
        }
        if (spec.startsWith("./") || spec.startsWith("../") || spec === ".") {
          const base = path.resolve(path.dirname(from), spec);
          const withoutExt = base.replace(/\.(js|jsx|mjs|cjs|ts|tsx)$/i, "");
          const candidates = [
            base,
            ...EXTENSIONS.map((ext) => withoutExt + ext),
            ...EXTENSIONS.map((ext) => path.join(base, "index" + ext)),
            ...EXTENSIONS.map((ext) => path.join(withoutExt, "index" + ext)),
          ];
          for (const cand of candidates) {
            if (existsSync(cand) && statSync(cand).isFile()) return cand;
          }
          return null;
        }
        return null;
      },
    });
    if (chain) {
      const importer = chain.path[chain.path.length - 1];
      const dedupeKey = `${importer} => ${chain.spec}`;
      if (!seenEntryLeak.has(dedupeKey)) {
        seenEntryLeak.add(dedupeKey);
        leaks.push(chain);
      }
    }
  }
  return leaks;
}

function main(): void {
  const entryFiles = collectFrontendEntryFiles();
  const leaks = findFrontendServerImportLeaks();

  if (leaks.length === 0) {
    console.log(
      `[check:frontend-server-imports] OK — ${entryFiles.length} arquivo(s) frontend rastreado(s); nenhum caminho até Prisma/server/Node.`
    );
    process.exit(0);
  }

  console.error(
    `[check:frontend-server-imports] FALHA — ${leaks.length} cadeia(s) de import frontend → Prisma/server/Node:\n`
  );
  for (const leak of leaks) {
    console.error(`  ✗ ${leak.kind} via "${leak.spec}"`);
    console.error(`    ${leak.path.join("\n      -> ")}`);
    console.error("");
  }
  console.error(
    "Correção: o arquivo final da cadeia importa Prisma ou módulo Node.\n" +
      "Mova tipos/labels/helpers puros para *.types.ts / *.shared.ts / *.presentation.ts\n" +
      "e faça o componente importar só os puros.\n" +
      "Carregamento de dados / crypto / sessão devem ir para *.server.ts via HTTP."
  );
  process.exit(1);
}

const isDirectRun =
  process.argv[1] != null &&
  /checkFrontendServerImports\.(ts|js|mjs|cjs)$/.test(
    process.argv[1].replace(/\\/g, "/")
  );

if (isDirectRun) {
  main();
}
