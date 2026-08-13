/**
 * Metas (OKR) — compilador de variáveis calculadas ("momento do cliente").
 *
 * Traduz um GoalConceptDefinition em SQL. A ideia inteira cabe em três
 * decisões:
 *
 *  1. WINDOW FUNCTION, não subquery por linha: uma passada calcula, para
 *     cada pedido, quantas compras o cliente tinha ANTES dele e quando foi a
 *     última — moldura `ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING`.
 *
 *  2. O HISTÓRICO NUNCA É RECORTADO PELA JANELA DA META. Se o CTE filtrasse
 *     por período, todo pedido de janeiro pareceria "primeira compra" e a
 *     meta mentiria. O período da meta entra só no filtro externo, DEPOIS da
 *     classificação. É a armadilha nº 1 deste recurso e tem teste dedicado.
 *
 *  3. O CTE é aliasado com o NOME DA TABELA ("SalesOrder"), então todo o
 *     resto do motor (métrica, período, filtros, desdobramento por vendedor)
 *     continua montando `"SalesOrder"."coluna"` sem saber que agora lê de um
 *     CTE. Zero mudança no caminho de quem não usa conceito.
 *
 * Poda: o histórico completo é lido apenas dos clientes que compraram dentro
 * da janela da meta — sem isso, a window function varreria a tabela inteira.
 *
 * Segurança: identificadores só do dicionário; valores do usuário viram
 * parâmetro; `$queryRawUnsafe` proibido, como no resto do motor.
 */

import { Prisma } from "@prisma/client";
import { GoalContractError } from "./goalContracts.js";
import {
  findGoalMetadataEntity,
  findGoalMetadataLink,
  type GoalMetadataEntity,
} from "./goalMetadata.js";
import { findGoalConcept, type GoalConceptDefinition } from "./goalConcepts.js";

/** NF-e considerada faturamento (mesma definição do módulo de Comissões). */
const NFE_STATUS_AUTHORIZED = 4;
const NFE_TIPO_OPERACAO_SAIDA = 1;

/** Colunas técnicas injetadas pelo CTE (prefixo reservado, nunca do dicionário). */
const HISTORY_COUNT_COLUMN = "__goal_hist_count";
const HISTORY_LAST_COLUMN = "__goal_hist_last";

/**
 * "Pedido faturado": existe NF-e autorizada de saída ligada ao pedido.
 * Vive em tabela filha, por isso é predicado curado e não coluna.
 */
export function invoicedOrderPredicateSql(
  entity: GoalMetadataEntity,
  invoiced: boolean
): Prisma.Sql {
  const exists = Prisma.sql`EXISTS (
    SELECT 1 FROM "SalesOrderNfeLink" nfe
    WHERE nfe."salesOrderId" = ${Prisma.raw(`"${entity.dbTable}"."id"`)}
      AND nfe."nfeStatus" = ${NFE_STATUS_AUTHORIZED}
      AND (nfe."tipoOperacao" IS NULL OR nfe."tipoOperacao" = ${NFE_TIPO_OPERACAO_SAIDA})
  )`;
  return invoiced ? exists : Prisma.sql`NOT ${exists}`;
}

/** Mesma regra, aplicada dentro do CTE de histórico (alias próprio). */
function invoicedHistoryPredicateSql(alias: string): Prisma.Sql {
  return Prisma.sql`EXISTS (
    SELECT 1 FROM "SalesOrderNfeLink" nfe
    WHERE nfe."salesOrderId" = ${Prisma.raw(`${alias}."id"`)}
      AND nfe."nfeStatus" = ${NFE_STATUS_AUTHORIZED}
      AND (nfe."tipoOperacao" IS NULL OR nfe."tipoOperacao" = ${NFE_TIPO_OPERACAO_SAIDA})
  )`;
}

export type GoalConceptFilter = {
  conceptKey: string;
  /** EQ = "é este momento"; NEQ = "não é". */
  negated: boolean;
};

/** Valida o conceito contra o dicionário — porta única, igual a resolveGoalRule. */
export function resolveGoalConcept(
  entity: GoalMetadataEntity,
  conceptKey: string
): GoalConceptDefinition {
  const concept = findGoalConcept(conceptKey);
  if (!concept) {
    throw new GoalContractError(
      "Situação do cliente desconhecida — escolha uma opção da lista.",
      "ruleJson.filters"
    );
  }
  if (concept.subjectEntityKey !== entity.key) {
    throw new GoalContractError(
      "Esta situação do cliente não se aplica a esta área de dados.",
      "ruleJson.filters"
    );
  }
  const link = findGoalMetadataLink(concept.partitionLinkKey);
  if (!link || link.eventEntityKey !== entity.key) {
    throw new GoalContractError(
      "Relação de histórico inválida para esta área de dados.",
      "ruleJson.filters"
    );
  }
  return concept;
}

/** Expressão de data relativa à linha ("3 meses antes deste pedido"). */
function timeExprSql(
  entity: GoalMetadataEntity,
  periodColumn: string,
  offset: { amount: number; unit: "DAY" | "MONTH" | "YEAR"; direction: "BACK" } | null
): Prisma.Sql {
  const eventDate = Prisma.raw(`"${entity.dbTable}"."${periodColumn}"`);
  if (!offset) return Prisma.sql`${eventDate}`;
  // make_interval com parâmetro inteiro: o "3 meses" é DADO, nunca SQL.
  const interval =
    offset.unit === "DAY"
      ? Prisma.sql`make_interval(days => ${offset.amount}::int)`
      : offset.unit === "MONTH"
        ? Prisma.sql`make_interval(months => ${offset.amount}::int)`
        : Prisma.sql`make_interval(years => ${offset.amount}::int)`;
  return Prisma.sql`(${eventDate} - ${interval})`;
}

function operatorSql(operator: "EQ" | "NEQ" | "GT" | "LT"): Prisma.Sql {
  switch (operator) {
    case "EQ":
      return Prisma.raw("=");
    case "NEQ":
      return Prisma.raw("<>");
    case "GT":
      return Prisma.raw(">");
    case "LT":
      return Prisma.raw("<");
  }
}

/** Predicado do conceito, já sobre as colunas técnicas do CTE. */
function conceptPredicateSql(
  entity: GoalMetadataEntity,
  concept: GoalConceptDefinition,
  periodColumn: string
): Prisma.Sql {
  let predicate: Prisma.Sql | null = null;
  for (const condition of concept.conditions) {
    const leftColumn =
      condition.left.aggregate === "COUNT" ? HISTORY_COUNT_COLUMN : HISTORY_LAST_COLUMN;
    const left = Prisma.raw(`"${entity.dbTable}"."${leftColumn}"`);
    const right =
      condition.right.type === "NUMBER"
        ? Prisma.sql`${Number(condition.right.value)}`
        : condition.right.type === "TIME_EXPR"
          ? timeExprSql(entity, periodColumn, condition.right.offset)
          : Prisma.raw(
              `"${entity.dbTable}"."${
                condition.right.aggregate === "COUNT"
                  ? HISTORY_COUNT_COLUMN
                  : HISTORY_LAST_COLUMN
              }"`
            );
    // COUNT sem histórico é 0; MAX_DATE sem histórico é NULL — e NULL em
    // comparação some da conta. "Nunca comprou" precisa ser explícito.
    const comparison = Prisma.sql`${left} ${operatorSql(condition.operator)} ${right}`;
    const guarded =
      condition.left.aggregate === "MAX_DATE"
        ? Prisma.sql`(${left} IS NOT NULL AND ${comparison})`
        : comparison;
    predicate =
      predicate == null
        ? guarded
        : condition.connector === "OR"
          ? Prisma.sql`${predicate} OR ${guarded}`
          : Prisma.sql`${predicate} AND ${guarded}`;
  }
  if (predicate == null) {
    throw new GoalContractError("Variável sem condições.", "ruleJson.filters");
  }
  return Prisma.sql`(${predicate})`;
}

export type CompiledConceptSource = {
  /** CTE completo (`WITH x AS (...)`) ou null quando não há conceito. */
  cte: Prisma.Sql | null;
  /** O que vai no FROM: tabela crua ou o CTE aliasado com o nome dela. */
  from: Prisma.Sql;
};

/**
 * Monta o CTE de histórico quando algum filtro usa variável calculada.
 *
 * Todas as variáveis da mesma entidade compartilham UM CTE: as duas colunas
 * técnicas (contagem e última compra anteriores) servem às três definições.
 */
export function compileConceptSource(
  entity: GoalMetadataEntity,
  concepts: GoalConceptDefinition[],
  window: { startCivilDate: string; endCivilDate: string }
): CompiledConceptSource {
  const table = Prisma.raw(`"${entity.dbTable}"`);
  if (concepts.length === 0) {
    return { cte: null, from: table };
  }

  const link = findGoalMetadataLink(concepts[0]!.partitionLinkKey);
  if (!link) {
    throw new GoalContractError("Relação de histórico desconhecida.", "ruleJson.filters");
  }
  for (const concept of concepts) {
    if (concept.partitionLinkKey !== link.key) {
      throw new GoalContractError(
        "As situações escolhidas usam históricos diferentes — use uma de cada vez.",
        "ruleJson.filters"
      );
    }
  }

  const alias = "goal_evt";
  const ownerCol = Prisma.raw(`${alias}."${link.eventOwnerDbColumn}"`);
  const dateCol = Prisma.raw(`${alias}."${link.eventPeriodDbColumn}"`);
  const startTs = `${window.startCivilDate}T00:00:00.000Z`;
  const endTs = `${window.endCivilDate}T00:00:00.000Z`;

  // Histórico só dos donos que tiveram evento na janela (poda de partição).
  const owners = Prisma.sql`
    SELECT DISTINCT ${Prisma.raw(`escopo."${link.eventOwnerDbColumn}"`)} AS owner_id
    FROM ${table} escopo
    WHERE ${Prisma.raw(`escopo."${link.eventPeriodDbColumn}"`)} >= ${startTs}::timestamptz
      AND ${Prisma.raw(`escopo."${link.eventPeriodDbColumn}"`)} < (${endTs}::timestamptz + interval '1 day')`;

  // Escopo do HISTÓRICO (decisão do negócio: só pedidos faturados) entra como
  // FILTER da agregação, não como WHERE do CTE: quem é faturado ou não é o
  // passado do cliente; a linha medida continua sendo qualquer pedido da
  // janela (se a meta quiser só faturados, isso é um filtro dela, visível na
  // frase). E, de novo: nada aqui recorta por período.
  const historyScope = concepts[0]!.historyFilters.some(
    (f) => f.fieldKey === "SALES_INVOICED" && f.value === "INVOICED"
  )
    ? Prisma.sql` FILTER (WHERE ${invoicedHistoryPredicateSql(alias)})`
    : Prisma.empty;

  // O CTE tem nome PRÓPRIO (goal_scope) e é aliasado com o nome da tabela no
  // FROM: o resto do motor segue montando `"SalesOrder"."coluna"` sem saber
  // que a origem mudou, e o corpo do CTE lê a tabela real sem ambiguidade.
  const cte = Prisma.sql`WITH goal_scope AS (
    SELECT ${Prisma.raw(`${alias}.*`)},
           COUNT(*)${historyScope} OVER janela_historico AS ${Prisma.raw(`"${HISTORY_COUNT_COLUMN}"`)},
           MAX(${dateCol})${historyScope} OVER janela_historico AS ${Prisma.raw(`"${HISTORY_LAST_COLUMN}"`)}
    FROM ${table} ${Prisma.raw(alias)}
    JOIN (${owners}) donos ON donos.owner_id = ${ownerCol}
    WINDOW janela_historico AS (
      PARTITION BY ${ownerCol}
      ORDER BY ${dateCol}, ${Prisma.raw(`${alias}."id"`)}
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
    )
  )`;

  return { cte, from: Prisma.raw(`goal_scope AS "${entity.dbTable}"`) };
}

/** Predicado final de cada filtro de conceito (já sobre o CTE). */
export function compileConceptFilter(
  entity: GoalMetadataEntity,
  concept: GoalConceptDefinition,
  negated: boolean,
  periodColumn: string
): Prisma.Sql {
  const predicate = conceptPredicateSql(entity, concept, periodColumn);
  return negated ? Prisma.sql`NOT ${predicate}` : predicate;
}

export function goalConceptEntityFor(entityKey: string): GoalMetadataEntity {
  const entity = findGoalMetadataEntity(entityKey);
  if (!entity) {
    throw new GoalContractError("Área de dados desconhecida.", "ruleJson.entityKey");
  }
  return entity;
}
