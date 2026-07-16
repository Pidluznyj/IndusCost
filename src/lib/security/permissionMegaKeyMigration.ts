/**
 * P09 — mapeamento explícito de migração mega-key / alias amplo → 1:1.
 * Não faz regrant automático; dry-run só reporta impacto.
 */

import { FRONTEND_PERMISSION_RESOURCES } from "@/src/lib/permissionsClient.js";
import { PERMISSION_RESOURCE_SEEDS } from "@/src/lib/permissionResourceSeedData.js";
import {
  PERMISSION_HARD_MEGA_KEYS,
  PERMISSION_KNOWN_MEGA_OR_BLEED_KEYS,
} from "@/src/lib/security/permissionContract/megaKeys.js";

export type MegaKeyMigrationMode = "legacy_identified" | "removed_bleed" | "canonical_1_1";

export type MegaKeyMigrationEntry = {
  legacyKey: string;
  /** Recursos que a chave NÃO deve mais liberar (hotfix P09). */
  removedFromResourceKeys: readonly string[];
  /** Único recurso canônico 1:1 (quando aplicável). */
  canonicalResourceKey: string | null;
  /** Chaves específicas substitutas para regrant manual (sem auto-apply). */
  replacementKeys: readonly string[];
  mode: MegaKeyMigrationMode;
  /** Camada onde a mega-key ainda pode existir temporariamente. */
  legacyLayer: "opex_only" | "finance_module_shell" | "none" | "catalog_deprecated";
  removalTarget: string;
  notes: string;
};

/**
 * Contrato de migração P09 — fonte documental tipada.
 * Atualizar junto com seed/FE/modulePermissions.
 */
export const MEGA_KEY_MIGRATION_MAP: readonly MegaKeyMigrationEntry[] = [
  {
    legacyKey: "finance.accountsPayable.view",
    removedFromResourceKeys: [
      "financeiro",
      "financeiro.conciliacao_carteira",
      "finance",
      "finance.portfolio_reconciliation",
      "finance.cash_flow",
    ],
    canonicalResourceKey: "financeiro.contas_pagar",
    replacementKeys: ["financeiro.contas_pagar", "finance.accounts_payable"],
    mode: "canonical_1_1",
    legacyLayer: "none",
    removalTarget: "P09 (hotfix bleed) — já removido de pai/conciliação",
    notes:
      "Bleed histórico AP→Financeiro/Conciliação. Compat: só Contas a Pagar 1:1. Sem regrant automático.",
  },
  {
    legacyKey: "finance.accountsReceivable.view",
    removedFromResourceKeys: [
      "financeiro",
      "financeiro.conciliacao_carteira",
      "finance.cash_flow",
    ],
    canonicalResourceKey: "financeiro.contas_receber",
    replacementKeys: ["financeiro.contas_receber", "finance.accounts_receivable"],
    mode: "canonical_1_1",
    legacyLayer: "none",
    removalTarget: "P09 — irmão do bleed AP",
    notes: "AR não deve abrir Conciliação nem elevar o pai via alias compartilhado.",
  },
  {
    legacyKey: "costs.view",
    removedFromResourceKeys: [
      "admin.employees",
      "operations.machines",
      "suprimentos",
      "suprimentos.tab.catalogo",
      "engineering.simulations",
      "engineering.transformation_simulator",
      "engineering.materials",
    ],
    canonicalResourceKey: "finance.opex",
    replacementKeys: [
      "opex.view",
      "employees.view",
      "machines.view",
      "materials.view",
      "simulations.view",
      "products.view",
    ],
    mode: "legacy_identified",
    legacyLayer: "opex_only",
    removalTarget: "P15–P16 (após snapshot P19 + regrant canônico)",
    notes:
      "Mega-key hard. P09: fora de RH/Máquinas/Suprimentos/Simulações. Permanece só em opex (camada legado identificada).",
  },
  {
    legacyKey: "finance.view",
    removedFromResourceKeys: ["financeiro.conciliacao_carteira"],
    canonicalResourceKey: "financeiro",
    replacementKeys: [
      "financeiro.contas_pagar",
      "financeiro.contas_receber",
      "financeiro.fluxo_caixa",
      "financeiro.conciliacao_carteira",
    ],
    mode: "legacy_identified",
    legacyLayer: "finance_module_shell",
    removalTarget: "Após decompor users com só finance.view (P19)",
    notes: "Mega-key de módulo; não aliasar em Conciliação. Filhos usam keys 1:1.",
  },
  {
    legacyKey: "crm.view",
    removedFromResourceKeys: [],
    canonicalResourceKey: "comercial.crm",
    replacementKeys: ["comercial.crm"],
    mode: "legacy_identified",
    legacyLayer: "catalog_deprecated",
    removalTarget: "Apertar parent comercial (pós P09)",
    notes: "Ainda em comercial + comercial.crm; dual-write 1:1 prefere comercial.crm.",
  },
  {
    legacyKey: "sales_orders.view",
    removedFromResourceKeys: [],
    canonicalResourceKey: "comercial.pedidos_venda",
    replacementKeys: ["comercial.pedidos_venda"],
    mode: "legacy_identified",
    legacyLayer: "catalog_deprecated",
    removalTarget: "Remover do âncora comercial quando seguro",
    notes: "Ideal 1:1 com pedidos; ainda listada no MENU comercial.",
  },
  {
    legacyKey: "dashboard.view",
    removedFromResourceKeys: [],
    canonicalResourceKey: "dashboard",
    replacementKeys: ["dashboard"],
    mode: "canonical_1_1",
    legacyLayer: "none",
    removalTarget: "Manter 1:1",
    notes: "Não usar em reports/guide (P08).",
  },
] as const;

/** Aliases que ainda podem aparecer em >1 recurso (allowlist documentada). */
export const ALIAS_WIDE_ALLOWLIST: ReadonlySet<string> = new Set([
  ...PERMISSION_KNOWN_MEGA_OR_BLEED_KEYS,
  "crm.view",
  "crm.general.view",
  "crm.seller.view",
  "crm.seller.own",
  "crm.seller.all",
  "sales_orders.view",
  "commissions.view",
  "commissions.dashboard.view",
  "commissions.audit.view",
  "commissions.payments.view",
  "commissions.release.view",
  "commissions.rules.view",
  "materials.view",
  "products.view",
  "simulations.view",
  "inventory.view",
  "employees.edit",
  "employees.view",
  "users.manage",
  "accessProfiles.view",
  "settings.view",
  "settings.nomus.view",
  "reports.view",
  "fleet.view",
  "machines.view",
  "maintenance.view",
  "purchases.view",
  "projects.view",
  "customers.view",
  "materials.market_quote.approve",
  "materials.market_quote.manual_exchange",
  "finance.portfolioReconciliation.conciliation.view",
  "finance.portfolioReconciliation.intelligence.view",
  "finance.portfolioReconciliation.orderStatusPedidos.view",
  "finance.portfolioReconciliation.orderToCashAudit.view",
]);

export type AliasFanoutFinding = {
  legacyKey: string;
  resourceKeys: string[];
  allowed: boolean;
  severity: "error" | "warn";
  message: string;
};

/** Inventário FE: legacyKey → resourceKeys. */
export function buildFrontendAliasFanout(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const r of FRONTEND_PERMISSION_RESOURCES) {
    for (const alias of r.legacyAliasKeys) {
      const list = map.get(alias) ?? [];
      list.push(r.key);
      map.set(alias, list);
    }
  }
  for (const [, list] of map) list.sort();
  return map;
}

/** Inventário seed: legacyKey → resourceKeys. */
export function buildSeedAliasFanout(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const r of PERMISSION_RESOURCE_SEEDS) {
    for (const alias of r.legacyAliasKeys) {
      const list = map.get(alias) ?? [];
      list.push(r.key);
      map.set(alias, list);
    }
  }
  for (const [, list] of map) list.sort();
  return map;
}

/**
 * Valida que aliases novos (fora da allowlist) não apontam para múltiplos recursos.
 * Hard mega-keys fora da camada legado → error.
 */
export function validateAliasOneToOnePolicy(
  fanout: Map<string, string[]> = buildFrontendAliasFanout()
): AliasFanoutFinding[] {
  const findings: AliasFanoutFinding[] = [];
  for (const [legacyKey, resourceKeys] of [...fanout.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    if (resourceKeys.length <= 1) continue;
    const allowed = ALIAS_WIDE_ALLOWLIST.has(legacyKey);
    const isHard = PERMISSION_HARD_MEGA_KEYS.has(legacyKey);
    const entry = MEGA_KEY_MIGRATION_MAP.find((e) => e.legacyKey === legacyKey);
    const opexOnly =
      entry?.legacyLayer === "opex_only" &&
      resourceKeys.every((k) => k === "finance.opex" || k.includes("opex"));

    if (isHard && !opexOnly && resourceKeys.length > 1) {
      findings.push({
        legacyKey,
        resourceKeys,
        allowed: false,
        severity: "error",
        message: `Hard mega-key ${legacyKey} ainda aliasa ${resourceKeys.length} recursos cross-module: ${resourceKeys.join(", ")}`,
      });
      continue;
    }

    if (!allowed) {
      findings.push({
        legacyKey,
        resourceKeys,
        allowed: false,
        severity: "error",
        message: `Alias novo/ampliamento sem allowlist: ${legacyKey} → ${resourceKeys.join(", ")}`,
      });
      continue;
    }

    findings.push({
      legacyKey,
      resourceKeys,
      allowed: true,
      severity: "warn",
      message: `Alias amplo allowlisted (temporário): ${legacyKey} → ${resourceKeys.length} recursos`,
    });
  }
  return findings;
}

export type MegaKeyMigrationDryRunReport = {
  generatedAt: string;
  entries: readonly MegaKeyMigrationEntry[];
  feFanout: Record<string, string[]>;
  seedFanout: Record<string, string[]>;
  policyFindings: AliasFanoutFinding[];
  /** Bleeds P09 que ainda aparecem no FE (não deveriam). */
  residualBleeds: { legacyKey: string; resourceKeys: string[] }[];
  note: string;
};

/**
 * Dry-run: reporta estado atual vs mapa. Não grava banco nem regrant.
 */
export function runMegaKeyMigrationDryRun(): MegaKeyMigrationDryRunReport {
  const fe = buildFrontendAliasFanout();
  const seed = buildSeedAliasFanout();
  const policyFindings = validateAliasOneToOnePolicy(fe);

  const residualBleeds: { legacyKey: string; resourceKeys: string[] }[] = [];
  for (const entry of MEGA_KEY_MIGRATION_MAP) {
    if (entry.removedFromResourceKeys.length === 0) continue;
    const removed = new Set(entry.removedFromResourceKeys);
    const owners = [
      ...(fe.get(entry.legacyKey) ?? []),
      ...(seed.get(entry.legacyKey) ?? []),
    ];
    const bad = [...new Set(owners)].filter((k) => removed.has(k));
    if (bad.length) {
      residualBleeds.push({ legacyKey: entry.legacyKey, resourceKeys: bad.sort() });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    entries: MEGA_KEY_MIGRATION_MAP,
    feFanout: Object.fromEntries(fe),
    seedFanout: Object.fromEntries(seed),
    policyFindings,
    residualBleeds,
    note:
      "Dry-run only — sem regrant automático de bleed. Apply manual após snapshot P19.",
  };
}

export function assertNoResidualP09Bleeds(
  report: MegaKeyMigrationDryRunReport = runMegaKeyMigrationDryRun()
): void {
  const blocking = report.residualBleeds.filter((b) =>
    ["finance.accountsPayable.view", "costs.view"].includes(b.legacyKey)
  );
  const policyErrors = report.policyFindings.filter((f) => f.severity === "error");
  if (blocking.length || policyErrors.length) {
    throw new Error(
      [
        ...blocking.map(
          (b) => `residual bleed ${b.legacyKey} @ ${b.resourceKeys.join(",")}`
        ),
        ...policyErrors.map((f) => f.message),
      ].join("; ")
    );
  }
}
