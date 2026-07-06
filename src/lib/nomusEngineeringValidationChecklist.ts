/**
 * Gera checklist operacional para validação humana pós auto apply BOM Nomus.
 * Foco: apenas pendências que exigem decisão de engenharia.
 */
import type { NomusBomAutoApplyProductResult, NomusBomAutoApplyTotals } from "@/src/lib/nomusBomAutoApplyAfterSyncTypes";
import { enrichDashboardProductRow } from "@/src/lib/nomusAutoApplyBomDashboardShared";
import { classifyAutoApplyProduct } from "@/src/lib/nomusAutoApplyBomDashboard";

function needsHumanValidation(product: NomusBomAutoApplyProductResult): boolean {
  if (product.status === "BLOCKED" || product.status === "SKIPPED" || product.status === "ERROR") {
    return true;
  }
  const classified = classifyAutoApplyProduct(product);
  return (
    classified.filterBuckets.includes("OPTIONAL_PENDING") ||
    classified.filterBuckets.includes("LOCAL_PENDING") ||
    classified.localOnlyLineCodes.length > 0
  );
}

function formatComponents(product: NomusBomAutoApplyProductResult): string {
  const preview = product.actionsPreview ?? [];
  if (preview.length === 0) return "—";
  return preview.map((a) => a.componentCode).join(", ");
}

function formatActions(product: NomusBomAutoApplyProductResult): string[] {
  const preview = product.actionsPreview ?? [];
  return preview.map((a) => {
    const qty =
      a.currentQuantity != null || a.effectiveQuantity != null
        ? `: ${a.currentQuantity ?? "—"} → ${a.effectiveQuantity ?? "—"}`
        : "";
    return `- \`${a.actionType}\` **${a.componentCode}**${qty}`;
  });
}

function tabLabel(tab: string): string {
  switch (tab) {
    case "effective-pricing-bom":
      return "BOM efetiva / revisão local";
    case "pending":
      return "Opcionais de Precificação / Pendências";
    case "product-import":
      return "Carga Mestre Nomus";
    case "apply-plan":
      return "Plano de aplicação";
    case "diagnostic":
      return "Diagnóstico técnico";
    default:
      return "Visão geral";
  }
}

export function buildEngineeringValidationChecklistMarkdown(input: {
  generatedAt: string;
  totals: NomusBomAutoApplyTotals;
  products: NomusBomAutoApplyProductResult[];
}): string {
  const actionable = input.products.filter(needsHumanValidation);

  const blocked = actionable.filter((p) => p.status === "BLOCKED");
  const skipped = actionable.filter((p) => p.status === "SKIPPED");
  const errored = actionable.filter((p) => p.status === "ERROR");

  const lines: string[] = [
    "# Checklist operacional — validação Nomus × IndusCost",
    "",
    `Gerado em: **${input.generatedAt}**`,
    "",
    "Este checklist lista **apenas produtos que exigem decisão humana**.",
    "Produtos alinhados (sem alteração) ou já aplicados automaticamente **não** aparecem aqui.",
    "",
    "## Resumo da rotina",
    "",
    "| Métrica | Valor |",
    "|---|---:|",
    `| Produtos avaliados | ${input.totals.parentsEvaluated} |`,
    `| Sem alteração (ok) | ${input.totals.parentsNoChanges} |`,
    `| Aplicados | ${input.totals.parentsApplied} |`,
    `| Prontos para aplicar | ${input.totals.parentsReadyToApply ?? 0} |`,
    `| Bloqueados | ${input.totals.parentsBlocked} |`,
    `| Ignorados | ${input.totals.parentsSkipped} |`,
    `| Erros | ${input.totals.parentsErrored} |`,
    `| **Itens neste checklist** | **${actionable.length}** |`,
    "",
    "## Como usar (estagiário / engenharia)",
    "",
    "1. Abrir **Manutenção Nomus → Visão Geral → Central Engenharia Nomus**.",
    "2. Clicar **Atualizar painel da engenharia**.",
    "3. Filtrar **Bloqueados** e buscar o `parentCode` deste checklist.",
    "4. Expandir a linha e conferir `actionsPreview`.",
    "5. Clicar **Abrir ajuste** na aba sugerida.",
    "6. Registrar decisão (preservar item local, resolver opcional, importar cadastro etc.).",
    "",
    "Política de apply: ver `docs/nomus-bom-auto-apply-policy.md`.",
    "",
    "---",
    "",
    `## Produtos para validação (${actionable.length})`,
    "",
  ];

  if (actionable.length === 0) {
    lines.push("_Nenhuma pendência humana registrada nesta rotina._", "");
    return `${lines.join("\n")}\n`;
  }

  const sorted = [...actionable].sort((a, b) => {
    const order = { ERROR: 0, BLOCKED: 1, SKIPPED: 2, READY_TO_APPLY: 3, APPLIED: 4, NO_CHANGES: 5 };
    const diff = (order[a.status] ?? 9) - (order[b.status] ?? 9);
    return diff !== 0 ? diff : a.parentCode.localeCompare(b.parentCode);
  });

  for (const product of sorted) {
    const classified = classifyAutoApplyProduct(product);
    const row = enrichDashboardProductRow({
      parentCode: product.parentCode,
      productId: product.productId,
      status: product.status,
      canApply: product.canApply,
      errorMessage: product.errorMessage,
      ...classified,
      pendingTypeLabel: "",
      recommendedAction: "",
      recommendedTab: "overview",
      severity: 0,
      actionsCount: 0,
      actionsSummaryLines: [],
      readyToApply: false,
      hasUnappliedBomDiff: false,
      appliedToOfficialBom: false,
      planHash: null,
      confirmationRequiredText: null,
      diffSummary: "",
    });

    lines.push(`### ${product.parentCode}`);
    lines.push("");
    lines.push(`| Campo | Valor |`);
    lines.push(`|---|---|`);
    lines.push(`| Status | ${product.status} |`);
    lines.push(`| Tipo de pendência | ${row.pendingTypeLabel} |`);
    lines.push(`| Motivo principal | ${row.primaryReason.replace(/\|/g, "\\|")} |`);
    lines.push(`| Ação recomendada | ${row.recommendedAction.replace(/\|/g, "\\|")} |`);
    lines.push(`| Aba sugerida | ${tabLabel(row.recommendedTab)} |`);
    lines.push(`| Componentes envolvidos | ${formatComponents(product)} |`);
    lines.push(`| Decisão necessária | ${row.recommendedAction.replace(/\|/g, "\\|")} |`);
    lines.push("");

    if (product.blockingReasons.length > 0) {
      lines.push("**Motivos de bloqueio:**");
      for (const r of product.blockingReasons) lines.push(`- ${r}`);
      lines.push("");
    }

    const actionLines = formatActions(product);
    if (actionLines.length > 0) {
      lines.push("**Ações previstas:**");
      lines.push(...actionLines);
      lines.push("");
    }

    if (product.errorMessage) {
      lines.push(`**Erro:** ${product.errorMessage}`, "");
    }

    lines.push("---", "");
  }

  lines.push(
    "## Estatísticas rápidas",
    "",
    `- Bloqueados neste checklist: ${blocked.length}`,
    `- Ignorados neste checklist: ${skipped.length}`,
    `- Erros neste checklist: ${errored.length}`,
    ""
  );

  return `${lines.join("\n")}\n`;
}
