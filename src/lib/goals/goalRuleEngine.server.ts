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
import {
  compileConceptFilter,
  compileConceptSource,
  invoicedOrderPredicateSql,
  resolveGoalConcept,
} from "./goalConceptCompiler.server.js";
import {
  findGoalMetricProvider,
  type GoalMetricProvider,
  type GoalMetricProviderKey,
} from "./goalMetricProviders.server.js";

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
  // Métrica OFICIAL (provider): a regra é a do domínio dono do número —
  // fechada. Filtro personalizado aqui criaria uma variação "quase oficial"
  // que ninguém consegue auditar; quem precisa de recorte usa a área de
  // medição personalizada correspondente.
  if (metric.providerKey && rawFilters.length > 0) {
    throw new GoalContractError(
      "Esta é uma medição oficial — ela segue exatamente a regra do módulo de origem e não aceita regras de exceção. Para filtrar, use a medição personalizada da mesma área.",
      "ruleJson.filters"
    );
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

  // Variáveis calculadas custam uma window function cada; acima de duas a
  // meta virou relatório — e a frase deixa de ser legível para o usuário.
  const conceptFilters = filters.filter(
    ({ field }) => field.predicate === "CUSTOMER_MOMENT"
  );
  if (conceptFilters.length > 2) {
    throw new GoalContractError(
      "Use no máximo duas situações de cliente na mesma medição.",
      "ruleJson.filters"
    );
  }

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
  value: string | null,
  periodDbColumn: string
): Prisma.Sql {
  // Predicados curados (faturamento, momento do cliente) não são comparação
  // de coluna — quem monta o SQL deles é o compilador de conceitos.
  if (field.predicate === "INVOICED_ORDER") {
    const invoiced = value === "INVOICED";
    return invoicedOrderPredicateSql(entity, operator === "NEQ" ? !invoiced : invoiced);
  }
  if (field.predicate === "CUSTOMER_MOMENT") {
    const concept = resolveGoalConcept(entity, String(value));
    return compileConceptFilter(entity, concept, operator === "NEQ", periodDbColumn);
  }
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
  /**
   * SÓ PARA TESTE: registry de providers com deps fake. Produção sempre usa
   * o registry oficial (default).
   */
  providerRegistry?: ReadonlyMap<GoalMetricProviderKey, GoalMetricProvider>;
};

/**
 * Provider da métrica OFICIAL, se houver. Métrica com providerKey sem
 * provider registrado é contrato quebrado — erro claro, nunca SQL próprio.
 */
function resolveMetricProvider(
  resolved: GoalRuleResolved,
  options: GoalRuleExecutionOptions
): GoalMetricProvider | null {
  const key = resolved.metric.providerKey;
  if (!key) return null;
  const provider = findGoalMetricProvider(key, options.providerRegistry);
  if (!provider) {
    throw new GoalContractError(
      "Medição oficial indisponível no momento — o provedor desta métrica não está registrado.",
      "ruleJson.metricKey"
    );
  }
  if (options.employeeColumnValue != null && !provider.capabilities.employeeSlice) {
    throw new GoalContractError(
      "Esta medição oficial ainda não suporta desdobramento por pessoa.",
      "ruleJson.metricKey"
    );
  }
  return provider;
}

/**
 * Origem + filtro da regra, sem o SELECT — a parte que TODA leitura da meta
 * compartilha (valor único e série mensal). Existe para as duas nunca
 * divergirem: mesmo período, mesmo desdobramento, mesmos filtros, mesmo CTE de
 * conceitos.
 */
function buildGoalRuleSource(
  resolved: GoalRuleResolved,
  window: GoalRuleExecutionWindow,
  options: GoalRuleExecutionOptions = {}
): { prefix: Prisma.Sql; from: Prisma.Sql; where: Prisma.Sql } {
  const { entity, metric, filters } = resolved;

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
      filters[0]!.filter.value,
      metric.periodDbColumn
    );
    for (const { field, filter } of filters.slice(1)) {
      const condition = filterConditionSql(
        resolved.entity,
        field,
        filter.operator,
        filter.value,
        metric.periodDbColumn
      );
      stacked =
        filter.connector === "OR"
          ? Prisma.sql`${stacked} OR ${condition}`
          : Prisma.sql`${stacked} AND ${condition}`;
    }
    where = Prisma.sql`${where} AND (${stacked})`;
  }

  // Variáveis calculadas exigem o histórico do cliente ANTES de cada linha:
  // a origem do FROM passa a ser um CTE com window functions. Sem conceito
  // no filtro, nada muda (mesma query de sempre).
  const concepts = filters
    .filter(({ field }) => field.predicate === "CUSTOMER_MOMENT")
    .map(({ filter }) => resolveGoalConcept(entity, String(filter.value)));
  const source = compileConceptSource(entity, concepts, window);
  const prefix = source.cte ? Prisma.sql`${source.cte} ` : Prisma.empty;

  return { prefix, from: source.from, where };
}

/** Monta a query agregada completa (exportado para teste determinístico). */
export function buildGoalRuleQuery(
  resolved: GoalRuleResolved,
  window: GoalRuleExecutionWindow,
  options: GoalRuleExecutionOptions = {}
): Prisma.Sql {
  const { entity, metric } = resolved;

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

  const { prefix, from, where } = buildGoalRuleSource(resolved, window, options);
  return Prisma.sql`${prefix}SELECT ${aggregate} AS value FROM ${from} WHERE ${where}`;
}

/**
 * Mesma regra, mesmos filtros, mesma janela — só que quebrada POR MÊS civil da
 * coluna de período da métrica. Serve à linha "onde estamos" (acumulado mês a
 * mês) e à linha do período de comparação (ano passado) do Detalhe da Meta.
 *
 * Devolve os três números crus de cada mês em vez do agregado pronto porque o
 * acumulado de uma MÉDIA não é a média dos meses: com soma e contagem dá para
 * derivar `Σsoma / Σcontagem` corretamente (ver `accumulateGoalRuleMonths`).
 * Meses sem nenhuma linha simplesmente não voltam — quem consome preenche o
 * vão carregando o acumulado anterior.
 */
export type GoalRuleMonthlyBucket = {
  /** Mês civil "YYYY-MM" (fuso UTC, mesma convenção do resto do motor). */
  month: string;
  /** Σ da coluna da métrica no mês; "0" quando a métrica é COUNT de linhas. */
  sum: string;
  /** Linhas do mês (base do COUNT). */
  rowCount: number;
  /** Linhas com valor não nulo na coluna da métrica (base do AVG). */
  valueCount: number;
};

export function buildGoalRuleMonthlyQuery(
  resolved: GoalRuleResolved,
  window: GoalRuleExecutionWindow,
  options: GoalRuleExecutionOptions = {}
): Prisma.Sql {
  const { entity, metric } = resolved;
  const periodCol = columnSql(entity.dbTable, metric.periodDbColumn);

  // COUNT de linhas não tem coluna agregada: soma vira 0 e o que conta é
  // `rowCount`. Identificadores continuam vindo só do dicionário.
  const sumExpr = metric.dbColumn
    ? Prisma.raw(
        `COALESCE(SUM("${entity.dbTable}"."${metric.dbColumn}"), 0)::text`
      )
    : Prisma.raw(`'0'::text`);
  const valueCountExpr = metric.dbColumn
    ? Prisma.raw(`COUNT("${entity.dbTable}"."${metric.dbColumn}")::int`)
    : Prisma.raw(`COUNT(*)::int`);

  const { prefix, from, where } = buildGoalRuleSource(resolved, window, options);
  return Prisma.sql`${prefix}SELECT to_char(date_trunc('month', ${periodCol}), 'YYYY-MM') AS "month", ${sumExpr} AS "sum", COUNT(*)::int AS "rowCount", ${valueCountExpr} AS "valueCount" FROM ${from} WHERE ${where} GROUP BY 1 ORDER BY 1`;
}

/** Executa a série mensal da regra (mesma validação total do dicionário). */
export async function executeGoalRuleMonthly(
  prisma: PrismaClient,
  ruleJson: unknown,
  window: GoalRuleExecutionWindow,
  options: GoalRuleExecutionOptions = {}
): Promise<GoalRuleMonthlyBucket[]> {
  const resolved = resolveGoalRule(ruleJson);
  // Métrica oficial: preview, refresh, job e SÉRIE usam a MESMA autoridade —
  // o provider canônico (nunca série por uma fórmula e valor por outra).
  const provider = resolveMetricProvider(resolved, options);
  if (provider) {
    return provider.executeMonthly(prisma, window);
  }
  const query = buildGoalRuleMonthlyQuery(resolved, window, options);
  const rows = await prisma.$queryRaw<
    Array<{
      month: string | null;
      sum: string | null;
      rowCount: number | null;
      valueCount: number | null;
    }>
  >(query);
  return rows
    .filter((r) => r.month != null)
    .map((r) => ({
      month: String(r.month),
      sum: r.sum == null || r.sum === "" ? "0" : String(r.sum),
      rowCount: Number(r.rowCount ?? 0),
      valueCount: Number(r.valueCount ?? 0),
    }));
}

/**
 * Acumula os meses da janela do início até cada mês — a "linha de onde
 * estamos". Meses sem linha nenhuma não somem do gráfico: herdam o acumulado
 * do mês anterior (o caixa não anda, mas a curva continua).
 *
 * O acumulado respeita a operação da métrica: SUM soma, COUNT conta linhas e
 * AVG divide a soma acumulada pela contagem acumulada — a média do período até
 * ali, não a média das médias mensais.
 */
export function accumulateGoalRuleMonths(
  months: readonly string[],
  buckets: readonly GoalRuleMonthlyBucket[],
  operation: GoalMetadataMetric["operation"]
): Array<{ month: string; accumulated: string }> {
  const byMonth = new Map(buckets.map((b) => [b.month, b]));
  let sum = 0;
  let rows = 0;
  let values = 0;
  return months.map((month) => {
    const bucket = byMonth.get(month);
    if (bucket) {
      const bucketSum = Number(bucket.sum);
      if (Number.isFinite(bucketSum)) sum += bucketSum;
      rows += bucket.rowCount;
      values += bucket.valueCount;
    }
    const accumulated =
      operation === "COUNT"
        ? rows
        : operation === "SUM"
          ? sum
          : values > 0
            ? sum / values
            : 0;
    return { month, accumulated: String(accumulated) };
  });
}

/** Executa a regra e devolve o valor agregado como string decimal. */
export async function executeGoalRule(
  prisma: PrismaClient,
  ruleJson: unknown,
  window: GoalRuleExecutionWindow,
  options: GoalRuleExecutionOptions = {}
): Promise<string> {
  const resolved = resolveGoalRule(ruleJson);
  // Métrica oficial delega ao provider canônico (motor oficial do domínio).
  const provider = resolveMetricProvider(resolved, options);
  if (provider) {
    return provider.execute(prisma, window);
  }
  const query = buildGoalRuleQuery(resolved, window, options);
  const rows = await prisma.$queryRaw<Array<{ value: string | null }>>(query);
  const value = rows[0]?.value;
  return value == null || value === "" ? "0" : String(value);
}
