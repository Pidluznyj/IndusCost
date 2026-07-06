/**
 * scripts/auditPermissionsV1.ts
 *
 * Fase: INDUSCOST-ACCESS-PERMISSIONS-AUDIT-UX-A.
 *
 * Script de auditoria 100% read-only do sistema de permissões do IndusCost.
 *
 * O que faz:
 *  1. Lê o catálogo central (`src/lib/permissionCatalog.ts` via import dinâmico).
 *  2. Varre `server.ts` extraindo:
 *     - rotas declaradas (app.get/post/put/delete/patch),
 *     - middlewares de autorização aplicados em cada rota
 *       (requirePermission, requireAnyPermission, requireBootstrap*, requireAppAuth).
 *  3. Varre `src/components`, `src/contexts`, `src/lib`, `src/hooks` extraindo
 *     todas as chamadas de `hasPermission("...")` / `hasAnyPermission([...])`.
 *  4. Cruza catálogo × backend × frontend e classifica:
 *     - OK         — declarada no catálogo e usada;
 *     - ORFÃ       — declarada no catálogo, mas não usada em backend nem frontend;
 *     - FANTASMA   — usada no código mas não está declarada no catálogo;
 *     - SOMENTE_FE — declarada e usada só no frontend (sem proteção real);
 *     - SOMENTE_BE — declarada e usada só no backend (UI não trata).
 *  5. Lista rotas:
 *     - sem proteção alguma (apenas requireAppAuth ou nenhum guard);
 *     - mutations (POST/PUT/PATCH/DELETE) com proteção genérica demais.
 *  6. Grava relatório consolidado em `docs/generated/permissions-audit-report.md`
 *     e imprime um resumo no terminal.
 *
 * O script NÃO acessa o banco — é puro análise estática de arquivos.
 *
 * Uso:
 *   npm run audit:permissions
 */

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const REPORT_DIR = path.join(ROOT, "docs", "generated");
const REPORT_PATH = path.join(REPORT_DIR, "permissions-audit-report.md");
const SERVER_FILE = path.join(ROOT, "server.ts");

type CatalogEntry = {
  key: string;
  label: string;
  group: string;
  module: string;
  description: string;
  type: string;
  parentKey?: string;
  risk?: string;
};

type Occurrence = {
  file: string;
  line: number;
};

type PermissionUsage = {
  key: string;
  inCatalog: boolean;
  backend: Occurrence[];
  frontend: Occurrence[];
};

type RouteInfo = {
  method: string;
  pathPattern: string | null;
  line: number;
  guards: string[];
  /** Strings literais de permissão usadas pelos guards desta rota. */
  permissions: string[];
  /** Categoria do guard para classificação rápida. */
  guardKind: "permission" | "any" | "bootstrap" | "auth-only" | "user-admin" | "bootstrap-or-permission" | "bootstrap-only" | "unguarded";
};

function relative(p: string): string {
  return path.relative(ROOT, p).replace(/\\/g, "/");
}

function listFilesRecursive(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    let entries: string[] = [];
    try {
      entries = readdirSync(cur);
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (e === "node_modules" || e === ".git" || e === "dist") continue;
        stack.push(full);
        continue;
      }
      if (exts.some((ext) => full.endsWith(ext))) out.push(full);
    }
  }
  return out;
}

/** Lê o catálogo de permissões via import dinâmico (evita reparse do TS). */
async function loadCatalog(): Promise<CatalogEntry[]> {
  const mod = await import(
    pathToFileURL(path.join(ROOT, "src", "lib", "permissionCatalog.ts")).href
  );
  const list = (mod as { PERMISSION_CATALOG: CatalogEntry[] }).PERMISSION_CATALOG ?? [];
  return list;
}

const KNOWN_GUARD_TOKENS = new Set([
  "requirePermission",
  "requireAnyPermission",
  "requireAllPermissions",
  "requireAppAuth",
  "requireBootstrapAdmin",
  "requireBootstrapOrAnyPermission",
  "requireUserAdminOrBootstrap",
  "requireBootstrapForGlobalParamMutation",
]);

/**
 * Resolve identificadores conhecidos usados como spread (`[...IDENT]`)
 * dentro de `requireAnyPermission`/`requireBootstrapOrAnyPermission`. Faz
 * análise local — busca `const IDENT = [...] as const;` no próprio arquivo.
 */
function buildPermissionConstantsTable(raw: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  // const NAME = [ ... ] as const;
  const re = /const\s+([A-Z][A-Z0-9_]+)\s*=\s*\[([^\]]+)\]\s*as\s*const\s*;/g;
  for (const m of raw.matchAll(re)) {
    const name = m[1];
    const body = m[2];
    const strings = Array.from(body.matchAll(/["']([\w.-]+)["']/g)).map((x) => x[1]);
    if (strings.length > 0) out.set(name, strings);
  }
  return out;
}

/** Extrai rotas de server.ts e os guards aplicados em cada uma. */
function parseServerRoutes(): { routes: RouteInfo[]; raw: string } {
  const raw = readFileSync(SERVER_FILE, "utf8");
  const lines = raw.split(/\r?\n/);
  const constsTable = buildPermissionConstantsTable(raw);

  // Regex que captura app.METHOD( "/path", possibly guards , async (req, res) => {
  // Como as definições podem quebrar em várias linhas, vamos juntar até achar o
  // fechamento da função handler na mesma "expressão de chamada" (até o `async`).
  const routes: RouteInfo[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = /^\s*app\.(get|post|put|delete|patch)\s*\(/i.exec(line);
    if (!m) continue;
    const method = m[1].toUpperCase();

    // Junta a "header line" até encontrar a primeira ocorrência de `async` ou `=>` ou `function`
    // que indica o handler (limite: até 30 linhas).
    let header = line;
    const startLine = i + 1;
    let endIdx = i;
    let depth = (line.match(/\(/g)?.length ?? 0) - (line.match(/\)/g)?.length ?? 0);
    while (endIdx < lines.length - 1 && (depth > 0 || !/async\s*\(|=>\s*{|function\s*\(/.test(header))) {
      endIdx += 1;
      header += "\n" + lines[endIdx];
      depth += (lines[endIdx].match(/\(/g)?.length ?? 0);
      depth -= (lines[endIdx].match(/\)/g)?.length ?? 0);
      if (endIdx - i > 60) break;
    }

    const pathMatch = /app\.\w+\s*\(\s*["'`]([^"'`]+)["'`]/.exec(header);
    const pathPattern = pathMatch?.[1] ?? null;

    const guards: string[] = [];
    const permissions: string[] = [];

    for (const token of KNOWN_GUARD_TOKENS) {
      if (header.includes(token)) guards.push(token);
    }

    // Captura permissões dentro de requirePermission("X")
    for (const pm of header.matchAll(/requirePermission\(\s*["']([^"']+)["']/g)) {
      permissions.push(pm[1]);
    }
    // requireAnyPermission([...]) — também resolve spread [...NOMUS_OPTIONAL_PRICING_PERMS].
    for (const pm of header.matchAll(/require(?:Any|BootstrapOrAny)Permission\(\s*\[([^\]]+)\]/g)) {
      const body = pm[1];
      for (const s of body.matchAll(/["']([^"']+)["']/g)) permissions.push(s[1]);
      for (const s of body.matchAll(/\.\.\.([A-Z][A-Z0-9_]+)/g)) {
        const list = constsTable.get(s[1]);
        if (list) permissions.push(...list);
      }
    }

    let guardKind: RouteInfo["guardKind"] = "unguarded";
    if (guards.includes("requirePermission")) guardKind = "permission";
    else if (guards.includes("requireAnyPermission")) guardKind = "any";
    else if (guards.includes("requireBootstrapOrAnyPermission")) guardKind = "bootstrap-or-permission";
    else if (guards.includes("requireUserAdminOrBootstrap")) guardKind = "user-admin";
    else if (guards.includes("requireBootstrapAdmin")) guardKind = "bootstrap-only";
    else if (guards.includes("requireAppAuth")) guardKind = "auth-only";

    routes.push({
      method,
      pathPattern,
      line: startLine,
      guards,
      permissions: Array.from(new Set(permissions)),
      guardKind,
    });
  }

  return { routes, raw };
}

/** Escaneia arquivos do frontend procurando hasPermission/hasAnyPermission. */
function parseFrontendPermissions(): Map<string, Occurrence[]> {
  const folders = ["src/components", "src/contexts", "src/lib", "src/hooks", "src/tours", "src/types"];
  const files: string[] = [];
  for (const f of folders) files.push(...listFilesRecursive(path.join(ROOT, f), [".ts", ".tsx"]));

  // Também escaneia App.tsx e main.tsx (fora dessas pastas)
  const standalone = [path.join(ROOT, "src", "App.tsx"), path.join(ROOT, "src", "main.tsx")];
  for (const p of standalone) if (existsSync(p)) files.push(p);

  const map = new Map<string, Occurrence[]>();

  for (const file of files) {
    const rel = relative(file);
    const raw = readFileSync(file, "utf8");
    const lines = raw.split(/\r?\n/);
    lines.forEach((line, idx) => {
      // hasPermission("X")
      for (const m of line.matchAll(/hasPermission\(\s*["']([\w.-]+)["']\s*\)/g)) {
        const arr = map.get(m[1]) ?? [];
        arr.push({ file: rel, line: idx + 1 });
        map.set(m[1], arr);
      }
      // hasAnyPermission(["A","B"]) ou hasAnyPermission([...CONST_LIST])
      for (const m of line.matchAll(/hasAnyPermission\(\s*\[([^\]]+)\]/g)) {
        for (const s of m[1].matchAll(/["']([\w.-]+)["']/g)) {
          const arr = map.get(s[1]) ?? [];
          arr.push({ file: rel, line: idx + 1 });
          map.set(s[1], arr);
        }
      }
    });
  }

  return map;
}

/** Escaneia server.ts (raw) procurando permissões literais usadas em qualquer guard. */
function parseBackendPermissions(raw: string): Map<string, Occurrence[]> {
  const lines = raw.split(/\r?\n/);
  const map = new Map<string, Occurrence[]>();
  const constsTable = buildPermissionConstantsTable(raw);

  lines.forEach((line, idx) => {
    for (const m of line.matchAll(/requirePermission\(\s*["']([\w.-]+)["']/g)) {
      const arr = map.get(m[1]) ?? [];
      arr.push({ file: "server.ts", line: idx + 1 });
      map.set(m[1], arr);
    }
    // requireAnyPermission/requireBootstrapOrAnyPermission podem vir em linha única
    for (const m of line.matchAll(/require(?:Any|BootstrapOrAny)Permission\(\s*\[([^\]]+)\]/g)) {
      const body = m[1];
      for (const s of body.matchAll(/["']([\w.-]+)["']/g)) {
        const arr = map.get(s[1]) ?? [];
        arr.push({ file: "server.ts", line: idx + 1 });
        map.set(s[1], arr);
      }
      for (const s of body.matchAll(/\.\.\.([A-Z][A-Z0-9_]+)/g)) {
        const list = constsTable.get(s[1]);
        if (!list) continue;
        for (const key of list) {
          const arr = map.get(key) ?? [];
          arr.push({ file: "server.ts", line: idx + 1 });
          map.set(key, arr);
        }
      }
    }
    // hasPermission usado em código server-side fora dos guards (ex.: requireUserAdminOrBootstrap)
    for (const m of line.matchAll(/hasPermission\(\s*\w+\s*,\s*["']([\w.-]+)["']\s*\)/g)) {
      const arr = map.get(m[1]) ?? [];
      arr.push({ file: "server.ts", line: idx + 1 });
      map.set(m[1], arr);
    }
  });

  // Também varre src/lib para usos server-side (modulePermissions.ts, appAuth.ts, etc.)
  const libFiles = listFilesRecursive(path.join(ROOT, "src", "lib"), [".ts"]);
  for (const file of libFiles) {
    if (file.endsWith(".test.ts")) continue;
    const rel = relative(file);
    const raw2 = readFileSync(file, "utf8");
    const lines2 = raw2.split(/\r?\n/);
    lines2.forEach((line, idx) => {
      // Padrão: check.hasPermission("X") já é coberto pelo varrimento de frontend
      // mas as libs ficam em dois mundos. Aqui também conta como backend.
      for (const m of line.matchAll(/check\.hasPermission\(\s*["']([\w.-]+)["']\s*\)/g)) {
        const arr = map.get(m[1]) ?? [];
        arr.push({ file: rel, line: idx + 1 });
        map.set(m[1], arr);
      }
    });
  }

  return map;
}

function fmtOcc(occ: Occurrence[]): string {
  if (occ.length === 0) return "—";
  const first = occ[0];
  const rest = occ.length > 1 ? ` (+${occ.length - 1})` : "";
  return `${first.file}:${first.line}${rest}`;
}

function classify(usage: PermissionUsage): { status: string; observation: string } {
  if (!usage.inCatalog && (usage.backend.length > 0 || usage.frontend.length > 0)) {
    return {
      status: "FANTASMA",
      observation: "Permissão usada no código mas ausente do catálogo central.",
    };
  }
  if (usage.inCatalog && usage.backend.length === 0 && usage.frontend.length === 0) {
    return {
      status: "ORFÃ",
      observation: "Declarada no catálogo, mas não é referenciada em nenhum lugar.",
    };
  }
  if (usage.inCatalog && usage.backend.length === 0 && usage.frontend.length > 0) {
    return {
      status: "SOMENTE_FE",
      observation: "Aparece só no frontend. Backend não impõe — é apenas guia de UI.",
    };
  }
  if (usage.inCatalog && usage.backend.length > 0 && usage.frontend.length === 0) {
    return {
      status: "SOMENTE_BE",
      observation: "Aparece só no backend. UI não está ensinando o usuário sobre o gate.",
    };
  }
  return { status: "OK", observation: "Declarada no catálogo e usada nos dois lados." };
}

async function main() {
  const catalog = await loadCatalog();
  const catalogKeys = new Set(catalog.map((e) => e.key));

  const { routes, raw: serverRaw } = parseServerRoutes();
  const backendMap = parseBackendPermissions(serverRaw);
  const frontendMap = parseFrontendPermissions();

  // União de todas as chaves observadas
  const allKeys = new Set<string>();
  catalog.forEach((e) => allKeys.add(e.key));
  for (const k of backendMap.keys()) allKeys.add(k);
  for (const k of frontendMap.keys()) allKeys.add(k);

  const usages: Array<PermissionUsage & { status: string; observation: string; entry?: CatalogEntry }> = [];
  for (const key of Array.from(allKeys).sort((a, b) => a.localeCompare(b, "pt-BR"))) {
    const inCatalog = catalogKeys.has(key);
    const backend = backendMap.get(key) ?? [];
    const frontend = frontendMap.get(key) ?? [];
    const usage: PermissionUsage = { key, inCatalog, backend, frontend };
    const cls = classify(usage);
    usages.push({
      ...usage,
      ...cls,
      entry: catalog.find((e) => e.key === key),
    });
  }

  const orphans = usages.filter((u) => u.status === "ORFÃ");
  const phantoms = usages.filter((u) => u.status === "FANTASMA");
  const onlyFE = usages.filter((u) => u.status === "SOMENTE_FE");
  const onlyBE = usages.filter((u) => u.status === "SOMENTE_BE");

  // Rotas problemáticas
  const unguardedRoutes = routes.filter(
    (r) => r.guardKind === "unguarded" || r.guardKind === "auth-only"
  );
  const mutationsWithoutPermission = routes.filter(
    (r) =>
      (r.method === "POST" || r.method === "PUT" || r.method === "PATCH" || r.method === "DELETE") &&
      r.permissions.length === 0 &&
      r.guardKind !== "bootstrap-only" &&
      r.guardKind !== "user-admin"
  );
  const mutationsTotal = routes.filter(
    (r) => r.method === "POST" || r.method === "PUT" || r.method === "PATCH" || r.method === "DELETE"
  );
  const readsTotal = routes.filter((r) => r.method === "GET");

  // Cabeçalho do relatório
  const lines: string[] = [];
  lines.push("# IndusCost — Relatório de auditoria de permissões");
  lines.push("");
  lines.push(
    `Gerado em ${new Date().toISOString()} · fase \`INDUSCOST-ACCESS-PERMISSIONS-AUDIT-UX-A\`.`
  );
  lines.push("");
  lines.push(
    "> Relatório gerado automaticamente por `npm run audit:permissions`. NÃO altera dados — apenas leitura estática do código."
  );
  lines.push("");
  lines.push("## Resumo executivo");
  lines.push("");
  lines.push(`- Permissões no catálogo: **${catalog.length}**`);
  lines.push(`- Permissões observadas (catálogo + código): **${allKeys.size}**`);
  lines.push(`- ORFÃS (no catálogo, sem uso): **${orphans.length}**`);
  lines.push(`- FANTASMAS (usadas, fora do catálogo): **${phantoms.length}**`);
  lines.push(`- SOMENTE_FE (gate só visual): **${onlyFE.length}**`);
  lines.push(`- SOMENTE_BE (gate sem UI): **${onlyBE.length}**`);
  lines.push(`- Rotas mapeadas em server.ts: **${routes.length}** (${mutationsTotal.length} mutações / ${readsTotal.length} leituras)`);
  lines.push(`- Rotas SEM proteção de permissão (apenas auth ou nada): **${unguardedRoutes.length}**`);
  lines.push(`- Mutações sem requirePermission/Any direto: **${mutationsWithoutPermission.length}** (algumas usam bootstrap/users.manage — ver detalhes)`);
  lines.push("");

  // Tabela consolidada
  lines.push("## Matriz consolidada de permissões");
  lines.push("");
  lines.push("| Permissão | Catálogo? | Backend | Frontend | Módulo | Tipo | Risco | Status | Observação |");
  lines.push("|---|---|---|---|---|---|---|---|---|");
  for (const u of usages) {
    const entry = u.entry;
    lines.push(
      `| \`${u.key}\` | ${u.inCatalog ? "Sim" : "Não"} | ${fmtOcc(u.backend)} | ${fmtOcc(u.frontend)} | ${entry?.module ?? "—"} | ${entry?.type ?? "—"} | ${entry?.risk ?? "—"} | ${u.status} | ${u.observation} |`
    );
  }
  lines.push("");

  if (orphans.length > 0) {
    lines.push("## Permissões órfãs");
    lines.push("");
    for (const u of orphans) {
      lines.push(`- \`${u.key}\` (${u.entry?.label ?? "?"}) — ${u.entry?.description ?? ""}`);
    }
    lines.push("");
  }

  if (phantoms.length > 0) {
    lines.push("## Permissões fantasmas (usadas no código sem estar no catálogo)");
    lines.push("");
    for (const u of phantoms) {
      lines.push(`- \`${u.key}\` — backend: ${fmtOcc(u.backend)} · frontend: ${fmtOcc(u.frontend)}`);
    }
    lines.push("");
  }

  if (onlyFE.length > 0) {
    lines.push("## Permissões SOMENTE_FE (gate só visual)");
    lines.push("");
    for (const u of onlyFE) {
      lines.push(`- \`${u.key}\` — frontend: ${fmtOcc(u.frontend)}`);
    }
    lines.push("");
  }

  if (onlyBE.length > 0) {
    lines.push("## Permissões SOMENTE_BE (gate sem UI)");
    lines.push("");
    for (const u of onlyBE) {
      lines.push(`- \`${u.key}\` — backend: ${fmtOcc(u.backend)}`);
    }
    lines.push("");
  }

  // Rotas sem proteção
  lines.push("## Rotas sem requirePermission/requireAnyPermission");
  lines.push("");
  lines.push("Estas rotas usam apenas `requireAppAuth`, `requireBootstrap*`, `requireUserAdminOrBootstrap` ou nenhum guard. Para auditoria de risco, classifique cada uma e migre as mutations sensíveis para permissão específica.");
  lines.push("");
  lines.push("| Método | Rota | Linha | Guards | Permissões | Observação |");
  lines.push("|---|---|---|---|---|---|");
  for (const r of routes) {
    if (r.permissions.length > 0) continue;
    const obs =
      r.guardKind === "unguarded"
        ? "🚨 SEM autenticação"
        : r.guardKind === "auth-only"
        ? "⚠️ apenas autenticado (sem gate de permissão)"
        : r.guardKind === "bootstrap-only"
        ? "🔒 só bootstrap admin (acesso administrativo temporário)"
        : r.guardKind === "user-admin"
        ? "🔒 admin de usuários (users.manage ou bootstrap)"
        : "—";
    lines.push(
      `| ${r.method} | \`${r.pathPattern ?? "(?)"}\` | ${r.line} | ${r.guards.join(", ") || "(nenhum)"} | — | ${obs} |`
    );
  }
  lines.push("");

  // Mutations sem permissão
  if (mutationsWithoutPermission.length > 0) {
    lines.push("## Mutations sem requirePermission/Any direto");
    lines.push("");
    lines.push("Mutations (POST/PUT/PATCH/DELETE) que não passam por `requirePermission`/`requireAnyPermission` direto. Confirmar caso a caso — algumas usam `requireBootstrapOrAnyPermission` (vide coluna Guards) e estão OK; outras podem precisar de gate específico.");
    lines.push("");
    lines.push("| Método | Rota | Linha | Guards |");
    lines.push("|---|---|---|---|");
    for (const r of mutationsWithoutPermission) {
      lines.push(`| ${r.method} | \`${r.pathPattern ?? "(?)"}\` | ${r.line} | ${r.guards.join(", ") || "(nenhum)"} |`);
    }
    lines.push("");
  }

  // Inventário do catálogo por grupo
  lines.push("## Catálogo agrupado por módulo");
  lines.push("");
  const byGroup = new Map<string, CatalogEntry[]>();
  for (const e of catalog) {
    const g = e.group ?? "Outros";
    const arr = byGroup.get(g) ?? [];
    arr.push(e);
    byGroup.set(g, arr);
  }
  for (const [group, entries] of byGroup) {
    lines.push(`### ${group}`);
    lines.push("");
    for (const e of entries) {
      const risk = e.risk && e.risk !== "normal" ? ` _(${e.risk})_` : "";
      lines.push(`- \`${e.key}\` — **${e.label}**${risk}: ${e.description}`);
    }
    lines.push("");
  }

  if (!existsSync(REPORT_DIR)) mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(REPORT_PATH, lines.join("\n"), "utf8");

  // Resumo no terminal
  const summary = [
    `[audit:permissions] catálogo=${catalog.length} | observadas=${allKeys.size} | órfãs=${orphans.length} | fantasmas=${phantoms.length} | somente_fe=${onlyFE.length} | somente_be=${onlyBE.length}`,
    `[audit:permissions] rotas=${routes.length} (${mutationsTotal.length} mut/${readsTotal.length} read) | sem permissão direta=${unguardedRoutes.length} | mutations sem permissão=${mutationsWithoutPermission.length}`,
    `[audit:permissions] relatório salvo em ${relative(REPORT_PATH)}`,
  ];
  for (const s of summary) console.log(s);
}

main().catch((err) => {
  console.error("[audit:permissions] falha:", err);
  process.exitCode = 1;
});
