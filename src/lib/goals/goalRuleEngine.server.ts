/**
 * Metas (OKR) — Motor de Tradução de Regras (o "cisne por baixo d'água").
 *
 * Traduz o ruleJson do KR (CHAVES do dicionário goalMetadata) em UMA query
 * agregada, segura e parametrizada:
 *   - identificadores (tabela/coluna) vêm SEMPRE do dicionário — o input do
 *     usuário nunca vira identificador SQL (whitelist total);
 *   - valores de filtro entram como parâmetros (Prisma.sql`${...}`) — zero
 *     injeção; `$queryRawUnsafe` é proibido neste módulo;
 *   - o período do Objetivo é SEMPRE aplicado na coluna de data da métrica
 *     (a meta só conta o que aconteceu na janela dela);
 *   - filtros extras são empilhados linearmente com AND/OR (RN-004) com a
 *     precedência natural do SQL;
 *   - desdobramento (RN-006): quando a entidade tem employeeDbColumn e a
 *     execução pede uma pessoa, o recorte é injetado invisivelmente.
 */

import { Prisma, type PrismaClient } from "@prisma/client";
import {
  GOAL_FILTER_CONNECTORS,
  GOAL_FILTER_OPERATORS,
  findGoalMetadataEntity,
  findGoalMetadataField,
  findGoalMetadataMetric,
  type GoalFilterConnector,
  type GoalFilterOperator,
  type GoalMetadataEntity,
  type GoalMetadataField,
  type GoalMetadataMetric,
} from "./goalMetadata.js";
import { GoalContractError } from "./goalContracts.js";

export type GoalRuleFilter = {
  fieldKey: string;
  operator: GoalFilterOperator;
  /** Valor do usuário (parametrizado). null para IS_EMPTY. */
  value: string | null;
  /** Conector com o filtro ANTERIOR (ignorado no primeiro). */
  connector: GoalFilterConnector;
};

export type GoalRule = {
  entityKey: string;
  metricKey: string;
  filters: GoalRuleFilter[];
};

export type GoalRuleResolved = {
  entity: GoalMetadataEntity;
  metric: GoalMetadataMetric;
  filters: Array<{ field: GoalMetadataField; filter: GoalRuleFilter }>;
};

/** Valida o ruleJson contra o dicionário — única porta de entrada do motor. */
export function resolveGoalRule(ruleJson: unknown): GoalRuleResolved {
  if (!ruleJson || typeof ruleJson !== "object") {
    throw new GoalContractError("Regra de medição inválida.", "ruleJson");
  }
  const raw = ruleJson as Record<string, unknown>;
  const entity = findGoalMetadataEntity(String(raw.entityKey ?? ""));
  if (!entity) {
    throw new GoalContractError(
      "Área de dados desconhecida — escolha uma opção da lista.",
      "ruleJson.entityKey"
    );
  }
  const metric = findGoalMetadataMetric(entity, String(raw.metricKey ?? ""));
  if (!metric) {
    throw new GoalContractError(
      "Indicador desconhecido para esta área — escolha uma opção da lista.",
      "ruleJson.metricKey"
    );
  }
  const rawFilters = Array.isArray(raw.filters) ? raw.filters : [];
  if (rawFilters.length > 10) {
    throw new GoalContractError("Máximo de 10 regras de exceção.", "ruleJson.filters");
  }
  const filters: GoalRuleResolved["filters"] = rawFilters.map((f, index) => {
    const row = (f ?? {}) as Record<string, unknown>;
    const field = findGoalMetadataField(entity, String(row.fieldKey ?? ""));
    if (!field) {
      throw new GoalContractError(
        `Campo da regra ${index + 1} desconhecido — escolha uma opção da lista.`,
        `ruleJson.filters[${index}].fieldKey`
      );
    }
    const operator = String(row.operator ?? "") as GoalFilterOperator;
    if (!GOAL_FILTER_OPERATORS.includes(operator) || !field.operators.includes(operator)) {
      throw new GoalContractError(
        `Condição da regra ${index + 1} não permitida para este campo.`,
        `ruleJson.filters[${index}].operator`
      );
    }
    const connector = String(row.connector ?? "AND") as GoalFilterConnector;
    if (!GOAL_FILTER_CONNECTORS.includes(connector)) {
      throw new GoalContractError(
        `Conector da regra ${index + 1} inválido.`,
        `ruleJson.filters[${index}].connector`
      );
    }
    let value: string | null = null;
    if (operator !== "IS_EMPTY") {
      const rawValue = row.value;
      if (rawValue == null || String(rawValue).trim() === "") {
        throw new GoalContractError(
          `Informe o valor da regra ${index + 1}.`,
          `ruleJson.filters[${index}].value`
        );
      }
      value = String(rawValue).trim().slice(0, 200);
      if (field.type === "ENUM") {
        const allowed = (field.options ?? []).some((o) => o.value === value);
        if (!allowed) {
          throw new GoalContractError(
            `Valor da regra ${index + 1} fora da lista permitida.`,
            `ruleJson.filters[${index}].value`
          );
        }
      }
      if (field.type === "NUMBER" && !/^-?\d+(\.\d{1,6})?$/.test(value)) {
        throw new GoalContractError(
          `Valor da regra ${index + 1} deve ser numérico.`,
          `ruleJson.filters[${index}].value`
        );
      }
    }
    return { field, filter: { fieldKey: field.key, operator, value, connector } };
  });

  return { entity, metric, filters };
}

/** ruleJson canônico (normalizado) para persistir no KR. */
export function normalizeGoalRuleForPersist(ruleJson: unknown): GoalRule {
  const resolved = resolveGoalRule(ruleJson);
  return {
    entityKey: resolved.entity.key,
    metricKey: resolved.metric.key,
    filters: resolved.filters.map(({ filter }) => filter),
  };
}

function columnSql(table: string, column: string): Prisma.Sql {
  // Identificadores SEMPRE do dicionário (whitelist) — nunca do usuário.
  return Prisma.raw(`"${table}"."${column}"`);
}

function filterConditionSql(
  entity: GoalMetadataEntity,
  field: GoalMetadataField,
  operator: GoalFilterOperator,
  value: string | null
): Prisma.Sql {
  const col = columnSql(entity.dbTable, field.dbColumn);
  switch (operator) {
    case "EQ":
      return field.type === "ENUM"
        ? Prisma.sql`${col}::text = ${value}`
        : field.type === "NUMBER"
          ? Prisma.sql`${col} = ${Number(value)}`
          : Prisma.sql`${col} = ${value}`;
    case "NEQ":
      return field.type === "ENUM"
        ? Prisma.sql`${col}::text <> ${value}`
        : field.type === "NUMBER"
          ? Prisma.sql`${col} <> ${Number(value)}`
          : Prisma.sql`${col} <> ${value}`;
    case "GT":
      return Prisma.sql`${col} > ${Number(value)}`;
    case "LT":
      return Prisma.sql`${col} < ${Number(value)}`;
    case "CONTAINS":
      return Prisma.sql`${col} ILIKE ${"%" + value + "%"}`;
    case "IS_EMPTY":
      return Prisma.sql`(${col} IS NULL OR ${col}::text = '')`;
  }
}

export type GoalRuleExecutionWindow = {
  /** Início do período do Objetivo (YYYY-MM-DD, inclusivo). */
  startCivilDate: string;
  /** Fim do período (YYYY-MM-DD, inclusivo — o motor fecha em < dia+1). */
  endCivilDate: string;
};

export type GoalRuleExecutionOptions = {
  /**
   * Recorte por pessoa (desdobramento RN-006): valor comparado contra a
   * employeeDbColumn da entidade. Erro se a entidade não suporta.
   */
  employeeColumnValue?: number | string | null;
};

/** Monta a query agregada completa (exportado para teste determinístico). */
export function buildGoalRuleQuery(
  resolved: GoalRuleResolved,
  window: GoalRuleExecutionWindow,
  options: GoalRuleExecutionOptions = {}
): Prisma.Sql {
  const { entity, metric, filters } = resolved;

  const aggregate =
    metric.operation === "COUNT"
      ? Prisma.raw(`COUNT(*)::text`)
      : metric.operation === "SUM"
        ? Prisma.raw(
            `COALESCE(SUM("${entity.dbTable}"."${metric.dbColumn}"), 0)::text`
          )
        : Prisma.raw(
            `COALESCE(AVG("${entity.dbTable}"."${metric.dbColumn}"), 0)::text`
          );

  const periodCol = columnSql(entity.dbTable, metric.periodDbColumn);
  const startTs = `${window.startCivilDate}T00:00:00.000Z`;
  const endExclusiveTs = `${window.endCivilDate}T00:00:00.000Z`;

  // Período do Objetivo: [start, end+1dia) — inclusivo no dia final.
  let where = Prisma.sql`${periodCol} >= ${startTs}::timestamptz AND ${periodCol} < (${endExclusiveTs}::timestamptz + interval '1 day')`;

  if (options.employeeColumnValue != null) {
    if (!entity.employeeDbColumn) {
      throw new GoalContractError(
        "Esta área de dados não permite desdobramento individual automático.",
        "ruleJson.entityKey"
      );
    }
    const employeeCol = columnSql(entity.dbTable, entity.employeeDbColumn);
    where = Prisma.sql`${where} AND ${employeeCol} = ${options.employeeColumnValue}`;
  }

  // Filtros do usuário: empilhamento linear com AND/OR (precedência SQL
  // natural), agrupados em parênteses para não vazar sobre o período.
  if (filters.length > 0) {
    let stacked = filterConditionSql(
      resolved.entity,
      filters[0]!.field,
      filters[0]!.filter.operator,
      filters[0]!.filter.value
    );
    for (const { field, filter } of filters.slice(1)) {
      const condition = filterConditionSql(resolved.entity, field, filter.operator, filter.value);
      stacked =
        filter.connector === "OR"
          ? Prisma.sql`${stacked} OR ${condition}`
          : Prisma.sql`${stacked} AND ${condition}`;
    }
    where = Prisma.sql`${where} AND (${stacked})`;
  }

  return Prisma.sql`SELECT ${aggregate} AS value FROM ${Prisma.raw(`"${entity.dbTable}"`)} WHERE ${where}`;
}

/** Executa a regra e devolve o valor agregado como string decimal. */
export async function executeGoalRule(
  prisma: PrismaClient,
  ruleJson: unknown,
  window: GoalRuleExecutionWindow,
  options: GoalRuleExecutionOptions = {}
): Promise<string> {
  const resolved = resolveGoalRule(ruleJson);
  const query = buildGoalRuleQuery(resolved, window, options);
  const rows = await prisma.$queryRaw<Array<{ value: string | null }>>(query);
  const value = rows[0]?.value;
  return value == null || value === "" ? "0" : String(value);
}
