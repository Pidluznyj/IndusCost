/**
 * Valida JSONs de plano dry-run e preview de aplicação Nomus (piloto APPLY-A).
 *
 * Uso:
 *   npm run sync:nomus:bom-plan -- --parentCode=610.73BA --out=/tmp/nomus_bom_plan_610_check.json
 *   npm run sync:nomus:bom-apply-preview -- --parentCode=610.73BA --out=/tmp/apply_preview_610.json
 *   npm run sync:nomus:bom-apply-validation-print -- --parentCode=610.73BA
 */
import { existsSync, readFileSync } from "node:fs";
import { normalizeSku } from "../src/lib/nomusBomComparison.ts";

type CliArgs = {
  parentCode: string;
  planPath: string;
  previewPath: string;
};

const COMPONENT_309 = "309.61AA";
const COMPONENT_800 = "800.01";
const EXPECTED_SOURCE_IDS = [3228, 7696];

function parseArgs(): CliArgs {
  const args: CliArgs = {
    parentCode: "610.73BA",
    planPath: "/tmp/nomus_bom_plan_610_check.json",
    previewPath: "/tmp/apply_preview_610.json",
  };

  for (const arg of process.argv.slice(2)) {
    const parent = arg.match(/^--parentCode=(.+)$/);
    if (parent) {
      args.parentCode = parent[1].trim();
      continue;
    }
    const plan = arg.match(/^--plan=(.+)$/);
    if (plan) {
      args.planPath = plan[1].trim();
      continue;
    }
    const preview = arg.match(/^--preview=(.+)$/);
    if (preview) {
      args.previewPath = preview[1].trim();
      continue;
    }
  }

  return args;
}

function fail(message: string): never {
  console.error(`[VALIDATION FAIL] ${message}`);
  process.exit(1);
}

function ok(message: string): void {
  console.log(`[OK] ${message}`);
}

function loadJson(path: string): unknown {
  if (!existsSync(path)) {
    fail(`Arquivo não encontrado: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function includesAllIds(ids: unknown, expected: number[]): boolean {
  if (!Array.isArray(ids)) return false;
  const set = new Set(ids.map((v) => Number(v)));
  return expected.every((id) => set.has(id));
}

function actionQuantity(action: Record<string, unknown>): number | null {
  const raw =
    action.effectiveQuantity ??
    action.targetQuantity ??
    action.plannedQuantity ??
    action.nomusQuantity;
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function validatePlan(planPath: string, parentCode: string): void {
  console.log("\n=== A) PLANO DRY-RUN ===");
  const data = loadJson(planPath) as {
    plans?: Array<{
      parentCode?: string;
      optionalPricingStatus?: string;
      summary?: unknown;
      comparison?: { lines?: Array<Record<string, unknown>> };
      actions?: Array<Record<string, unknown>>;
    }>;
  };

  const plans = data.plans ?? [];
  const parentCodes = plans.map((p) => p.parentCode).filter(Boolean);

  console.log("total plans:", plans.length);
  console.log("parentCodes:", parentCodes);

  if (plans.length !== 1) {
    fail(`plans.length deve ser 1, obtido ${plans.length}`);
  }
  ok("plans.length === 1");

  const plan = plans[0];
  const wanted = normalizeSku(parentCode);
  if (normalizeSku(plan.parentCode ?? "") !== wanted) {
    fail(`plan.parentCode deve ser ${parentCode}, obtido ${plan.parentCode}`);
  }
  ok(`plan.parentCode === ${parentCode}`);

  console.log("parentCode validado:", plan.parentCode);
  console.log("optionalPricingStatus:", plan.optionalPricingStatus);
  console.log("summary:", JSON.stringify(plan.summary, null, 2));

  const line = plan.comparison?.lines?.find((l) => l.componentCode === COMPONENT_309);
  console.log(`\ncomparison ${COMPONENT_309}:`);
  console.log(JSON.stringify(line, null, 2));

  if (!line) {
    fail(`Linha ${COMPONENT_309} não encontrada na comparação`);
  }
  ok(`linha ${COMPONENT_309} existe`);

  const nomusQty = Number(line.nomusQuantity);
  if (nomusQty !== 3) {
    fail(`nomusQuantity esperada 3, obtida ${line.nomusQuantity}`);
  }
  ok(`${COMPONENT_309} nomusQuantity = 3`);

  const nomusLineCount = Number(line.nomusLineCount);
  if (nomusLineCount !== 2) {
    fail(`nomusLineCount esperado 2, obtido ${line.nomusLineCount}`);
  }
  ok(`${COMPONENT_309} nomusLineCount = 2`);

  if ("hasDuplicateNomusLines" in line && line.hasDuplicateNomusLines !== true) {
    fail(`hasDuplicateNomusLines esperado true, obtido ${String(line.hasDuplicateNomusLines)}`);
  }
  if ("hasDuplicateNomusLines" in line) {
    ok(`${COMPONENT_309} hasDuplicateNomusLines = true`);
  }

  if ("nomusSourceLineIds" in line) {
    if (!includesAllIds(line.nomusSourceLineIds, EXPECTED_SOURCE_IDS)) {
      fail(
        `nomusSourceLineIds deve conter ${EXPECTED_SOURCE_IDS.join(" e ")}, obtido ${JSON.stringify(line.nomusSourceLineIds)}`
      );
    }
    ok(`${COMPONENT_309} nomusSourceLineIds contém 3228 e 7696`);
  }

  const action = plan.actions?.find((a) => a.componentCode === COMPONENT_309);
  console.log(`\naction ${COMPONENT_309}:`);
  console.log(JSON.stringify(action, null, 2));

  console.log("\n[OK] Agregação duplicada validada no plano.");
}

function validatePreview(previewPath: string, parentCode: string): void {
  console.log("\n=== B) PREVIEW DE APLICAÇÃO ===");

  if (!existsSync(previewPath)) {
    console.warn("Preview não encontrado; validação do plano concluída.");
    console.warn(`Arquivo esperado: ${previewPath}`);
    return;
  }

  const data = loadJson(previewPath) as {
    parentCode?: string;
    productId?: string;
    canApply?: boolean;
    confirmationRequiredText?: string;
    planHash?: string;
    blockingReasons?: string[];
    warnings?: string[];
    beforeSummary?: unknown;
    afterSummary?: unknown;
    actions?: Array<Record<string, unknown>>;
  };

  console.log("parentCode:", data.parentCode);
  console.log("productId:", data.productId);
  console.log("canApply:", data.canApply);
  console.log("confirmationRequiredText:", data.confirmationRequiredText);
  console.log("planHash:", data.planHash);
  console.log("blockingReasons:", data.blockingReasons);
  console.log("warnings:", data.warnings);
  console.log("beforeSummary:", data.beforeSummary);
  console.log("afterSummary:", data.afterSummary);

  if (normalizeSku(data.parentCode ?? "") !== normalizeSku(parentCode)) {
    fail(`preview.parentCode deve ser ${parentCode}, obtido ${data.parentCode}`);
  }

  const blocking = data.blockingReasons ?? [];
  if (blocking.length > 0) {
    console.error("\n*** NÃO APLICAR ***");
    for (const reason of blocking) {
      console.error(`  - ${reason}`);
    }
    fail("blockingReasons presentes — não aplicar.");
  }

  if (data.canApply === false) {
    console.error("\n*** NÃO APLICAR *** canApply=false");
    fail("canApply=false — não aplicar.");
  }

  console.log("\nAções principais:");
  for (const a of data.actions ?? []) {
    console.log({
      actionType: a.actionType,
      componentCode: a.componentCode,
      description: a.componentDescription,
      currentQuantity: a.currentQuantity,
      effectiveQuantity: a.effectiveQuantity,
      reason: a.reason,
      riskLevel: a.riskLevel,
    });
  }

  const line309 = (data.actions ?? []).find((a) => a.componentCode === COMPONENT_309);
  if (line309) {
    const qty = actionQuantity(line309);
    if (qty != null && qty !== 3) {
      fail(`${COMPONENT_309} quantity em action deve ser 3, obtido ${qty}`);
    }
    if (qty === 3) {
      ok(`${COMPONENT_309} effectiveQuantity = 3 na action`);
    }
  }

  const remove800 = (data.actions ?? []).find(
    (a) => a.componentCode === COMPONENT_800 && a.actionType === "REMOVE_PRODUCT_BOM_LINE"
  );
  if (remove800) {
    fail(`${COMPONENT_800} aparece em REMOVE_PRODUCT_BOM_LINE — remoção indevida.`);
  }
  ok(`${COMPONENT_800} não está em REMOVE indevido`);

  if (data.canApply === true) {
    ok("canApply=true (sem blockingReasons)");
  }
}

function main(): void {
  const args = parseArgs();
  console.log(`[nomus-bom-apply-validation-print] parentCode=${args.parentCode}`);
  console.log(`  plan: ${args.planPath}`);
  console.log(`  preview: ${args.previewPath}`);

  validatePlan(args.planPath, args.parentCode);
  validatePreview(args.previewPath, args.parentCode);

  console.log("\n=== VALIDAÇÃO CONCLUÍDA ===");
}

try {
  main();
} catch (e) {
  console.error("Erro:", e instanceof Error ? e.message : e);
  process.exit(1);
}
