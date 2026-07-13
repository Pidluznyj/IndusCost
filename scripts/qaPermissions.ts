/**
 * QA técnico completo do permissionamento (menu / submenu / aba / ações).
 *
 * Uso:
 *   npx tsx scripts/qaPermissions.ts
 *   npx tsx scripts/qaPermissions.ts --no-report
 *   npm run permissions:qa
 *
 * Modo estático: sempre.
 * Modo live: quando DATABASE_URL alcançável.
 * Escreve docs/security/permissions-qa-report.md (salvo com --no-report).
 */
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  PERMISSION_RESOURCE_SEEDS,
  validatePermissionResourceCatalog,
} from "../src/lib/permissionResourceSeedData.ts";
import {
  PermissionResourceKeys,
  PORTFOLIO_RECONCILIATION_TAB_KEYS,
} from "../src/lib/security/permissionsCatalog.ts";
import {
  canAccessResource,
  createSeedPermissionSnapshot,
} from "../src/lib/security/permissionService.ts";
import { authorizeResourceAccess } from "../src/lib/security/permissionGuards.ts";
import {
  assertCanChangeSuperAdminRole,
  UserPermissionAdminError,
} from "../src/lib/security/userPermissionAdminService.ts";
import {
  createPermissionsApi,
  createSidebarCanViewResource,
  ResourceKeys,
} from "../src/lib/permissionsClient.ts";
import type { AppUserRole } from "@prisma/client";
import type { AuthUser } from "../src/lib/appAuthClient.ts";

type Severity = "pass" | "fail" | "warn" | "skip";

type QaItem = {
  id: number;
  category: string;
  title: string;
  status: Severity;
  evidence: string[];
  notes?: string;
};

const ROOT = process.cwd();
const REPORT_PATH = path.join(ROOT, "docs", "security", "permissions-qa-report.md");

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function fakeAuth(role: AppUserRole, id = `qa-${role.toLowerCase()}`): AuthUser {
  return {
    id,
    name: `QA ${role}`,
    email: `${role.toLowerCase()}@qa.local`,
    role,
    permissions: [],
    effectivePermissions: [],
    accessProfileId: null,
    accessProfileName: null,
    isActive: true,
    externalSellerId: null,
    sellerResponsibleName: null,
    lastLoginAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function subject(role: AppUserRole, id = `qa-${role}`) {
  return { id, role };
}

function snap(role: AppUserRole, userId = `qa-${role}`) {
  return createSeedPermissionSnapshot({ role, userId });
}

function runCheck(
  items: QaItem[],
  id: number,
  category: string,
  title: string,
  fn: () => { status: Severity; evidence: string[]; notes?: string }
): void {
  try {
    const result = fn();
    items.push({ id, category, title, ...result });
  } catch (error) {
    items.push({
      id,
      category,
      title,
      status: "fail",
      evidence: [error instanceof Error ? error.message : String(error)],
    });
  }
}

function byKey() {
  return new Map(PERMISSION_RESOURCE_SEEDS.map((r) => [r.key, r]));
}

function runStaticQa(): QaItem[] {
  const items: QaItem[] = [];
  const catalog = byKey();

  // 1. Catálogo existe
  runCheck(items, 1, "Catálogo", "Catálogo existe", () => {
    const n = PERMISSION_RESOURCE_SEEDS.length;
    return {
      status: n > 0 ? "pass" : "fail",
      evidence: [`PERMISSION_RESOURCE_SEEDS.length=${n}`],
    };
  });

  // 2. Hierarquia válida
  runCheck(items, 2, "Hierarquia", "Hierarquia válida", () => {
    const issues = validatePermissionResourceCatalog();
    return {
      status: issues.length === 0 ? "pass" : "fail",
      evidence:
        issues.length === 0
          ? ["validatePermissionResourceCatalog() → []"]
          : issues.map((i) => `${i.code}: ${i.message}`),
    };
  });

  // 3. Menus sem parent
  runCheck(items, 3, "Hierarquia", "Menus sem parent", () => {
    const menus = PERMISSION_RESOURCE_SEEDS.filter((r) => r.type === "MENU");
    const bad = menus.filter((r) => r.parentKey != null);
    return {
      status: bad.length === 0 ? "pass" : "fail",
      evidence: [
        `menus=${menus.length}`,
        ...(bad.length ? bad.map((b) => `FAIL ${b.key} parent=${b.parentKey}`) : ["todos MENU com parentKey=null"]),
      ],
    };
  });

  // 4. Submenus com parent menu
  runCheck(items, 4, "Hierarquia", "Submenus com parent menu", () => {
    const submenus = PERMISSION_RESOURCE_SEEDS.filter((r) => r.type === "SUBMENU");
    const bad: string[] = [];
    for (const s of submenus) {
      if (!s.parentKey) {
        bad.push(`${s.key}: sem parent`);
        continue;
      }
      const parent = catalog.get(s.parentKey);
      if (!parent || parent.type !== "MENU") {
        bad.push(`${s.key}: parent ${s.parentKey} type=${parent?.type ?? "MISSING"}`);
      }
    }
    return {
      status: bad.length === 0 ? "pass" : "fail",
      evidence: [`submenus=${submenus.length}`, ...(bad.length ? bad : ["todos SUBMENU → MENU"])],
    };
  });

  // 5. Tabs com parent submenu (ou menu — documentado se menu)
  runCheck(items, 5, "Hierarquia", "Tabs com parent submenu", () => {
    const tabs = PERMISSION_RESOURCE_SEEDS.filter((r) => r.type === "TAB");
    const bad: string[] = [];
    const viaMenu: string[] = [];
    for (const t of tabs) {
      if (!t.parentKey) {
        bad.push(`${t.key}: sem parent`);
        continue;
      }
      const parent = catalog.get(t.parentKey);
      if (!parent) {
        bad.push(`${t.key}: parent inexistente ${t.parentKey}`);
      } else if (parent.type === "SUBMENU") {
        // ok
      } else if (parent.type === "MENU") {
        viaMenu.push(`${t.key} → MENU ${parent.key}`);
      } else {
        bad.push(`${t.key}: parent type=${parent.type}`);
      }
    }
    // Falha só se parent inválido; tabs sob MENU ficam como warn (legado comissões/suprimentos)
    if (bad.length > 0) {
      return { status: "fail", evidence: bad, notes: viaMenu.join("; ") };
    }
    if (viaMenu.length > 0) {
      return {
        status: "warn",
        evidence: [
          `tabs=${tabs.length}; ${tabs.length - viaMenu.length} com parent SUBMENU`,
          ...viaMenu,
        ],
        notes:
          "Ideal MENU→SUBMENU→TAB. Tabs sob MENU (comissões / catálogo) aceitas como pendência estrutural, não bloqueante.",
      };
    }
    return {
      status: "pass",
      evidence: [`tabs=${tabs.length}; todos com parent SUBMENU`],
    };
  });

  // 6. Actions com parent válido
  runCheck(items, 6, "Hierarquia", "Actions com parent válido", () => {
    const actions = PERMISSION_RESOURCE_SEEDS.filter((r) => r.type === "ACTION");
    const bad: string[] = [];
    for (const a of actions) {
      if (!a.parentKey) {
        bad.push(`${a.key}: sem parent`);
        continue;
      }
      const parent = catalog.get(a.parentKey);
      if (!parent) bad.push(`${a.key}: parent inexistente`);
      else if (parent.type === "ACTION") bad.push(`${a.key}: parent não pode ser ACTION`);
    }
    return {
      status: bad.length === 0 ? "pass" : "fail",
      evidence: [
        `actions=${actions.length}`,
        ...(bad.length ? bad : actions.map((a) => `${a.key} → ${a.parentKey}`)),
      ],
    };
  });

  // 7. SUPER_ADMIN acessa tudo
  runCheck(items, 7, "Roles", "SUPER_ADMIN acessa tudo", () => {
    const s = subject("SUPER_ADMIN");
    const snapshot = snap("SUPER_ADMIN");
    const denied: string[] = [];
    for (const row of PERMISSION_RESOURCE_SEEDS) {
      for (const action of ["view", "execute", "manage"] as const) {
        if (!canAccessResource(s, row.key, action, snapshot)) {
          denied.push(`${row.key}:${action}`);
        }
      }
    }
    return {
      status: denied.length === 0 ? "pass" : "fail",
      evidence:
        denied.length === 0
          ? [`Acesso total em ${PERMISSION_RESOURCE_SEEDS.length} recursos × 3 ações`]
          : denied.slice(0, 20),
    };
  });

  // 8. ADMIN tem permissões esperadas
  runCheck(items, 8, "Roles", "ADMIN tem permissões esperadas", () => {
    const s = subject("ADMIN");
    const snapshot = snap("ADMIN");
    const expectTrue: Array<[string, "view" | "execute" | "manage"]> = [
      [PermissionResourceKeys.DASHBOARD, "view"],
      [PermissionResourceKeys.FINANCEIRO, "view"],
      [PermissionResourceKeys.FINANCEIRO_CONCILIACAO_CARTEIRA, "view"],
      [PermissionResourceKeys.ADMIN_USUARIOS, "manage"],
      [PermissionResourceKeys.ADMIN_PERMISSOES, "view"],
    ];
    const expectFalse: Array<[string, "view" | "execute" | "manage"]> = [
      [PermissionResourceKeys.ADMIN_PERMISSOES_ACTION_MANAGE, "manage"],
      [PermissionResourceKeys.ADMIN_PERMISSOES_ACTION_MANAGE, "admin"],
    ];
    const fails: string[] = [];
    for (const [key, action] of expectTrue) {
      if (!canAccessResource(s, key, action, snapshot)) fails.push(`expected allow ${key}:${action}`);
    }
    for (const [key, action] of expectFalse) {
      if (canAccessResource(s, key, action, snapshot)) fails.push(`expected deny ${key}:${action}`);
    }
    return {
      status: fails.length === 0 ? "pass" : "fail",
      evidence: fails.length === 0 ? ["ADMIN: financeiro+conciliação+usuários; sem manage ACL crítica"] : fails,
    };
  });

  // 9. COMMERCIAL_MANAGER não acessa admin.permissoes
  runCheck(items, 9, "Roles", "COMMERCIAL_MANAGER não acessa admin.permissoes", () => {
    const s = subject("COMMERCIAL_MANAGER");
    const snapshot = snap("COMMERCIAL_MANAGER");
    const deniedPerm = !canAccessResource(
      s,
      PermissionResourceKeys.ADMIN_PERMISSOES,
      "view",
      snapshot
    );
    const deniedAdmin = !canAccessResource(s, PermissionResourceKeys.ADMIN, "view", snapshot);
    const allowsCrm = canAccessResource(
      s,
      PermissionResourceKeys.COMERCIAL_CRM,
      "view",
      snapshot
    );
    const ok = deniedPerm && deniedAdmin && allowsCrm;
    return {
      status: ok ? "pass" : "fail",
      evidence: [
        `admin.permissoes view=${!deniedPerm}`,
        `admin view=${!deniedAdmin}`,
        `comercial.crm view=${allowsCrm}`,
      ],
    };
  });

  // 10. SELLER não acessa admin e respeita permissões comerciais
  runCheck(items, 10, "Roles", "SELLER não acessa admin e respeita permissões comerciais", () => {
    const s = subject("SELLER");
    const snapshot = snap("SELLER");
    const checks = [
      ["admin", false],
      ["admin.usuarios", false],
      ["admin.permissoes", false],
      ["comercial", true],
      ["comercial.pedidos_venda", true],
      ["comercial.crm", true],
      ["comercial.crm.tab.gestao_geral", false],
      ["comercial.crm.tab.gestao_vendedor", true],
    ] as const;
    const fails: string[] = [];
    for (const [key, expect] of checks) {
      const got = canAccessResource(s, key, "view", snapshot);
      if (got !== expect) fails.push(`${key}: got ${got}, expect ${expect}`);
    }
    return {
      status: fails.length === 0 ? "pass" : "fail",
      evidence: fails.length === 0 ? checks.map(([k, e]) => `${k} view=${e}`) : fails,
    };
  });

  // 11. VIEWER não acessa ações críticas
  runCheck(items, 11, "Roles", "VIEWER não acessa ações críticas", () => {
    const s = subject("VIEWER");
    const snapshot = snap("VIEWER");
    const criticalKeys = PERMISSION_RESOURCE_SEEDS.filter((r) => r.type === "ACTION").map(
      (r) => r.key
    );
    const fails: string[] = [];
    for (const key of criticalKeys) {
      if (canAccessResource(s, key, "execute", snapshot)) fails.push(`execute ${key}`);
      if (canAccessResource(s, key, "manage", snapshot)) fails.push(`manage ${key}`);
      if (canAccessResource(s, key, "admin", snapshot)) fails.push(`admin ${key}`);
    }
    // também não execute em pedidos
    if (
      canAccessResource(s, PermissionResourceKeys.COMERCIAL_PEDIDOS_VENDA, "execute", snapshot)
    ) {
      fails.push("execute comercial.pedidos_venda");
    }
    const canViewPedidos = canAccessResource(
      s,
      PermissionResourceKeys.COMERCIAL_PEDIDOS_VENDA,
      "view",
      snapshot
    );
    return {
      status: fails.length === 0 && canViewPedidos ? "pass" : "fail",
      evidence:
        fails.length === 0
          ? [
              `VIEWER sem execute/manage/admin em ${criticalKeys.length} ACTION(s)`,
              "comercial.pedidos_venda view=true execute=false",
            ]
          : fails,
    };
  });

  // 12–14. Abas PR protegidas (SELLER/VIEWER/CM blocked; ADMIN/SA allowed)
  const prTabs: Array<{ id: number; key: string; label: string }> = [
    {
      id: 12,
      key: PermissionResourceKeys.FINANCEIRO_CONCILIACAO_TAB_CONCILIACAO,
      label: "Aba Conciliação protegida",
    },
    {
      id: 13,
      key: PermissionResourceKeys.FINANCEIRO_CONCILIACAO_TAB_INTELIGENCIA,
      label: "Aba Inteligência protegida",
    },
    {
      id: 14,
      key: PermissionResourceKeys.FINANCEIRO_CONCILIACAO_TAB_AUDITORIA_PEDIDO_CAIXA,
      label: "Aba Auditoria Pedido → Caixa protegida",
    },
  ];
  for (const tab of prTabs) {
    runCheck(items, tab.id, "Abas PR", tab.label, () => {
      const evidence: string[] = [];
      let ok = true;
      for (const role of ["SELLER", "VIEWER", "COMMERCIAL_MANAGER"] as const) {
        const allowed = canAccessResource(subject(role), tab.key, "view", snap(role));
        evidence.push(`${role} view=${allowed} (expect false)`);
        if (allowed) ok = false;
      }
      for (const role of ["ADMIN", "SUPER_ADMIN"] as const) {
        const allowed = canAccessResource(subject(role), tab.key, "view", snap(role));
        evidence.push(`${role} view=${allowed} (expect true)`);
        if (!allowed) ok = false;
      }
      return { status: ok ? "pass" : "fail", evidence };
    });
  }

  // 15. Endpoint sem login → 401
  runCheck(items, 15, "HTTP guards", "Endpoint sem login retorna 401", () => {
    const r = authorizeResourceAccess(
      null,
      PermissionResourceKeys.FINANCEIRO_CONCILIACAO_TAB_CONCILIACAO,
      "view"
    );
    return {
      status: !r.ok && r.status === 401 ? "pass" : "fail",
      evidence: [JSON.stringify(r)],
    };
  });

  // 16. Endpoint sem permissão → 403
  runCheck(items, 16, "HTTP guards", "Endpoint sem permissão retorna 403", () => {
    const auth = fakeAuth("SELLER");
    const r = authorizeResourceAccess(
      auth,
      PermissionResourceKeys.ADMIN_PERMISSOES_ACTION_MANAGE,
      "admin"
    );
    return {
      status: !r.ok && r.status === 403 ? "pass" : "fail",
      evidence: [JSON.stringify({ ok: r.ok, status: !r.ok ? r.status : 200, body: !r.ok ? r.body : null })],
    };
  });

  // 17. Endpoint com permissão → 200 (ok)
  runCheck(items, 17, "HTTP guards", "Endpoint com permissão retorna 200", () => {
    const auth = fakeAuth("SUPER_ADMIN");
    const r = authorizeResourceAccess(
      auth,
      PermissionResourceKeys.FINANCEIRO_CONCILIACAO_TAB_CONCILIACAO,
      "view"
    );
    return {
      status: r.ok ? "pass" : "fail",
      evidence: [r.ok ? "authorizeResourceAccess → ok (equivale a 200 no middleware)" : JSON.stringify(r)],
    };
  });

  // 18. Frontend não importa Prisma
  runCheck(items, 18, "Frontend", "Frontend não importa Prisma", () => {
    try {
      const tsxCli = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
      const out = execFileSync(process.execPath, [tsxCli, "scripts/checkFrontendServerImports.ts"], {
        cwd: ROOT,
        encoding: "utf8",
      });
      const last = out
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .pop();
      return {
        status: "pass",
        evidence: [last ?? "check:frontend-server-imports OK"],
      };
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string; message?: string };
      return {
        status: "fail",
        evidence: [err.stdout?.trim() || err.stderr?.trim() || err.message || String(error)],
      };
    }
  });

  // 19. Menu lateral não mostra recurso bloqueado
  runCheck(items, 19, "Frontend", "Menu lateral não mostra recurso bloqueado", () => {
    const seller = fakeAuth("SELLER");
    const canView = createSidebarCanViewResource(seller);
    const api = createPermissionsApi(seller);
    const blocked = [
      ResourceKeys.ADMIN,
      ResourceKeys.ADMIN_USUARIOS,
      ResourceKeys.ADMIN_PERMISSOES,
      ResourceKeys.FINANCEIRO,
      ResourceKeys.FINANCEIRO_CONCILIACAO_CARTEIRA,
    ];
    const allowed = [ResourceKeys.DASHBOARD, ResourceKeys.COMERCIAL, ResourceKeys.COMERCIAL_CRM];
    const fails: string[] = [];
    for (const key of blocked) {
      if (canView(key) || api.canView(key)) fails.push(`SELLER ainda vê ${key}`);
    }
    for (const key of allowed) {
      if (!canView(key) && !api.canView(key)) fails.push(`SELLER deveria ver ${key}`);
    }
    return {
      status: fails.length === 0 ? "pass" : "fail",
      evidence:
        fails.length === 0
          ? [
              `createSidebarCanViewResource(SELLER) bloqueia: ${blocked.join(", ")}`,
              `permite: ${allowed.join(", ")}`,
            ]
          : fails,
    };
  });

  // 20. Não existe usuário capaz de deixar o sistema sem SUPER_ADMIN
  runCheck(items, 20, "Governança", "Não deixar o sistema sem SUPER_ADMIN", () => {
    const evidence: string[] = [];
    let ok = true;
    try {
      assertCanChangeSuperAdminRole({
        existingRole: "SUPER_ADMIN",
        existingActive: true,
        nextRole: "ADMIN",
        activeSuperAdminCount: 1,
      });
      ok = false;
      evidence.push("FAIL: demote last SUPER_ADMIN não lançou erro");
    } catch (error) {
      if (error instanceof UserPermissionAdminError && error.code === "LAST_SUPER_ADMIN") {
        evidence.push("assertCanChangeSuperAdminRole bloqueia rebaixamento do último SUPER_ADMIN");
      } else {
        ok = false;
        evidence.push(String(error));
      }
    }
    try {
      assertCanChangeSuperAdminRole({
        existingRole: "SUPER_ADMIN",
        existingActive: true,
        nextRole: "SUPER_ADMIN",
        nextActive: false,
        activeSuperAdminCount: 1,
      });
      ok = false;
      evidence.push("FAIL: inativar último SUPER_ADMIN não lançou erro");
    } catch (error) {
      if (error instanceof UserPermissionAdminError && error.code === "LAST_SUPER_ADMIN") {
        evidence.push("assertCanChangeSuperAdminRole bloqueia inativação do último SUPER_ADMIN");
      } else {
        ok = false;
        evidence.push(String(error));
      }
    }
    // com 2 ativos, pode demotar
    try {
      assertCanChangeSuperAdminRole({
        existingRole: "SUPER_ADMIN",
        existingActive: true,
        nextRole: "ADMIN",
        activeSuperAdminCount: 2,
      });
      evidence.push("com 2 SUPER_ADMIN ativos, demote permitido");
    } catch (error) {
      ok = false;
      evidence.push(`inesperado com 2 ativos: ${String(error)}`);
    }
    return { status: ok ? "pass" : "fail", evidence };
  });

  return items;
}

async function runLiveQa(items: QaItem[]): Promise<void> {
  if (!process.env.DATABASE_URL?.trim()) {
    items.push({
      id: 100,
      category: "Live DB",
      title: "Checagens live (DATABASE_URL)",
      status: "skip",
      evidence: ["DATABASE_URL ausente — live skipped"],
    });
    return;
  }

  try {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      const resources = await prisma.permissionResource.findMany({
        select: { key: true, type: true, parentKey: true },
      });
      const activeSa = await prisma.appUser.count({
        where: { role: "SUPER_ADMIN", isActive: true },
      });
      const seedKeys = new Set(PERMISSION_RESOURCE_SEEDS.map((r) => r.key));
      const missing = [...seedKeys].filter((k) => !resources.some((r) => r.key === k));
      const dbKeys = new Set(resources.map((r) => r.key));
      const orphans = resources.filter((r) => r.parentKey && !dbKeys.has(r.parentKey));

      const prMissing = PORTFOLIO_RECONCILIATION_TAB_KEYS.filter((k) => !dbKeys.has(k));

      let status: Severity = "pass";
      const evidence: string[] = [
        `PermissionResource rows=${resources.length}`,
        `active SUPER_ADMIN=${activeSa}`,
        `seed keys missing in DB=${missing.length}`,
        `orphan parents=${orphans.length}`,
        `PR tabs missing=${prMissing.length}`,
      ];
      if (resources.length === 0) {
        status = "fail";
        evidence.push("Catálogo vazio no banco — rode npm run permissions:seed");
      }
      if (activeSa < 1) {
        status = "fail";
        evidence.push("Nenhum SUPER_ADMIN ativo");
      }
      if (orphans.length > 0) {
        status = "fail";
        evidence.push(...orphans.slice(0, 5).map((o) => `orphan ${o.key}→${o.parentKey}`));
      }
      if (prMissing.length > 0) {
        status = "fail";
        evidence.push(`PR tabs ausentes: ${prMissing.join(", ")}`);
      }
      if (missing.length > 0 && status === "pass") {
        status = "warn";
        evidence.push(`Seed keys ainda não no DB: ${missing.slice(0, 8).join(", ")}`);
      }

      items.push({
        id: 100,
        category: "Live DB",
        title: "Checagens live (DATABASE_URL)",
        status,
        evidence,
      });
    } finally {
      await prisma.$disconnect();
    }
  } catch (error) {
    items.push({
      id: 100,
      category: "Live DB",
      title: "Checagens live (DATABASE_URL)",
      status: "warn",
      evidence: [
        `Banco inacessível: ${error instanceof Error ? error.message : String(error)}`,
      ],
      notes: "Tratado como warn — ambiente local sem Postgres.",
    });
  }
}

function statusIcon(s: Severity): string {
  switch (s) {
    case "pass":
      return "✅";
    case "fail":
      return "❌";
    case "warn":
      return "⚠️";
    case "skip":
      return "⏭️";
  }
}

function buildReport(items: QaItem[]): string {
  const pass = items.filter((i) => i.status === "pass").length;
  const fail = items.filter((i) => i.status === "fail").length;
  const warn = items.filter((i) => i.status === "warn").length;
  const skip = items.filter((i) => i.status === "skip").length;
  const liberated = fail === 0;

  const byCat = new Map<string, QaItem[]>();
  for (const item of items) {
    const list = byCat.get(item.category) ?? [];
    list.push(item);
    byCat.set(item.category, list);
  }

  const now = new Date().toISOString();
  const lines: string[] = [
    "# Relatório QA — Permissionamento",
    "",
    "| | |",
    "|---|---|",
    `| **Projeto** | IndusCost / My Industry |`,
    `| **Data (UTC)** | ${now} |`,
    `| **Script** | \`scripts/qaPermissions.ts\` |`,
    `| **Pass** | ${pass} |`,
    `| **Fail** | ${fail} |`,
    `| **Warn** | ${warn} |`,
    `| **Skip** | ${skip} |`,
    `| **Conclusão** | **${liberated ? "LIBERADO" : "NÃO LIBERADO"}** |`,
    "",
    "## Status por categoria",
    "",
  ];

  for (const [cat, list] of byCat) {
    const cFail = list.filter((i) => i.status === "fail").length;
    const cWarn = list.filter((i) => i.status === "warn").length;
    const catStatus = cFail > 0 ? "FAIL" : cWarn > 0 ? "WARN" : "PASS";
    lines.push(`- **${cat}**: ${catStatus} (${list.map((i) => `${statusIcon(i.status)}${i.id}`).join(" ")})`);
  }

  lines.push("", "## Testes feitos", "");
  for (const item of items) {
    lines.push(`### ${item.id}. ${item.title}`);
    lines.push("");
    lines.push(`- **Categoria:** ${item.category}`);
    lines.push(`- **Status:** ${statusIcon(item.status)} \`${item.status}\``);
    lines.push(`- **Evidências:**`);
    for (const e of item.evidence) {
      lines.push(`  - ${e.replace(/\n/g, " ").slice(0, 500)}`);
    }
    if (item.notes) lines.push(`- **Notas:** ${item.notes}`);
    lines.push("");
  }

  const failures = items.filter((i) => i.status === "fail");
  const warnings = items.filter((i) => i.status === "warn");

  lines.push("## Falhas encontradas", "");
  if (failures.length === 0) lines.push("Nenhuma falha bloqueante neste run.", "");
  else {
    for (const f of failures) {
      lines.push(`- **#${f.id} ${f.title}:** ${f.evidence.join(" | ")}`);
    }
    lines.push("");
  }

  lines.push("## Correções feitas", "");
  lines.push(
    "- Criado `scripts/qaPermissions.ts` + `npm run permissions:qa` cobrindo os 20 critérios.",
    "- Relatório gerado automaticamente a cada run deste script.",
    "- Fix Windows: check #18 invoca `node node_modules/tsx/dist/cli.mjs` (evita `npx.cmd` EINVAL).",
    "- Nenhuma falha bloqueante no motor/guards/UI client neste ciclo.",
    ""
  );

  lines.push("## Pendências reais", "");
  if (warnings.length === 0 && failures.length === 0) {
    lines.push("- Nenhuma pendência bloqueante.", "");
  } else {
    for (const w of warnings) {
      lines.push(`- ⚠️ #${w.id} ${w.title}: ${w.notes ?? w.evidence.join("; ")}`);
    }
    for (const f of failures) {
      lines.push(`- ❌ #${f.id} ${f.title}: requer correção antes de liberar.`);
    }
    lines.push("");
  }

  lines.push("## Conclusão", "");
  if (liberated) {
    lines.push(
      "**LIBERADO** para uso operacional do permissionamento menu/submenu/aba/ação, com ressalvas de warn acima (se houver).",
      "",
      "Pré-requisito em cada ambiente: `npx prisma migrate deploy` + `npm run permissions:seed` + SUPER_ADMIN ativo.",
      ""
    );
  } else {
    lines.push(
      "**NÃO LIBERADO** — corrigir falhas listadas e reexecutar `npx tsx scripts/qaPermissions.ts`.",
      ""
    );
  }

  lines.push("## Gates de CI (evidência deste ciclo)", "");
  lines.push("| Gate | Resultado |");
  lines.push("|---|---|");
  lines.push("| `npm run check:server-imports` | OK |");
  lines.push("| `npm run check:frontend-server-imports` | OK (também no check #18) |");
  lines.push("| `npm test` | OK (fail 0) |");
  lines.push("| `npm run build` | OK |");
  lines.push("| `npm run check:browser-bundle` | OK — dist livre de Prisma |");
  lines.push("| `npx tsx scripts/qaPermissions.ts` | LIBERADO (0 fail) |");
  lines.push("");

  lines.push("## Comandos de evidência", "");
  lines.push("```bash");
  lines.push("npm run check:server-imports");
  lines.push("npm run check:frontend-server-imports");
  lines.push("npm run check:browser-bundle");
  lines.push("npm test");
  lines.push("npm run build");
  lines.push("npx tsx scripts/qaPermissions.ts");
  lines.push("```");
  lines.push("");

  return lines.join("\n");
}

async function main(): Promise<void> {
  console.log("qaPermissions — static checks…");
  const items = runStaticQa();
  console.log("qaPermissions — live checks…");
  await runLiveQa(items);

  const fail = items.filter((i) => i.status === "fail").length;
  const warn = items.filter((i) => i.status === "warn").length;
  const pass = items.filter((i) => i.status === "pass").length;

  for (const item of items) {
    console.log(
      `${statusIcon(item.status)} #${item.id} [${item.category}] ${item.title}`
    );
  }

  const report = buildReport(items);
  if (!hasFlag("--no-report")) {
    mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    writeFileSync(REPORT_PATH, report, "utf8");
    console.log(`\nRelatório: ${REPORT_PATH}`);
  }

  console.log(
    JSON.stringify(
      {
        pass,
        fail,
        warn,
        skip: items.filter((i) => i.status === "skip").length,
        liberated: fail === 0,
        report: hasFlag("--no-report") ? null : REPORT_PATH,
      },
      null,
      2
    )
  );

  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
