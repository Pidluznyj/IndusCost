/**
 * Motor de detecção de divergências (Prompt 03).
 */

import { ALL_PERMISSION_KEYS, PERMISSION_CATALOG } from "@/src/lib/permissionCatalog.js";
import { SIDEBAR_MODULE_ORDER } from "@/src/lib/modulePermissions.js";
import { getModulePath } from "@/src/lib/navigationGroups.js";
import {
  COMMISSIONS_LIVE_UI_TABS,
  CRM_UI_TABS,
  PRODUCT_UI_TABS,
} from "@/src/lib/moduleTabResources.js";
import { FINANCE_SECTIONS } from "@/src/lib/financeNavigation.js";
import { PORTFOLIO_RECONCILIATION_UI_TABS } from "@/src/lib/permissionsClient.js";
import {
  PERMISSION_RESOURCE_SEEDS,
  listPermissionResourceKeys,
} from "@/src/lib/permissionResourceSeedData.js";
import {
  PERMISSION_CONTRACT_RESOURCES,
  validatePermissionContract,
} from "@/src/lib/security/permissionContract/index.js";
import { isKnownGap } from "./knownGaps.ts";
import { buildUsageIndex, type UsageIndex } from "./scanAst.ts";
import type {
  PermissionAuditFinding,
  PermissionAuditMode,
  PermissionAuditReport,
  PermissionAuditSummary,
} from "./types.ts";

/** Evita importar componentes React no motor de auditoria. */
const INVENTORY_NAV_TAB_IDS = [
  "overview",
  "items",
  "warehouses",
  "balances",
  "movements",
  "counts",
  "reservations",
  "audit",
] as const;

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const PUBLIC_API_PREFIXES = [
  "/api/auth",
  "/api/health",
  "/api/public/",
  "/api/bootstrap",
];

function isPublicApi(pathPattern: string): boolean {
  return PUBLIC_API_PREFIXES.some((p) => pathPattern === p || pathPattern.startsWith(p));
}

function markKnown(findings: PermissionAuditFinding[]): void {
  for (const f of findings) {
    if (isKnownGap(f.code, f.subject)) f.knownGap = true;
  }
}

function summarize(
  mode: PermissionAuditMode,
  findings: PermissionAuditFinding[],
  usage: UsageIndex,
  unusedCatalogKeys: string[],
  phantomKeys: string[]
): PermissionAuditSummary {
  const findingCounts = { error: 0, warn: 0, info: 0 };
  let knownGapCount = 0;
  let actionableErrorCount = 0;
  for (const f of findings) {
    findingCounts[f.severity] += 1;
    if (f.knownGap) knownGapCount += 1;
    if (f.severity === "error" && !f.knownGap) actionableErrorCount += 1;
  }

  const ok =
    mode === "report"
      ? true
      : actionableErrorCount === 0;

  return {
    mode,
    catalogKeyCount: PERMISSION_CATALOG.length,
    contractResourceCount: PERMISSION_CONTRACT_RESOURCES.length,
    relationalSeedCount: PERMISSION_RESOURCE_SEEDS.length,
    frontendUsageCount: usage.frontend.size,
    backendUsageCount: usage.backend.size,
    routeScanCount: usage.routes.length,
    findingCounts,
    knownGapCount,
    actionableErrorCount,
    ok,
  };
}

/** Executa auditoria completa a partir do cwd. */
export function runPermissionAudit(options?: {
  root?: string;
  mode?: PermissionAuditMode;
  usage?: UsageIndex;
}): PermissionAuditReport {
  const root = options?.root ?? process.cwd();
  const mode = options?.mode ?? "report";
  const usage = options?.usage ?? buildUsageIndex(root);
  const findings: PermissionAuditFinding[] = [];
  const catalogSet = new Set(ALL_PERMISSION_KEYS);
  const seedKeys = new Set(listPermissionResourceKeys());
  const limitations: string[] = [];

  // 1) Contrato estrutural
  for (const issue of validatePermissionContract()) {
    findings.push({
      code: "CONTRACT_ISSUE",
      severity: "error",
      message: issue.message,
      subject: issue.resourceKey,
    });
  }

  // 2) Usado e não cadastrado (legado)
  const usedKeys = new Set<string>([
    ...usage.frontend.keys(),
    ...usage.backend.keys(),
  ]);
  const phantomKeys: string[] = [];
  for (const key of usedKeys) {
    if (!catalogSet.has(key)) {
      // pode ser resource key PT escaneada por engano em hasPermission — filtrar
      if (seedKeys.has(key) || key === "configuracoes") {
        findings.push({
          code: "FE_BE_GUARD_STYLE_MISMATCH",
          severity: "warn",
          message: `Chave usada como legado mas parece resourceKey relacional: ${key}`,
          subject: key,
        });
        continue;
      }
      phantomKeys.push(key);
      findings.push({
        code: "USED_NOT_IN_CATALOG",
        severity: "error",
        message: `Permissão usada e não cadastrada no PERMISSION_CATALOG: ${key}`,
        subject: key,
        evidence: [
          ...(usage.frontend.get(key) ?? []).slice(0, 3).map((h) => `${h.file}:${h.line}`),
          ...(usage.backend.get(key) ?? []).slice(0, 3).map((h) => `${h.file}:${h.line}`),
        ],
      });
    }
  }

  // 3) Cadastrada e nunca usada
  const unusedCatalogKeys: string[] = [];
  for (const key of ALL_PERMISSION_KEYS) {
    if (!usedKeys.has(key)) {
      unusedCatalogKeys.push(key);
      findings.push({
        code: "CATALOG_NEVER_USED",
        severity: "info",
        message: `Chave no catálogo sem uso literal detectado: ${key}`,
        subject: key,
      });
    }
  }

  // 4) Aliases do contrato
  const aliasOwners = new Map<string, string[]>();
  for (const r of PERMISSION_CONTRACT_RESOURCES) {
    for (const a of r.actions) {
      for (const legacy of a.legacyPermissionKeys) {
        if (!catalogSet.has(legacy)) {
          findings.push({
            code: "ALIAS_MISSING_FROM_CATALOG",
            severity: "error",
            message: `Alias legado inexistente: ${legacy} (${r.resourceKey}.${a.action})`,
            subject: legacy,
          });
        }
        const owners = aliasOwners.get(legacy) ?? [];
        owners.push(`${r.resourceKey}:${a.action}`);
        aliasOwners.set(legacy, owners);
      }
    }
    for (const rel of r.relationalResourceKeys) {
      if (!seedKeys.has(rel)) {
        findings.push({
          code: "ALIAS_MISSING_FROM_CATALOG",
          severity: "error",
          message: `relationalResourceKey ausente do seed: ${rel}`,
          subject: rel,
        });
      }
    }
  }

  // 5) Sidebar modules → contract
  const contractModuleIds = new Set(
    PERMISSION_CONTRACT_RESOURCES.filter((r) => r.moduleId).map((r) => r.moduleId)
  );
  for (const moduleId of SIDEBAR_MODULE_ORDER) {
    if (!contractModuleIds.has(moduleId)) {
      findings.push({
        code: "SIDEBAR_WITHOUT_CONTRACT",
        severity: "error",
        message: `Módulo sidebar sem recurso canônico (moduleId): ${moduleId}`,
        subject: moduleId,
        evidence: [getModulePath(moduleId)],
      });
    }
  }

  // 6) Abas UI conhecidas → contract relational ou canônico
  const contractRelational = new Set(
    PERMISSION_CONTRACT_RESOURCES.flatMap((r) => [...r.relationalResourceKeys, r.resourceKey])
  );
  const tabChecks: { id: string; resourceKey?: string; label: string }[] = [
    ...CRM_UI_TABS.map((t) => ({ id: `crm.${t.id}`, resourceKey: t.resourceKey, label: t.label })),
    ...COMMISSIONS_LIVE_UI_TABS.map((t) => ({
      id: `commissions.${t.id}`,
      resourceKey: t.resourceKey,
      label: t.label,
    })),
    ...FINANCE_SECTIONS.map((s) => ({
      id: `finance.${s.id}`,
      resourceKey: undefined,
      label: s.label,
    })),
    ...PORTFOLIO_RECONCILIATION_UI_TABS.map((t) => ({
      id: `portfolio.${t.id}`,
      resourceKey: t.resourceKey,
      label: t.label,
    })),
    ...PRODUCT_UI_TABS.map((t) => ({
      id: `products.${t.id}`,
      resourceKey: t.resourceKey,
      label: t.label,
    })),
  ];

  for (const tabId of INVENTORY_NAV_TAB_IDS) {
    const canonical = `operations.inventory.${tabId}`;
    const hasContract = PERMISSION_CONTRACT_RESOURCES.some(
      (r) =>
        r.resourceKey === canonical ||
        r.resourceKey === `operations.inventory` ||
        (tabId !== "overview" &&
          tabId !== "balances" &&
          tabId !== "reservations" &&
          tabId !== "audit" &&
          r.resourceKey.endsWith(`.${tabId}`))
    );
    // overview/balances/reservations/audit: expect warn if missing dedicated leaf
    const hasDedicated = PERMISSION_CONTRACT_RESOURCES.some(
      (r) => r.resourceKey === canonical
    );
    if (!hasDedicated && ["overview", "balances", "reservations", "audit"].includes(tabId)) {
      findings.push({
        code: "TAB_WITHOUT_CONTRACT",
        severity: "warn",
        message: `Aba de estoque sem recurso canônico dedicado: ${tabId}`,
        subject: canonical,
      });
    } else if (!hasContract) {
      findings.push({
        code: "TAB_WITHOUT_CONTRACT",
        severity: "warn",
        message: `Aba de estoque sem recurso canônico: ${tabId}`,
        subject: canonical,
      });
    }
  }

  for (const tab of tabChecks) {
    if (tab.resourceKey) {
      if (!contractRelational.has(tab.resourceKey) && !seedKeys.has(tab.resourceKey)) {
        findings.push({
          code: "TAB_WITHOUT_CONTRACT",
          severity: "warn",
          message: `Aba sem ponte contrato/seed: ${tab.label}`,
          subject: tab.resourceKey,
        });
      }
    } else if (tab.id.startsWith("finance.")) {
      const section = tab.id.replace("finance.", "").replace(/-/g, "_");
      const expected = `finance.${section}`;
      const hit = PERMISSION_CONTRACT_RESOURCES.some(
        (r) => r.resourceKey === expected || r.resourceKey.includes(section)
      );
      if (!hit) {
        findings.push({
          code: "TAB_WITHOUT_CONTRACT",
          severity: "warn",
          message: `Seção financeira sem recurso canônico óbvio: ${tab.label}`,
          subject: expected,
        });
      }
    }
  }

  // 7) Rotas de mutação
  for (const route of usage.routes) {
    if (!route.pathPattern.startsWith("/api")) continue;
    if (isPublicApi(route.pathPattern)) continue;
    const subject = `${route.method} ${route.pathPattern}`;
    const hasPermGuard =
      route.permissionKeys.length > 0 ||
      route.resourceKeys.length > 0 ||
      route.guardCallees.some((g) =>
        [
          "requirePermission",
          "requireAnyPermission",
          "requireAllPermissions",
          "requireBootstrapOrAnyPermission",
          "requireResourcePermission",
          "requireBootstrapOrPermission",
          "requireUserAdminOrBootstrap",
          "requireBootstrapForGlobalParamMutation",
        ].includes(g) ||
        (/Guard|Permission|authorize|canFleet|Ops|Middleware/i.test(g) &&
          g !== "requireAppAuth") ||
        g.includes(".") // ...g.checklistOps
      );
    const authOnly =
      route.guardCallees.length > 0 &&
      route.guardCallees.every((g) => g === "requireAppAuth" || g === "requireBootstrapAdmin") &&
      !hasPermGuard;

    if (MUTATION_METHODS.has(route.method)) {
      if (!hasPermGuard && route.guardCallees.length === 0) {
        findings.push({
          code: "MUTATION_WITHOUT_PERMISSION_GUARD",
          severity: "error",
          message: `Mutação sem guard detectado: ${subject}`,
          subject,
          evidence: [`${route.file}:${route.line}`],
        });
      } else if (authOnly || (!hasPermGuard && route.guardCallees.includes("requireAppAuth"))) {
        findings.push({
          code: "MUTATION_AUTH_ONLY",
          severity: "warn",
          message: `Mutação só com auth (sem permissão/resource no middleware): ${subject}`,
          subject,
          evidence: [`${route.file}:${route.line}`, ...route.guardCallees],
        });
      }
    } else if (route.method === "GET" && route.guardCallees.length === 0) {
      // GET sem guard — só flaguear se test-db etc.
      if (route.pathPattern.includes("test-db")) {
        findings.push({
          code: "MUTATION_WITHOUT_PERMISSION_GUARD",
          severity: "error",
          message: `Endpoint sensível sem guard: ${subject}`,
          subject,
          evidence: [`${route.file}:${route.line}`],
        });
      }
    }
  }

  // 8) Contract action unused (legacy never in scan)
  for (const r of PERMISSION_CONTRACT_RESOURCES) {
    for (const a of r.actions) {
      const anyUsed = a.legacyPermissionKeys.some((k) => usedKeys.has(k));
      if (!anyUsed) {
        findings.push({
          code: "CONTRACT_ACTION_UNUSED",
          severity: "info",
          message: `Ação do contrato sem uso literal das legacy keys: ${r.resourceKey}.${a.action}`,
          subject: `${r.resourceKey}.${a.action}`,
          evidence: [...a.legacyPermissionKeys],
        });
      }
    }
  }

  // 9) FE/BE mismatch sample: settings.view used for sync on BE
  const syncEvidence = (usage.backend.get("settings.nomus.sync") ?? []).length;
  const settingsViewBe = (usage.backend.get("settings.view") ?? []).length;
  if (syncEvidence > 0 && settingsViewBe > 0) {
    findings.push({
      code: "FE_BE_GUARD_STYLE_MISMATCH",
      severity: "warn",
      message:
        "Backend referencia settings.nomus.sync e settings.view (possível OR largo em sync).",
      subject: "settings.view|settings.nomus.sync",
    });
  }

  // 10) Resource keys used but not in seed (configuracoes)
  for (const key of usage.resourceKeysUsed.keys()) {
    if (!seedKeys.has(key) && key === "configuracoes") {
      findings.push({
        code: "FE_BE_GUARD_STYLE_MISMATCH",
        severity: "warn",
        message: "Frontend usa resourceKey configuracoes; seed oficial usa admin.",
        subject: "configuracoes",
        evidence: (usage.resourceKeysUsed.get(key) ?? [])
          .slice(0, 5)
          .map((h) => `${h.file}:${h.line}`),
      });
    }
  }

  limitations.push(
    "Scan AST não resolve spreads de constantes importadas de outros arquivos.",
    "Guards fleet/custom (createFleetRouteGuards) e checks inline em handlers não contam como permissionKeys.",
    "Botões sensíveis sem hasPermission exigem heurística UI — não classificados como erro automático nesta versão.",
    "Rotas registradas via wrappers (registerXRoutes) são cobertas se o arquivo *Routes.ts usa app/router.METHOD.",
    "CATALOG_NEVER_USED ignora uso indireto via arrays tipados sem literal no call site."
  );

  markKnown(findings);

  const summary = summarize(mode, findings, usage, unusedCatalogKeys, phantomKeys);

  return {
    generatedAt: new Date().toISOString(),
    summary,
    findings,
    unusedCatalogKeys,
    phantomKeys,
    limitations,
  };
}

export function formatPermissionAuditMarkdown(report: PermissionAuditReport): string {
  const lines: string[] = [];
  lines.push("# Relatório — validador automático de permissões");
  lines.push("");
  lines.push("| | |");
  lines.push("|---|---|");
  lines.push(`| Gerado em | ${report.generatedAt} |`);
  lines.push(`| Modo | ${report.summary.mode} |`);
  lines.push(`| OK (modo) | ${report.summary.ok ? "sim" : "não"} |`);
  lines.push(`| Catálogo | ${report.summary.catalogKeyCount} |`);
  lines.push(`| Contrato | ${report.summary.contractResourceCount} |`);
  lines.push(`| Seed relacional | ${report.summary.relationalSeedCount} |`);
  lines.push(`| Uso FE (chaves) | ${report.summary.frontendUsageCount} |`);
  lines.push(`| Uso BE (chaves) | ${report.summary.backendUsageCount} |`);
  lines.push(`| Rotas escaneadas | ${report.summary.routeScanCount} |`);
  lines.push(
    `| Findings | error ${report.summary.findingCounts.error} · warn ${report.summary.findingCounts.warn} · info ${report.summary.findingCounts.info} |`
  );
  lines.push(`| Known gaps | ${report.summary.knownGapCount} |`);
  lines.push(`| Erros acionáveis | ${report.summary.actionableErrorCount} |`);
  lines.push("");

  lines.push("## Limitações");
  for (const l of report.limitations) lines.push(`- ${l}`);
  lines.push("");

  lines.push("## Fantasmas (usado ∉ catálogo)");
  if (report.phantomKeys.length === 0) lines.push("_Nenhum._");
  else for (const k of report.phantomKeys.slice(0, 50)) lines.push(`- \`${k}\``);
  if (report.phantomKeys.length > 50) {
    lines.push(`- … +${report.phantomKeys.length - 50} omitidos`);
  }
  lines.push("");

  lines.push("## Findings (agrupados)");
  const byCode = new Map<string, typeof report.findings>();
  for (const f of report.findings) {
    const arr = byCode.get(f.code) ?? [];
    arr.push(f);
    byCode.set(f.code, arr);
  }
  for (const [code, list] of [...byCode.entries()].sort()) {
    lines.push(`### ${code} (${list.length})`);
    const sample = list.slice(0, 25);
    for (const f of sample) {
      const gap = f.knownGap ? " _(known)_" : "";
      lines.push(`- **${f.severity}**${gap}: ${f.message}`);
    }
    if (list.length > 25) lines.push(`- … +${list.length - 25} omitidos`);
    lines.push("");
  }

  lines.push("## Catálogo sem uso literal (amostra)");
  for (const k of report.unusedCatalogKeys.slice(0, 40)) lines.push(`- \`${k}\``);
  if (report.unusedCatalogKeys.length > 40) {
    lines.push(`- … +${report.unusedCatalogKeys.length - 40}`);
  }
  lines.push("");
  lines.push("_Sem dados sensíveis (sem emails, tokens ou conteúdo de produção)._");
  lines.push("");
  return lines.join("\n");
}
