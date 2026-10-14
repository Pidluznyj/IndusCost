/**
 * Recebíveis Mensais — seleção de pedidos candidatos pelo vencimento.
 *
 * Só decide QUAIS pedidos passam pelo cálculo canônico (auditoria 360º → FIN-05 →
 * FIN-08). Não calcula valor nem cobertura e não substitui nenhuma regra financeira.
 *
 * Linhas com vencimento que o relatório pode mostrar, e de onde vem a data:
 * - CR real: `receivables[].dueDate` (CR das NF-e do pedido);
 * - previsão do pedido (original ou residual): `plannedReceivables[].dueDate`, datas
 *   das parcelas originais da condição do pedido;
 * - documento aguardando CR: sem vencimento (`dueDate: null`), nunca entra em um mês.
 *
 * A regra é deliberadamente mais larga que a canônica (um superconjunto): ignora
 * cobertura, supressões, situação e origem, e alarga a janela em um mês de cada lado
 * contra diferenças de fuso na data. Quem decide se o pedido entra continua sendo o
 * cálculo canônico; aqui só não se pode deixar ninguém de fora.
 */
import { formatYearMonthKey, parseYearMonthKey, yearMonthKeyFromDueIso } from "./salesOrderMonthlyReceivablesReport.js";

export type MonthlyReceivablesCandidateProjection = {
  receivables: ReadonlyArray<{ dueDate: string | null }>;
  plannedReceivables: ReadonlyArray<{ dueDate: string | null }>;
};

function shiftMonthKey(key: string, delta: number): string | null {
  const parsed = parseYearMonthKey(key);
  if (!parsed) return null;
  const index = parsed.year * 12 + (parsed.month - 1) + delta;
  return formatYearMonthKey(Math.floor(index / 12), (index % 12) + 1);
}

/** Meses das colunas do relatório, mais um mês antes e um depois. */
export function buildCandidateDueWindow(monthKeys: readonly string[]): Set<string> {
  const window = new Set<string>(monthKeys);
  if (monthKeys.length > 0) {
    const before = shiftMonthKey(monthKeys[0]!, -1);
    const after = shiftMonthKey(monthKeys[monthKeys.length - 1]!, 1);
    if (before) window.add(before);
    if (after) window.add(after);
  }
  return window;
}

/** Tem CR ou parcela prevista vencendo na janela? */
export function projectionHasDueInWindow(
  projection: MonthlyReceivablesCandidateProjection,
  window: ReadonlySet<string>
): boolean {
  for (const line of [...projection.receivables, ...projection.plannedReceivables]) {
    const key = yearMonthKeyFromDueIso(line.dueDate);
    if (key && window.has(key)) return true;
  }
  return false;
}
