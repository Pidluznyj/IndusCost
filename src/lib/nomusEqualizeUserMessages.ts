/**
 * Mensagens e relatório operacional do fluxo Igualar Bases.
 * Arquivo puro — seguro para frontend e backend.
 *
 * Fase: NOMUS-EQUALIZE-USER-FEEDBACK-A.
 */

import { equalizeActionLabel } from "@/src/lib/nomusMasterDataEqualizeShared";
import type {
  EqualizeApplyErrorItem,
  EqualizeApplyResult,
  EqualizeApplyStatus,
  EqualizeTotals,
} from "@/src/lib/nomusMasterDataEqualizeTypes";
import { EQUALIZE_CONFIRMATION_TEXT } from "@/src/lib/nomusMasterDataEqualizeTypes";

export type EqualizeFailureKind =
  | "CONFIRMATION"
  | "PERMISSION"
  | "NETWORK"
  | "DATABASE"
  | "API"
  | "UNKNOWN";

export type EqualizeModalViewModel = {
  variant: "success" | "info" | "warning" | "error";
  title: string;
  userMessage: string;
  executiveSummary: string;
  resolutionHint: string | null;
  failureKind: EqualizeFailureKind | null;
  statusLabel: string;
  counts: {
    createdProducts: number;
    createdMaterials: number;
    updatedProducts: number;
    updatedMaterials: number;
    deactivatedProducts: number;
    deactivatedMaterials: number;
    preservedItems: number;
    preserveNomusControlled: number;
    ambiguous: number;
    blocked: number;
    errors: number;
    historyEntriesCreated: number;
  };
  safetyLines: string[];
  pendingLines: string[];
  failedItems: EqualizeApplyErrorItem[];
  runId: string | null;
  planHash: string | null;
  generatedAt: string;
  technicalMessage: string;
  status: EqualizeApplyStatus | "NETWORK_ERROR";
};

export const EQUALIZE_STATUS_LABEL: Record<EqualizeApplyStatus, string> = {
  APPLIED: "Aplicado com sucesso",
  NO_CHANGES: "Nenhuma alteração necessária",
  BLOCKED: "Bloqueado por segurança",
  FAILED: "Falhou antes de concluir",
  PARTIAL: "Concluído parcialmente",
};

export const EQUALIZE_SAFETY_LINES = [
  "BOM dos produtos não foi alterada",
  "Custos não foram alterados",
  "Preços não foram alterados",
  "Propostas não foram alteradas",
  "Pedidos não foram alterados",
  "Roteiros e processos não foram alterados",
] as const;

export function formatCount(n: number | undefined | null): number {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

export function classifyEqualizeHttpError(message: string, status?: number): EqualizeFailureKind {
  const m = message.toLowerCase();
  if (
    status === 403 ||
    /forbidden|permiss|permission|products\.edit|materials\.edit/i.test(m)
  ) {
    return "PERMISSION";
  }
  if (
    /confirmação inválida|confirmation|igualar bases nomus|invalid_confirmation/i.test(m)
  ) {
    return "CONFIRMATION";
  }
  if (
    /foreign key|engineeringchangelog_runid|engineering syncrun|runid_fkey|prisma/i.test(m)
  ) {
    return "DATABASE";
  }
  if (/failed to fetch|networkerror|econnrefused|fetch error/i.test(m)) {
    return "NETWORK";
  }
  if (status != null && status >= 500) return "API";
  return "UNKNOWN";
}

export function failurePresentation(kind: EqualizeFailureKind): {
  title: string;
  userMessage: string;
  resolutionHint: string;
} {
  switch (kind) {
    case "CONFIRMATION":
      return {
        title: "Não foi possível igualar as bases",
        userMessage:
          "A frase de confirmação não confere. Para proteger os dados, nenhuma alteração foi aplicada.",
        resolutionHint: `Digite exatamente: ${EQUALIZE_CONFIRMATION_TEXT}`,
      };
    case "PERMISSION":
      return {
        title: "Não foi possível igualar as bases",
        userMessage:
          "Seu usuário não possui permissão para executar a igualação de bases.",
        resolutionHint:
          "Solicite permissão de edição de produtos ou peça para um administrador executar a ação.",
      };
    case "NETWORK":
      return {
        title: "Não foi possível igualar as bases",
        userMessage:
          "O navegador não conseguiu se comunicar com o backend da aplicação.",
        resolutionHint:
          "Atualize a página com Ctrl+F5. Se persistir, reinicie o servidor da aplicação e tente novamente.",
      };
    case "DATABASE":
      return {
        title: "Não foi possível igualar as bases",
        userMessage:
          "O sistema não conseguiu gravar o histórico da operação. Para segurança, a igualação foi interrompida.",
        resolutionHint:
          "Acione o suporte técnico e verifique se existe um EngineeringSyncRun válido para o histórico.",
      };
    case "API":
      return {
        title: "Não foi possível igualar as bases",
        userMessage:
          "O sistema tentou igualar as bases, mas encontrou um problema antes de concluir. Nenhuma alteração perigosa foi aplicada. Veja abaixo o motivo e a ação recomendada.",
        resolutionHint:
          "Copie o relatório técnico e envie ao suporte. Se o erro persistir, rode o preview pelo terminal para diagnóstico.",
      };
    default:
      return {
        title: "Não foi possível igualar as bases",
        userMessage:
          "O sistema tentou igualar as bases, mas encontrou um problema antes de concluir. Nenhuma alteração perigosa foi aplicada.",
        resolutionHint:
          "Erro técnico não classificado. Copie o relatório técnico e envie ao suporte.",
      };
  }
}

function buildExecutiveSummary(result: EqualizeApplyResult, preview?: EqualizeTotals | null): string {
  const ambiguous = formatCount(preview?.ambiguous);
  const parts: string[] = [
    `Resultado da igualação:`,
    `${formatCount(result.updatedProducts)} produto(s) atualizado(s).`,
    `${formatCount(result.updatedMaterials)} material(is) atualizado(s).`,
    `${formatCount(result.createdProducts) + formatCount(result.createdMaterials)} item(ns) criado(s).`,
    `${formatCount(result.deactivatedProducts) + formatCount(result.deactivatedMaterials)} item(ns) inativado(s).`,
    `${formatCount(result.errors)} erro(s).`,
  ];
  if (ambiguous > 0) {
    parts.push(
      `${ambiguous} código(s) continuam como ambíguos e precisam de decisão humana.`
    );
  }
  parts.push("A BOM dos produtos não foi alterada.");
  return parts.join(" ");
}

function mapApplyErrors(result: EqualizeApplyResult): EqualizeApplyErrorItem[] {
  if (result.applyErrors?.length) return result.applyErrors;
  return result.report
    .filter((r) => r.outcome === "FAILED")
    .map((r) => ({
      code: r.code,
      action: r.action,
      message: r.message,
      userMessage: `Não foi possível processar ${r.code} (${equalizeActionLabel(r.action)}).`,
      resolutionHint: "Revise o cadastro no Nomus e no IndusCost, depois rode o preview novamente.",
      sku: r.code,
    }));
}

export function buildEqualizeUserMessage(result: EqualizeApplyResult, preview?: EqualizeTotals | null): string {
  const ambiguous = formatCount(preview?.ambiguous);
  switch (result.status) {
    case "APPLIED":
      return ambiguous > 0
        ? "A base de cadastro do IndusCost foi comparada com o Nomus e os itens seguros foram atualizados. Alguns códigos ambíguos ainda precisam de revisão manual."
        : "A base de cadastro do IndusCost foi comparada com o Nomus e os itens seguros foram atualizados. Nenhuma estrutura de BOM, custo, preço, proposta ou pedido foi alterado.";
    case "NO_CHANGES":
      return "Nenhuma alteração foi necessária. Os cadastros controlados pelo Nomus já estão alinhados com o IndusCost. Ainda podem existir itens ambíguos para revisão manual.";
    case "PARTIAL":
      return "Parte dos itens foi atualizada, mas alguns não puderam ser processados. Revise os itens com erro antes de executar novamente.";
    case "BLOCKED":
      return result.userMessage || result.message || "Operação bloqueada por segurança.";
    case "FAILED":
    default:
      return (
        result.userMessage ||
        result.message ||
        "Igualação falhou — verifique o relatório técnico."
      );
  }
}

export function buildEqualizeModalViewModel(
  result: EqualizeApplyResult,
  preview?: EqualizeTotals | null
): EqualizeModalViewModel {
  const previewTotals = preview ?? result.previewTotals ?? null;
  const preservedItems =
    formatCount(previewTotals?.preserveLocalProducts) +
    formatCount(previewTotals?.preserveLocalMaterials);
  const ambiguous = formatCount(previewTotals?.ambiguous);
  const blocked = formatCount(Math.max(previewTotals?.blocked ?? 0, result.blocked));
  const preserveNomusControlled = formatCount(previewTotals?.preserveNomusControlled);
  const failedItems = mapApplyErrors(result);
  const userMessage = buildEqualizeUserMessage(result, previewTotals);
  const executiveSummary = buildExecutiveSummary(result, previewTotals);

  const pendingLines: string[] = [];
  if (ambiguous > 0) {
    pendingLines.push(
      `${ambiguous} código(s) ambíguo(s): existem como Produto e Material no IndusCost. Precisam de decisão humana antes de qualquer automação.`
    );
  }
  if (blocked > 0) {
    pendingLines.push(
      `${blocked} item(ns) bloqueado(s) por segurança (ex.: montagem local 800.xx ou descrição vazia).`
    );
  }
  if (formatCount(result.errors) > 0) {
    pendingLines.push(`${formatCount(result.errors)} item(ns) com falha na aplicação.`);
  }
  if (preserveNomusControlled > 0) {
    pendingLines.push(
      `${preserveNomusControlled} item(ns) já alinhados com o Nomus — nenhuma ação necessária.`
    );
  }
  if (preservedItems > 0) {
    pendingLines.push(
      `${preservedItems} item(ns) locais preservados — o IndusCost não alterou cadastros manuais.`
    );
  }

  let variant: EqualizeModalViewModel["variant"] = "success";
  let title = "Bases igualadas com sucesso";
  let resolutionHint: string | null = null;
  let failureKind: EqualizeFailureKind | null = null;

  if (result.status === "NO_CHANGES") {
    variant = "info";
    title = "Bases já estavam alinhadas";
  } else if (result.status === "PARTIAL") {
    variant = "warning";
    title = "Igualação concluída parcialmente";
    resolutionHint =
      "Revise os itens com erro na lista abaixo. Corrija no cadastro e execute o preview antes de tentar novamente.";
  } else if (result.status === "BLOCKED" || result.status === "FAILED") {
    variant = "error";
    title = "Não foi possível igualar as bases";
    failureKind = classifyEqualizeHttpError(result.message);
    const fp = failurePresentation(failureKind);
    if (!result.userMessage || result.userMessage === result.message) {
      // keep backend userMessage when present
    }
    resolutionHint = fp.resolutionHint;
    if (result.status === "BLOCKED" && /confirmação/i.test(result.message)) {
      failureKind = "CONFIRMATION";
      resolutionHint = failurePresentation("CONFIRMATION").resolutionHint;
    }
  }

  return {
    variant,
    title,
    userMessage,
    executiveSummary,
    resolutionHint,
    failureKind,
    statusLabel: EQUALIZE_STATUS_LABEL[result.status] ?? result.status,
    counts: {
      createdProducts: formatCount(result.createdProducts),
      createdMaterials: formatCount(result.createdMaterials),
      updatedProducts: formatCount(result.updatedProducts),
      updatedMaterials: formatCount(result.updatedMaterials),
      deactivatedProducts: formatCount(result.deactivatedProducts),
      deactivatedMaterials: formatCount(result.deactivatedMaterials),
      preservedItems,
      preserveNomusControlled,
      ambiguous,
      blocked,
      errors: formatCount(result.errors),
      historyEntriesCreated: formatCount(result.historyEntriesCreated),
    },
    safetyLines: [...EQUALIZE_SAFETY_LINES],
    pendingLines,
    failedItems,
    runId: result.runId?.trim() ? result.runId.trim() : null,
    planHash: result.technicalDetails?.planHash ?? null,
    generatedAt: result.generatedAt,
    technicalMessage: result.message,
    status: result.status,
  };
}

export function buildEqualizeFailureViewModel(
  errorMessage: string,
  options?: { httpStatus?: number; isNetwork?: boolean }
): EqualizeModalViewModel {
  const kind = options?.isNetwork
    ? "NETWORK"
    : classifyEqualizeHttpError(errorMessage, options?.httpStatus);
  const fp = failurePresentation(kind);
  const now = new Date().toISOString();
  return {
    variant: "error",
    title: fp.title,
    userMessage: fp.userMessage,
    executiveSummary: errorMessage,
    resolutionHint: fp.resolutionHint,
    failureKind: kind,
    statusLabel: "Falhou antes de concluir",
    counts: {
      createdProducts: 0,
      createdMaterials: 0,
      updatedProducts: 0,
      updatedMaterials: 0,
      deactivatedProducts: 0,
      deactivatedMaterials: 0,
      preservedItems: 0,
      preserveNomusControlled: 0,
      ambiguous: 0,
      blocked: 0,
      errors: 0,
      historyEntriesCreated: 0,
    },
    safetyLines: [...EQUALIZE_SAFETY_LINES],
    pendingLines: [],
    failedItems: [],
    runId: null,
    planHash: null,
    generatedAt: now,
    technicalMessage: errorMessage,
    status: "NETWORK_ERROR",
  };
}

export function buildEqualizeTechnicalReport(
  vm: EqualizeModalViewModel,
  extra?: { previewGeneratedAt?: string }
): string {
  const lines: string[] = [
    "Relatório da Igualação de Bases Nomus",
    `Status: ${vm.statusLabel}`,
  ];
  if (vm.runId) lines.push(`RunId: ${vm.runId}`);
  lines.push(
    `Data/hora: ${new Date(vm.generatedAt).toLocaleString("pt-BR")}`,
    `Produtos criados: ${vm.counts.createdProducts}`,
    `Materiais criados: ${vm.counts.createdMaterials}`,
    `Produtos atualizados: ${vm.counts.updatedProducts}`,
    `Materiais atualizados: ${vm.counts.updatedMaterials}`,
    `Produtos inativados: ${vm.counts.deactivatedProducts}`,
    `Materiais inativados: ${vm.counts.deactivatedMaterials}`,
    `Itens preservados (locais): ${vm.counts.preservedItems}`,
    `Já alinhados Nomus: ${vm.counts.preserveNomusControlled}`,
    `Itens ambíguos: ${vm.counts.ambiguous}`,
    `Bloqueados: ${vm.counts.blocked}`,
    `Erros: ${vm.counts.errors}`,
    `Históricos criados: ${vm.counts.historyEntriesCreated}`,
    "BOM alterada: Não",
    "Custos alterados: Não",
    "Preços alterados: Não",
    "Propostas/Pedidos alterados: Não",
    "Roteiros alterados: Não",
    `Mensagem: ${vm.userMessage}`,
    `Resumo: ${vm.executiveSummary}`
  );
  if (vm.planHash) lines.push(`PlanHash: ${vm.planHash}`);
  if (extra?.previewGeneratedAt) {
    lines.push(`Preview gerado em: ${new Date(extra.previewGeneratedAt).toLocaleString("pt-BR")}`);
  }
  if (vm.resolutionHint) lines.push(`Ação recomendada: ${vm.resolutionHint}`);
  if (vm.failedItems.length > 0) {
    lines.push("", "Itens com falha:");
    for (const e of vm.failedItems.slice(0, 20)) {
      lines.push(`- ${e.sku}: ${e.message}`);
    }
    if (vm.failedItems.length > 20) {
      lines.push(`... e mais ${vm.failedItems.length - 20} item(ns).`);
    }
  }
  if (vm.technicalMessage && vm.technicalMessage !== vm.userMessage) {
    lines.push("", `Detalhe técnico: ${vm.technicalMessage}`);
  }
  return lines.join("\n");
}
