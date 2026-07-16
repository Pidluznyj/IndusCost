/**
 * Scanner AST (TypeScript) para extrair literais de permissão e rotas Express.
 * Evita regex como única fonte; regex só como fallback em headers multilinha limitados.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

export type ScannedCall = {
  file: string;
  line: number;
  callee: string;
  stringArgs: string[];
};

export type ScannedRoute = {
  file: string;
  line: number;
  method: string;
  pathPattern: string;
  guardCallees: string[];
  permissionKeys: string[];
  resourceKeys: string[];
};

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "coverage",
  "tmp-audits",
  ".cursor",
]);

export function listSourceFiles(root: string, dirs: string[], exts = [".ts", ".tsx"]): string[] {
  const out: string[] = [];
  for (const dir of dirs) {
    const abs = path.join(root, dir);
    if (!existsSync(abs)) continue;
    const stack = [abs];
    while (stack.length) {
      const cur = stack.pop()!;
      let entries: string[] = [];
      try {
        entries = readdirSync(cur);
      } catch {
        continue;
      }
      for (const e of entries) {
        if (SKIP_DIRS.has(e)) continue;
        const full = path.join(cur, e);
        let st;
        try {
          st = statSync(full);
        } catch {
          continue;
        }
        if (st.isDirectory()) {
          stack.push(full);
          continue;
        }
        if (exts.some((ext) => full.endsWith(ext)) && !full.endsWith(".d.ts")) {
          if (full.includes(".test.") || full.includes(".spec.")) continue;
          out.push(full);
        }
      }
    }
  }
  return out;
}

function rel(root: string, file: string): string {
  return path.relative(root, file).replace(/\\/g, "/");
}

function getCalleeName(expr: ts.Expression): string | null {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) {
    return expr.name.text;
  }
  return null;
}

function collectStringLiteralsFromNode(node: ts.Node, out: string[]): void {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    out.push(node.text);
    return;
  }
  if (ts.isArrayLiteralExpression(node)) {
    for (const el of node.elements) collectStringLiteralsFromNode(el, out);
    return;
  }
  if (ts.isSpreadElement(node)) {
    collectStringLiteralsFromNode(node.expression, out);
    return;
  }
  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node)) {
    collectStringLiteralsFromNode(node.expression, out);
  }
}

const PERMISSION_CALLEES = new Set([
  "hasPermission",
  "hasAnyPermission",
  "requirePermission",
  "requireAnyPermission",
  "requireAllPermissions",
  "requireBootstrapOrAnyPermission",
  "requireBootstrapOrPermission",
  "requireBootstrapOrResource",
  "requireResourcePermission",
  "requireResource",
  "canView",
  "canExecute",
  "canManage",
  "canAccessResource",
]);

/** Extrai chamadas relevantes de um arquivo via AST. */
export function scanFileCalls(root: string, filePath: string): ScannedCall[] {
  const raw = readFileSync(filePath, "utf8");
  const sf = ts.createSourceFile(
    filePath,
    raw,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const file = rel(root, filePath);
  const calls: ScannedCall[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = getCalleeName(node.expression);
      if (callee && PERMISSION_CALLEES.has(callee)) {
        const stringArgs: string[] = [];
        for (const arg of node.arguments) {
          collectStringLiteralsFromNode(arg, stringArgs);
        }
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        calls.push({
          file,
          line: line + 1,
          callee,
          stringArgs: [...new Set(stringArgs)],
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return calls;
}

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete"]);

const GUARD_CALLEES = new Set([
  "requireAppAuth",
  "requirePermission",
  "requireAnyPermission",
  "requireAllPermissions",
  "requireBootstrapAdmin",
  "requireBootstrapOrAnyPermission",
  "requireBootstrapOrPermission",
  "requireBootstrapOrResource",
  "requireResourcePermission",
  "requireResource",
  "requireUserAdminOrBootstrap",
  "requireUsersOrPermissionsAdmin",
  "requireUsersManageOrBootstrap",
  "requireUsersViewOrBootstrap",
  "requirePermissionsAdminOrBootstrap",
  "requireBootstrapForGlobalParamMutation",
]);

/**
 * Detecta app.METHOD("path", ...guards) e router.METHOD no mesmo arquivo.
 * Usa AST; ignora calls aninhadas não-HTTP.
 */
export function scanExpressRoutes(root: string, filePath: string): ScannedRoute[] {
  const raw = readFileSync(filePath, "utf8");
  const sf = ts.createSourceFile(filePath, raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const file = rel(root, filePath);
  const routes: ScannedRoute[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text.toLowerCase();
      const receiver = getCalleeName(node.expression.expression);
      if (
        HTTP_METHODS.has(method) &&
        receiver &&
        (receiver === "app" || receiver === "router" || receiver.endsWith("Router"))
      ) {
        const pathArg = node.arguments[0];
        let pathPattern = "";
        if (pathArg && (ts.isStringLiteral(pathArg) || ts.isNoSubstitutionTemplateLiteral(pathArg))) {
          pathPattern = pathArg.text;
        }
        if (pathPattern.startsWith("/api") || pathPattern.startsWith("/")) {
          const guardCallees: string[] = [];
          const permissionKeys: string[] = [];
          const resourceKeys: string[] = [];

          for (let i = 1; i < node.arguments.length; i++) {
            const arg = node.arguments[i];
            collectGuardsFromArg(arg, guardCallees, permissionKeys, resourceKeys);
          }

          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          routes.push({
            file,
            line: line + 1,
            method: method.toUpperCase(),
            pathPattern,
            guardCallees: [...new Set(guardCallees)],
            permissionKeys: [...new Set(permissionKeys)],
            resourceKeys: [...new Set(resourceKeys)],
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return routes;
}

function collectGuardsFromArg(
  arg: ts.Expression,
  guardCallees: string[],
  permissionKeys: string[],
  resourceKeys: string[]
): void {
  if (ts.isSpreadElement(arg)) {
    const expr = arg.expression;
    // Padrão IndusCost: ...g.checklistOps / ...paymentsManageGuard
    if (ts.isPropertyAccessExpression(expr) || ts.isIdentifier(expr)) {
      const label = expr.getText().replace(/\s+/g, "");
      guardCallees.push(label);
      return;
    }
    collectGuardsFromArg(expr, guardCallees, permissionKeys, resourceKeys);
    return;
  }
  if (ts.isCallExpression(arg)) {
    const name = getCalleeName(arg.expression);
    if (name && GUARD_CALLEES.has(name)) {
      guardCallees.push(name);
      const strings: string[] = [];
      for (const a of arg.arguments) collectStringLiteralsFromNode(a, strings);
      if (
        name === "requireResourcePermission" ||
        name === "requireResource" ||
        name === "requireBootstrapOrPermission" ||
        name === "requireBootstrapOrResource"
      ) {
        if (strings[0]) resourceKeys.push(strings[0]);
        for (const s of strings.slice(1)) {
          if (s.includes(".")) permissionKeys.push(s);
        }
      } else {
        for (const s of strings) {
          if (s.includes(".") || s.includes("_")) permissionKeys.push(s);
        }
      }
    } else if (name) {
      // Wrappers locais: paymentsManageGuard(), createFleetRouteGuards().xxx — conta como guard nomeado
      if (/Guard|Permission|Auth|require|canFleet|authorize/i.test(name)) {
        guardCallees.push(name);
      }
    }
    return;
  }
  if (ts.isIdentifier(arg)) {
    const n = arg.text;
    if (GUARD_CALLEES.has(n) || /Guard|Permission|Auth|require|canFleet|authorize/i.test(n)) {
      guardCallees.push(n);
    }
    return;
  }
  if (ts.isPropertyAccessExpression(arg)) {
    const leaf = arg.name.text;
    const full = arg.getText();
    if (
      GUARD_CALLEES.has(leaf) ||
      /Guard|Permission|Auth|require|canFleet|authorize/i.test(leaf) ||
      /Guard|Permission|Auth|require/i.test(full)
    ) {
      guardCallees.push(leaf);
    }
  }
}

export type UsageIndex = {
  frontend: Map<string, { file: string; line: number; callee: string }[]>;
  backend: Map<string, { file: string; line: number; callee: string }[]>;
  resourceKeysUsed: Map<string, { file: string; line: number; callee: string }[]>;
  routes: ScannedRoute[];
};

export function buildUsageIndex(root: string): UsageIndex {
  const frontendDirs = ["src/components", "src/contexts", "src/hooks", "src/pages", "src/views"];
  const backendDirs = ["src/lib"];
  const feFiles = listSourceFiles(root, frontendDirs);
  const beFiles = [
    ...listSourceFiles(root, backendDirs),
    path.join(root, "server.ts"),
  ].filter((f) => existsSync(f));

  // App entry
  for (const extra of ["src/App.tsx", "src/main.tsx"]) {
    const p = path.join(root, extra);
    if (existsSync(p)) feFiles.push(p);
  }

  const frontend = new Map<string, { file: string; line: number; callee: string }[]>();
  const backend = new Map<string, { file: string; line: number; callee: string }[]>();
  const resourceKeysUsed = new Map<
    string,
    { file: string; line: number; callee: string }[]
  >();
  const routes: ScannedRoute[] = [];

  const push = (
    map: Map<string, { file: string; line: number; callee: string }[]>,
    key: string,
    hit: { file: string; line: number; callee: string }
  ) => {
    const arr = map.get(key) ?? [];
    arr.push(hit);
    map.set(key, arr);
  };

  const FE_CALLEES = new Set([
    "hasPermission",
    "hasAnyPermission",
    "canView",
    "canExecute",
    "canManage",
  ]);
  const BE_CALLEES = new Set([
    "requirePermission",
    "requireAnyPermission",
    "requireAllPermissions",
    "requireBootstrapOrAnyPermission",
    "hasPermission",
  ]);
  const RESOURCE_CALLEES = new Set([
    "requireResourcePermission",
    "requireResource",
    "requireBootstrapOrPermission",
    "requireBootstrapOrResource",
  ]);

  for (const file of feFiles) {
    for (const call of scanFileCalls(root, file)) {
      const hit = { file: call.file, line: call.line, callee: call.callee };
      if (FE_CALLEES.has(call.callee)) {
        for (const key of call.stringArgs) {
          // resource keys PT não têm muitos dots no início legacy pattern: word.word
          if (call.callee.startsWith("can") && !key.includes("_") && key.split(".").length >= 1) {
            // canView("comercial.crm") vs hasPermission("crm.view")
            if (!/^[a-z]+\.[a-z_]/.test(key) || key.startsWith("comissoes") || key.startsWith("financeiro") || key.startsWith("comercial") || key.startsWith("suprimentos") || key.startsWith("admin") || key === "dashboard" || key === "configuracoes") {
              push(resourceKeysUsed, key, hit);
              continue;
            }
          }
          if (key.includes(".")) push(frontend, key, hit);
        }
      }
    }
  }

  for (const file of beFiles) {
    for (const call of scanFileCalls(root, file)) {
      const hit = { file: call.file, line: call.line, callee: call.callee };
      if (BE_CALLEES.has(call.callee)) {
        for (const key of call.stringArgs) {
          if (key.includes(".")) push(backend, key, hit);
        }
      }
      if (RESOURCE_CALLEES.has(call.callee) || call.callee === "requireResourcePermission") {
        for (const key of call.stringArgs) {
          if (
            key === "view" ||
            key === "execute" ||
            key === "manage" ||
            key === "admin" ||
            key === "read" ||
            key === "create" ||
            key === "update" ||
            key === "delete" ||
            key === "export"
          ) {
            continue;
          }
          if (key.includes(".") || ["dashboard", "admin", "comercial", "financeiro", "comissoes", "suprimentos", "configuracoes"].includes(key)) {
            push(resourceKeysUsed, key, hit);
          }
        }
      }
    }
    if (
      file.endsWith("server.ts") ||
      file.includes("Routes.ts") ||
      file.includes("routes.ts") ||
      /Routes\./.test(file)
    ) {
      routes.push(...scanExpressRoutes(root, file));
    }
  }

  // Também varre todos *Routes.ts sob src/lib explicitamente
  const routeFiles = listSourceFiles(root, ["src/lib"]).filter(
    (f) => /Routes\.ts$/i.test(f) || /routes\.ts$/i.test(f)
  );
  for (const file of routeFiles) {
    routes.push(...scanExpressRoutes(root, file));
  }

  // Deduplicate routes by file+line+method+path
  const seen = new Set<string>();
  const uniqueRoutes = routes.filter((r) => {
    const k = `${r.file}:${r.line}:${r.method}:${r.pathPattern}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return { frontend, backend, resourceKeysUsed, routes: uniqueRoutes };
}
