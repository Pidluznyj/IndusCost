/**
 * Motor único-de-dia da Caixa — fonte canônica para "Movimento de hoje",
 * cabeçalho do drill-down da Linha do tempo, e qualquer tela futura que
 * pergunte "o que aconteceu / vai acontecer neste dia?".
 *
 * Regra de ouro: NÃO recalcula fluxo — apenas COMPÕE o que os motores oficiais
 * já produzem, projetando cada título/movimento numa das seis dimensões
 * disjuntas do dia, com data e regra explícitas:
 *
 *   receivableDue      = títulos CR em aberto vencendo neste dia
 *   receivableReceived = títulos CR baixados neste dia (settlementDate)
 *   payableDue         = títulos CP em aberto vencendo neste dia
 *   payablePaid        = títulos CP baixados neste dia (paymentDate,
 *                        fallback dueDate quando Nomus não informa — mesma
 *                        regra canônica de `buildTreasuryCaixaRealizedDays`)
 *   otherInflows       = ledger CREDIT + transferências recebidas no dia
 *   otherOutflows      = ledger DEBIT + transferências saídas no dia
 *
 * Populações disjuntas por construção: um mesmo título nunca aparece em
 * `receivableDue` e `receivableReceived` no mesmo dia (se está aberto, não
 * foi baixado; se foi baixado, não está aberto). Ledger/transferências vivem
 * numa dimensão separada — nunca é somado silenciosamente ao "recebido/pago".
 *
 * Motivo: hoje "Saiu" do card, "A pagar hoje" da dica e "Contas a pagar" do
 * drill-down apresentam três populações diferentes para o mesmo dia — cada
 * camada consulta uma fonte com regra própria. Este motor entrega os seis
 * números por dia, com as listas de títulos que compõem cada um; o front só
 * apresenta.
 */

import type { FinanceAccountsPayableGridRow } from "@/src/lib/financeAccountsPayableRulesEngine.js";
import type { FinanceAccountsReceivableGridRow } from "@/src/lib/financeAccountsReceivableRulesEngine.js";

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Título que forma um dos totais do dia, na projeção da grid oficial. */
export type TreasuryCaixaCanonicalDayReceivableTitle = {
  externalId: number;
  personName: string | null;
  personCnpj: string | null;
  dueDate: string | null;
  settlementDate: string | null;
  amountReceivable: number;
  amountReceived: number;
  balanceReceivable: number;
  calculatedStatus: string;
  documentNumber?: string | null;
};

export type TreasuryCaixaCanonicalDayPayableTitle = {
  externalId: number;
  personName: string | null;
  personCnpj: string | null;
  dueDate: string | null;
  paymentDate: string | null;
  amountPayable: number;
  amountPaid: number;
  balancePayable: number;
  calculatedStatus: string;
  documentNumber: string | null;
};

/** Movimento sem título por trás (ledger / transferência). */
export type TreasuryCaixaCanonicalDayOtherMovement = {
  origin: "LEDGER" | "TRANSFER";
  direction: "IN" | "OUT";
  amount: number;
  note?: string | null;
};

/** Tipos de alerta que o motor diário pode emitir por dia. */
export type TreasuryCaixaCanonicalDayWarningCode =
  | "NO_OPENING_BALANCE"
  | "PARTIAL_LOAD"
  | "OTHER_MOVEMENTS_NOT_LOADED"
  | "OPENING_BALANCE_FROM_WEAK_SOURCE"
  | "OFFICIAL_BALANCE_PARTIAL_ACCOUNTS";

export type TreasuryCaixaCanonicalDayWarning = {
  code: TreasuryCaixaCanonicalDayWarningCode;
  message: string;
};

/**
 * Fatos elementares do dia — cada dimensão traz o total (soma dos títulos que
 * a compõem) e a lista que fecha esse total.
 *
 * Convenção null vs 0:
 *  - Totais das dimensões elementares (receivableDue/…): número — 0 é fato
 *    (nenhum título vencendo/baixado). Se a fonte falhou de carregar, o
 *    campo relevante recebe warning `PARTIAL_LOAD`, não vira null.
 *  - openingBalance/closingRealizedBalance/closingProjectedBalance: `null` =
 *    saldo INDISPONÍVEL (nenhuma origem informou; anterior à gênese; etc).
 *    A UI mostra "—". Nunca vira R$ 0,00 falso.
 */
export type TreasuryCaixaCanonicalDay = {
  civilDate: string;

  // ── Fatos elementares (dimensões disjuntas) ─────────────────────────────
  receivableDue: number;
  receivableDueTitles: TreasuryCaixaCanonicalDayReceivableTitle[];

  receivableReceived: number;
  receivableReceivedTitles: TreasuryCaixaCanonicalDayReceivableTitle[];

  payableDue: number;
  payableDueTitles: TreasuryCaixaCanonicalDayPayableTitle[];

  payablePaid: number;
  payablePaidTitles: TreasuryCaixaCanonicalDayPayableTitle[];

  otherInflows: number;
  otherOutflows: number;
  otherMovements: TreasuryCaixaCanonicalDayOtherMovement[];

  // ── Agregados derivados dos fatos elementares ───────────────────────────
  /**
   * realizedInflows = receivableReceived + otherInflows
   * realizedOutflows = payablePaid + otherOutflows
   * Reflete somente o que EFETIVAMENTE aconteceu no dia (baixas + ledger/
   * transferência). Não inclui título em aberto vencendo.
   */
  realizedInflows: number;
  realizedOutflows: number;
  /**
   * projectedInflows = receivableDue
   * projectedOutflows = payableDue
   * Reflete somente o que está PROJETADO por vencimento (títulos em aberto
   * vencendo neste dia). Não inclui já-realizado.
   */
  projectedInflows: number;
  projectedOutflows: number;

  // ── Saldo do dia ────────────────────────────────────────────────────────
  /** Saldo de abertura do dia (fechamento realizado do dia anterior). */
  openingBalance: number | null;
  /**
   * Fechamento realizado: opening + realizedInflows − realizedOutflows.
   * `null` quando `openingBalance` é `null`.
   */
  closingRealizedBalance: number | null;
  /**
   * Fechamento projetado: opening + realizedInflows + projectedInflows
   *                    − realizedOutflows − projectedOutflows.
   * Vale como fechamento do dia para efeito de encadeamento quando o dia
   * é futuro (ainda não houve realização). `null` quando `openingBalance`
   * é `null`.
   */
  closingProjectedBalance: number | null;

  /** Alertas do dia — indisponibilidades, cargas parciais, etc. */
  warnings: TreasuryCaixaCanonicalDayWarning[];
};

/**
 * Fallback canônico da data efetiva de pagamento do CP — mesma regra usada por
 * `buildTreasuryCaixaRealizedDays`, extraída aqui para o motor único também
 * consumir. Nomus quase nunca preenche `paymentDate`; quando o título foi
 * baixado (`amountPaid > 0`) o `dueDate` vale como data em que o dinheiro
 * andou.
 */
function resolveApRealizedCivilDate(
  row: Pick<FinanceAccountsPayableGridRow, "dueDate" | "paymentDate" | "amountPaid">
): string | null {
  if (!(row.amountPaid > 0)) return null;
  const key = row.paymentDate ?? row.dueDate;
  return key ? key.slice(0, 10) : null;
}

/**
 * Se o CR foi baixado (`amountReceived > 0`), a data que conta é a
 * liquidação — sem fallback: o motor oficial só considera CR realizado
 * quando `settlementDate` existe.
 */
function resolveArRealizedCivilDate(
  row: Pick<FinanceAccountsReceivableGridRow, "settlementDate" | "amountReceived">
): string | null {
  if (!(row.amountReceived > 0)) return null;
  return row.settlementDate ? row.settlementDate.slice(0, 10) : null;
}

/**
 * Filtra rows CR/CP da grid oficial que ainda estão em aberto (saldo > 0) e
 * NÃO estão suspensos/cancelados — mesma regra do "A receber/A pagar hoje"
 * (`sumOfficialArOpenDueByCivilDay`/`sumOfficialApOpenDueByCivilDay`) do
 * canônico. Suspensos ficam de fora do FLUXO (o Ledger zera lá), embora
 * ainda apareçam na listagem de gestão.
 */
function isArOpenDueTitle(row: FinanceAccountsReceivableGridRow): boolean {
  if (row.suspendCollection) return false;
  return row.balanceReceivable > 0;
}

function isApOpenDueTitle(row: FinanceAccountsPayableGridRow): boolean {
  if (row.suspendPayment) return false;
  return row.balancePayable > 0;
}

function toReceivableTitleDto(
  row: FinanceAccountsReceivableGridRow
): TreasuryCaixaCanonicalDayReceivableTitle {
  return {
    externalId: row.externalId,
    personName: row.personName,
    personCnpj: row.personCnpj,
    dueDate: row.dueDate,
    settlementDate: row.settlementDate,
    amountReceivable: row.amountReceivable,
    amountReceived: row.amountReceived,
    balanceReceivable: row.balanceReceivable,
    calculatedStatus: row.calculatedStatus,
    documentNumber: row.sourceInvoiceNumber ?? null,
  };
}

function toPayableTitleDto(
  row: FinanceAccountsPayableGridRow
): TreasuryCaixaCanonicalDayPayableTitle {
  return {
    externalId: row.externalId,
    personName: row.personName,
    personCnpj: row.personCnpj,
    dueDate: row.dueDate,
    paymentDate: row.paymentDate,
    amountPayable: row.amountPayable,
    amountPaid: row.amountPaid,
    balancePayable: row.balancePayable,
    calculatedStatus: row.calculatedStatus,
    documentNumber: row.documentNumber,
  };
}

export type TreasuryCaixaCanonicalDayInput = {
  /**
   * Datas civis (YYYY-MM-DD) que o motor deve enxergar — normalmente o
   * período consultado. Dias fora dessa janela ficam de fora do resultado
   * mesmo quando há título vencendo/baixado ali (a Linha do tempo já corta
   * por período, o motor único obedece a mesma janela).
   */
  civilDatesInWindow: readonly string[];
  /** Grid CR oficial (mesma fonte do `data.receivables`). */
  receivables: readonly FinanceAccountsReceivableGridRow[];
  /** Grid CP oficial (mesma fonte do `data.payables`). */
  payables: readonly FinanceAccountsPayableGridRow[];
  /**
   * Movimentos "outros" (ledger/transferência) por dia civil — o motor não
   * consulta banco, quem carrega passa. Vazio = nenhum movimento fora de
   * título; nunca vira zero silencioso: as três dimensões CR/CP ainda contam.
   * Quando o carregamento externo falhar/for parcial, quem chama pode
   * marcar `otherMovementsLoadStatus = "partial"` para emitir aviso do
   * motor sem inventar zero.
   */
  otherMovementsByCivilDate?: ReadonlyMap<
    string,
    readonly TreasuryCaixaCanonicalDayOtherMovement[]
  >;
  /**
   * Estado do carregamento de ledger/transfer:
   *   - "loaded" (default): motor considerou completo, ausência = zero real
   *   - "partial": marca warning `PARTIAL_LOAD` em cada dia — a UI mostra que
   *      "outras entradas/saídas" pode estar subestimada.
   *   - "not_loaded": marca warning `OTHER_MOVEMENTS_NOT_LOADED` — o motor
   *      não pergunta pela fonte porque ela é opcional (ex.: dias passados
   *      no board, rotina só cobre hoje).
   */
  otherMovementsLoadStatus?: "loaded" | "partial" | "not_loaded";
  /**
   * Saldo inicial da janela (fechamento realizado do dia anterior ao
   * primeiro dia). `null` = nenhuma origem informou (dia anterior à gênese,
   * ou snapshot ausente) — a UI mostra "—" e o motor emite warning
   * `NO_OPENING_BALANCE` no primeiro dia.
   */
  openingBalanceOfFirstDay?: number | null;
  /**
   * Âncora oficial de SALDO DE HOJE — quando presente, RE-ANCORA a cadeia
   * no dia informado (não substitui `openingBalanceOfFirstDay`; se o dia da
   * âncora estiver dentro da janela, ele passa a ser o fechamento realizado
   * daquele dia, e o dia seguinte abre nele).
   *
   * A força da âncora depende da fonte (ver `officialTodayBalanceSource`):
   * DAILY_CLOSING é imutável; ACCOUNT_LATEST_BALANCE emite warning para a UI
   * mostrar que o saldo pode não bater centavo a centavo com um extrato
   * conciliado.
   */
  officialTodayBalance?: {
    civilDate: string;
    amount: number;
    /** Rótulo pt-BR curto para exibir na UI (fonte legível). */
    sourceLabel: string;
    /** Força da fonte — governa o warning por dia. */
    strength: "STRONG" | "MEDIUM" | "WEAK";
    /** Cobertura de contas incompleta emite warning à parte. */
    accountsPartial?: boolean;
  } | null;
};

/**
 * Constrói o mapa canônico dia→dimensões a partir das mesmas populações que
 * a Linha do tempo já usa. Não faz round-trip, não recalcula fluxo, não
 * consulta banco: só projeta título em dimensão pela regra explícita.
 *
 * Invariantes garantidos por construção (cobertos por teste):
 *   Σ receivableDueTitles[amount = balanceReceivable] == receivableDue
 *   Σ receivableReceivedTitles[amount = amountReceived] == receivableReceived
 *   Σ payableDueTitles[amount = balancePayable] == payableDue
 *   Σ payablePaidTitles[amount = amountPaid] == payablePaid
 *   Σ otherMovements.filter(IN)[amount] == otherInflows
 *   Σ otherMovements.filter(OUT)[amount] == otherOutflows
 * Um título CR nunca aparece em receivableDue E receivableReceived NO MESMO
 * DIA (dimensões disjuntas por saldo/baixa). CP idem.
 */
export function buildTreasuryCaixaCanonicalDays(
  input: TreasuryCaixaCanonicalDayInput
): TreasuryCaixaCanonicalDay[] {
  const windowSet = new Set(input.civilDatesInWindow);
  const byDate = new Map<string, TreasuryCaixaCanonicalDay>();

  function bucket(civilDate: string): TreasuryCaixaCanonicalDay | null {
    if (!windowSet.has(civilDate)) return null;
    let existing = byDate.get(civilDate);
    if (existing) return existing;
    existing = {
      civilDate,
      receivableDue: 0,
      receivableDueTitles: [],
      receivableReceived: 0,
      receivableReceivedTitles: [],
      payableDue: 0,
      payableDueTitles: [],
      payablePaid: 0,
      payablePaidTitles: [],
      otherInflows: 0,
      otherOutflows: 0,
      otherMovements: [],
      realizedInflows: 0,
      realizedOutflows: 0,
      projectedInflows: 0,
      projectedOutflows: 0,
      openingBalance: null,
      closingRealizedBalance: null,
      closingProjectedBalance: null,
      warnings: [],
    };
    byDate.set(civilDate, existing);
    return existing;
  }

  // Sempre cria a linha para cada dia da janela, mesmo sem movimento —
  // "0.00 com lista vazia" é diferente de "sem dado" e evita gap na UI.
  for (const civilDate of windowSet) {
    bucket(civilDate);
  }

  // Dimensão AR — receivableDue e receivableReceived são DISJUNTAS por título
  // no mesmo dia: se baixou hoje, entra em Received; se está aberto vencendo
  // hoje, entra em Due. Nunca as duas — o motor oficial só marca uma delas.
  for (const row of input.receivables) {
    const settledOn = resolveArRealizedCivilDate(row);
    if (settledOn) {
      const day = bucket(settledOn);
      if (day) {
        day.receivableReceived += row.amountReceived;
        day.receivableReceivedTitles.push(toReceivableTitleDto(row));
      }
    }
    if (isArOpenDueTitle(row)) {
      const dueOn = row.dueDate?.slice(0, 10);
      if (dueOn) {
        const day = bucket(dueOn);
        if (day) {
          day.receivableDue += row.balanceReceivable;
          day.receivableDueTitles.push(toReceivableTitleDto(row));
        }
      }
    }
  }

  for (const row of input.payables) {
    const paidOn = resolveApRealizedCivilDate(row);
    if (paidOn) {
      const day = bucket(paidOn);
      if (day) {
        day.payablePaid += row.amountPaid;
        day.payablePaidTitles.push(toPayableTitleDto(row));
      }
    }
    if (isApOpenDueTitle(row)) {
      // Regra canônica: para "a pagar", o vencimento OPERACIONAL prevalece
      // quando existe (schedule), senão o oficial — mesmo tratamento do
      // `sumOfficialApOpenDueByCivilDay`.
      const dueOn = (row.operationalDueDate ?? row.dueDate)?.slice(0, 10);
      if (dueOn) {
        const day = bucket(dueOn);
        if (day) {
          day.payableDue += row.balancePayable;
          day.payableDueTitles.push(toPayableTitleDto(row));
        }
      }
    }
  }

  if (input.otherMovementsByCivilDate) {
    for (const [civilDate, movements] of input.otherMovementsByCivilDate) {
      const day = bucket(civilDate);
      if (!day) continue;
      for (const mv of movements) {
        if (!Number.isFinite(mv.amount) || mv.amount <= 0) continue;
        day.otherMovements.push(mv);
        if (mv.direction === "IN") day.otherInflows += mv.amount;
        else day.otherOutflows += mv.amount;
      }
    }
  }

  // Passo 1 — normaliza os fatos elementares e deriva os agregados/dimensões.
  const normalized = [...byDate.values()]
    .map((d) => {
      const receivableDue = roundMoney(d.receivableDue);
      const receivableReceived = roundMoney(d.receivableReceived);
      const payableDue = roundMoney(d.payableDue);
      const payablePaid = roundMoney(d.payablePaid);
      const otherInflows = roundMoney(d.otherInflows);
      const otherOutflows = roundMoney(d.otherOutflows);
      return {
        ...d,
        receivableDue,
        receivableReceived,
        payableDue,
        payablePaid,
        otherInflows,
        otherOutflows,
        realizedInflows: roundMoney(receivableReceived + otherInflows),
        realizedOutflows: roundMoney(payablePaid + otherOutflows),
        projectedInflows: receivableDue,
        projectedOutflows: payableDue,
      };
    })
    .sort((a, b) => a.civilDate.localeCompare(b.civilDate));

  // Passo 2 — encadeia o saldo dia a dia. Cadeia = fechamento REALIZADO
  // do dia N vira abertura do dia N+1 (spec: saldo realizado final =
  // abertura + recebido + outras entradas realizadas − pago − outras
  // saídas realizadas). O fechamento PROJETADO acrescenta os títulos em
  // aberto vencendo no dia, mas NÃO propaga na cadeia (projeção não vira
  // verdade de saldo).
  //
  // Se houver âncora oficial de saldo (`officialTodayBalance`) dentro da
  // janela, o dia da âncora RE-ANCORA a cadeia: o fechamento REALIZADO
  // daquele dia passa a ser o valor da âncora, e o dia seguinte abre nele.
  // Isso libera o motor da fragilidade da cadeia inteira desde a gênese —
  // basta ter o saldo oficial de hoje (que o card superior já mostra).
  const otherStatus = input.otherMovementsLoadStatus ?? "loaded";
  const anchor = input.officialTodayBalance ?? null;
  let opening: number | null =
    input.openingBalanceOfFirstDay != null &&
    Number.isFinite(input.openingBalanceOfFirstDay)
      ? roundMoney(input.openingBalanceOfFirstDay)
      : null;

  const result: TreasuryCaixaCanonicalDay[] = [];
  let isFirst = true;
  for (const d of normalized) {
    const warnings: TreasuryCaixaCanonicalDayWarning[] = [];
    if (isFirst && opening == null && !(anchor && anchor.civilDate <= d.civilDate)) {
      warnings.push({
        code: "NO_OPENING_BALANCE",
        message:
          "Saldo inicial da janela não informado — abertura, fechamento realizado e fechamento projetado ficam indisponíveis até que ao menos uma origem informe saldo.",
      });
    }
    if (otherStatus === "partial") {
      warnings.push({
        code: "PARTIAL_LOAD",
        message:
          "Outras entradas/saídas do dia podem estar subestimadas: fonte externa (ledger/transfer) devolveu carga parcial.",
      });
    } else if (otherStatus === "not_loaded") {
      warnings.push({
        code: "OTHER_MOVEMENTS_NOT_LOADED",
        message:
          "Outras entradas/saídas não foram carregadas para este dia (fonte externa opcional).",
      });
    }

    // Se este dia é o dia da âncora, o fechamento realizado passa a ser o
    // valor oficial — a cadeia se re-ancora aqui.
    const isAnchorDay = anchor != null && d.civilDate === anchor.civilDate;
    const closingRealizedBalance = isAnchorDay
      ? roundMoney(anchor!.amount)
      : opening == null
        ? null
        : roundMoney(opening + d.realizedInflows - d.realizedOutflows);
    // Projetado usa o realizado como base + projeções do próprio dia.
    const closingProjectedBalance =
      closingRealizedBalance == null
        ? null
        : roundMoney(
            closingRealizedBalance +
              d.projectedInflows -
              d.projectedOutflows
          );

    if (isAnchorDay) {
      if (anchor!.strength === "WEAK") {
        warnings.push({
          code: "OPENING_BALANCE_FROM_WEAK_SOURCE",
          message: `Saldo de ${d.civilDate} veio de fonte fraca (${anchor!.sourceLabel}) — pode não bater centavo com um extrato conciliado.`,
        });
      }
      if (anchor!.accountsPartial) {
        warnings.push({
          code: "OFFICIAL_BALANCE_PARTIAL_ACCOUNTS",
          message: `Nem todas as contas do consolidado tinham saldo informado — ${anchor!.sourceLabel}.`,
        });
      }
    }

    result.push({
      ...d,
      openingBalance: opening,
      closingRealizedBalance,
      closingProjectedBalance,
      warnings,
    });

    // Cadeia usa SEMPRE o realizado — a projeção não vira "verdade" de saldo.
    opening = closingRealizedBalance;
    isFirst = false;
  }

  return result;
}

/**
 * Encontra o dia canônico pela data civil — helper para o card
 * "Movimento de hoje" (dia único) e para o drill-down (dia clicado).
 */
export function findTreasuryCaixaCanonicalDay(
  days: readonly TreasuryCaixaCanonicalDay[],
  civilDate: string
): TreasuryCaixaCanonicalDay | null {
  return days.find((d) => d.civilDate === civilDate) ?? null;
}

/**
 * Total mensal derivado da soma dos dias canônicos — a Linha do tempo mensal
 * do Fluxo de Caixa ganha uma soma que fecha no centavo com a diária por
 * construção (mesma dimensão, mesma população).
 */
export type TreasuryCaixaCanonicalMonthTotals = {
  monthKey: string;
  receivableDue: number;
  receivableReceived: number;
  payableDue: number;
  payablePaid: number;
  otherInflows: number;
  otherOutflows: number;
};

export function aggregateTreasuryCaixaCanonicalDaysByMonth(
  days: readonly TreasuryCaixaCanonicalDay[]
): TreasuryCaixaCanonicalMonthTotals[] {
  const byMonth = new Map<string, TreasuryCaixaCanonicalMonthTotals>();
  for (const day of days) {
    const monthKey = day.civilDate.slice(0, 7);
    let existing = byMonth.get(monthKey);
    if (!existing) {
      existing = {
        monthKey,
        receivableDue: 0,
        receivableReceived: 0,
        payableDue: 0,
        payablePaid: 0,
        otherInflows: 0,
        otherOutflows: 0,
      };
      byMonth.set(monthKey, existing);
    }
    existing.receivableDue += day.receivableDue;
    existing.receivableReceived += day.receivableReceived;
    existing.payableDue += day.payableDue;
    existing.payablePaid += day.payablePaid;
    existing.otherInflows += day.otherInflows;
    existing.otherOutflows += day.otherOutflows;
  }
  return [...byMonth.values()]
    .map((m) => ({
      ...m,
      receivableDue: roundMoney(m.receivableDue),
      receivableReceived: roundMoney(m.receivableReceived),
      payableDue: roundMoney(m.payableDue),
      payablePaid: roundMoney(m.payablePaid),
      otherInflows: roundMoney(m.otherInflows),
      otherOutflows: roundMoney(m.otherOutflows),
    }))
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey));
}
