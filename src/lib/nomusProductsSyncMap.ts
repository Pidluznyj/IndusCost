/**
 * Mapeamento Nomus /produtos → elegíveis/bloqueados para sync de Product.
 * Extraído de scripts/nomusProductsSyncV1.ts para testes e diagnóstico.
 */
import type { ItemType } from "@prisma/client";
import { normalizeSku } from "./nomusBomComparison.js";

export type NomusProductApiRow = Record<string, unknown>;

export type NomusEligibleProduct = {
  externalId: number;
  sku: string;
  name: string;
  description: string | null;
  type: ItemType;
  typeInferenceConfidence: "HIGH" | "LOW";
  flags: {
    optional: boolean;
    phantom: boolean;
    service: boolean;
    inactive: boolean;
    hasBomLikeData: boolean;
  };
  nomusTypeName: string | null;
  nomusGroupName: string | null;
  nomusFamilyName: string | null;
  nomusSupplyTypeName: string | null;
  unitFromNomus: string | null;
  netWeightFromNomus: number | null;
  grossWeightFromNomus: number | null;
  nomusRawName: string | null;
  nomusDescription: string | null;
  chosenName: string;
  nameSource: "nome" | "descricao" | "codigo" | "none";
  nameLooksLikeSku: boolean;
  raw: NomusProductApiRow;
};

export type NomusBlockedProduct = {
  externalId: number | null;
  sku: string | null;
  name: string | null;
  reasons: string[];
  ativo: boolean | null;
  template: boolean | null;
  nomeTipoProduto: string | null;
  nomeGrupoProduto: string | null;
  nomeFamiliaProduto: string | null;
  nomusSupplyTypeName: string | null;
  servicoIndustrializacaoTerceiros: boolean | null;
  nomusRawName: string | null;
  nomusDescription: string | null;
  typeInferenceConfidence: "HIGH" | "LOW";
  inferredType: ItemType;
};

export type NomusProductsMapDiagnostics = {
  detectedProductKeys: string[];
  weightFieldsDetected: string[];
  unitFieldsDetected: string[];
  typeFieldsDetected: string[];
  optionalLikeFieldsDetected: string[];
  phantomLikeFieldsDetected: string[];
  serviceLikeFieldsDetected: string[];
  inactiveLikeFieldsDetected: string[];
  bomLikeFieldsDetected: string[];
  typeInferenceSummary: {
    highConfidenceProduct: number;
    highConfidenceComponent: number;
    lowConfidence: number;
    blockedUnsafeType: number;
  };
  safeUpdateFields: string[];
  blockedBusinessRules: string[];
};

export function nomusProductSkuFromRow(row: NomusProductApiRow): string | null {
  return asString(row.codigo) ?? asString(row.codigoProduto);
}

export function nomusProductSecondaryCodeFromRow(row: NomusProductApiRow): string | null {
  return (
    asString(row.codigoSecundario) ??
    asString(row.codigoProdutoSecundario) ??
    asString(row.codigoAlternativo) ??
    null
  );
}

function toInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string") {
    const normalized = value.replace(/[^\d-]/g, "");
    if (!normalized) return null;
    const parsed = Number.parseInt(normalized, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["true", "1", "sim", "yes"].includes(v)) return true;
    if (["false", "0", "nao", "não", "no"].includes(v)) return false;
  }
  return null;
}

function matchAny(values: Array<string | null>, regex: RegExp): boolean {
  return values.some((v) => Boolean(v && regex.test(v)));
}

function normalizeForSkuCompare(s: string): string {
  return s.trim().toUpperCase().replace(/\s+/g, "");
}

export function isSkuLikeName(value: string | null, sku: string): boolean {
  if (value == null) return true;
  const t = value.trim();
  if (t.length === 0) return true;
  if (normalizeForSkuCompare(t) === normalizeForSkuCompare(sku)) return true;
  if (/[\s,;()[\]{}'"“”]/.test(t)) return false;
  if (/[àáâãäåèéêëìíîïòóôõöùúûüýÿçñ]/i.test(t)) return false;
  if (/[\u00C0-\u024F\u1E00-\u1EFF]/.test(t)) return false;
  if (t.length > 48) return false;
  const letterCount = (t.match(/[A-Za-z]/g) ?? []).length;
  const digitCount = (t.match(/\d/g) ?? []).length;
  if (t.length >= 18 && letterCount >= 12 && digitCount <= 2) return false;
  if (!/^[A-Za-z0-9._\-/]+$/.test(t)) return false;
  if (/[aeiouAEIOU]{4,}/.test(t)) return false;
  if (!/\d/.test(t) && t.length > 10) return false;
  return true;
}

export function chooseSafeProductName(
  raw: NomusProductApiRow,
  sku: string
): {
  name: string | null;
  source: "nome" | "descricao" | "codigo" | "none";
  nameLooksLikeSku: boolean;
} {
  const nome = asString(raw.nome);
  const descricao = asString(raw.descricao);
  const codigo = asString(raw.codigo) ?? asString(raw.codigoProduto) ?? sku;

  if (nome && !isSkuLikeName(nome, sku)) {
    return { name: nome, source: "nome", nameLooksLikeSku: false };
  }
  if (descricao && !isSkuLikeName(descricao, sku)) {
    return { name: descricao, source: "descricao", nameLooksLikeSku: false };
  }
  if (codigo) {
    return { name: codigo, source: "codigo", nameLooksLikeSku: true };
  }
  return { name: null, source: "none", nameLooksLikeSku: true };
}

function isGenericNonDescriptiveText(value: string | null): boolean {
  if (value == null) return true;
  const normalized = value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (!normalized) return true;
  return ["disponivel", "indisponivel", "teste", "n/a", "na", "-", "--", "."].includes(normalized);
}

function toNumberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function extractNomusSupplyTypeName(raw: NomusProductApiRow): string | null {
  return (
    asString(raw.nomeTipoRessuprimento) ??
    asString(raw.tipoRessuprimento) ??
    asString(raw.nomeRessuprimento) ??
    asString(raw.ressuprimento)
  );
}

export function extractNomusMeta(raw: NomusProductApiRow): {
  nomeTipoProduto: string | null;
  nomeGrupoProduto: string | null;
  nomeFamiliaProduto: string | null;
  nomusSupplyTypeName: string | null;
  unitFromNomus: string | null;
  netWeightFromNomus: number | null;
  grossWeightFromNomus: number | null;
  ativo: boolean | null;
  template: boolean | null;
  servicoIndustrializacaoTerceiros: boolean | null;
} {
  return {
    nomeTipoProduto: asString(raw.nomeTipoProduto),
    nomeGrupoProduto: asString(raw.nomeGrupoProduto),
    nomeFamiliaProduto: asString(raw.nomeFamiliaProduto),
    nomusSupplyTypeName: extractNomusSupplyTypeName(raw),
    unitFromNomus:
      asString(raw.siglaUnidadeMedida) ?? asString(raw.unidade) ?? asString(raw.unidadeMedida),
    netWeightFromNomus: toNumberOrNull(raw.pesoLiquidoUnitario),
    grossWeightFromNomus: toNumberOrNull(raw.pesoBrutoUnitario),
    ativo: asBoolean(raw.ativo),
    template: asBoolean(raw.template),
    servicoIndustrializacaoTerceiros: asBoolean(raw.servicoIndustrializacaoTerceiros),
  };
}

/** Matéria-prima explícita — não confundir com "lista de materiais" (BOM). */
export function isNomusRawMaterialScope(
  typeName: string | null,
  groupName: string | null,
  familyName: string | null
): boolean {
  const textScope = [typeName, groupName, familyName];
  return matchAny(textScope, /\bmat[ée]ria[\s-]*prima\b|\bmateria[\s-]*prima\b/i);
}

export function isNomusBomComponentScope(
  typeName: string | null,
  groupName: string | null,
  familyName: string | null,
  supplyTypeName: string | null
): boolean {
  const type = (typeName ?? "").toUpperCase();
  const group = (groupName ?? "").toUpperCase();
  const family = (familyName ?? "").toUpperCase();
  const supply = (supplyTypeName ?? "").toUpperCase();

  if (group.includes("BOM") || group.includes("LISTA DE MATERIAIS")) return true;
  if (family.includes("OUTROS COMPONENTES") || family.includes("COMPONENTE")) return true;
  if (type.includes("PRODUTO INDUSTRIALIZADO") || type.includes("INDUSTRIALIZADO")) {
    if (supply.includes("COMPRADO") || group.includes("BOM")) return true;
  }
  if (supply.includes("COMPRADO") && (group.includes("BOM") || family.includes("COMPONENT"))) {
    return true;
  }
  return false;
}

export function inferProductTypeWithConfidence(
  raw: NomusProductApiRow
): { type: ItemType; confidence: "HIGH" | "LOW" } {
  const meta = extractNomusMeta(raw);
  const typeName = (meta.nomeTipoProduto ?? "").toUpperCase();
  const groupName = (meta.nomeGrupoProduto ?? "").toUpperCase();
  const familyName = (meta.nomeFamiliaProduto ?? "").toUpperCase();
  const supplyName = (meta.nomusSupplyTypeName ?? "").toUpperCase();

  if (isNomusBomComponentScope(meta.nomeTipoProduto, meta.nomeGrupoProduto, meta.nomeFamiliaProduto, meta.nomusSupplyTypeName)) {
    return { type: "COMPONENT", confidence: "HIGH" };
  }

  if (
    typeName.includes("SEMI-ACABADO") ||
    typeName.includes("SEMI ACABADO") ||
    typeName.includes("SEMIACABADO") ||
    typeName.includes("SEMI-ELABORADO") ||
    typeName.includes("SEMI ELABORADO") ||
    typeName.includes("SEMIELABORADO")
  ) {
    return { type: "COMPONENT", confidence: "HIGH" };
  }
  if (
    typeName.includes("COMPONENTE") ||
    typeName.includes("COMPONENT") ||
    groupName.includes("COMPONENTE")
  ) {
    return { type: "COMPONENT", confidence: "HIGH" };
  }
  if (
    typeName.includes("PRODUTO ACABADO") ||
    typeName.includes("ACABADO") ||
    groupName.includes("PRODUTO ACABADO")
  ) {
    return { type: "PRODUCT", confidence: "HIGH" };
  }
  if (typeName.includes("PRODUTO INDUSTRIALIZADO") && supplyName.includes("COMPRADO")) {
    return { type: "COMPONENT", confidence: "HIGH" };
  }
  return { type: "PRODUCT", confidence: "LOW" };
}

function collectDiagnostics(raw: NomusProductApiRow[]): NomusProductsMapDiagnostics {
  const keySet = new Set<string>();
  const weightFields = new Set<string>();
  const unitFields = new Set<string>();
  const typeFields = new Set<string>();
  const optionalLikeFields = new Set<string>();
  const phantomLikeFields = new Set<string>();
  const serviceLikeFields = new Set<string>();
  const inactiveLikeFields = new Set<string>();
  const bomLikeFields = new Set<string>();

  const weightRegex = /peso|weight/i;
  const unitRegex = /(siglaUnidadeMedida|idUnidadeMedida|unidade|unidadeMedida)$/i;
  const typeRegex = /tipo|categoria|classificacao/i;
  const optionalRegex = /opcional|optional|produtoOpcional|itemOpcional/i;
  const phantomRegex = /fantasma|phantom|produtoFantasma|itemFantasma/i;
  const serviceRegex = /servic|serviço|servico|apoio|gen[eé]rico|generico|n[aã]o.?produtivo|tempor[aá]rio|temporario/i;
  const inactiveRegex = /inativ|cancel|exclu|delet|desativ|ativo|status/i;
  const bomRegex = /component|estrutura|insumo|materia|filho|compos|produtoPai|produtoFilho|quantidade/i;

  for (const row of raw) {
    for (const [key, value] of Object.entries(row)) {
      keySet.add(key);
      if (weightRegex.test(key)) weightFields.add(key);
      if (unitRegex.test(key)) unitFields.add(key);
      if (typeRegex.test(key)) typeFields.add(key);
      if (optionalRegex.test(key)) optionalLikeFields.add(key);
      if (phantomRegex.test(key)) phantomLikeFields.add(key);
      if (serviceRegex.test(key)) serviceLikeFields.add(key);
      if (inactiveRegex.test(key)) inactiveLikeFields.add(key);
      if (bomRegex.test(key)) bomLikeFields.add(key);
      if (typeof value === "string") {
        if (optionalRegex.test(value)) optionalLikeFields.add(key);
        if (phantomRegex.test(value)) phantomLikeFields.add(key);
        if (serviceRegex.test(value)) serviceLikeFields.add(key);
        if (inactiveRegex.test(value)) inactiveLikeFields.add(key);
      }
      if (Array.isArray(value) || (value && typeof value === "object")) {
        if (bomRegex.test(key)) bomLikeFields.add(key);
      }
    }
  }

  return {
    detectedProductKeys: [...keySet].sort(),
    weightFieldsDetected: [...weightFields].sort(),
    unitFieldsDetected: [...unitFields].sort(),
    typeFieldsDetected: [...typeFields].sort(),
    optionalLikeFieldsDetected: [...optionalLikeFields].sort(),
    phantomLikeFieldsDetected: [...phantomLikeFields].sort(),
    serviceLikeFieldsDetected: [...serviceLikeFields].sort(),
    inactiveLikeFieldsDetected: [...inactiveLikeFields].sort(),
    bomLikeFieldsDetected: [...bomLikeFields].sort(),
    typeInferenceSummary: {
      highConfidenceProduct: 0,
      highConfidenceComponent: 0,
      lowConfidence: 0,
      blockedUnsafeType: 0,
    },
    safeUpdateFields: ["name", "description"],
    blockedBusinessRules: [
      "OPTIONAL_PRODUCT",
      "PHANTOM_PRODUCT",
      "SERVICE_ITEM",
      "INACTIVE_PRODUCT_NOMUS",
      "TEMPLATE_PRODUCT",
      "RAW_MATERIAL_NOT_PRODUCT",
      "PACKAGING_NOT_PRODUCT",
      "MRO_OR_FIXED_ASSET_NOT_PRODUCT",
      "MERCHANDISE_RESALE_UNMAPPED",
      "UNSAFE_PRODUCT_TYPE",
      "MISSING_DESCRIPTIVE_NAME",
    ],
  };
}

export function mapNomusProductsFromApiRows(
  raw: NomusProductApiRow[],
  existingSkuSet: Set<string>
): {
  eligible: NomusEligibleProduct[];
  blocked: NomusBlockedProduct[];
  diagnostics: NomusProductsMapDiagnostics;
} {
  const eligible: NomusEligibleProduct[] = [];
  const blocked: NomusBlockedProduct[] = [];
  const diagnostics = collectDiagnostics(raw);

  for (const p of raw) {
    const externalId = toInt(p.id);
    const sku = nomusProductSkuFromRow(p);
    const reasons: string[] = [];
    if (externalId == null) reasons.push("MISSING_EXTERNAL_ID");
    if (!sku) reasons.push("MISSING_SKU");
    const chosenNamePack = sku
      ? chooseSafeProductName(p, sku)
      : { name: null as string | null, source: "none" as const, nameLooksLikeSku: true };
    if (!chosenNamePack.name) reasons.push("MISSING_NAME");
    const name = chosenNamePack.name ?? asString(p.nome) ?? asString(p.descricao);
    if (reasons.length > 0) {
      blocked.push({
        externalId,
        sku,
        name,
        reasons,
        ativo: null,
        template: null,
        nomeTipoProduto: null,
        nomeGrupoProduto: null,
        nomeFamiliaProduto: null,
        nomusSupplyTypeName: null,
        servicoIndustrializacaoTerceiros: null,
        nomusRawName: asString(p.nome),
        nomusDescription: asString(p.descricao),
        typeInferenceConfidence: "LOW",
        inferredType: "PRODUCT",
      });
      continue;
    }

    const meta = extractNomusMeta(p);
    const textScope = [meta.nomeTipoProduto, meta.nomeGrupoProduto, meta.nomeFamiliaProduto];
    const optional = matchAny(textScope, /\b(opcional|optional)\b/i);
    const phantom = matchAny(textScope, /\b(fantasma|phantom)\b/i);
    const service =
      meta.servicoIndustrializacaoTerceiros === true ||
      matchAny(textScope, /\b(servi[cç]o|service)\b/i);
    const inactive = meta.ativo === false;
    const template = meta.template === true;
    const resale = matchAny(textScope, /mercadoria\s+para\s+revenda/i);
    const rawMaterial = isNomusRawMaterialScope(
      meta.nomeTipoProduto,
      meta.nomeGrupoProduto,
      meta.nomeFamiliaProduto
    );
    const packaging = matchAny(textScope, /\bembalagem\b/i);
    const mroOrFixedAsset = matchAny(
      textScope,
      /\bmro\b|ativo\s+imobilizado|manuten[cç][aã]o,\s*reparo\s*e\s*opera[cç][aã]o|manuten[cç][aã]o|reparo|opera[cç][aã]o/i
    );
    const hasBomLikeData = Object.keys(p).some((k) =>
      /component|estrutura|insumo|materia|filho|compos|produtoPai|produtoFilho|quantidade/i.test(k)
    );

    if (optional) reasons.push("OPTIONAL_PRODUCT");
    if (phantom) reasons.push("PHANTOM_PRODUCT");
    if (service) reasons.push("SERVICE_ITEM");
    if (inactive) reasons.push("INACTIVE_PRODUCT_NOMUS");
    if (template) reasons.push("TEMPLATE_PRODUCT");
    if (rawMaterial) reasons.push("RAW_MATERIAL_NOT_PRODUCT");
    if (packaging) reasons.push("PACKAGING_NOT_PRODUCT");
    if (mroOrFixedAsset) reasons.push("MRO_OR_FIXED_ASSET_NOT_PRODUCT");
    if (resale) reasons.push("MERCHANDISE_RESALE_UNMAPPED");

    const inferred = inferProductTypeWithConfidence(p);
    const isNewSku = !existingSkuSet.has(sku!) && !existingSkuSet.has(normalizeSku(sku!));
    const nomusRawName = asString(p.nome);
    const nomusDescription = asString(p.descricao);
    const hasDescriptiveNomusName =
      (!!nomusRawName &&
        !isSkuLikeName(nomusRawName, sku!) &&
        !isGenericNonDescriptiveText(nomusRawName)) ||
      (!!nomusDescription &&
        !isSkuLikeName(nomusDescription, sku!) &&
        !isGenericNonDescriptiveText(nomusDescription));
    if (isNewSku && inferred.confidence === "LOW") {
      reasons.push("UNSAFE_PRODUCT_TYPE");
      diagnostics.typeInferenceSummary.blockedUnsafeType += 1;
    }
    if (isNewSku && !hasDescriptiveNomusName) {
      reasons.push("MISSING_DESCRIPTIVE_NAME");
    }

    if (reasons.length > 0) {
      blocked.push({
        externalId,
        sku,
        name,
        reasons,
        ativo: meta.ativo,
        template: meta.template,
        nomeTipoProduto: meta.nomeTipoProduto,
        nomeGrupoProduto: meta.nomeGrupoProduto,
        nomeFamiliaProduto: meta.nomeFamiliaProduto,
        nomusSupplyTypeName: meta.nomusSupplyTypeName,
        servicoIndustrializacaoTerceiros: meta.servicoIndustrializacaoTerceiros,
        nomusRawName,
        nomusDescription,
        typeInferenceConfidence: inferred.confidence,
        inferredType: inferred.type,
      });
      continue;
    }

    if (inferred.confidence === "HIGH" && inferred.type === "PRODUCT") {
      diagnostics.typeInferenceSummary.highConfidenceProduct += 1;
    } else if (inferred.confidence === "HIGH" && inferred.type === "COMPONENT") {
      diagnostics.typeInferenceSummary.highConfidenceComponent += 1;
    } else {
      diagnostics.typeInferenceSummary.lowConfidence += 1;
    }

    eligible.push({
      externalId: externalId!,
      sku: sku!,
      name: chosenNamePack.name!,
      description: asString(p.descricao),
      type: inferred.type,
      typeInferenceConfidence: inferred.confidence,
      flags: { optional, phantom, service, inactive, hasBomLikeData },
      nomusTypeName: meta.nomeTipoProduto,
      nomusGroupName: meta.nomeGrupoProduto,
      nomusFamilyName: meta.nomeFamiliaProduto,
      nomusSupplyTypeName: meta.nomusSupplyTypeName,
      unitFromNomus: meta.unitFromNomus,
      netWeightFromNomus: meta.netWeightFromNomus,
      grossWeightFromNomus: meta.grossWeightFromNomus,
      nomusRawName: asString(p.nome),
      nomusDescription: asString(p.descricao),
      chosenName: chosenNamePack.name!,
      nameSource: chosenNamePack.source,
      nameLooksLikeSku: chosenNamePack.nameLooksLikeSku,
      raw: p,
    });
  }
  return { eligible, blocked, diagnostics };
}

export function findNomusProductRowsByCode(
  rows: NomusProductApiRow[],
  code: string
): NomusProductApiRow[] {
  const wanted = code.trim();
  const wantedNorm = normalizeSku(wanted);
  const wantedLoose = wanted.replace(/-+$/g, "");

  return rows.filter((row) => {
    const sku = nomusProductSkuFromRow(row);
    const secondary = nomusProductSecondaryCodeFromRow(row);
    if (!sku && !secondary) return false;
    const skuNorm = sku ? normalizeSku(sku) : "";
    if (sku === wanted || skuNorm === wantedNorm) return true;
    if (sku && normalizeSku(sku.replace(/-+$/g, "")) === normalizeSku(wantedLoose)) return true;
    if (secondary === wanted || (secondary && normalizeSku(secondary) === wantedNorm)) return true;
    return false;
  });
}

export function buildNomusProductFixture52022(): NomusProductApiRow {
  return {
    id: 52022001,
    codigo: "520.22--",
    codigoSecundario: "3.14.117.0014",
    nome: "Fita SF 48mm X 100mm - Serr 100mm (Alavanca Britania)",
    descricao: "Fita SF 48mm X 100mm - Serr 100mm (Alavanca Britania)",
    nomeTipoProduto: "Produto industrializado",
    nomeGrupoProduto: "BOM - Lista de materiais",
    nomeFamiliaProduto: "5 - Outros componentes",
    nomeTipoRessuprimento: "Comprado",
    siglaUnidadeMedida: "ROLO",
    ativo: true,
    template: false,
    servicoIndustrializacaoTerceiros: false,
  };
}
