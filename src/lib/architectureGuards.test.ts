/**
 * Testes dos guardrails de arquitetura Frontend × Backend:
 *  - scripts/checkFrontendServerImports.ts (rastreador de grafo de imports);
 *  - scripts/checkBrowserBundle.ts (varredura do dist por vestígios de Prisma).
 *
 * Também valida que os arquivos puros criados para quebrar os vazamentos
 * (enum espelho e helper de apresentação) permanecem livres de Prisma.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO_ROOT = process.cwd();
const require = createRequire(import.meta.url);
// Caminho absoluto do CLI do tsx: roda por path absoluto via `node`, sem shell,
// para funcionar mesmo quando o cwd é um diretório temporário sem node_modules.
const TSX_CLI = path.join(path.dirname(require.resolve("tsx/package.json")), "dist", "cli.mjs");
const TRACER = path.join(REPO_ROOT, "scripts", "checkFrontendServerImports.ts");
const BUNDLE_CHECK = path.join(REPO_ROOT, "scripts", "checkBrowserBundle.ts");

function runScript(script: string, cwd: string): { status: number; output: string } {
  try {
    const out = execFileSync(process.execPath, [TSX_CLI, script], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, output: out };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

function makeTmp(prefix: string): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("tracer detecta cadeia frontend → @prisma/client (import indireto)", () => {
  const dir = makeTmp("guard-prisma-");
  try {
    mkdirSync(path.join(dir, "src", "components"), { recursive: true });
    mkdirSync(path.join(dir, "src", "lib"), { recursive: true });
    writeFileSync(path.join(dir, "src", "main.tsx"), `import "./App";\n`);
    writeFileSync(path.join(dir, "src", "App.tsx"), `import { foo } from "./components/Foo";\nexport const x = foo;\n`);
    writeFileSync(
      path.join(dir, "src", "components", "Foo.tsx"),
      `import { load } from "../lib/serverThing";\nexport const foo = load;\n`
    );
    writeFileSync(
      path.join(dir, "src", "lib", "serverThing.ts"),
      `import { PrismaClient } from "@prisma/client";\nexport const load = () => new PrismaClient();\n`
    );

    const res = runScript(TRACER, dir);
    assert.equal(res.status, 1, "tracer deveria falhar com vazamento");
    assert.match(res.output, /@prisma\/client/);
    assert.match(res.output, /serverThing/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tracer detecta cadeia frontend → src/lib/prisma", () => {
  const dir = makeTmp("guard-libprisma-");
  try {
    mkdirSync(path.join(dir, "src", "components"), { recursive: true });
    mkdirSync(path.join(dir, "src", "lib"), { recursive: true });
    writeFileSync(path.join(dir, "src", "main.tsx"), `import "./components/Panel";\n`);
    writeFileSync(
      path.join(dir, "src", "components", "Panel.tsx"),
      `import { prisma } from "@/src/lib/prisma.js";\nexport const p = prisma;\n`
    );
    writeFileSync(
      path.join(dir, "src", "lib", "prisma.ts"),
      `export const prisma = {} as unknown;\n`
    );

    const res = runScript(TRACER, dir);
    assert.equal(res.status, 1);
    assert.match(res.output, /src\/lib\/prisma/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tracer ignora import type (apagado no build) e import('x').Tipo", () => {
  const dir = makeTmp("guard-typeonly-");
  try {
    mkdirSync(path.join(dir, "src", "components"), { recursive: true });
    mkdirSync(path.join(dir, "src", "lib"), { recursive: true });
    writeFileSync(path.join(dir, "src", "main.tsx"), `import "./components/Safe";\n`);
    writeFileSync(
      path.join(dir, "src", "components", "Safe.tsx"),
      [
        `import type { Prisma } from "@prisma/client";`,
        `type D = import("@prisma/client").Prisma.Decimal;`,
        `export type T = Prisma; export type E = D;`,
      ].join("\n") + "\n"
    );

    const res = runScript(TRACER, dir);
    assert.equal(res.status, 0, `type-only não deveria vazar: ${res.output}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("checkBrowserBundle falha com .prisma/client/index-browser no dist", () => {
  const dir = makeTmp("guard-bundle-bad-");
  try {
    mkdirSync(path.join(dir, "dist", "assets"), { recursive: true });
    writeFileSync(path.join(dir, "dist", "index.html"), `<script src="/assets/x.js"></script>`);
    writeFileSync(
      path.join(dir, "dist", "assets", "x.js"),
      `import xce from ".prisma/client/index-browser";export default xce;`
    );

    const res = runScript(BUNDLE_CHECK, dir);
    assert.equal(res.status, 1);
    assert.match(res.output, /\.prisma\/client/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("checkBrowserBundle passa com dist limpo", () => {
  const dir = makeTmp("guard-bundle-ok-");
  try {
    mkdirSync(path.join(dir, "dist", "assets"), { recursive: true });
    writeFileSync(path.join(dir, "dist", "index.html"), `<script src="/assets/x.js"></script>`);
    writeFileSync(
      path.join(dir, "dist", "assets", "x.js"),
      `export const sum = (a,b)=>a+b;console.log(sum(1,2));`
    );

    const res = runScript(BUNDLE_CHECK, dir);
    assert.equal(res.status, 0, res.output);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("regressão: repo real não tem cadeia frontend → Prisma", () => {
  const res = runScript(TRACER, REPO_ROOT);
  assert.equal(res.status, 0, res.output);
});

test("enum espelho NomusNfeBillingClassification é puro e completo", () => {
  const src = readFileSync(
    path.join(REPO_ROOT, "src", "lib", "nomusNfeBillingClassification.ts"),
    "utf8"
  );
  assert.doesNotMatch(src, /from\s+["']@prisma\/client["']/, "mirror não pode importar @prisma/client");
  for (const v of ["LOGISTICS_NOT_REVENUE", "INTERCOMPANY", "MARKET_REVENUE"]) {
    assert.match(src, new RegExp(v));
  }
});

test("helper de apresentação de Frotas é livre de Prisma", () => {
  const src = readFileSync(
    path.join(REPO_ROOT, "src", "lib", "fleetExecutiveDashboard.presentation.ts"),
    "utf8"
  );
  assert.doesNotMatch(src, /@prisma\/client/);
  assert.doesNotMatch(src, /lib\/prisma/);
});

test("fleetErrors não importa @prisma/client (usa duck-typing)", () => {
  const src = readFileSync(path.join(REPO_ROOT, "src", "lib", "fleetErrors.ts"), "utf8");
  assert.doesNotMatch(src, /from ["']@prisma\/client["']/);
  assert.match(src, /PrismaClientKnownRequestError/);
});
