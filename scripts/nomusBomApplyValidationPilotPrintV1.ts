/**
 * Imprime resumo de validação piloto (610.73BA) a partir de JSONs gerados pelos CLIs.
 * Uso no servidor:
 *   npm run sync:nomus:bom-plan -- --parentCode=610.73BA --out=/tmp/nomus_bom_plan_610_check.json
 *   npm run sync:nomus:bom-apply-preview -- --parentCode=610.73BA --out=/tmp/apply_preview_610.json
 *   npx tsx scripts/nomusBomApplyValidationPilotPrintV1.ts
 */
import { readFileSync } from "node:fs";

const PLAN_PATH = process.env.PLAN_JSON ?? "/tmp/nomus_bom_plan_610_check.json";
const PREVIEW_PATH = process.env.PREVIEW_JSON ?? "/tmp/apply_preview_610.json";

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function printPlan() {
  const data = loadJson(PLAN_PATH) as {
    plans?: Array<{
      parentCode?: string;
      optionalPricingStatus?: string;
      summary?: unknown;
      comparison?: { lines?: Array<Record<string, unknown>> };
      actions?: Array<Record<string, unknown>>;
    }>;
  };
  const plan = data.plans?.[0];
  console.log("\n=== BOM PLAN (dry-run) ===");
  console.log("parentCode:", plan?.parentCode);
  console.log("optionalPricingStatus:", plan?.optionalPricingStatus);
  console.log("summary:", JSON.stringify(plan?.summary, null, 2));

  const line = plan?.comparison?.lines?.find((l) => l.componentCode === "309.61AA");
  console.log("\ncomparison 309.61AA:");
  console.log(JSON.stringify(line, null, 2));

  const action = plan?.actions?.find((a) => a.componentCode === "309.61AA");
  console.log("\naction 309.61AA:");
  console.log(JSON.stringify(action, null, 2));

  const nomusQty = line?.nomusQuantity;
  if (nomusQty !== 3) {
    console.error("\n[STOP] nomusQuantity esperada = 3, obtida:", nomusQty);
    process.exitCode = 1;
  } else {
    console.log("\n[OK] 309.61AA nomusQuantity = 3");
  }
}

function printPreview() {
  const data = loadJson(PREVIEW_PATH) as {
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

  console.log("\n=== APPLY PREVIEW ===");
  console.log("parentCode:", data.parentCode);
  console.log("productId:", data.productId);
  console.log("canApply:", data.canApply);
  console.log("confirmationRequiredText:", data.confirmationRequiredText);
  console.log("planHash:", data.planHash);
  console.log("blockingReasons:", data.blockingReasons);
  console.log("warnings:", data.warnings);
  console.log("beforeSummary:", data.beforeSummary);
  console.log("afterSummary:", data.afterSummary);

  console.log("\nAções:");
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

  const line309 = (data.actions ?? []).find((a) => a.componentCode === "309.61AA");
  if (line309) {
    console.log("\n309.61AA action:", JSON.stringify(line309, null, 2));
  }

  if (data.canApply === false) {
    console.error("\n[STOP] canApply=false — não aplicar.");
    process.exitCode = 1;
  }
}

try {
  printPlan();
  printPreview();
} catch (e) {
  console.error("Erro:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
}
