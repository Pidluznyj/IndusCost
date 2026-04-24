/**
 * Montagem do payload `pricingBreakdown` da simulação unitária de formação de preço.
 * Não recalcula custos nem preço — apenas estrutura valores já obtidos no backend.
 */

export type PricingBreakdownRawMaterialRow = {
  materialId: string | null;
  sku: string | null;
  description: string;
  lineType: "MATERIAL" | "COMPONENT" | "UNKNOWN";
  quantityPerUnit: number | null;
  unit: string | null;
  unitCost: number | null;
  lineTotalCost: number | null;
  originNote: string | null;
};

export type PricingBreakdownTransformationRow = {
  operation: string | null;
  source: string | null;
  sourceLabel: string | null;
  cycleTimeSeconds: number | null;
  cavities: number | null;
  efficiencyExpectedPct: number | null;
  setupTimeMin: number | null;
  lotSize: number | null;
  netPartsPerHour: number | null;
  hhCostPerHour: number | null;
  machineHourCostPerHour: number | null;
  cellCostPerHour: number | null;
  timeHoursPerUnit: number | null;
  unitLaborCost: number | null;
  unitMachineCost: number | null;
  setupCostAllocated: number | null;
  unitTotalTransform: number | null;
  friendlyHmNote: string | null;
};

export type PricingUnitCalculationBreakdown = {
  methodology: "MARKUP_DIVISOR";
  methodologyShortNote: string;
  baseCost: {
    rawMaterialCost: number | null;
    laborCostHH: number | null;
    machineCostHM: number | null;
    setupCostAllocated: number | null;
    transformationSubtotalHHPlusHM: number | null;
    industrialCostCIU: number | null;
    cifPerUnit: number | null;
    opexPerUnit: number | null;
    managerialCostTotal: number | null;
  };
  deductions: {
    taxes: {
      percentageOnSale: number | null;
      amountOnSale: number | null;
      ruleName: string | null;
      ruleId: string | null;
      source: string;
    };
    commission: { percentageOnSale: number | null; amountOnSale: number | null };
    freight: { mode: "FIXED_PER_UNIT"; amount: number | null; percentageOnSale: null };
    otherVariables: { percentageOnSale: number | null; amountOnSale: number | null };
    totalRatesOnSale: number | null;
    totalVariableOnSale: number | null;
  };
  margin: {
    targetPercentageOnSale: number | null;
    amountOnSale: number | null;
    basis: "SALE_PRICE";
  };
  markup: {
    priceOverIndustrialCost: number | null;
    divisor: number | null;
    factorOnCostPlusFreight: number | null;
    formulaText: string;
    denominatorRates: {
      tax: number | null;
      commission: number | null;
      otherVariables: number | null;
      margin: number | null;
    };
  };
  priceBridge: {
    explanation: string;
    lines: Array<{ label: string; amount: number }>;
    suggestedPrice: number | null;
  };
  finalPrice: {
    suggestedPrice: number | null;
    contributionMargin: number | null;
    operationalMargin: number | null;
  };
  rawMaterials: PricingBreakdownRawMaterialRow[] | null;
  transformationMemory: PricingBreakdownTransformationRow[] | null;
  helpTexts: {
    markup: string;
    margin: string;
    hm: string;
    hh: string;
  };
};

function n(x: unknown): number | null {
  const v = Number(x);
  return Number.isFinite(v) ? v : null;
}

function sumSetupFromProcessBreakdown(rows: unknown[] | null | undefined): number | null {
  if (!Array.isArray(rows)) return null;
  let s = 0;
  let any = false;
  for (const row of rows) {
    const cd = (row as { calculationDetails?: { setupCost?: unknown } })?.calculationDetails;
    const sc = n(cd?.setupCost);
    if (sc != null) {
      s += sc;
      any = true;
    }
  }
  return any ? s : null;
}

function labelForProcessSource(source: string | undefined): string | null {
  if (!source) return null;
  if (source === "ROUTING") return "Roteiro (cargo/salário + máquina da operação)";
  if (source === "STANDARD_PROCESS") return "Processo padrão do produto (HH global + custo/hora máquina)";
  return source;
}

function mapTransformationMemory(rows: unknown[] | null | undefined): PricingBreakdownTransformationRow[] | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const out: PricingBreakdownTransformationRow[] = [];
  for (const raw of rows) {
    const b = raw as {
      description?: unknown;
      source?: unknown;
      laborCost?: unknown;
      machineCost?: unknown;
      total?: unknown;
      calculationDetails?: Record<string, unknown>;
    };
    const d = b.calculationDetails ?? {};
    const cycle = n(d.cycle);
    const cavities = n(d.cavities);
    const eff = n(d.efficiency);
    const netPph = n(d.netPph);
    const setupCost = n(d.setupCost);
    const hhHour = n(d.hhCost) ?? n(d.globalHhCost);
    const mh = n(d.machineHourCost);
    const cell = n(d.cellHourCost);
    const lot = n(d.lotSize);
    const setupMin = n(d.setupTimeMin);
    const rollup = Boolean(d.rollupFromBom);
    const timeH =
      rollup && n(d.childOwnProductiveTimeH_Unit) != null && n(d.requiredQty) != null
        ? Number(d.childOwnProductiveTimeH_Unit) * Number(d.requiredQty)
        : netPph != null && netPph > 0
          ? 1 / netPph + (setupMin != null && lot != null && lot > 0 ? setupMin / 60 / lot : 0)
          : null;

    let friendlyHm: string | null = null;
    if (rollup) {
      friendlyHm =
        "Parcela de máquina (HM) agregada do componente filho na BOM, proporcional à quantidade utilizada.";
    } else if (netPph != null && cell != null && cycle != null && cavities != null && eff != null) {
      friendlyHm = `HM por unidade = (custo/hora da célula) ÷ (produção líquida/hora), com produção/hora = (3600 s ÷ ciclo) × cavidades × (${eff}% de eficiência).`;
    }

    out.push({
      operation: typeof b.description === "string" ? b.description : null,
      source: typeof b.source === "string" ? b.source : rollup ? "BOM_ROLLUP" : null,
      sourceLabel: rollup ? "Agregado de componente (BOM)" : labelForProcessSource(typeof b.source === "string" ? b.source : undefined),
      cycleTimeSeconds: cycle,
      cavities,
      efficiencyExpectedPct: eff,
      setupTimeMin: setupMin,
      lotSize: lot,
      netPartsPerHour: netPph,
      hhCostPerHour: hhHour,
      machineHourCostPerHour: mh,
      cellCostPerHour: cell,
      timeHoursPerUnit: timeH,
      unitLaborCost: n(b.laborCost),
      unitMachineCost: n(b.machineCost),
      setupCostAllocated: setupCost,
      unitTotalTransform: n(b.total),
      friendlyHmNote: friendlyHm,
    });
  }
  return out.length ? out : null;
}

function mapOpenBookMaterials(
  rows: Array<Record<string, unknown>> | null | undefined
): PricingBreakdownRawMaterialRow[] | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows.map((r) => ({
    materialId: typeof r.materialId === "string" ? r.materialId : null,
    sku: typeof r.code === "string" ? r.code : null,
    description: typeof r.description === "string" ? r.description : "—",
    lineType: "MATERIAL" as const,
    quantityPerUnit: n(r.quantity),
    unit: typeof r.unit === "string" ? r.unit : null,
    unitCost: n(r.unitCostEffective),
    lineTotalCost: n(r.totalCost),
    originNote: "Explosão recursiva de MP (open book)",
  }));
}

function mapBomDetailMaterials(
  rows: Array<Record<string, unknown>> | null | undefined
): PricingBreakdownRawMaterialRow[] | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const mapped: PricingBreakdownRawMaterialRow[] = [];
  for (const r of rows) {
    const excluded = Boolean(r.excludedFromCost);
    const desc = typeof r.description === "string" ? r.description : "—";
    const req = n(r.requiredQty);
    const lineTotal = n(r.unitCost);
    const base = n(r.basePrice);
    const unitFromLine = req != null && req > 0 && lineTotal != null ? lineTotal / req : null;
    const isComponent =
      !excluded && base != null && unitFromLine != null && Math.abs(unitFromLine - base) < 1e-4;
    const unitCostEff = req != null && req > 0 && lineTotal != null ? lineTotal / req : null;
    mapped.push({
      materialId: null,
      sku: typeof r.sku === "string" ? r.sku : null,
      description: desc,
      lineType: excluded ? "UNKNOWN" : isComponent ? "COMPONENT" : "MATERIAL",
      quantityPerUnit: req,
      unit: null,
      unitCost: excluded ? null : unitCostEff,
      lineTotalCost: excluded ? null : lineTotal,
      originNote: excluded
        ? typeof r.detailChain === "string"
          ? r.detailChain
          : "Linha excluída do custeio"
        : "Detalhe da BOM do motor de custo",
    });
  }
  return mapped.length ? mapped : null;
}

export type BuildPricingUnitBreakdownInput = {
  custoFabril: number;
  custoGerencial: number;
  totalMaterialCost: number;
  totalHH_Unit: number;
  totalHM_Unit: number;
  totalCIF_Unit: number;
  totalOPEX_Unit: number;
  taxRuleName: string | null;
  taxRuleId: string;
  taxRate: number;
  commRate: number;
  marginRate: number;
  otherRate: number;
  freight: number;
  divisor: number;
  suggestedPrice: number;
  totalTaxes: number;
  totalCommission: number;
  totalOther: number;
  contributionMargin: number;
  operationalMargin: number;
  openBookConsolidatedMaterials: Array<Record<string, unknown>> | null;
  bomMaterialsDetail: Array<Record<string, unknown>> | null;
  processBreakdown: unknown[] | null;
};

export function buildPricingUnitCalculationBreakdown(p: BuildPricingUnitBreakdownInput): PricingUnitCalculationBreakdown {
  const setupSum = sumSetupFromProcessBreakdown(p.processBreakdown);
  const transformMem = mapTransformationMemory(p.processBreakdown);
  const rawFromOb = mapOpenBookMaterials(p.openBookConsolidatedMaterials);
  const rawFallback = mapBomDetailMaterials(p.bomMaterialsDetail);
  const rawMaterials = rawFromOb && rawFromOb.length > 0 ? rawFromOb : rawFallback;

  const marginAmount = Number.isFinite(p.suggestedPrice) ? p.suggestedPrice * p.marginRate : NaN;
  const marginAmtOk = Number.isFinite(marginAmount) ? marginAmount : null;

  const ciu = n(p.custoFabril);
  const priceOverInd =
    ciu != null && ciu > 0 && Number.isFinite(p.suggestedPrice) ? p.suggestedPrice / ciu : null;
  const div = n(p.divisor);
  const factorCf = div != null && div > 0 && Number.isFinite(p.suggestedPrice) && Number.isFinite(p.custoFabril + p.freight)
    ? p.suggestedPrice / (p.custoFabril + p.freight)
    : null;

  const taxPct = p.taxRate * 100;
  const commPct = p.commRate * 100;
  const othPct = p.otherRate * 100;
  const marPct = p.marginRate * 100;
  const sumRates = (p.taxRate + p.commRate + p.otherRate + p.marginRate) * 100;

  const bridgeLines: Array<{ label: string; amount: number }> = [];
  if (Number.isFinite(p.custoFabril)) bridgeLines.push({ label: "Custo industrial (CIU = MP + HH + HM)", amount: p.custoFabril });
  if (Number.isFinite(p.freight)) bridgeLines.push({ label: "Frete (fixo por unidade, no numerador)", amount: p.freight });
  if (Number.isFinite(p.totalTaxes)) bridgeLines.push({ label: "Impostos sobre o preço (R$)", amount: p.totalTaxes });
  if (Number.isFinite(p.totalCommission)) bridgeLines.push({ label: "Comissão sobre o preço (R$)", amount: p.totalCommission });
  if (Number.isFinite(p.totalOther)) bridgeLines.push({ label: "Outras variáveis % sobre o preço (R$)", amount: p.totalOther });
  if (marginAmtOk != null) bridgeLines.push({ label: "Margem desejada sobre o preço (R$)", amount: marginAmtOk });

  return {
    methodology: "MARKUP_DIVISOR",
    methodologyShortNote:
      "O preço segue PV = (CIU + frete fixo) ÷ (1 − impostos% − comissão% − outros% − margem%), todos os percentuais sobre o preço de venda.",
    baseCost: {
      rawMaterialCost: n(p.totalMaterialCost),
      laborCostHH: n(p.totalHH_Unit),
      machineCostHM: n(p.totalHM_Unit),
      setupCostAllocated: setupSum,
      transformationSubtotalHHPlusHM:
        n(p.totalHH_Unit) != null && n(p.totalHM_Unit) != null ? (n(p.totalHH_Unit) as number) + (n(p.totalHM_Unit) as number) : null,
      industrialCostCIU: ciu,
      cifPerUnit: n(p.totalCIF_Unit),
      opexPerUnit: n(p.totalOPEX_Unit),
      managerialCostTotal: n(p.custoGerencial),
    },
    deductions: {
      taxes: {
        percentageOnSale: taxPct,
        amountOnSale: n(p.totalTaxes),
        ruleName: p.taxRuleName,
        ruleId: p.taxRuleId,
        source: "ProductPricing.TaxRule",
      },
      commission: { percentageOnSale: commPct, amountOnSale: n(p.totalCommission) },
      freight: { mode: "FIXED_PER_UNIT", amount: n(p.freight), percentageOnSale: null },
      otherVariables: { percentageOnSale: othPct, amountOnSale: n(p.totalOther) },
      totalRatesOnSale: sumRates,
      totalVariableOnSale:
        n(p.totalTaxes) != null && n(p.totalCommission) != null && n(p.totalOther) != null && marginAmtOk != null
          ? (n(p.totalTaxes) as number) +
            (n(p.totalCommission) as number) +
            (n(p.totalOther) as number) +
            marginAmtOk
          : null,
    },
    margin: {
      targetPercentageOnSale: marPct,
      amountOnSale: marginAmtOk,
      basis: "SALE_PRICE",
    },
    markup: {
      priceOverIndustrialCost: priceOverInd,
      divisor: div,
      factorOnCostPlusFreight: factorCf,
      formulaText:
        "PV = (CIU + F) ÷ (1 − i − c − o − m), equivalente a aplicar o fator 1÷(1−i−c−o−m) sobre (CIU+F); em que i,c,o,m são frações sobre o preço.",
      denominatorRates: {
        tax: taxPct,
        commission: commPct,
        otherVariables: othPct,
        margin: marPct,
      },
    },
    priceBridge: {
      explanation:
        "Sob o modelo de divisor, o preço de venda é a única variável que fecha a identidade: PV = CIU + frete + impostos(R$) + comissão(R$) + outros(R$) + margem desejada(R$).",
      lines: bridgeLines,
      suggestedPrice: n(p.suggestedPrice),
    },
    finalPrice: {
      suggestedPrice: n(p.suggestedPrice),
      contributionMargin: n(p.contributionMargin),
      operationalMargin: n(p.operationalMargin),
    },
    rawMaterials,
    transformationMemory: transformMem,
    helpTexts: {
      markup:
        "O sistema calcula o preço aplicando o divisor sobre (CIU + frete). O quociente preço÷CIU mostra o ganho em relação ao custo industrial, incluindo o efeito do frete fixo no numerador.",
      margin:
        "A margem aplicada representa a parcela do preço de venda destinada ao resultado desejado (percentual sobre PV), após custo industrial e frete no numerador da fórmula.",
      hm: "HM calculado a partir do custo/hora da máquina ou célula produtiva, tempo de ciclo, cavidades e eficiência produtiva — conforme roteiro ou processo padrão do cadastro.",
      hh: "HH calculado a partir do custo/hora de mão de obra considerado no processo (roteiro com cargo ou HH global no processo padrão).",
    },
  };
}
