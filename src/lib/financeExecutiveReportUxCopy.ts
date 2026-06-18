/**
 * Textos de UX do Relatório Presidencial — linguagem simples, sem lógica financeira.
 */
import { formatFinanceDateTime } from "./financeAccountsReceivableFormat.js";
import type {
  FinanceExecutiveReportDataQuality,
  FinanceExecutiveReportNarrative,
} from "./financeExecutiveReportTypes.js";

export const EXECUTIVE_REPORT_MAX_NARRATIVE_BULLETS = 3;

export const EXECUTIVE_REPORT_MAX_LINE_CHARS = 120;

export const EXECUTIVE_REPORT_SOURCES_LABEL =
  "Dados de vendas, notas fiscais, contas a receber, contas a pagar e pedidos.";

export const EXECUTIVE_REPORT_NO_TARGET_MESSAGE =
  "Não há meta cadastrada para este período; o sistema usou uma referência automática.";

export const EXECUTIVE_REPORT_AUTO_TARGET_SHORT = "Meta automática";

export const EXECUTIVE_REPORT_PRINT_DATA_NOTE =
  "Relatório gerado com base nos dados disponíveis no IndusCost/Nomus na data-base selecionada.";

export const EXECUTIVE_DATA_QUALITY_TITLE = "Avisos sobre os dados";

export const EXECUTIVE_REPORT_SECTION_INTROS: Record<string, string> = {
  summary: "Visão rápida dos principais números da empresa.",
  "billing-comparison": "Mostra quanto foi vendido com nota fiscal.",
  "billing-projection": "Compara o que já aconteceu com a previsão até o fim do período.",
  "accounts-receivable": "Mostra os valores que os clientes ainda devem pagar.",
  "accounts-payable": "Mostra as obrigações da empresa com fornecedores.",
  "cash-flow": "Mostra se o caixa tende a ficar positivo ou negativo.",
  "sales-orders": "Mostra o volume de pedidos registrados.",
  conclusion: "Principais pontos de atenção para decisão.",
};

export const EXECUTIVE_REPORT_SECTION_SUBTITLES: Record<string, string> = {
  summary: "Números principais do mês selecionado.",
  "billing-comparison": "Vendas com nota fiscal mês a mês.",
  "billing-projection": "Realizado, projeção e meta do período.",
  "accounts-receivable": "Valores a receber dos clientes.",
  "accounts-payable": "Valores a pagar a fornecedores.",
  "cash-flow": "Entradas, saídas e saldo previsto.",
  "sales-orders": "Pedidos registrados no período.",
  conclusion: "Leitura rápida para apoiar a decisão.",
};

/** Tooltip curto — responde “O que é isso?” */
export const EXECUTIVE_REPORT_KPI_HINTS: Record<string, string> = {
  "Faturamento mês": "Valor das notas fiscais emitidas no mês.",
  "Atingimento meta mês": "Percentual da meta de faturamento já alcançado.",
  "Realizado mês": "Total já faturado com nota fiscal no mês.",
  "Projetado mês": "Estimativa de faturamento até o fim do mês.",
  "Meta mês": "Valor que a empresa precisa alcançar no mês.",
  YTD: "Total acumulado no ano até o mês selecionado.",
  "Média diária": "Média de faturamento por dia útil no mês.",
  Faturado: "Valor já faturado no mês.",
  Projetado: "Estimativa de faturamento até o fim do mês.",
  "Meta do ano": "Meta de faturamento para o ano.",
  Atingimento: "Percentual da meta já alcançado.",
  "A receber": "Valores em aberto que os clientes ainda precisam pagar.",
  Recebido: "Valores já recebidos dos clientes.",
  "Em aberto": "Valores que ainda não foram quitados.",
  Atrasados: "Valores vencidos que ainda não foram recebidos.",
  "A pagar total": "Total de contas em aberto com fornecedores.",
  Pago: "Valores já pagos a fornecedores.",
  Vencidos: "Contas vencidas que ainda precisam ser pagas.",
  "Entradas previstas": "Dinheiro que deve entrar no caixa.",
  "Saídas previstas": "Dinheiro que deve sair do caixa.",
  "Saldo líquido": "Entradas previstas menos saídas previstas.",
  "Saldo acumulado": "Saldo previsto acumulado no período.",
  "Realizado YTD": "Total de pedidos acumulado no ano.",
  "Projeção mês": "Estimativa de pedidos até o fim do mês.",
  "Vendido no mês":
    "Soma dos pedidos de venda válidos emitidos no mês selecionado. Não considera propostas.",
  "Atingimento mês pedidos": "Percentual do vendido no mês sobre a meta do mês.",
};

const UNAVAILABLE_SECTION_LABELS: Record<string, string> = {
  billing: "Faturamento",
  "billing-comparison": "Faturamento",
  "billing-projection": "Projeção",
  "accounts-receivable": "Contas a Receber",
  "accounts-payable": "Contas a Pagar",
  "cash-flow": "Fluxo de Caixa",
  "sales-orders": "Pedidos de Venda",
  conclusion: "Conclusão",
};

export function getExecutiveReportKpiHint(label: string): string | undefined {
  const direct = EXECUTIVE_REPORT_KPI_HINTS[label];
  if (direct) return direct;
  if (label.startsWith("Faturamento mês —")) {
    return "Total vendido com nota fiscal no mês.";
  }
  return undefined;
}

export function formatExecutiveReportGeneratedFooter(generatedAt: string): string {
  return `Documento gerado pelo IndusCost em ${formatFinanceDateTime(generatedAt)}`;
}

export function formatExecutiveReportStaleSyncWarning(
  sourceLabel: string,
  syncAt: string
): string {
  return `Atenção: os dados de ${sourceLabel} podem estar desatualizados (última atualização em ${formatFinanceDateTime(syncAt)}).`;
}

export function formatExecutiveReportBillingYearsSubtitle(years: number[]): string {
  if (years.length === 0) {
    return "Comparativo por ano — valores em reais";
  }
  return `Comparativo ${years.join(" · ")} — valores em reais`;
}

export function translateExecutiveReportUnavailableSection(sectionId: string): string {
  return UNAVAILABLE_SECTION_LABELS[sectionId] ?? sectionId;
}

export function translateExecutiveReportWarning(warning: string): string {
  const w = warning.trim();
  if (!w) return w;

  if (/Metas de faturamento derivadas/i.test(w)) {
    return "Meta estimada: não há meta cadastrada, então o sistema usou uma referência automática.";
  }
  if (/Base AR exclui títulos stale/i.test(w)) {
    return "Alguns títulos antigos de contas a receber foram ignorados porque os dados podem estar desatualizados.";
  }
  if (/Base AP exclui títulos stale/i.test(w)) {
    return "Alguns títulos antigos de contas a pagar foram ignorados porque os dados podem estar desatualizados.";
  }
  if (/Última sync de Contas a Receber indisponível/i.test(w)) {
    return "Não foi possível confirmar quando os dados de contas a receber foram atualizados.";
  }
  if (/Última sync de Contas a Pagar indisponível/i.test(w)) {
    return "Não foi possível confirmar quando os dados de contas a pagar foram atualizados.";
  }
  if (/Última sync de NF-e indisponível/i.test(w)) {
    return "Não foi possível confirmar quando os dados de notas fiscais foram atualizados.";
  }
  if (/targetsDerived/i.test(w)) {
    return "Meta estimada automaticamente.";
  }
  if (/stale/i.test(w) && /Nomus/i.test(w)) {
    return "Dados do Nomus podem estar desatualizados.";
  }
  if (/sync/i.test(w) && /desatualiz/i.test(w)) {
    return "Alguns dados podem estar desatualizados.";
  }

  return truncateExecutiveReportLine(w);
}

export function truncateExecutiveReportLine(text: string, max = EXECUTIVE_REPORT_MAX_LINE_CHARS): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trim()}…`;
}

export function simplifyExecutiveHighlight(text: string): string {
  const t = text.trim();
  if (!t) return t;

  if (/déficit|negativ/i.test(t)) {
    return "Atenção: as saídas previstas são maiores que as entradas.";
  }
  if (/superávit|positiv/i.test(t)) {
    return "Bom sinal: o caixa tende a sobrar no período.";
  }
  if (/vencid|atrasad/i.test(t) && /receber/i.test(t)) {
    return "Atenção: existem valores vencidos a receber.";
  }
  if (/vencid|atrasad/i.test(t) && /pagar/i.test(t)) {
    return "Verificar: há contas vencidas a pagar.";
  }
  if (/meta/i.test(t) && /acima|superior/i.test(t)) {
    return "Bom sinal: o faturamento está acima da meta.";
  }
  if (/meta/i.test(t) && /abaixo|inferior/i.test(t)) {
    return "Faturamento do período está abaixo da meta.";
  }

  return truncateExecutiveReportLine(t);
}

export function simplifyExecutiveNarrativeSection(section: {
  id: string;
  title: string;
  body: string;
}): string {
  const { id, body } = section;

  if (id === "billing-target") {
    if (/acima/i.test(body)) return "Bom sinal: o faturamento está acima da meta.";
    if (/abaixo/i.test(body)) return "Faturamento do período está abaixo da meta.";
    if (/em linha/i.test(body)) return "Faturamento está em linha com a meta.";
    return "Faturamento comparado com a meta do mês.";
  }
  if (id === "billing-target-missing") {
    return "Não há meta cadastrada para este período.";
  }
  if (id === "billing-year-projection") {
    return "Projeção indica quanto falta para bater a meta do mês.";
  }
  if (id === "cashflow-negative-months") {
    return "Fluxo previsto exige atenção nos próximos meses.";
  }
  if (id === "ar-open") {
    if (/vencid|atrasad/i.test(body)) {
      return "Contas a receber vencidas precisam de cobrança.";
    }
    return "Há valores a receber em aberto no período.";
  }
  if (id === "ap-open") {
    if (/vencid|atrasad/i.test(body)) {
      return "Verificar: há contas vencidas a pagar.";
    }
    return "Há contas a pagar em aberto no período.";
  }
  if (id.startsWith("sales-")) {
    return "Pedidos comerciais comparados com a meta do período.";
  }

  return truncateExecutiveReportLine(body);
}

export function presentExecutiveReportNarrativeBullets(input: {
  highlights?: string[];
  narrative?: FinanceExecutiveReportNarrative | null;
  warnings?: string[];
  max?: number;
}): string[] {
  const max = input.max ?? EXECUTIVE_REPORT_MAX_NARRATIVE_BULLETS;
  const bullets: string[] = [];

  for (const line of input.highlights ?? []) {
    const simplified = simplifyExecutiveHighlight(line);
    if (simplified && !bullets.includes(simplified)) bullets.push(simplified);
    if (bullets.length >= max) return bullets.slice(0, max);
  }

  for (const section of input.narrative?.sections ?? []) {
    const simplified = simplifyExecutiveNarrativeSection(section);
    if (simplified && !bullets.includes(simplified)) bullets.push(simplified);
    if (bullets.length >= max) return bullets.slice(0, max);
  }

  for (const warning of input.warnings ?? []) {
    const simplified = translateExecutiveReportWarning(warning);
    if (simplified && !bullets.includes(simplified)) bullets.push(simplified);
    if (bullets.length >= max) return bullets.slice(0, max);
  }

  return bullets.slice(0, max);
}

export function buildExecutiveReportStaleSyncNotices(
  dataQuality: FinanceExecutiveReportDataQuality
): string[] {
  const { sync, freshness } = dataQuality;
  const notices: string[] = [];

  if (freshness.arStaleExcluded && sync.accountsReceivableLastSyncAt) {
    notices.push(
      formatExecutiveReportStaleSyncWarning("Contas a Receber", sync.accountsReceivableLastSyncAt)
    );
  }
  if (freshness.apStaleExcluded && sync.accountsPayableLastSyncAt) {
    notices.push(
      formatExecutiveReportStaleSyncWarning("Contas a Pagar", sync.accountsPayableLastSyncAt)
    );
  }
  if (sync.nfeLastSyncAt && dataQuality.targetsDerived) {
    notices.push(formatExecutiveReportStaleSyncWarning("Notas fiscais", sync.nfeLastSyncAt));
  }

  return notices;
}

export function formatExecutiveReportSyncLabel(label: string): string {
  if (label === "Sync AR") return "Contas a receber";
  if (label === "Sync AP") return "Contas a pagar";
  if (label === "Sync NF-e") return "Notas fiscais";
  if (label === "Sync Pedidos") return "Pedidos de venda";
  return label;
}
