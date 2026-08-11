/**
 * Roteamento de CÓDIGOS NOVOS do Nomus para Material (Suprimentos).
 *
 * Escopo estrito (missão nomus-new-material-routing):
 *   - Vale SOMENTE para códigos que NÃO existem nem em Product nem em Material.
 *   - Nunca converte, migra, exclui ou reclassifica registros históricos.
 *   - Nunca atualiza Material existente (custos são locais/manuais — o único
 *     write deste módulo é CREATE; não existe UPDATE aqui, por construção).
 *
 * Fonte de classificação: os MESMOS helpers do mapper oficial
 * (`nomusProductsSyncMap.ts`) + os blockedReasons que o próprio mapper já
 * calculou — nenhuma segunda regra paralela que possa divergir.
 *
 * Prioridade de evidência cadastral (conservadora, fail closed):
 *   1. Matéria-prima explícita  → MATERIAL
 *   2. Embalagem explícita      → MATERIAL
 *   3. Insumo explícito         → MATERIAL
 *   Contradição (ex.: tipo "Produto acabado/industrializado" junto com texto
 *   de material) → nenhuma escrita automática; item permanece só no
 *   NomusProductCatalog com diagnóstico. Isso protege a correção de junho
 *   (produto industrializado comprado → Product/COMPONENT, caso 520.22--).
 */

import {
  chooseSafeProductName,
  extractNomusMeta,
  isNomusInsumoScope,
  isNomusPackagingScope,
  isNomusRawMaterialScope,
  nomusProductSkuFromRow,
  type NomusProductApiRow,
} from "./nomusProductsSyncMap.js";
import {
  cleanNomusDescription,
  isAssemblyLocalCode,
  isValidCode,
} from "./nomusMasterDataImportShared.js";
import {
  resolveCatalogEntityByCode,
  type CatalogEntityLookupMaps,
} from "./nomusCatalogEntityResolve.js";

/**
 * Mesma categoria do fluxo canônico de Carga Mestre/Equalize. NÃO trocar por
 * "EMBALAGEM"/"MATERIA_PRIMA"/"INSUMO": `isMaterialNomusControlled` em
 * nomusMasterDataEqualize.ts reconhece origem Nomus por category ===
 * "NOMUS_IMPORT" — mudar aqui quebraria a compatibilidade (dívida técnica
 * documentada; remodelar origem/categoria é projeto futuro, fora deste escopo).
 */
export const NOMUS_NEW_MATERIAL_CATEGORY = "NOMUS_IMPORT" as const;
const DEFAULT_MATERIAL_UNIT = "UN";

/** blockedReasons do mapper que tornam o cadastro inseguro para auto-create. */
const UNSAFE_MAPPER_REASONS = [
  "OPTIONAL_PRODUCT",
  "PHANTOM_PRODUCT",
  "SERVICE_ITEM",
  "TEMPLATE_PRODUCT",
  "MRO_OR_FIXED_ASSET_NOT_PRODUCT",
  "MERCHANDISE_RESALE_UNMAPPED",
] as const;

export type NomusNewMaterialReason = "MATERIA_PRIMA" | "EMBALAGEM" | "INSUMO";

export type NomusNewMaterialCreatePayload = {
  code: string;
  description: string;
  unit: string;
  category: typeof NOMUS_NEW_MATERIAL_CATEGORY;
  currentCost: 0;
  averageCost: 0;
  standardCost: 0;
  freight: 0;
  standardLoss: 0;
  conversionFactor: 1;
  status: "ACTIVE";
};

export type NomusMaterialRoutingCandidate = {
  code: string;
  reason: NomusNewMaterialReason;
  /** Guard não-nulo = fail closed: candidato reconhecido mas inseguro para auto-create. */
  guard: string | null;
  description: string | null;
  unit: string;
};

export type NomusMaterialRoutingDecision =
  | { kind: "CREATE_MATERIAL"; code: string; reason: NomusNewMaterialReason; payload: NomusNewMaterialCreatePayload }
  | { kind: "ALREADY_MATERIAL"; code: string; reason: NomusNewMaterialReason; materialId: string }
  | { kind: "SKIP_EXISTING_PRODUCT"; code: string; reason: NomusNewMaterialReason; productId: string }
  | { kind: "SKIP_BOTH_EXIST"; code: string; reason: NomusNewMaterialReason; materialId: string | null; conflictProductIds: string[] }
  | { kind: "SKIP_UNSAFE"; code: string; reason: NomusNewMaterialReason; guard: string };

export type NomusMaterialRoutingPlan = {
  decisions: NomusMaterialRoutingDecision[];
  summary: {
    materialCandidatesCount: number;
    materialCreateCount: number;
    materialAlreadyExistingCount: number;
    materialSkippedExistingProductCount: number;
    materialBothExistCount: number;
    materialUnsafeCount: number;
  };
  /** Preview limitado para o log do sync — nunca despejar tudo. */
  preview: Array<{ code: string; description: string | null; reason: string; target: "MATERIAL" | "SKIP" }>;
};

function contradictsFinishedOrIndustrializedType(typeName: string | null): boolean {
  if (!typeName) return false;
  return /\bproduto\s+(acabado|industrializado)\b/i.test(typeName) || /\bacabado\b/i.test(typeName);
}

/**
 * Fase 1 (pura, sem existência): reconhece candidatos a Material entre as
 * linhas brutas do /produtos. Linhas sem evidência explícita de
 * matéria-prima/embalagem/insumo NÃO são candidatas — seguem exclusivamente
 * o ciclo Product existente, sem qualquer mudança de comportamento.
 */
export function detectNomusMaterialRoutingCandidates(
  rows: NomusProductApiRow[],
  blockedReasonsBySku: ReadonlyMap<string, string[]>
): NomusMaterialRoutingCandidate[] {
  const out: NomusMaterialRoutingCandidate[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const sku = nomusProductSkuFromRow(row);
    if (!sku || seen.has(sku)) continue;

    const meta = extractNomusMeta(row);
    const scopeArgs = [meta.nomeTipoProduto, meta.nomeGrupoProduto, meta.nomeFamiliaProduto] as const;
    const reason: NomusNewMaterialReason | null = isNomusRawMaterialScope(...scopeArgs)
      ? "MATERIA_PRIMA"
      : isNomusPackagingScope(...scopeArgs)
        ? "EMBALAGEM"
        : isNomusInsumoScope(...scopeArgs)
          ? "INSUMO"
          : null;
    if (!reason) continue;
    seen.add(sku);

    const chosen = chooseSafeProductName(row, sku);
    const description = chosen.name && !chosen.nameLooksLikeSku ? cleanNomusDescription(chosen.name) : null;
    const unit = meta.unitFromNomus ?? DEFAULT_MATERIAL_UNIT;

    let guard: string | null = null;
    if (meta.ativo !== true) guard = "INATIVO_NO_NOMUS";
    else if (meta.template === true) guard = "TEMPLATE";
    else if (meta.servicoIndustrializacaoTerceiros === true) guard = "SERVICO_TERCEIROS";
    else if (contradictsFinishedOrIndustrializedType(meta.nomeTipoProduto)) {
      // Tipo declara produto acabado/industrializado E há texto de material —
      // contradição: fail closed (protege o padrão 520.22-- de junho).
      guard = "TIPO_PRODUTO_CONTRADITORIO";
    } else if (isAssemblyLocalCode(sku)) guard = "CODIGO_MONTAGEM_LOCAL_800";
    else if (!isValidCode(sku)) guard = "CODIGO_INVALIDO";
    else if (!description) guard = "SEM_DESCRICAO_SEGURA";
    else {
      const mapperReasons = blockedReasonsBySku.get(sku) ?? [];
      const unsafe = mapperReasons.find((r) =>
        (UNSAFE_MAPPER_REASONS as readonly string[]).includes(r)
      );
      if (unsafe) guard = `MAPPER_${unsafe}`;
    }

    out.push({ code: sku, reason, guard, description, unit });
  }
  return out;
}

/**
 * Fase 2 (pura): aplica os gates de existência sobre os candidatos usando o
 * resolvedor canônico (`resolveCatalogEntityByCode`) — Product existente é
 * preservado, Material existente é preservado, ambos existentes viram apenas
 * diagnóstico. SOMENTE not_found vira CREATE.
 */
export function planNomusNewMaterialRouting(
  candidates: NomusMaterialRoutingCandidate[],
  maps: CatalogEntityLookupMaps
): NomusMaterialRoutingPlan {
  const decisions: NomusMaterialRoutingDecision[] = [];

  for (const c of candidates) {
    if (c.guard) {
      decisions.push({ kind: "SKIP_UNSAFE", code: c.code, reason: c.reason, guard: c.guard });
      continue;
    }

    const resolution = resolveCatalogEntityByCode(c.code, maps);

    if (resolution.status === "material" || resolution.status === "material_inactive") {
      if (resolution.hasHistoricalConflict) {
        decisions.push({
          kind: "SKIP_BOTH_EXIST",
          code: c.code,
          reason: c.reason,
          materialId: resolution.materialId,
          conflictProductIds: resolution.conflictingProductIds,
        });
      } else {
        decisions.push({
          kind: "ALREADY_MATERIAL",
          code: c.code,
          reason: c.reason,
          materialId: resolution.materialId ?? resolution.materialIds[0] ?? "",
        });
      }
      continue;
    }

    if (resolution.status === "component" || resolution.status === "product") {
      decisions.push({
        kind: "SKIP_EXISTING_PRODUCT",
        code: c.code,
        reason: c.reason,
        productId: resolution.componentProductId ?? resolution.finishedProductId ?? "",
      });
      continue;
    }

    // not_found → único caminho que cria.
    decisions.push({
      kind: "CREATE_MATERIAL",
      code: c.code,
      reason: c.reason,
      payload: {
        code: c.code,
        description: c.description!,
        unit: c.unit,
        category: NOMUS_NEW_MATERIAL_CATEGORY,
        currentCost: 0,
        averageCost: 0,
        standardCost: 0,
        freight: 0,
        standardLoss: 0,
        conversionFactor: 1,
        status: "ACTIVE",
      },
    });
  }

  const summary = {
    materialCandidatesCount: candidates.length,
    materialCreateCount: decisions.filter((d) => d.kind === "CREATE_MATERIAL").length,
    materialAlreadyExistingCount: decisions.filter((d) => d.kind === "ALREADY_MATERIAL").length,
    materialSkippedExistingProductCount: decisions.filter((d) => d.kind === "SKIP_EXISTING_PRODUCT").length,
    materialBothExistCount: decisions.filter((d) => d.kind === "SKIP_BOTH_EXIST").length,
    materialUnsafeCount: decisions.filter((d) => d.kind === "SKIP_UNSAFE").length,
  };

  const preview = decisions.slice(0, 50).map((d) => ({
    code: d.code,
    description:
      d.kind === "CREATE_MATERIAL"
        ? d.payload.description
        : (candidates.find((c) => c.code === d.code)?.description ?? null),
    reason:
      d.kind === "SKIP_UNSAFE" ? `${d.reason} (${d.guard})` : d.reason,
    target: d.kind === "CREATE_MATERIAL" ? ("MATERIAL" as const) : ("SKIP" as const),
  }));

  return { decisions, summary, preview };
}

/**
 * Gate final no momento da escrita (anti-TOCTOU): re-resolve a existência com
 * mapas FRESCOS carregados imediatamente antes do write. Product ou Material
 * que surgiu entre o planejamento e a aplicação faz o CREATE virar skip.
 */
export function finalizeNomusMaterialCreates(
  creates: Array<Extract<NomusMaterialRoutingDecision, { kind: "CREATE_MATERIAL" }>>,
  freshMaps: CatalogEntityLookupMaps
): {
  toCreate: Array<Extract<NomusMaterialRoutingDecision, { kind: "CREATE_MATERIAL" }>>;
  lateSkips: Array<{ code: string; why: string }>;
} {
  const toCreate: Array<Extract<NomusMaterialRoutingDecision, { kind: "CREATE_MATERIAL" }>> = [];
  const lateSkips: Array<{ code: string; why: string }> = [];

  for (const c of creates) {
    const resolution = resolveCatalogEntityByCode(c.code, freshMaps);
    if (resolution.status === "not_found") {
      toCreate.push(c);
    } else {
      lateSkips.push({
        code: c.code,
        why: `Entidade surgiu entre o plano e a escrita (${resolution.status}) — create cancelado.`,
      });
    }
  }
  return { toCreate, lateSkips };
}
