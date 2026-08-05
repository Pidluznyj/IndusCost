/**
 * Serviço dos três cenários da Caixa (server-only).
 *
 * NÃO chama endpoint HTTP interno; consome:
 *   - createTreasuryCaixaService.getBoard() para reaproveitar canonicalDays,
 *     openingBalance encadeado, arResult/apResult carregados;
 *   - createTreasuryScenarioPolicyService.getForEngine() para os parâmetros;
 *   - complementos operacionais (`TreasuryTitleOperationalComplement`) e
 *     promessas ativas (`TreasuryPaymentPromise`) carregados numa consulta
 *     única por tipo de título.
 *
 * O motor puro `computeTreasuryCaixaScenarios` faz o resto — este service só
 * carrega/monta o input.
 */

import type { PrismaClient } from "@prisma/client";
import {
  computeTreasuryCaixaScenarios,
  type TreasuryScenarioComputationResult,
  type TreasuryScenarioOpenPayable,
  type TreasuryScenarioOpenReceivable,
} from "../domain/treasuryCaixaScenarios.js";
import {
  isTreasuryCivilDate,
  parseTreasuryCivilDate,
  todayTreasuryCivilDateInSaoPaulo,
  type TreasuryCivilDate,
} from "../contracts/treasuryCivilDate.js";
import type { TreasuryCaixaPeriodInput } from "../domain/treasuryCaixaRules.js";
import type { TreasuryCaixaBoardDto } from "../domain/treasuryCaixaRules.js";
import {
  createTreasuryCaixaService,
  type TreasuryCaixaService,
} from "./treasuryCaixaService.server.js";
import {
  createTreasuryScenarioPolicyService,
  type TreasuryScenarioPolicyService,
} from "./treasuryScenarioPolicyService.server.js";
import type { TreasuryScenarioPolicyDto } from "../contracts/treasuryScenarioPolicyContracts.js";

export type TreasuryCaixaScenariosRequest = {
  /** Se omitido, usa a data civil de hoje em SP. */
  asOfCivilDate?: TreasuryCivilDate | null;
  /**
   * Horizonte em dias corridos a partir de asOf (inclusive). Se `year`/`month`
   * forem passados sem horizonte, o período do board manda; caso contrário
   * horizon = 90 (default seguro).
   */
  horizonDays?: number | null;
  /**
   * Filtro do board (delegado a getBoard). Quando ausente, o service escolhe
   * `year` do asOf; `month/day` só são passados quando explicitamente pedidos.
   */
  year?: number | null;
  month?: number | null;
  day?: number | null;
};

export type TreasuryCaixaScenariosResponse = TreasuryScenarioComputationResult & {
  period: TreasuryCaixaPeriodInput;
  dueDateFrom: string;
  dueDateTo: string;
  policy: TreasuryScenarioPolicyDto;
  /** Contas incluídas — placeholder de contrato; expansão nas próximas fases. */
  accountIds: string[] | null;
  /** Fonte do saldo inicial usado pelos cenários — auditabilidade da UI. */
  officialTodayBalance: TreasuryCaixaBoardDto["officialTodayBalance"];
};

const DEFAULT_HORIZON_DAYS = 90;
const MAX_HORIZON_DAYS = 365;

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function normalizeAsOf(value: unknown): TreasuryCivilDate {
  if (typeof value === "string" && isTreasuryCivilDate(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    return parseTreasuryCivilDate(value, "asOfCivilDate");
  }
  return todayTreasuryCivilDateInSaoPaulo();
}

function normalizeHorizon(value: unknown): number {
  if (value == null || value === "") return DEFAULT_HORIZON_DAYS;
  const n = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(n)) return DEFAULT_HORIZON_DAYS;
  if (n <= 0) return 1;
  if (n > MAX_HORIZON_DAYS) return MAX_HORIZON_DAYS;
  return Math.floor(n);
}

/**
 * Enriquece os títulos de CR/CP com complementos operacionais em UMA consulta
 * por tipo. O motor puro precisa: expectedDate, confirmedDate, scheduledDate,
 * status de promessa ativa, status de programação. Nomus continua fonte
 * oficial — o complemento é PARALELO, nunca sobrescreve o `dueDate`.
 */
async function loadReceivablesWithComplements(
  prisma: PrismaClient,
  board: TreasuryCaixaBoardDto,
  asOfCivilDate: string
): Promise<TreasuryScenarioOpenReceivable[]> {
  const openRows = board.receivables.filter(
    (r) => r.balanceReceivable > 0 && !r.suspendCollection
  );
  if (openRows.length === 0) return [];

  const externalIds = openRows.map((r) => r.externalId);

  // Complementos operacionais (expected/confirmed) — 1 consulta.
  const complements = await prisma.treasuryTitleOperationalComplement.findMany({
    where: {
      titleType: "RECEIVABLE",
      officialExternalId: { in: externalIds },
      cancelledAt: null,
    },
    select: {
      officialExternalId: true,
      expectedDate: true,
      confirmedDate: true,
    },
  });
  const complementByExternalId = new Map<
    number,
    (typeof complements)[number]
  >();
  for (const c of complements) {
    complementByExternalId.set(c.officialExternalId, c);
  }

  // Promessas ativas (ACTIVE ou PARTIALLY_FULFILLED) — 1 consulta.
  const promises = await prisma.treasuryPaymentPromise.findMany({
    where: {
      titleType: "RECEIVABLE",
      officialExternalId: { in: externalIds },
      status: { in: ["ACTIVE", "PARTIALLY_FULFILLED"] },
      cancelledAt: null,
    },
    select: {
      officialExternalId: true,
      promisedDate: true,
      status: true,
    },
    orderBy: { promisedDate: "asc" },
  });
  const promiseByExternalId = new Map<number, (typeof promises)[number]>();
  for (const p of promises) {
    // Se houver mais de uma, mantém a MAIS PRÓXIMA (asc = primeira).
    if (!promiseByExternalId.has(p.officialExternalId)) {
      promiseByExternalId.set(p.officialExternalId, p);
    }
  }
  // Promessas BROKEN/EXPIRED por título (para o pessimista saber).
  const brokenPromises = await prisma.treasuryPaymentPromise.findMany({
    where: {
      titleType: "RECEIVABLE",
      officialExternalId: { in: externalIds },
      status: { in: ["BROKEN", "EXPIRED"] },
      cancelledAt: null,
    },
    select: { officialExternalId: true },
  });
  const hasBrokenSet = new Set<number>(
    brokenPromises.map((p) => p.officialExternalId)
  );

  return openRows.map<TreasuryScenarioOpenReceivable>((r) => {
    const cmp = complementByExternalId.get(r.externalId);
    const pr = promiseByExternalId.get(r.externalId);
    return {
      externalId: r.externalId,
      personName: r.personName,
      personCnpj: r.personCnpj,
      dueDate: r.dueDate,
      settlementDate: r.settlementDate,
      amountReceivable: r.amountReceivable,
      amountReceived: r.amountReceived,
      balanceReceivable: r.balanceReceivable,
      calculatedStatus: r.calculatedStatus,
      documentNumber: r.sourceInvoiceNumber ?? null,
      activePromiseDate: pr ? toIsoDate(pr.promisedDate) : null,
      activePromiseStatus: pr?.status ?? null,
      expectedDate: cmp?.expectedDate ? toIsoDate(cmp.expectedDate) : null,
      confirmedDate: cmp?.confirmedDate ? toIsoDate(cmp.confirmedDate) : null,
      hasBrokenPromise: hasBrokenSet.has(r.externalId),
    };
  });
}

async function loadPayablesWithComplements(
  prisma: PrismaClient,
  board: TreasuryCaixaBoardDto,
  _asOfCivilDate: string
): Promise<TreasuryScenarioOpenPayable[]> {
  const openRows = board.payables.filter(
    (p) => p.balancePayable > 0 && !p.suspendPayment
  );
  if (openRows.length === 0) return [];

  const externalIds = openRows.map((p) => p.externalId);
  const complements = await prisma.treasuryTitleOperationalComplement.findMany({
    where: {
      titleType: "PAYABLE",
      officialExternalId: { in: externalIds },
      cancelledAt: null,
    },
    select: {
      officialExternalId: true,
      expectedDate: true,
      confirmedDate: true,
      scheduledDate: true,
      status: true,
    },
  });
  const complementByExternalId = new Map<
    number,
    (typeof complements)[number]
  >();
  for (const c of complements) {
    complementByExternalId.set(c.officialExternalId, c);
  }

  return openRows.map<TreasuryScenarioOpenPayable>((p) => {
    const cmp = complementByExternalId.get(p.externalId);
    return {
      externalId: p.externalId,
      personName: p.personName,
      personCnpj: p.personCnpj,
      dueDate: p.dueDate,
      paymentDate: p.paymentDate,
      amountPayable: p.amountPayable,
      amountPaid: p.amountPaid,
      balancePayable: p.balancePayable,
      calculatedStatus: p.calculatedStatus,
      documentNumber: p.documentNumber,
      scheduledDate: cmp?.scheduledDate ? toIsoDate(cmp.scheduledDate) : null,
      expectedDate: cmp?.expectedDate ? toIsoDate(cmp.expectedDate) : null,
      confirmedDate: cmp?.confirmedDate ? toIsoDate(cmp.confirmedDate) : null,
      programmingStatus: cmp?.status ?? null,
    };
  });
}

export type TreasuryCaixaScenariosService = {
  getBoard(
    request: TreasuryCaixaScenariosRequest
  ): Promise<TreasuryCaixaScenariosResponse>;
};

export function createTreasuryCaixaScenariosService(deps: {
  prisma: PrismaClient;
  caixaService?: TreasuryCaixaService;
  policyService?: TreasuryScenarioPolicyService;
}): TreasuryCaixaScenariosService {
  const prisma = deps.prisma;
  const caixa = deps.caixaService ?? createTreasuryCaixaService({ prisma });
  const policy =
    deps.policyService ?? createTreasuryScenarioPolicyService({ prisma });

  return {
    async getBoard(request) {
      const asOfCivilDate = normalizeAsOf(request.asOfCivilDate);
      const horizonDays = normalizeHorizon(request.horizonDays);

      // Board padrão: ano do asOf, sem month/day → carrega o ano inteiro.
      // Assim o motor tem toda a população de AR/AP; a janela de dias que
      // sai no gráfico é o horizonte.
      const year =
        request.year != null && Number.isFinite(request.year)
          ? request.year
          : Number(asOfCivilDate.slice(0, 4));
      const period: TreasuryCaixaPeriodInput = {
        year,
        month: request.month ?? undefined,
        day: request.day ?? undefined,
      };
      const board = await caixa.getBoard(period);
      const policyDto = await policy.getForEngine();

      // Janela civil da projeção: do asOf até asOf + horizonDays.
      const asOfDate = new Date(`${asOfCivilDate}T00:00:00`);
      const civilDatesInWindow: string[] = [];
      for (let i = 0; i < horizonDays; i += 1) {
        const d = new Date(asOfDate);
        d.setDate(d.getDate() + i);
        civilDatesInWindow.push(toIsoDate(d));
      }

      // Ainda pode ser útil ver o passado curto (semana anterior) para o
      // gráfico mostrar de onde vem. Adiciona 7 dias antes de asOf desde que
      // caibam no board (o board carregou ano inteiro).
      const daysBeforeAsOf = 7;
      const past: string[] = [];
      for (let i = daysBeforeAsOf; i >= 1; i -= 1) {
        const d = new Date(asOfDate);
        d.setDate(d.getDate() - i);
        const iso = toIsoDate(d);
        if (iso >= board.dueDateFrom) past.push(iso);
      }
      const fullWindow = [...past, ...civilDatesInWindow];

      // Saldo inicial da janela — precedência:
      //   1. Âncora oficial de saldo de HOJE (a mais confiável — fechamento
      //      CLOSED, snapshots ou availableBalance do Nomus). Quando existir,
      //      o primeiro dia da projeção passa a ser HOJE e o saldo abre com
      //      a âncora — o gráfico não depende mais da cadeia calculada desde
      //      a gênese (que começa em zero, ignora aportes sem título).
      //   2. openingBalance do canonicalDays[firstWindow] (cadeia calculada).
      //   3. Fallback: último realizedDays.closing conhecido.
      let firstWindowDay = fullWindow[0] ?? asOfCivilDate;
      let openingBalanceOfFirstDay: number | null = null;

      if (board.officialTodayBalance.amount != null) {
        // Ancora em hoje: recorta a janela para começar EM asOf (descarta o
        // passado curto), assim o "opening" da janela é o próprio saldo real.
        firstWindowDay = asOfCivilDate;
        openingBalanceOfFirstDay = board.officialTodayBalance.amount;
      } else {
        const canonicalFirst = board.canonicalDays.find(
          (d) => d.civilDate === firstWindowDay
        );
        openingBalanceOfFirstDay = canonicalFirst?.openingBalance ?? null;
        if (openingBalanceOfFirstDay == null) {
          for (let i = board.realizedDays.length - 1; i >= 0; i -= 1) {
            const rd = board.realizedDays[i]!;
            if (rd.civilDate < firstWindowDay && rd.closing != null) {
              openingBalanceOfFirstDay = rd.closing;
              break;
            }
          }
        }
      }
      const projectedWindow =
        board.officialTodayBalance.amount != null
          ? civilDatesInWindow
          : fullWindow;

      const openReceivables = await loadReceivablesWithComplements(
        prisma,
        board,
        asOfCivilDate
      );
      const openPayables = await loadPayablesWithComplements(
        prisma,
        board,
        asOfCivilDate
      );

      const result = computeTreasuryCaixaScenarios({
        asOfCivilDate,
        civilDatesInWindow: projectedWindow,
        canonicalDays: board.canonicalDays,
        openReceivables,
        openPayables,
        policy: policyDto,
        openingBalanceOfFirstDay,
      });

      return {
        ...result,
        period,
        dueDateFrom: board.dueDateFrom,
        dueDateTo: board.dueDateTo,
        policy: policyDto,
        accountIds: null,
        officialTodayBalance: board.officialTodayBalance,
      };
    },
  };
}
