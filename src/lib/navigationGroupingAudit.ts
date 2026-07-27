/**
 * Auditoria automatizada do agrupamento visual da sidebar.
 * Protege contra regressões em paths, labels, permissões e disponibilidade de menus.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildGroupedNavigationStructure,
  flattenGroupedNavigationItems,
  getModulePath,
  MODULE_MENU_PERMISSION_KEYS,
  NAVIGATION_GROUP_DEFINITIONS,
  resolveNavigationGroupIdForModule,
  type NavigationGroupId,
} from "@/src/lib/navigationGroups.js";
import {
  buildAccessibleSidebarNavigation,
  resolveActiveNavigationGroupId,
  resolveExpandedGroupsForPath,
} from "@/src/lib/sidebarNavigation.js";
import {
  canAccessModule,
  MODULE_LABELS,
  SIDEBAR_MODULE_ORDER,
  type AppModuleId,
  type PermissionChecker,
} from "@/src/lib/modulePermissions.js";

export type NavigationGroupingAuditStatus = "OK" | "ALERTA" | "BLOQUEANTE";

export type NavigationGroupingAuditFinding = {
  severity: NavigationGroupingAuditStatus;
  code: string;
  message: string;
  details?: unknown;
};

export type NavigationGroupingBaselineItem = {
  order: number;
  itemId: AppModuleId;
  label: string;
  path: string;
  groupId: NavigationGroupId;
  groupLabel: string;
  isDirect: boolean;
  requiredPermissions: readonly string[];
};

export type NavigationGroupingBaseline = {
  version: 1;
  generatedAt: string;
  description: string;
  items: NavigationGroupingBaselineItem[];
  appModuleRoutes: Record<AppModuleId, boolean>;
  permissionKeysByModule: Record<AppModuleId, readonly string[]>;
};

export type NavigationGroupingAuditResult = {
  status: NavigationGroupingAuditStatus;
  findings: NavigationGroupingAuditFinding[];
  snapshot: NavigationGroupingBaseline;
  baselinePath: string;
};

const DEFAULT_BASELINE_PATH = join(
  process.cwd(),
  "docs",
  "navigation",
  "navigation-grouping-baseline.json"
);

const FRONTEND_NAV_FILES = [
  "src/components/layout/Sidebar.tsx",
  "src/lib/navigationGroups.ts",
  "src/lib/sidebarNavigation.ts",
  "src/components/admin/PermissionEditor.tsx",
];

const PRISMA_FORBIDDEN_PATTERNS = [
  /@prisma\/client/,
  /\.prisma\/client/,
  /src\/lib\/prisma/,
  /lib\/prisma/,
  /PrismaClient/,
  /PRISMA_QUERY_LOG/,
];

function groupLabel(groupId: NavigationGroupId): string {
  return NAVIGATION_GROUP_DEFINITIONS.find((group) => group.id === groupId)?.label ?? groupId;
}

function isDirectGroup(groupId: NavigationGroupId): boolean {
  return NAVIGATION_GROUP_DEFINITIONS.find((group) => group.id === groupId)?.isDirect === true;
}

function hasAppModuleRoute(appTsx: string, moduleId: AppModuleId): boolean {
  if (moduleId === "suppliers") {
    return /path=["']finance\/suppliers["']/.test(appTsx);
  }
  if (moduleId === "portfolio-reconciliation") {
    return /path=["']finance\/portfolio-reconciliation["']/.test(appTsx);
  }
  if (moduleId === "sales-order-flow") {
    return /path=["']commercial\/sales-order-flow["']/.test(appTsx);
  }
  if (moduleId === "commercial-price-table") {
    return /path=["']commercial\/price-table["']/.test(appTsx);
  }
  const escaped = moduleId.replace(/-/g, "\\-");
  return new RegExp(`path=["']${escaped}(?:\\/\\*)?["']`).test(appTsx);
}

export function buildNavigationGroupingSnapshot(
  rootDir = process.cwd()
): NavigationGroupingBaseline {
  const structure = buildGroupedNavigationStructure();
  const flat = flattenGroupedNavigationItems(structure);
  const appTsx = readFileSync(join(rootDir, "src", "App.tsx"), "utf8");

  const items: NavigationGroupingBaselineItem[] = SIDEBAR_MODULE_ORDER.map((itemId, index) => {
    const grouped =
      flat.find((item) => item.itemId === itemId) ?? structure.directItems.find((i) => i.itemId === itemId);
    const groupId = resolveNavigationGroupIdForModule(itemId);
    return {
      order: index + 1,
      itemId,
      label: MODULE_LABELS[itemId],
      path: getModulePath(itemId),
      groupId,
      groupLabel: groupLabel(groupId),
      isDirect: isDirectGroup(groupId),
      requiredPermissions: [...MODULE_MENU_PERMISSION_KEYS[itemId]],
    };
  });

  const appModuleRoutes = Object.fromEntries(
    SIDEBAR_MODULE_ORDER.map((moduleId) => [moduleId, hasAppModuleRoute(appTsx, moduleId)])
  ) as Record<AppModuleId, boolean>;

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    description:
      "Baseline de navegação agrupada — paths, labels, grupos e permissões de menu por módulo.",
    items,
    appModuleRoutes,
    permissionKeysByModule: { ...MODULE_MENU_PERMISSION_KEYS },
  };
}

export function loadNavigationGroupingBaseline(
  baselinePath = DEFAULT_BASELINE_PATH
): NavigationGroupingBaseline {
  const raw = readFileSync(baselinePath, "utf8");
  return JSON.parse(raw) as NavigationGroupingBaseline;
}

function pushFinding(
  findings: NavigationGroupingAuditFinding[],
  severity: NavigationGroupingAuditStatus,
  code: string,
  message: string,
  details?: unknown
): void {
  findings.push({ severity, code, message, details });
}

function compareArrays(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function checker(perms: string[]): PermissionChecker {
  const set = new Set(perms);
  return {
    hasPermission: (p) => set.has(p),
    hasAnyPermission: (list) => list.some((p) => set.has(p)),
  };
}

export function runNavigationGroupingAudit(options?: {
  baselinePath?: string;
  rootDir?: string;
}): NavigationGroupingAuditResult {
  const rootDir = options?.rootDir ?? process.cwd();
  const baselinePath = options?.baselinePath ?? DEFAULT_BASELINE_PATH;
  const findings: NavigationGroupingAuditFinding[] = [];
  const snapshot = buildNavigationGroupingSnapshot(rootDir);
  const baseline = loadNavigationGroupingBaseline(baselinePath);
  const structure = buildGroupedNavigationStructure();
  const flat = flattenGroupedNavigationItems(structure);

  const snapshotById = new Map(snapshot.items.map((item) => [item.itemId, item]));
  const baselineById = new Map(baseline.items.map((item) => [item.itemId, item]));

  for (const moduleId of SIDEBAR_MODULE_ORDER) {
    const current = snapshotById.get(moduleId);
    const expected = baselineById.get(moduleId);
    if (!current) {
      pushFinding(findings, "BLOQUEANTE", "ITEM_MISSING", `Item ${moduleId} ausente no snapshot atual.`);
      continue;
    }
    if (!expected) {
      pushFinding(
        findings,
        "ALERTA",
        "BASELINE_NEW_ITEM",
        `Item ${moduleId} não existia no baseline — revisar baseline se intencional.`,
        { moduleId }
      );
      continue;
    }
    if (current.path !== expected.path) {
      pushFinding(findings, "BLOQUEANTE", "PATH_CHANGED", `Path de ${moduleId} mudou.`, {
        moduleId,
        expected: expected.path,
        actual: current.path,
      });
    }
    if (current.label !== expected.label) {
      pushFinding(findings, "BLOQUEANTE", "LABEL_CHANGED", `Label de ${moduleId} mudou.`, {
        moduleId,
        expected: expected.label,
        actual: current.label,
      });
    }
    if (current.groupId !== expected.groupId) {
      pushFinding(findings, "BLOQUEANTE", "GROUP_CHANGED", `Grupo de ${moduleId} mudou.`, {
        moduleId,
        expected: expected.groupId,
        actual: current.groupId,
      });
    }
    if (
      !compareArrays(current.requiredPermissions, expected.requiredPermissions) ||
      !compareArrays(
        MODULE_MENU_PERMISSION_KEYS[moduleId],
        baseline.permissionKeysByModule[moduleId] ?? []
      )
    ) {
      pushFinding(
        findings,
        "BLOQUEANTE",
        "PERMISSIONS_CHANGED",
        `Permissões de menu de ${moduleId} mudaram.`,
        {
          moduleId,
          expected: expected.requiredPermissions,
          actual: current.requiredPermissions,
        }
      );
    }
  }

  for (const expected of baseline.items) {
    if (!snapshotById.has(expected.itemId)) {
      pushFinding(
        findings,
        "BLOQUEANTE",
        "BASELINE_ITEM_REMOVED",
        `Item ${expected.itemId} existia no baseline e sumiu.`,
        { itemId: expected.itemId }
      );
    }
  }

  const flatIds = flat.map((item) => item.itemId);
  if (flatIds.length !== SIDEBAR_MODULE_ORDER.length) {
    pushFinding(findings, "BLOQUEANTE", "ITEM_COUNT", "Contagem de itens agrupados diverge do menu.", {
      expected: SIDEBAR_MODULE_ORDER.length,
      actual: flatIds.length,
    });
  }
  if (new Set(flatIds).size !== flatIds.length) {
    pushFinding(findings, "BLOQUEANTE", "ITEM_DUPLICATED", "Há itens duplicados na navegação agrupada.", {
      duplicates: flatIds.filter((id, i) => flatIds.indexOf(id) !== i),
    });
  }

  for (const group of structure.groups) {
    if (group.items.length === 0) {
      pushFinding(findings, "BLOQUEANTE", "EMPTY_GROUP", `Grupo vazio na sidebar: ${group.id}.`, {
        groupId: group.id,
      });
    }
  }
  if (structure.fallbackGroup && structure.fallbackGroup.items.length === 0) {
    pushFinding(findings, "BLOQUEANTE", "EMPTY_FALLBACK", "Grupo fallback Outros está vazio na estrutura.");
  }

  const dashboardDirect = structure.directItems.find((item) => item.itemId === "dashboard");
  if (!dashboardDirect) {
    pushFinding(findings, "BLOQUEANTE", "DASHBOARD_MISSING", "Dashboard não está como item direto.");
  } else if (dashboardDirect.groupId !== "dashboard") {
    pushFinding(
      findings,
      "BLOQUEANTE",
      "DASHBOARD_GROUP",
      "Dashboard não está no grupo dashboard.",
      { groupId: dashboardDirect.groupId }
    );
  }

  if (structure.unmappedItemIds.length > 0) {
    pushFinding(
      findings,
      "ALERTA",
      "UNMAPPED_ITEMS",
      "Itens sem mapeamento explícito caíram em Outros.",
      { itemIds: structure.unmappedItemIds }
    );
  }

  const fullNav = buildAccessibleSidebarNavigation({
    hasPermission: () => true,
    hasAnyPermission: () => true,
  });
  for (const moduleId of SIDEBAR_MODULE_ORDER) {
    const inFlat = fullNav.flatAccessibleItems.some((item) => item.id === moduleId);
    if (!inFlat) {
      pushFinding(
        findings,
        "BLOQUEANTE",
        "FULL_ACCESS_MISSING",
        `Item ${moduleId} não aparece nem com acesso total (regressão de agrupamento).`,
        { moduleId }
      );
    }
  }

  const restricted = buildAccessibleSidebarNavigation(checker(["dashboard.view"]));
  const restrictedIds = restricted.flatAccessibleItems.map((item) => item.id);
  if (restrictedIds.includes("products")) {
    pushFinding(
      findings,
      "BLOQUEANTE",
      "EXTRA_ACCESS",
      "Agrupamento expôs Produtos sem products.view.",
      { restrictedIds }
    );
  }
  if (!restrictedIds.includes("dashboard")) {
    pushFinding(
      findings,
      "BLOQUEANTE",
      "ACCESS_HIDDEN",
      "Dashboard sumiu para usuário com dashboard.view.",
      { restrictedIds }
    );
  }

  const activeRouteChecks: Array<[string, NavigationGroupId | null]> = [
    ["/products", "engenharia"],
    ["/finance", "financeiro"],
    ["/dashboard", null],
  ];
  for (const [pathname, expectedGroup] of activeRouteChecks) {
    const actual = resolveActiveNavigationGroupId(pathname, fullNav);
    if (actual !== expectedGroup) {
      pushFinding(
        findings,
        "BLOQUEANTE",
        "ACTIVE_ROUTE_GROUP",
        `Rota ${pathname} deveria abrir grupo ${String(expectedGroup)}, obteve ${String(actual)}.`,
        { pathname, expectedGroup, actual }
      );
    }
    const expanded = resolveExpandedGroupsForPath(pathname, fullNav);
    if (expectedGroup && !expanded.includes(expectedGroup)) {
      pushFinding(
        findings,
        "BLOQUEANTE",
        "ACTIVE_ROUTE_EXPAND",
        `Rota ${pathname} não expande grupo ${expectedGroup}.`,
        { pathname, expanded }
      );
    }
    if (!expectedGroup && expanded.length > 0) {
      pushFinding(
        findings,
        "BLOQUEANTE",
        "DASHBOARD_EXPAND",
        `Rota ${pathname} não deveria expandir grupos.`,
        { pathname, expanded }
      );
    }
  }

  for (const moduleId of SIDEBAR_MODULE_ORDER) {
    const hasRoute = snapshot.appModuleRoutes[moduleId];
    const baselineHasRoute = baseline.appModuleRoutes[moduleId];
    if (baselineHasRoute && !hasRoute) {
      pushFinding(
        findings,
        "BLOQUEANTE",
        "APP_ROUTE_REMOVED",
        `Rota App.tsx para módulo ${moduleId} desapareceu.`,
        { moduleId }
      );
    }
    if (!hasRoute) {
      pushFinding(
        findings,
        "ALERTA",
        "APP_ROUTE_MISSING",
        `App.tsx não declara path="${moduleId}" (verificar sub-rotas).`,
        { moduleId }
      );
    }
  }

  for (const relativePath of FRONTEND_NAV_FILES) {
    const content = readFileSync(join(rootDir, relativePath), "utf8");
    for (const pattern of PRISMA_FORBIDDEN_PATTERNS) {
      if (pattern.test(content)) {
        pushFinding(
          findings,
          "BLOQUEANTE",
          "PRISMA_IN_FRONTEND",
          `Padrão Prisma detectado em ${relativePath}.`,
          { file: relativePath, pattern: pattern.source }
        );
      }
    }
  }

  for (const moduleId of SIDEBAR_MODULE_ORDER) {
    if (!canAccessModule(moduleId, checker(["dashboard.view"])) && moduleId === "dashboard") {
      pushFinding(findings, "BLOQUEANTE", "CAN_ACCESS_BROKEN", "canAccessModule quebrado para dashboard.");
    }
  }

  const hasBlocker = findings.some((f) => f.severity === "BLOQUEANTE");
  const hasAlert = findings.some((f) => f.severity === "ALERTA");
  const status: NavigationGroupingAuditStatus = hasBlocker ? "BLOQUEANTE" : hasAlert ? "ALERTA" : "OK";

  if (status === "OK") {
    pushFinding(
      findings,
      "OK",
      "ALL_CHECKS_PASSED",
      "Agrupamento visual preserva paths, labels, permissões e disponibilidade de menus."
    );
  }

  return { status, findings, snapshot, baselinePath };
}

export function formatNavigationGroupingAuditReport(result: NavigationGroupingAuditResult): string {
  const lines = [
    "=== Navigation Grouping Audit ===",
    `Status: ${result.status}`,
    `Baseline: ${result.baselinePath}`,
    `Itens auditados: ${result.snapshot.items.length}`,
    "",
  ];

  const grouped = {
    BLOQUEANTE: result.findings.filter((f) => f.severity === "BLOQUEANTE"),
    ALERTA: result.findings.filter((f) => f.severity === "ALERTA"),
    OK: result.findings.filter((f) => f.severity === "OK"),
  };

  for (const severity of ["BLOQUEANTE", "ALERTA", "OK"] as const) {
    const list = grouped[severity];
    if (list.length === 0) continue;
    lines.push(`--- ${severity} (${list.length}) ---`);
    for (const finding of list) {
      lines.push(`[${finding.code}] ${finding.message}`);
      if (finding.details) {
        lines.push(`  ${JSON.stringify(finding.details)}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

export const NAVIGATION_GROUPING_BASELINE_PATH = DEFAULT_BASELINE_PATH;
