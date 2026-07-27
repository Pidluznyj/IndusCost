#!/usr/bin/env node
/**
 * Baseline reutilizável da Central de Tesouraria.
 * Orquestra apenas comandos npm/Prisma já seguros do projeto.
 * Não altera banco, não faz deploy, não cria .env.
 *
 * Uso: npm run validate:treasury-baseline
 * Exit: 0 se passos críticos OK; 1 se algum crítico falhar.
 *
 * Críticos: deps, prisma validate (com DATABASE_URL de validação se ausente),
 *           check frontend/server imports, test:server-startup, build.
 * Informativos: lint (tsc) — falhas preexistentes não derrubam o baseline crítico
 *               quando TREASURY_BASELINE_LINT_SOFT=1 (default).
 */
import { spawnSync } from "node:child_process";
import process from "node:process";

const softLint = process.env.TREASURY_BASELINE_LINT_SOFT !== "0";

function run(label, command, args, env = process.env) {
  console.log(`\n===== ${label} =====`);
  console.log(`$ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env,
    shell: process.platform === "win32",
  });
  const code = result.status ?? 1;
  console.log(`EXIT: ${code}`);
  return code;
}

const results = [];

results.push({
  label: "deps",
  critical: true,
  code: run("deps", "npm", ["ls", "--depth=0"]),
});

const prismaEnv = { ...process.env };
if (!prismaEnv.DATABASE_URL) {
  // Apenas para `prisma validate` (schema load). Não grava .env.
  prismaEnv.DATABASE_URL =
    "postgresql://user:password@localhost:5432/induscost_validate?schema=public";
  console.log(
    "\n[info] DATABASE_URL ausente — usando URL dummy só para prisma validate."
  );
}
results.push({
  label: "prisma_validate",
  critical: true,
  code: run("prisma_validate", "npx", ["prisma", "validate"], prismaEnv),
});

results.push({
  label: "lint_tsc",
  critical: !softLint,
  code: run("lint_tsc", "npm", ["run", "lint"]),
});

results.push({
  label: "check_frontend_imports",
  critical: true,
  code: run("check_frontend_imports", "npm", ["run", "check:frontend-server-imports"]),
});

results.push({
  label: "check_server_imports",
  critical: true,
  code: run("check_server_imports", "npm", ["run", "check:server-imports"]),
});

results.push({
  label: "test_server_startup",
  critical: true,
  code: run("test_server_startup", "npm", ["run", "test:server-startup"]),
});

results.push({
  label: "build_frontend",
  critical: true,
  code: run("build_frontend", "npm", ["run", "build"]),
});

console.log("\n===== SUMMARY =====");
for (const row of results) {
  const flag = row.code === 0 ? "OK" : "FAIL";
  const crit = row.critical ? "critical" : "soft";
  console.log(`${flag} [${crit}] ${row.label} (exit ${row.code})`);
}

const criticalFailed = results.some((r) => r.critical && r.code !== 0);
if (softLint) {
  const lint = results.find((r) => r.label === "lint_tsc");
  if (lint && lint.code !== 0) {
    console.log(
      "\n[info] lint/tsc falhou em modo soft (TREASURY_BASELINE_LINT_SOFT=1). " +
        "Tratar como dívida preexistente — ver docs/treasury/04-BASELINE.md."
    );
  }
}

console.log(
  "\n[info] Backend não tem build separado (Express via tsx server.ts)."
);
process.exit(criticalFailed ? 1 : 0);
