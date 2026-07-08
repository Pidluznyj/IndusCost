/**
 * Guardrail de imports ESM no backend (named exports).
 *
 * O Vite/tsc do frontend NÃO carregam `server.ts` nem os registrars MI em
 * runtime Node. Um `import { nomeFantasma } from './mod.js'` só estoura no
 * boot (`SyntaxError: ... does not provide an export named '...'`).
 *
 * Abordagem C (estático + dinâmico):
 *  A) Valida named imports locais contra exports declarados nos .ts resolvidos
 *     (sem DATABASE_URL, sem listen).
 *  B) `import()` dos registrars MI em processo isolado — confirma o mesmo erro
 *     que o Node veria no boot, sem executar `server.ts` / `app.listen`.
 *
 * Uso: npm run check:server-imports
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = process.cwd();

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"] as const;

/** Entry + registrars MI relevantes (inclui o arquivo do crash histórico). */
export const SERVER_IMPORT_CHECK_ENTRIES = [
  "server.ts",
  "src/lib/materialMarketAuditRoutes.ts",
  "src/lib/materialMarketQuoteAttachmentRoutes.ts",
  "src/lib/materialMarketQuoteGovernanceRoutes.ts",
  "src/lib/materialMarketQuoteReliabilityRoutes.ts",
  "src/lib/materialMarketIntelligenceExportRoutes.ts",
  "src/lib/brentCommodityRoutes.ts",
  "src/lib/marketGlobalIndicatorsRoutes.ts",
] as const;

/** Módulos carregados dinamicamente (registrars; NÃO o server.ts completo). */
export const SERVER_IMPORT_DYNAMIC_MODULES = [
  "src/lib/materialMarketAuditRoutes.ts",
  "src/lib/materialMarketQuoteAttachmentRoutes.ts",
  "src/lib/materialMarketQuoteGovernanceRoutes.ts",
  "src/lib/materialMarketQuoteReliabilityRoutes.ts",
  "src/lib/materialMarketIntelligenceExportRoutes.ts",
  "src/lib/brentCommodityRoutes.ts",
  "src/lib/marketGlobalIndicatorsRoutes.ts",
] as const;

export type NamedImportRef = {
  file: string;
  name: string;
  spec: string;
  resolved: string | null;
};

export type MissingExportIssue = {
  file: string;
  name: string;
  spec: string;
  resolved: string | null;
  reason: "unresolved" | "missing-export";
};

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Resolve specifier local (@/ ou relativo) para caminho absoluto de fonte. */
export function resolveLocalImport(fromFile: string, spec: string): string | null {
  let base: string | null = null;

  if (spec.startsWith("@/")) {
    base = path.join(ROOT, spec.slice(2));
  } else if (spec === "@") {
    base = ROOT;
  } else if (spec.startsWith("./") || spec.startsWith("../") || spec === ".") {
    base = path.resolve(path.dirname(fromFile), spec);
  } else {
    return null;
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

type ExportSet = {
  values: Set<string>;
  /** `export * from 'x'` — precisa unir exports do alvo. */
  starFrom: string[];
};

const EXPORT_DECL_RE =
  /(?:^|[;\s])export\s+(?:async\s+)?(?:function\*?|class|const|let|var|enum)\s+([A-Za-z_$][\w$]*)/g;
const EXPORT_LIST_RE =
  /(?:^|[;\s])export\s*\{([^}]+)\}(?:\s*from\s*['"]([^'"]+)['"])?/g;
const EXPORT_STAR_RE =
  /(?:^|[;\s])export\s*\*\s*(?:as\s+[A-Za-z_$][\w$]*\s+)?from\s*['"]([^'"]+)['"]/g;
const EXPORT_DEFAULT_AS_RE =
  /(?:^|[;\s])export\s+\{\s*default\s+as\s+([A-Za-z_$][\w$]*)\s*\}/g;

function parseExportListMembers(raw: string): Array<{ local: string; exported: string; typeOnly: boolean }> {
  return raw
    .split(",")
    .map((m) => m.trim())
    .filter((m) => m.length > 0)
    .map((m) => {
      const typeOnly = /^type\s+/.test(m);
      const cleaned = m.replace(/^type\s+/, "").trim();
      const asMatch = cleaned.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
      if (asMatch) {
        return { local: asMatch[1], exported: asMatch[2], typeOnly };
      }
      return { local: cleaned, exported: cleaned, typeOnly };
    })
    .filter((m) => m.exported !== "default" || m.local !== "default");
}

/** Coleta exports de valor (não type-only) declarados no arquivo + reexports estrela. */
export function collectValueExports(fileAbs: string, cache = new Map<string, ExportSet>()): ExportSet {
  const cached = cache.get(fileAbs);
  if (cached) return cached;

  const provisional: ExportSet = { values: new Set(), starFrom: [] };
  cache.set(fileAbs, provisional);

  let text: string;
  try {
    text = stripComments(readFileSync(fileAbs, "utf8"));
  } catch {
    return provisional;
  }

  EXPORT_DECL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EXPORT_DECL_RE.exec(text)) != null) {
    provisional.values.add(m[1]);
  }

  EXPORT_DEFAULT_AS_RE.lastIndex = 0;
  while ((m = EXPORT_DEFAULT_AS_RE.exec(text)) != null) {
    provisional.values.add(m[1]);
  }

  EXPORT_LIST_RE.lastIndex = 0;
  while ((m = EXPORT_LIST_RE.exec(text)) != null) {
    const members = parseExportListMembers(m[1]);
    const fromSpec = m[2];
    if (fromSpec) {
      const resolved = resolveLocalImport(fileAbs, fromSpec);
      if (!resolved) continue;
      const remote = collectValueExports(resolved, cache);
      for (const mem of members) {
        if (mem.typeOnly) continue;
        if (remote.values.has(mem.local) || mem.local === "default") {
          provisional.values.add(mem.exported);
        } else if (remote.starFrom.length > 0) {
          // Reexport seletivo de módulo com export * — assume presente se remoto tem o nome
          // após expandir stars (abaixo). Marca pelo nome exportado localmente.
          provisional.values.add(mem.exported);
        } else {
          // Ainda assim registra o nome exportado; a verificação do consumidor confere o alvo final.
          provisional.values.add(mem.exported);
        }
      }
    } else {
      for (const mem of members) {
        if (!mem.typeOnly) provisional.values.add(mem.exported);
      }
    }
  }

  EXPORT_STAR_RE.lastIndex = 0;
  while ((m = EXPORT_STAR_RE.exec(text)) != null) {
    provisional.starFrom.push(m[1]);
  }

  for (const starSpec of provisional.starFrom) {
    const resolved = resolveLocalImport(fileAbs, starSpec);
    if (!resolved) continue;
    const remote = collectValueExports(resolved, cache);
    for (const name of remote.values) provisional.values.add(name);
  }

  return provisional;
}

const IMPORT_STMT_RE =
  /(?:^|\n)\s*import\b([\s\S]*?)\bfrom\s+['"]([^'"]+)['"]/g;

function isEntirelyTypeOnlyImport(head: string): boolean {
  const trimmed = head.trim();
  if (/^type\b/.test(trimmed)) return true;
  return false;
}

/** Extrai named imports de valor (ignora `import type` e membros `type X`). */
export function collectLocalNamedValueImports(fileAbs: string): NamedImportRef[] {
  let text: string;
  try {
    text = stripComments(readFileSync(fileAbs, "utf8"));
  } catch {
    return [];
  }

  const out: NamedImportRef[] = [];
  const fileRel = toPosix(path.relative(ROOT, fileAbs));
  IMPORT_STMT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMPORT_STMT_RE.exec(text)) != null) {
    const head = m[1];
    const spec = m[2];
    if (isEntirelyTypeOnlyImport(head)) continue;

    const brace = head.match(/\{([\s\S]*)\}/);
    if (!brace) continue;

    const resolved = resolveLocalImport(fileAbs, spec);
    // Pacotes bare (express, etc.) — não validamos.
    if (!spec.startsWith(".") && !spec.startsWith("@/")) continue;

    for (const rawMember of brace[1].split(",")) {
      const member = rawMember.trim();
      if (!member) continue;
      if (/^type\s+/.test(member)) continue;
      const cleaned = member.replace(/^type\s+/, "").trim();
      const asMatch = cleaned.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
      const importedName = asMatch ? asMatch[1] : cleaned;
      if (!importedName || importedName === "default") continue;
      out.push({
        file: fileRel,
        name: importedName,
        spec,
        resolved: resolved ? toPosix(path.relative(ROOT, resolved)) : null,
      });
    }
  }
  return out;
}

function toEntryAbs(entry: string): string {
  return path.isAbsolute(entry) ? entry : path.join(ROOT, entry);
}

export function findMissingNamedExports(
  entryRels: readonly string[] = SERVER_IMPORT_CHECK_ENTRIES
): MissingExportIssue[] {
  const exportCache = new Map<string, ExportSet>();
  const issues: MissingExportIssue[] = [];

  for (const entry of entryRels) {
    const abs = toEntryAbs(entry);
    const entryLabel = toPosix(path.isAbsolute(entry) ? path.relative(ROOT, entry) || entry : entry);
    if (!existsSync(abs)) {
      issues.push({
        file: entryLabel,
        name: "(entry)",
        spec: entryLabel,
        resolved: null,
        reason: "unresolved",
      });
      continue;
    }

    for (const imp of collectLocalNamedValueImports(abs)) {
      if (!imp.resolved) {
        issues.push({
          file: imp.file,
          name: imp.name,
          spec: imp.spec,
          resolved: null,
          reason: "unresolved",
        });
        continue;
      }
      const targetAbs = path.isAbsolute(imp.resolved)
        ? imp.resolved
        : path.join(ROOT, imp.resolved);
      const exports = collectValueExports(targetAbs, exportCache);
      if (!exports.values.has(imp.name)) {
        issues.push({
          file: imp.file,
          name: imp.name,
          spec: imp.spec,
          resolved: imp.resolved,
          reason: "missing-export",
        });
      }
    }
  }

  return issues;
}

/**
 * Fixture sintético do bug histórico: `parseMaterialMarketAlertConfigPatch`
 * importado de materialMarketAlertConfig (nunca existiu como export).
 */
export function wouldCatchHistoricalAlertConfigPatchBug(): boolean {
  const alertConfigAbs = path.join(ROOT, "src/lib/materialMarketAlertConfig.ts");
  const exports = collectValueExports(alertConfigAbs);
  return !exports.values.has("parseMaterialMarketAlertConfigPatch");
}

async function runDynamicRegistrarImports(): Promise<string[]> {
  const failures: string[] = [];
  for (const rel of SERVER_IMPORT_DYNAMIC_MODULES) {
    const abs = path.join(ROOT, rel);
    const url = pathToFileURL(abs).href;
    try {
      await import(url);
    } catch (err) {
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      failures.push(`${toPosix(rel)} — ${msg}`);
    }
  }
  return failures;
}

export async function runServerImportCheck(options?: {
  entries?: readonly string[];
  skipDynamic?: boolean;
}): Promise<{ ok: boolean; staticIssues: MissingExportIssue[]; dynamicFailures: string[] }> {
  const staticIssues = findMissingNamedExports(options?.entries ?? SERVER_IMPORT_CHECK_ENTRIES);
  const dynamicFailures = options?.skipDynamic ? [] : await runDynamicRegistrarImports();
  return {
    ok: staticIssues.length === 0 && dynamicFailures.length === 0,
    staticIssues,
    dynamicFailures,
  };
}

async function main(): Promise<void> {
  const result = await runServerImportCheck();

  if (!wouldCatchHistoricalAlertConfigPatchBug()) {
    console.error(
      "[check:server-imports] FALHA interna — materialMarketAlertConfig passou a exportar " +
        "parseMaterialMarketAlertConfigPatch; atualize o regression probe."
    );
    process.exit(1);
  }

  if (result.ok) {
    console.log(
      `[check:server-imports] OK — estático: ${SERVER_IMPORT_CHECK_ENTRIES.length} entry(ies); ` +
        `dinâmico: ${SERVER_IMPORT_DYNAMIC_MODULES.length} registrar(es) MI; ` +
        `sem named export fantasma (probe histórico parseMaterialMarketAlertConfigPatch ainda ausente).`
    );
    process.exit(0);
  }

  console.error("[check:server-imports] FALHA — named export ESM inconsistente:\n");
  for (const issue of result.staticIssues) {
    if (issue.reason === "unresolved") {
      console.error(`  ✗ não resolveu "${issue.spec}" (import de ${issue.name}) em ${issue.file}`);
    } else {
      console.error(
        `  ✗ ${issue.file} importa '${issue.name}' de "${issue.spec}"` +
          (issue.resolved ? ` → ${issue.resolved}` : "") +
          ` mas o módulo não exporta esse nome`
      );
    }
  }
  for (const fail of result.dynamicFailures) {
    console.error(`  ✗ dynamic import: ${fail}`);
  }
  console.error(
    "\nCorreção: remova o named import fantasma ou exporte o símbolo no módulo de origem.\n" +
      "Este check reproduz o SyntaxError de boot do Node que o Vite build não captura."
  );
  process.exit(1);
}

const thisFile = fileURLToPath(import.meta.url);
const invokedAsScript =
  process.argv[1] != null && path.resolve(process.argv[1]) === thisFile;

if (invokedAsScript) {
  main().catch((err) => {
    console.error("[check:server-imports] erro inesperado:", err);
    process.exit(1);
  });
}
