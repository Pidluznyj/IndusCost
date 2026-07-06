/**
 * Escopo SYSTEM — relatório analisável para saúde geral do ambiente.
 * Read-only; sem .env bruto, tokens ou DATABASE_URL completo.
 */
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { resolveServerAppBuildInfo } from "../appVersion.js";
import { getNomusAccountsPayableSyncStatus } from "../nomusAccountsPayableSyncRunner.js";
import { getNomusNfesSyncStatus } from "../nomusNfesSyncRunner.js";
import { getNomusAccountsReceivableSyncStatus } from "../nomusAccountsReceivableSyncRunner.js";
import { getNomusDailySyncStatus, resolveNomusSyncLogDir } from "../nomusDailySyncRunner.js";
import type {
  DiagnosticCodeReference,
  DiagnosticFinding,
  DiagnosticFindingSeverity,
  DiagnosticScopeContext,
} from "./chatgptDiagnosticTypes.js";
import {
  DIAGNOSTIC_BUNDLE_MAX_TOTAL_BYTES,
  CHATGPT_DIAGNOSTIC_BUNDLE_VERSION,
} from "./chatgptDiagnosticTypes.js";
import {
  type BuildDiagnosticBundleInput,
  type BuildDiagnosticBundleResult,
  buildAndWriteDiagnosticBundle,
} from "./diagnosticBundleBuilder.server.js";
import { createDiagnosticSourceRef } from "./diagnosticSourceRefs.server.js";
import {
  buildSafeEnvironmentFlags,
  sanitizeDiagnosticLogLines,
  sanitizeDiagnosticText,
} from "./sanitizeDiagnosticPayload.server.js";

export type SystemDiagnosticContext = {
  errorMessage?: string | null;
  screenRoute?: string | null;
  screenTitle?: string | null;
  userId?: string | null;
  userEmail?: string | null;
  notes?: string | null;
};

export type SystemDiagnosticRequest = {
  scope: "SYSTEM";
  context?: SystemDiagnosticContext;
};

export type SystemAutoDiagnostic = {
  code: string;
  severity: DiagnosticFindingSeverity;
  title: string;
  message: string;
  hypothesis?: string | null;
};

export class SystemDiagnosticValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SystemDiagnosticValidationError";
  }
}

const APP_NAME = "IndusCost / My Industry";
const SYSTEM_SCREEN_ROUTE = "/settings/diagnostic-bundle";

const NOMUS_SYNC_TARGETS = [
  "customers",
  "products",
  "bom-components",
  "proposals",
  "sales-orders",
  "accounts-receivable",
  "accounts-payable",
  "nfes",
] as const;

const CRITICAL_TABLES = [
  "Product",
  "ProductionCostTableItem",
  "PriceTableItem",
  "SalesOrder",
  "CommissionOrderItemSnapshot",
  "CommissionReceivableSchedule",
  "NomusAccountsReceivable",
  "IntegrationRun",
] as const;

const BROWSER_BUNDLE_FORBIDDEN = [
  { label: "@prisma/client", re: /@prisma\/client/ },
  { label: "PrismaClient", re: /PrismaClient/ },
  { label: ".prisma/client", re: /\.prisma\/client/ },
] as const;

const SYSTEM_CODE_REFERENCES: DiagnosticCodeReference[] = [
  {
    path: "server.ts",
    reason: "Bootstrap Express, healthcheck e rotas API",
    symbols: ["GET /api/health", "buildNomusIntegrationHealthPayload"],
  },
  {
    path: "src/lib/diagnostics/systemDiagnostic.server.ts",
    reason: "Coleta SYSTEM para relatório analisável",
    symbols: ["buildSystemDiagnosticBundleInput"],
  },
  {
    path: "src/lib/diagnostics/diagnosticBundleBuilder.server.ts",
    reason: "Montagem ZIP read-only",
    symbols: ["buildChatGptDiagnosticBundle"],
  },
  {
    path: "src/lib/productCostAnalysisEngine.server.ts",
    reason: "Motor de custo industrial",
    symbols: ["createProductCostAnalysisEngine"],
  },
  {
    path: "src/lib/commissions/commissionReceiptEngine.server.ts",
    reason: "Preview fechamento por recebimento",
    symbols: ["loadCommissionReceiptPreview"],
  },
  {
    path: "scripts/checkFrontendServerImports.ts",
    reason: "Guardrail frontend × Prisma",
  },
  {
    path: "scripts/checkBrowserBundle.ts",
    reason: "Guardrail dist/ sem Prisma",
  },
  {
    path: "scripts/generate-diagnostic-bundle.ts",
    reason: "CLI Gerar Relatório Analisável",
  },
];

const MAX_SYSTEM_LOG_LINES = 120;
const MAX_LOG_FILE_BYTES = 48_000;

export function parseSystemDiagnosticRequest(body: unknown): SystemDiagnosticRequest {
  if (body != null && typeof body !== "object") {
    throw new SystemDiagnosticValidationError("Corpo JSON inválido.");
  }
  const raw = (body ?? {}) as Record<string, unknown>;
  const scope = String(raw.scope ?? "SYSTEM").trim().toUpperCase();
  if (scope !== "SYSTEM") {
    throw new SystemDiagnosticValidationError('scope deve ser "SYSTEM".');
  }
  const ctxRaw = raw.context;
  const ctx =
    ctxRaw && typeof ctxRaw === "object" ? (ctxRaw as Record<string, unknown>) : {};
  return {
    scope: "SYSTEM",
    context: {
      errorMessage:
        typeof ctx.errorMessage === "string" ? ctx.errorMessage.trim() || null : null,
      screenRoute:
        typeof ctx.screenRoute === "string" ? ctx.screenRoute.trim() || null : null,
      screenTitle:
        typeof ctx.screenTitle === "string" ? ctx.screenTitle.trim() || null : null,
      userId: typeof ctx.userId === "string" ? ctx.userId.trim() || null : null,
      userEmail: typeof ctx.userEmail === "string" ? ctx.userEmail.trim() || null : null,
      notes: typeof ctx.notes === "string" ? ctx.notes.trim() || null : null,
    },
  };
}

function runGitCommand(args: string, cwd: string): string | null {
  try {
    return execSync(`git ${args}`, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

export function collectGitSnapshot(cwd = process.cwd()): {
  commit: string | null;
  branch: string | null;
  isDirty: boolean;
  changedFilesCount: number;
  statusSummary: string;
} {
  const commit = runGitCommand("rev-parse HEAD", cwd);
  const branch = runGitCommand("rev-parse --abbrev-ref HEAD", cwd);
  const porcelain = runGitCommand("status --porcelain", cwd) ?? "";
  const lines = porcelain.split("\n").filter((l) => l.trim().length > 0);
  const isDirty = lines.length > 0;
  const statusSummary = isDirty
    ? `${lines.length} arquivo(s) alterado(s)/não rastreado(s)`
    : "working tree clean";
  return {
    commit,
    branch,
    isDirty,
    changedFilesCount: lines.length,
    statusSummary,
  };
}

export function listFilesystemMigrationNames(cwd = process.cwd()): string[] {
  const dir = join(cwd, "prisma", "migrations");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

export function readPackageMeta(cwd = process.cwd()): {
  name: string;
  version: string;
  prismaClientVersion: string | null;
  prismaCliVersion: string | null;
} {
  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) {
    return { name: "unknown", version: "unknown", prismaClientVersion: null, prismaCliVersion: null };
  }
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
    name?: string;
    version?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  return {
    name: pkg.name ?? "unknown",
    version: pkg.version ?? "unknown",
    prismaClientVersion: pkg.dependencies?.["@prisma/client"] ?? null,
    prismaCliVersion: pkg.devDependencies?.prisma ?? null,
  };
}

export function scanDistForPrismaLeaks(cwd = process.cwd()): Array<{
  file: string;
  label: string;
}> {
  const dist = join(cwd, "dist");
  if (!existsSync(dist)) return [];

  const hits: Array<{ file: string; label: string }> = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(js|mjs|cjs|css|html)$/i.test(full)) continue;
      const text = readFileSync(full, "utf8");
      for (const rule of BROWSER_BUNDLE_FORBIDDEN) {
        if (rule.re.test(text)) {
          hits.push({
            file: full.replace(/\\/g, "/").replace(`${cwd.replace(/\\/g, "/")}/`, ""),
            label: rule.label,
          });
          break;
        }
      }
    }
  };
  walk(dist);
  return hits;
}

async function collectDatabaseSnapshot(
  db: PrismaClient | null
): Promise<{
  databaseConfigured: boolean;
  provider: string | null;
  connectionOk: boolean;
  connectionError: string | null;
  appliedMigrations: string[];
  pendingMigrations: string[];
  criticalTables: Array<{ table: string; exists: boolean }>;
}> {
  const databaseConfigured = Boolean(process.env.DATABASE_URL?.trim());
  if (!db || !databaseConfigured) {
    return {
      databaseConfigured,
      provider: null,
      connectionOk: false,
      connectionError: databaseConfigured ? null : "DATABASE_URL não configurada",
      appliedMigrations: [],
      pendingMigrations: listFilesystemMigrationNames(),
      criticalTables: CRITICAL_TABLES.map((table) => ({ table, exists: false })),
    };
  }

  let connectionOk = false;
  let connectionError: string | null = null;
  try {
    await db.$queryRaw`SELECT 1`;
    connectionOk = true;
  } catch (err) {
    connectionError = err instanceof Error ? err.message : String(err);
  }

  let appliedMigrations: string[] = [];
  if (connectionOk) {
    try {
      const rows = await db.$queryRaw<
        { migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]
      >`
        SELECT migration_name, finished_at, rolled_back_at
        FROM "_prisma_migrations"
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
        ORDER BY finished_at ASC
      `;
      appliedMigrations = rows.map((r) => r.migration_name);
    } catch (err) {
      connectionError =
        connectionError ??
        (err instanceof Error ? err.message : "Falha ao ler _prisma_migrations");
    }
  }

  const filesystemMigrations = listFilesystemMigrationNames();
  const appliedSet = new Set(appliedMigrations);
  const pendingMigrations = filesystemMigrations.filter((m) => !appliedSet.has(m));

  const criticalTables: Array<{ table: string; exists: boolean }> = [];
  if (connectionOk) {
    for (const table of CRITICAL_TABLES) {
      try {
        const rows = await db.$queryRawUnsafe<{ exists: boolean }[]>(
          `SELECT to_regclass('"${table}"') IS NOT NULL AS exists`
        );
        criticalTables.push({ table, exists: Boolean(rows[0]?.exists) });
      } catch {
        criticalTables.push({ table, exists: false });
      }
    }
  } else {
    for (const table of CRITICAL_TABLES) {
      criticalTables.push({ table, exists: false });
    }
  }

  return {
    databaseConfigured,
    provider: "postgresql",
    connectionOk,
    connectionError,
    appliedMigrations,
    pendingMigrations,
    criticalTables,
  };
}

async function collectNomusSnapshot(db: PrismaClient | null): Promise<Record<string, unknown>> {
  const envFlags = buildSafeEnvironmentFlags();
  const syncConfigured = envFlags.NOMUS_API_CONFIGURED;

  let dailySync: unknown = null;
  let arSync: unknown = null;
  let apSync: unknown = null;
  let nfeSync: unknown = null;
  let targets: unknown[] = [];

  try {
    dailySync = await getNomusDailySyncStatus();
  } catch {
    dailySync = { error: "Falha ao ler status daily sync" };
  }
  try {
    arSync = await getNomusAccountsReceivableSyncStatus();
  } catch {
    arSync = null;
  }
  try {
    apSync = await getNomusAccountsPayableSyncStatus();
  } catch {
    apSync = null;
  }
  try {
    nfeSync = await getNomusNfesSyncStatus();
  } catch {
    nfeSync = null;
  }

  if (db) {
    for (const target of NOMUS_SYNC_TARGETS) {
      try {
        const row = await db.integrationRun.findFirst({
          where: { sourceSystem: "NOMUS", target, mode: "apply" },
          orderBy: { createdAt: "desc" },
          select: {
            target: true,
            status: true,
            success: true,
            exitCode: true,
            errorMessage: true,
            startedAt: true,
            finishedAt: true,
            createdAt: true,
          },
        });
        targets.push({
          target,
          lastRun: row
            ? {
                status: row.status,
                success: row.success,
                exitCode: row.exitCode,
                errorMessage: row.errorMessage,
                startedAt: row.startedAt?.toISOString() ?? null,
                finishedAt: row.finishedAt?.toISOString() ?? null,
                createdAt: row.createdAt.toISOString(),
              }
            : null,
        });
      } catch {
        targets.push({ target, lastRun: null, error: "query_failed" });
      }
    }
  }

  const daily = dailySync as { isActuallyRunning?: boolean; overallStatus?: string } | null;

  return {
    syncConfigured,
    logDir: resolveNomusSyncLogDir(),
    dailySync,
    runners: {
      accountsReceivable: arSync,
      accountsPayable: apSync,
      nfes: nfeSync,
    },
    targets,
    locks: {
      globalLockHeld: daily?.isActuallyRunning === true,
      overallStatus: daily?.overallStatus ?? null,
    },
  };
}

async function collectRecentIntegrationFailures(
  db: PrismaClient | null
): Promise<
  Array<{
    target: string;
    status: string;
    exitCode: number | null;
    errorMessage: string | null;
    createdAt: string;
  }>
> {
  if (!db) return [];
  try {
    const rows = await db.integrationRun.findMany({
      where: {
        OR: [{ success: false }, { status: { in: ["FAILED", "ERROR"] } }, { exitCode: { gt: 0 } }],
      },
      orderBy: { createdAt: "desc" },
      take: 15,
      select: {
        target: true,
        status: true,
        exitCode: true,
        errorMessage: true,
        createdAt: true,
      },
    });
    return rows.map((r) => ({
      target: r.target,
      status: r.status,
      exitCode: r.exitCode,
      errorMessage: r.errorMessage,
      createdAt: r.createdAt.toISOString(),
    }));
  } catch {
    return [];
  }
}

export function collectRecentSanitizedLogLines(cwd = process.cwd()): string[] {
  const logDir = resolveNomusSyncLogDir();
  if (!existsSync(logDir)) {
    return ["# Nenhum diretório de log Nomus encontrado."];
  }

  const files = readdirSync(logDir)
    .map((fileName) => {
      const full = join(logDir, fileName);
      try {
        const stat = statSync(full);
        if (!stat.isFile()) return null;
        return { fileName, full, mtimeMs: stat.mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((f): f is { fileName: string; full: string; mtimeMs: number } => f != null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, 5);

  const lines: string[] = [];
  const pattern = /error|warn|500|Unknown field|Prisma|FATAL|exception/i;

  for (const file of files) {
    try {
      const raw = readFileSync(file.full, "utf8");
      const slice =
        raw.length > MAX_LOG_FILE_BYTES ? raw.slice(-MAX_LOG_FILE_BYTES) : raw;
      const fileLines = slice.split("\n").filter((l) => pattern.test(l));
      for (const line of fileLines) {
        lines.push(`[${file.fileName}] ${line.trim()}`);
      }
    } catch {
      continue;
    }
    if (lines.length >= MAX_SYSTEM_LOG_LINES) break;
  }

  if (lines.length === 0) {
    return ["# Nenhuma linha error/warn recente nos logs Nomus escaneados."];
  }
  return lines.slice(0, MAX_SYSTEM_LOG_LINES);
}

export function evaluateSystemAutoDiagnostics(input: {
  git: ReturnType<typeof collectGitSnapshot>;
  buildInfo: ReturnType<typeof resolveServerAppBuildInfo>;
  database: Awaited<ReturnType<typeof collectDatabaseSnapshot>>;
  prismaVersions: ReturnType<typeof readPackageMeta>;
  browserLeaks: ReturnType<typeof scanDistForPrismaLeaks>;
  nomus: Record<string, unknown>;
  recentFailures: Array<{ target: string; status: string; errorMessage: string | null }>;
  logLines: string[];
  distExists: boolean;
}): SystemAutoDiagnostic[] {
  const diagnostics: SystemAutoDiagnostic[] = [];
  const push = (diag: SystemAutoDiagnostic) => {
    if (!diagnostics.some((d) => d.code === diag.code)) diagnostics.push(diag);
  };

  if (input.database.pendingMigrations.length > 0) {
    push({
      code: "MIGRATION_PENDING",
      severity: "error",
      title: "Migrations pendentes",
      message: `${input.database.pendingMigrations.length} migration(s) no filesystem ainda não aplicada(s). Primeira: ${input.database.pendingMigrations[0]}.`,
      hypothesis: "Schema Prisma diverge do banco — rode npx prisma migrate deploy.",
    });
  }

  if (
    input.prismaVersions.prismaClientVersion &&
    input.prismaVersions.prismaCliVersion &&
    input.prismaVersions.prismaClientVersion.replace(/^[\^~]/, "") !==
      input.prismaVersions.prismaCliVersion.replace(/^[\^~]/, "")
  ) {
    push({
      code: "PRISMA_CLIENT_OUTDATED",
      severity: "warning",
      title: "Versões Prisma divergentes",
      message: `@prisma/client=${input.prismaVersions.prismaClientVersion}, prisma=${input.prismaVersions.prismaCliVersion}.`,
      hypothesis: "Rode npx prisma generate após alinhar versões.",
    });
  }

  if (
    input.distExists &&
    input.git.commit &&
    input.buildInfo.commit !== "unknown" &&
    input.buildInfo.commit !== input.git.commit
  ) {
    push({
      code: "BUILD_ARTIFACT_STALE",
      severity: "warning",
      title: "Build dist desatualizado",
      message: `dist/build-info commit=${input.buildInfo.commit.slice(0, 8)} ≠ git HEAD=${input.git.commit.slice(0, 8)}.`,
      hypothesis: "Rode npm run build antes de deploy ou diagnóstico de produção.",
    });
  }

  const locks = input.nomus.locks as { globalLockHeld?: boolean } | undefined;
  if (locks?.globalLockHeld) {
    push({
      code: "NOMUS_SYNC_LOCKED",
      severity: "warning",
      title: "Sync Nomus em execução ou lock ativo",
      message: "Lock global Nomus detectado — nova sync pode ser ignorada.",
    });
  }

  if (!input.database.connectionOk && input.database.databaseConfigured) {
    push({
      code: "DATABASE_CONNECTION_ISSUE",
      severity: "critical",
      title: "Falha de conexão com banco",
      message: input.database.connectionError ?? "Não foi possível conectar ao PostgreSQL.",
    });
  }

  if (input.browserLeaks.length > 0) {
    push({
      code: "FRONTEND_BUNDLE_SERVER_IMPORT",
      severity: "error",
      title: "Bundle browser contaminado com Prisma",
      message: `${input.browserLeaks.length} artefato(s) em dist/ contêm ${input.browserLeaks[0]?.label}.`,
      hypothesis: "Rode npm run check:frontend-server-imports e corrija imports frontend→server.",
    });
  }

  const prismaSelectInLogs = input.logLines.some((l) => /Unknown field.*for select/i.test(l));
  if (prismaSelectInLogs) {
    push({
      code: "UNKNOWN_FIELD_IN_PRISMA_SELECT",
      severity: "error",
      title: "Campo inexistente em select Prisma",
      message: "Logs recentes mencionam Unknown field … for select — revisar selects Prisma vs schema.",
    });
  }

  const api500InLogs = input.logLines.some((l) => /\b500\b|status.?500|API_500/i.test(l));
  if (api500InLogs || input.recentFailures.length > 0) {
    push({
      code: "API_RECENT_500",
      severity: api500InLogs ? "error" : "warning",
      title: "Falhas recentes de API/sync",
      message: api500InLogs
        ? "Logs recentes contêm HTTP 500 ou equivalente."
        : `${input.recentFailures.length} falha(s) recente(s) em IntegrationRun.`,
    });
  }

  if (diagnostics.length === 0) {
    push({
      code: "SYSTEM_HEALTH_OK",
      severity: "info",
      title: "Ambiente aparentemente saudável",
      message: "Nenhum diagnóstico automático crítico detectado neste snapshot.",
    });
  }

  return diagnostics;
}

function autoToFinding(diag: SystemAutoDiagnostic, index: number): DiagnosticFinding {
  return {
    id: `system_finding_${String(index + 1).padStart(3, "0")}`,
    severity: diag.severity,
    code: diag.code,
    title: diag.title,
    message: diag.message,
    businessImpact:
      diag.severity === "critical" || diag.severity === "error"
        ? "Operações podem falhar ou exibir dados inconsistentes."
        : "Monitorar — impacto limitado no momento.",
    technicalImpact: diag.hypothesis ?? diag.message,
    evidenceRefs: ["06_SYSTEM_SNAPSHOT.json", "12_LOGS_SANITIZED.log"],
    sourceRefs: [
      createDiagnosticSourceRef({
        type: "service",
        name: "evaluateSystemAutoDiagnostics",
        path: "04_DIAGNOSTICS.json",
      }),
    ],
    suggestedNextSteps: [
      diag.hypothesis ?? "Revisar 06_SYSTEM_SNAPSHOT.json e logs sanitizados.",
      "Regenerar bundle após correção.",
    ],
  };
}

export function buildSystemExecutiveSummaryMarkdown(input: {
  git: ReturnType<typeof collectGitSnapshot>;
  buildInfo: ReturnType<typeof resolveServerAppBuildInfo>;
  pkg: ReturnType<typeof readPackageMeta>;
  database: Awaited<ReturnType<typeof collectDatabaseSnapshot>>;
  autoDiagnostics: SystemAutoDiagnostic[];
  nomus: Record<string, unknown>;
  distExists: boolean;
  generatedAt: string;
}): string {
  const critical = input.autoDiagnostics.filter(
    (d) => d.severity === "critical" || d.severity === "error"
  );
  const warnings = input.autoDiagnostics.filter((d) => d.severity === "warning");
  const nomusConfigured = (input.nomus.syncConfigured as boolean) ?? false;

  return `# Executive Summary — SYSTEM

## 1. Ambiente geral
- **App:** ${APP_NAME}
- **Ambiente:** ${input.buildInfo.env}
- **Commit:** ${input.git.commit ?? input.buildInfo.commit ?? "—"}
- **Branch:** ${input.git.branch ?? "—"}
- **Git:** ${input.git.statusSummary}
- **Package:** ${input.pkg.version}
- **Node:** ${process.version}
- **Prisma client:** ${input.pkg.prismaClientVersion ?? "—"}
- **Build time:** ${input.buildInfo.buildTime ?? "—"}
- **dist/ existe:** ${input.distExists ? "sim" : "não"}
- **Gerado em:** ${input.generatedAt}

## 2. Banco de dados
- **Configurado:** ${input.database.databaseConfigured ? "sim" : "não"}
- **Conexão OK:** ${input.database.connectionOk ? "sim" : "não"}
- **Migrations aplicadas:** ${input.database.appliedMigrations.length}
- **Migrations pendentes:** ${input.database.pendingMigrations.length}
- **Tabelas críticas ausentes:** ${
    input.database.criticalTables.filter((t) => !t.exists).map((t) => t.table).join(", ") ||
    "nenhuma"
  }

## 3. Serviço e Nomus
- **Uptime (s):** ${Math.floor(process.uptime())}
- **Health interno:** ${input.database.connectionOk ? "ok (DB reachable)" : "degradado"}
- **Nomus sync configurado:** ${nomusConfigured ? "sim" : "não"}

## 4. Diagnósticos automáticos
- **Críticos/erro:** ${critical.length} — ${critical.map((d) => d.code).join(", ") || "—"}
- **Avisos:** ${warnings.length} — ${warnings.map((d) => d.code).join(", ") || "—"}

## 5. Maiores problemas
${critical.length > 0 ? critical.map((d) => `- **${d.code}:** ${d.message}`).join("\n") : "- Nenhum erro crítico automático."}

## 6. O que fazer primeiro
${
  critical[0]
    ? `1. Corrigir **${critical[0].code}**: ${critical[0].hypothesis ?? critical[0].message}`
    : input.database.pendingMigrations.length > 0
      ? "1. Aplicar migrations pendentes (`npx prisma migrate deploy`)."
      : "1. Anexar ZIP ao ChatGPT para análise contextual se houver sintoma específico."
}
2. Conferir \`12_LOGS_SANITIZED.log\` e \`14_WARNINGS_AND_ERRORS.json\`.
3. Regenerar bundle SYSTEM após intervenção.
`;
}

export async function buildSystemSnapshot(
  db: PrismaClient | null,
  cwd = process.cwd()
): Promise<Record<string, unknown>> {
  const git = collectGitSnapshot(cwd);
  const buildInfo = resolveServerAppBuildInfo(cwd);
  const pkg = readPackageMeta(cwd);
  const database = await collectDatabaseSnapshot(db);
  const nomus = await collectNomusSnapshot(db);
  const recentFailures = await collectRecentIntegrationFailures(db);
  const browserLeaks = scanDistForPrismaLeaks(cwd);
  const distExists = existsSync(join(cwd, "dist"));
  const envFlags = buildSafeEnvironmentFlags();

  return {
    app: {
      appName: APP_NAME,
      environment: buildInfo.env,
      commit: git.commit ?? buildInfo.commit,
      branch: git.branch,
      buildTime: buildInfo.buildTime,
      packageVersion: pkg.version,
      nodeVersion: process.version,
      prismaClientVersion: pkg.prismaClientVersion,
      prismaCliVersion: pkg.prismaCliVersion,
    },
    git,
    build: {
      distExists,
      buildInfoCommit: buildInfo.commit,
      matchesGitHead: git.commit ? buildInfo.commit === git.commit : null,
      browserPrismaLeaks: browserLeaks,
    },
    database: {
      databaseConfigured: database.databaseConfigured,
      provider: database.provider,
      connectionOk: database.connectionOk,
      appliedMigrationsCount: database.appliedMigrations.length,
      pendingMigrations: database.pendingMigrations.slice(0, 20),
      pendingCount: database.pendingMigrations.length,
      criticalTables: database.criticalTables,
    },
    service: {
      uptimeSeconds: Math.floor(process.uptime()),
      healthStatus: database.connectionOk ? "ok" : database.databaseConfigured ? "degraded" : "no_database",
      recentFailures,
    },
    nomus,
    modules: {
      productCostEngine: "buildProductCostTrace / productCostAnalysisEngine",
      pricing: "buildPublishedPriceTrace / PriceTableItem",
      salesOrders: "SalesOrder + Nomus sync sales-orders",
      commission: "commissionReceiptEngine + CommissionReceivableSchedule",
      arAp: "NomusAccountsReceivable / NomusAccountsPayable",
      cashflow: "financeExecutiveReport / cost-to-cash trace",
    },
    environmentFlags: envFlags,
    bundleMeta: {
      version: CHATGPT_DIAGNOSTIC_BUNDLE_VERSION,
      maxTotalBytes: DIAGNOSTIC_BUNDLE_MAX_TOTAL_BYTES,
    },
  };
}

export async function buildSystemDiagnosticBundleInput(
  db: PrismaClient | null,
  context: SystemDiagnosticContext = {}
): Promise<BuildDiagnosticBundleInput> {
  const cwd = process.cwd();
  const git = collectGitSnapshot(cwd);
  const buildInfo = resolveServerAppBuildInfo(cwd);
  const pkg = readPackageMeta(cwd);
  const database = await collectDatabaseSnapshot(db);
  const nomus = await collectNomusSnapshot(db);
  const recentFailures = await collectRecentIntegrationFailures(db);
  const logLines = collectRecentSanitizedLogLines(cwd);
  const browserLeaks = scanDistForPrismaLeaks(cwd);
  const distExists = existsSync(join(cwd, "dist"));
  const generatedAt = new Date().toISOString();

  const autoDiagnostics = evaluateSystemAutoDiagnostics({
    git,
    buildInfo,
    database,
    prismaVersions: pkg,
    browserLeaks,
    nomus,
    recentFailures,
    logLines,
    distExists,
  });

  const findings = autoDiagnostics.map(autoToFinding);
  const systemSnapshot = await buildSystemSnapshot(db, cwd);

  const scopeContext: DiagnosticScopeContext = {
    scope: "SYSTEM",
    screenTitle: context.screenTitle ?? "Gerar Relatório Analisável",
    screenRoute: context.screenRoute ?? SYSTEM_SCREEN_ROUTE,
    userId: context.userId ?? null,
    userEmail: context.userEmail ?? null,
    errorMessage: context.errorMessage ?? null,
    notes: context.notes ?? "Bundle SYSTEM — diagnóstico geral read-only.",
    filters: {
      generatedAt,
      commit: git.commit,
      branch: git.branch,
    },
  };

  return {
    scope: "SYSTEM",
    context: scopeContext,
    findings,
    executiveSummaryMarkdown: buildSystemExecutiveSummaryMarkdown({
      git,
      buildInfo,
      pkg,
      database,
      autoDiagnostics,
      nomus,
      distExists,
      generatedAt,
    }),
    problemContextMarkdown: `# Problem Context — SYSTEM

Relatório geral de ambiente para diagnosticar build, migrations, rotas, banco, jobs Nomus e erros recentes.

## Regras de segurança
- Sem .env bruto
- Sem tokens ou DATABASE_URL completo
- Logs sanitizados e limitados

## Notas
${context.notes ?? "—"}
`,
    systemSnapshot,
    databaseEvidence: {
      note: "Snapshot read-only — contagens e existência de tabelas, sem dados sensíveis.",
      migrations: {
        appliedCount: database.appliedMigrations.length,
        pendingCount: database.pendingMigrations.length,
        pendingSample: database.pendingMigrations.slice(0, 10),
      },
      criticalTables: database.criticalTables,
      connectionOk: database.connectionOk,
    },
    calculationTrace: {
      mode: "read-only",
      diagnosticOnly: true,
      scope: "SYSTEM",
      checks: autoDiagnostics.map((d) => d.code),
    },
    logs: logLines,
    codeReferences: SYSTEM_CODE_REFERENCES,
    rawLimitedEvidence: {
      commit: git.commit,
      branch: git.branch,
      pendingMigrations: database.pendingMigrations.length,
      diagnosticCodes: autoDiagnostics.map((d) => d.code),
      bundleSizeBudgetBytes: DIAGNOSTIC_BUNDLE_MAX_TOTAL_BYTES,
    },
    reproductionCommands: [
      {
        label: "Gerar bundle SYSTEM",
        command: "npx tsx scripts/generate-diagnostic-bundle.ts --scope=SYSTEM",
        note: "Read-only; grava em tmp/diagnostic-bundles/",
      },
      {
        label: "Validar migrations",
        command: "npx prisma migrate status",
      },
      {
        label: "Healthcheck",
        command: "curl -s http://localhost:3000/api/health",
      },
      {
        label: "Guardrails build",
        command: "npm run check:frontend-server-imports && npm run check:browser-bundle",
      },
    ],
  };
}

export async function buildAndWriteSystemDiagnosticBundle(
  db: PrismaClient | null,
  context: SystemDiagnosticContext = {}
): Promise<BuildDiagnosticBundleResult> {
  const input = await buildSystemDiagnosticBundleInput(db, context);
  return buildAndWriteDiagnosticBundle(input);
}

export { sanitizeDiagnosticText, sanitizeDiagnosticLogLines };
