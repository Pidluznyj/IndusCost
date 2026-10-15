import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { describe, it } from "node:test";
import * as XLSX from "xlsx";
import type { ProjectDetail } from "@/src/types/projects.js";
import type { SavedProjectPricingItem } from "./projectsPricing.js";
import { EMPTY_PROJECT_DOCUMENT_FIELDS } from "./projectsCommercialTerms.js";
import { buildProjectDocumentValueSource, detectSavedPricingStaleness, savedPricingItemToView } from "./projectsDocumentValues.js";
import {
  buildIssuerFromBranding,
  buildProjectDocumentHeader,
  formatProjectDocumentNumber,
  projectDocumentIssueBlockers,
  projectDocumentTypeFromSlug,
} from "./projectsDocumentHeader.js";
import { documentUserNotes, resolveStructureLineCode, sumLaborHours } from "./projectsDocumentCodes.js";
import { buildProjectClientReport } from "./projectsClientReport.js";
import { buildProjectExecutiveReport } from "./projectsExecutiveReport.js";
import { buildProjectIntakeFormFromDetail } from "./projectsIntakeForm.js";
import { buildQuickIntakeFormFromDetail } from "./projectsIntakeQuickForm.js";
import {
  buildProjectSpreadsheetData,
  buildProjectSpreadsheetWorkbookFromData,
  projectIntakeSpreadsheetToBytes,
  toSheetNumber,
} from "./projectsIntakeSpreadsheet.js";
import { pdfImageFromDataUrl } from "./pdf/pdfImage.js";
import { buildProjectProposalPdf } from "./projectsDocumentPdf.js";
import { hashProjectDocumentEnvelope } from "./projectsDocuments.server.js";

const A = "aaaaaaaa-aaaa-4111-8111-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4111-8111-bbbbbbbbbbbb";
const PRODUCT_ID = "cccccccc-cccc-4111-8111-cccccccccccc";
const MATERIAL_ID = "eeeeeeee-eeee-4111-8111-eeeeeeeeeeee";
const TAX = [{ id: "tax-1", name: "Simples 10%", description: null, taxPercent: 10 }];

const notes = (id: string) => `guided-origin:SIMULATION\nguided-simulation-id:${id}`;

function simItem(id: string, code: string, description: string, cost: number) {
  return {
    id,
    provisionalCode: code,
    description,
    itemType: "COMPONENT" as const,
    unit: "UN",
    estimatedUnitCost: cost,
    quotedUnitCost: null,
    supplierName: null,
    leadTimeDays: null,
    estimatedWeight: null,
    lossPercent: 0,
    requiresQuotation: false,
    requiresEngineeringReview: false,
    canBecomeOfficial: false,
    notes: notes(id),
  };
}

/** Gravado: custo 2,00 / 3,00; imposto 10%; margem 30% → preço = custo / 0,6. */
function saved(id: string, desc: string, cost: number, extra: Partial<SavedProjectPricingItem> = {}): SavedProjectPricingItem {
  const price = Math.round((cost / 0.6) * 1e6) / 1e6;
  return {
    targetItemId: id,
    targetItemType: "SIMULATION",
    targetDescriptionSnapshot: desc,
    fiscalRuleId: "tax-1",
    fiscalRuleNameSnapshot: "Simples 10%",
    costBaseUnitSnapshot: cost,
    amortizationUnitCostSnapshot: 0,
    finalUnitCostSnapshot: cost,
    taxPercentSnapshot: 10,
    targetMarginPercent: 30,
    suggestedPrice: price,
    suggestedPriceWithoutAmortization: price,
    suggestedPriceWithAmortization: price,
    agreedCustomerPrice: null,
    taxAmountWithoutAmortization: null,
    marginAmountWithoutAmortization: null,
    taxAmount: Math.round(price * 0.1 * 100) / 100,
    marginAmount: Math.round(price * 0.3 * 100) / 100,
    status: "CALCULATED",
    savedAt: "2026-10-10T14:00:00.000Z",
    ...extra,
  };
}

function detail(over: Partial<ProjectDetail> = {}, costs: [number, number] = [2, 3]): ProjectDetail {
  return {
    id: "dddddddd-dddd-4111-8111-dddddddddddd",
    code: "PRJ-00012",
    title: "Conjunto Tampa + Base",
    customerName: "Metalúrgica Alfa Ltda (Alfa)",
    customerDocument: "12.345.678/0001-90",
    ...EMPTY_PROJECT_DOCUMENT_FIELDS,
    customerId: "11111111-1111-4111-8111-111111111111",
    customerLinkSource: "LOOKUP",
    customer: {
      id: "11111111-1111-4111-8111-111111111111",
      companyName: "Metalúrgica Alfa Ltda",
      tradeName: "Alfa",
      taxId: "12345678000190",
      stateTaxId: "123.456.789",
      contactName: "Joana Lima",
      email: "compras@alfa.com.br",
      phone: "(47) 3333-4444",
      address: "Rua das Indústrias, 100",
      city: "Joinville",
      state: "SC",
      zipCode: "89200-000",
      status: "ACTIVE",
    },
    priority: "HIGH",
    application: "Linha de envase",
    desiredDeadline: "2026-12-01",
    paymentTerms: "28/56 DDL",
    proposalValidityDays: 15,
    freightCondition: "FOB",
    clientNotes: "Amostras em 10 dias.",
    description: "Projeto comercial",
    projectType: "NEW_PRODUCT",
    status: "WAITING_QUOTATION",
    commercialOwner: "Comercial A",
    technicalOwner: "Técnico B",
    expectedMonthlyVolume: 1000,
    targetPrice: null,
    targetMarginPercent: null,
    notes: "INTERNO: margem negociável",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    currentVersion: null,
    versions: [],
    simulatedProducts: [],
    simulatedItems: [simItem(A, "PEC-A", "Tampa superior", costs[0]), simItem(B, "PEC-B", "Base inferior", costs[1])],
    structureLines: [],
    molds: [],
    snapshotRootProducts: {},
    costBreakdown: {
      rawMaterialCost: 0,
      componentCost: 0,
      serviceCost: 120,
      packagingCost: 0,
      separateMoldCost: 0,
      amortizedMoldCostPerUnit: 0,
      unitCost: 0,
      targetMarginPercent: null,
      suggestedPrice: null,
      markupPercent: null,
      targetPrice: null,
      priceGap: null,
    },
    alerts: [],
    conversionAvailable: false,
    projectPricing: { config: { fiscalRuleId: "tax-1", defaultMarginPercent: 30 }, taxRules: TAX, hasSavedPricing: true, items: [] },
    projectPricingSaved: {
      config: { fiscalRuleId: "tax-1", defaultMarginPercent: 30 },
      items: [saved(A, "Tampa superior", 2), saved(B, "Base inferior", 3)],
    },
    ...over,
  } as ProjectDetail;
}

function docDetail(d: ProjectDetail): ProjectDetail {
  return { ...d, documentValueSource: buildProjectDocumentValueSource(d) };
}

describe("fonte de valores dos documentos = precificação salva", () => {
  it("usa os snapshots gravados (custo, imposto e preço) sem recalcular", () => {
    const vs = buildProjectDocumentValueSource(detail());
    assert.equal(vs.mode, "SAVED_PRICING");
    assert.equal(vs.pricingSavedAt, "2026-10-10T14:00:00.000Z");
    assert.equal(vs.stale, false, vs.staleReasons.map((r) => r.message).join("; "));
    const a = vs.view.items.find((i) => i.targetItemId === A)!;
    assert.equal(a.costBaseUnit, 2);
    assert.equal(a.taxPercent, 10);
    assert.equal(a.suggestedPrice, 3.333333);
    assert.equal(a.amortizationPriceAddOnUnit, 0);
  });

  it("custo atual mudou: documento mantém o preço histórico e aponta a divergência", () => {
    const d = detail({}, [2.5, 3]);
    const vs = buildProjectDocumentValueSource(d);
    assert.equal(vs.view.items.find((i) => i.targetItemId === A)!.suggestedPrice, 3.333333, "preço gravado, não recalculado");
    assert.equal(vs.stale, true);
    assert.deepEqual(vs.staleReasons.map((r) => r.code), ["BASE_COST_CHANGED"]);
    assert.match(vs.staleReasons[0].message, /Tampa superior: custo base mudou de R\$\s?2,00 para R\$\s?2,50/);
    // Proposta ao cliente usa o preço gravado mesmo com custo novo.
    const report = buildProjectClientReport(docDetail(d), { [A]: 2, [B]: 1 });
    assert.equal(report.products.find((p) => p.id === A)!.finalUnitPrice, 3.33);
    assert.equal(report.summary.finalSetPrice, 11.66);
  });

  it("regra fiscal com novo percentual e item novo sem precificação são divergências", () => {
    const d = detail({
      projectPricing: { config: { fiscalRuleId: "tax-1", defaultMarginPercent: 30 }, taxRules: [{ ...TAX[0], taxPercent: 12 }], hasSavedPricing: true, items: [] },
      projectPricingSaved: { config: { fiscalRuleId: "tax-1", defaultMarginPercent: 30 }, items: [saved(A, "Tampa superior", 2)] },
    });
    const codes = buildProjectDocumentValueSource(d).staleReasons.map((r) => r.code).sort();
    assert.deepEqual(codes, ["ITEM_NOT_PRICED", "TAX_RULE_CHANGED"]);
  });

  it("item gravado que saiu do projeto aparece como removido", () => {
    const reasons = detectSavedPricingStaleness([saved("x", "Item antigo", 1)], { config: { fiscalRuleId: null, defaultMarginPercent: null }, items: [], taxRules: [], hasSavedPricing: true });
    assert.deepEqual(reasons.map((r) => r.code), ["ITEM_REMOVED"]);
  });

  it("sem precificação salva: nenhum preço é exibido", () => {
    const vs = buildProjectDocumentValueSource(detail({ projectPricingSaved: { config: { fiscalRuleId: null, defaultMarginPercent: null }, items: [] } }));
    assert.equal(vs.mode, "NO_SAVED_PRICING");
    assert.ok(vs.view.items.length > 0);
    assert.ok(vs.view.items.every((i) => i.suggestedPrice == null && i.agreedCustomerPrice == null));
  });

  it("desmembra o adicional de amortização no preço final com a fórmula oficial", () => {
    const v = savedPricingItemToView(saved(A, "Tampa", 2, { suggestedPrice: 3.833333 }));
    assert.equal(v.calculatedProductPrice, 3.333333);
    assert.equal(v.amortizationPriceAddOnUnit, 0.5);
  });
});

describe("bloco documental comum", () => {
  const issuer = buildIssuerFromBranding({
    companyName: "Lazarios Koppetel Ltda",
    tradeName: "Lazarios",
    document: "14055501000180",
    address: "Rua X, 1 — Curitiba/PR",
    phone: "(41) 3000-0000",
    email: "contato@empresa.com.br",
    proposalLogoDataUrl: "data:image/png;base64,AAAA",
  });

  it("número do documento e tipos por slug", () => {
    assert.equal(formatProjectDocumentNumber("PRJ-00012", "CLIENT_PROPOSAL", 3), "PRJ-00012-PC-R03");
    assert.equal(projectDocumentTypeFromSlug("planilha"), "SPREADSHEET");
    assert.equal(projectDocumentTypeFromSlug("x"), null);
  });

  it("emitente vem das Configurações de Marca (sem valor fixo no código)", () => {
    assert.equal(issuer.document, "14.055.501/0001-80");
    const empty = buildIssuerFromBranding(null);
    assert.equal(empty.legalName, null);
    assert.equal(empty.document, null);
  });

  it("documento interno mostra divergências e avisos; proposta ao cliente não", () => {
    const d = docDetail(detail({}, [2.5, 3]));
    const common = { detail: d, issuer, valueSource: d.documentValueSource!, issuedAt: "2026-10-15T12:00:00.000Z", issuedBy: { userId: null, name: "Paulo" }, revision: 2 };
    const internal = buildProjectDocumentHeader({ type: "EXECUTIVE_REPORT", ...common });
    assert.equal(internal.status, "ISSUED");
    assert.equal(internal.documentNumber, "PRJ-00012-RG-R02");
    assert.equal(internal.values.staleReasons.length, 1);
    assert.equal(internal.customer.registry?.city, "Joinville");
    const client = buildProjectDocumentHeader({ type: "CLIENT_PROPOSAL", ...common, revision: null });
    assert.equal(client.status, "PREVIEW");
    assert.equal(client.documentNumber, null);
    assert.deepEqual(client.values.staleReasons, []);
    assert.deepEqual(client.warnings, []);
  });

  it("proposta só é emitida com precificação salva, atual e completa", () => {
    assert.ok(projectDocumentIssueBlockers("CLIENT_PROPOSAL", { mode: "NO_SAVED_PRICING", stale: false, staleReasons: [] }).length > 0);
    const stale = buildProjectDocumentValueSource(detail({}, [2.5, 3]));
    assert.ok(projectDocumentIssueBlockers("CLIENT_PROPOSAL", stale).some((b) => /desatualizada/.test(b)));
    assert.deepEqual(projectDocumentIssueBlockers("CLIENT_PROPOSAL", buildProjectDocumentValueSource(detail()), { pricingPending: false, productsCount: 2 }), []);
    assert.deepEqual(projectDocumentIssueBlockers("EXECUTIVE_REPORT", stale), [], "interno emite com aviso impresso");
  });

  it("hash independe da ordem das chaves (jsonb reordena)", () => {
    assert.equal(hashProjectDocumentEnvelope({ b: 1, a: { d: 2, c: [1, 2] } }), hashProjectDocumentEnvelope({ a: { c: [1, 2], d: 2 }, b: 1 }));
    assert.notEqual(hashProjectDocumentEnvelope({ a: 1 }), hashProjectDocumentEnvelope({ a: 2 }));
  });
});

describe("correções dos documentos", () => {
  it("relatório gerencial: custo do conjunto = Σ unitário × qtd./conjunto, e elaborado por = emissor", () => {
    const r = buildProjectExecutiveReport(docDetail(detail()), { quantitiesByTargetId: { [A]: 2 }, preparedBy: "Paulo" });
    assert.equal(r.executiveSummary.baseItemsCost, 7); // 2×2 + 3×1
    assert.equal(r.executiveSummary.finalItemsCost, 7);
    assert.equal(r.executiveSummary.setQuantitiesAssumed, true, "B sem quantidade salva");
    const a = r.items.find((i) => i.id === A)!;
    assert.equal(a.quantityPerSet, 2);
    assert.equal(a.setFinalCost, 4);
    assert.equal(a.costSource, "SAVED_PRICING");
    assert.equal(r.approval.preparedBy, "Paulo");
    assert.equal(r.approval.reviewedBy, "", "revisão não é presumida");
  });

  it("códigos legíveis: SKU/código oficial, nunca o id interno", () => {
    const codes = { products: { [PRODUCT_ID]: "610.51AA" }, materials: { [MATERIAL_ID]: "115.01--" } };
    assert.equal(resolveStructureLineCode({ simulatedItemId: null, existingProductId: PRODUCT_ID, existingMaterialId: null }, [], codes), "610.51AA");
    assert.equal(resolveStructureLineCode({ simulatedItemId: null, existingProductId: null, existingMaterialId: MATERIAL_ID }, [], codes), "115.01--");
    assert.equal(resolveStructureLineCode({ simulatedItemId: null, existingProductId: PRODUCT_ID, existingMaterialId: null }, [], null), null);
  });

  it("observações nos documentos: só o texto do usuário, sem marcadores técnicos com ids", () => {
    assert.equal(documentUserNotes(notes(A)), null);
    assert.equal(documentUserNotes(`Peça crítica\n${notes(A)}`), "Peça crítica");
    assert.equal(
      documentUserNotes("guided-other-cost\ngroup:TOOLING\nbatch:abc\n__USER_NOTES__=Ferramental externo"),
      "Ferramental externo",
    );
    const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
    const d = docDetail(detail());
    assert.doesNotMatch(JSON.stringify(buildQuickIntakeFormFromDetail(d, {})), uuid);
    assert.doesNotMatch(JSON.stringify(buildProjectIntakeFormFromDetail(d, {}).materialsTable), uuid);
    assert.doesNotMatch(JSON.stringify(buildProjectClientReport(d).products.map((p) => p.notes)), uuid);
  });

  it("horas de mão de obra vêm das linhas em hora, nunca de valores em R$", () => {
    assert.equal(sumLaborHours([{ unitSnapshot: "HH", quantity: 1.5, countsInSimulatedProductCost: true }, { unitSnapshot: "KG", quantity: 9, countsInSimulatedProductCost: true }]), 1.5);
    assert.equal(sumLaborHours([{ unitSnapshot: "UN", quantity: 3, countsInSimulatedProductCost: true }]), null);
  });

  it("ficha completa: cliente do cadastro, condições estruturadas, BOM sem UUID e HH em horas", () => {
    const line = {
      id: "l1", simulatedProductId: null, parentLineId: null, level: 1, treePath: null, snapshotRootProductId: null,
      lineType: "RAW_MATERIAL", sourceType: "EXISTING_MATERIAL", existingProductId: null, existingMaterialId: MATERIAL_ID,
      simulatedItemId: null, sourceOfficialBomId: null, sourceOfficialRoutingId: null, descriptionSnapshot: "PP H503",
      unitSnapshot: "KG", quantity: 0.0029, lossPercent: null, officialQuantitySnapshot: null, officialLossPercentSnapshot: null,
      officialUnitCostSnapshot: null, unitCostSnapshot: 9.5, totalCost: 0.03, costSource: null, isChangedFromOfficial: false,
      isMissingCost: false, countsInSimulatedProductCost: true, supplierNameSnapshot: null, notes: null, sortOrder: 1,
    };
    const labor = { ...line, id: "l2", lineType: "PROCESS", sourceType: "MANUAL", existingMaterialId: null, descriptionSnapshot: "CNC", unitSnapshot: "HH", quantity: 1.5, unitCostSnapshot: 80, totalCost: 120 };
    const d = docDetail(detail({ structureLines: [line, labor] as never }));
    const form = buildProjectIntakeFormFromDetail(d, {
      entityCodes: { products: {}, materials: { [MATERIAL_ID]: "115.01--" } },
      quantitiesByTargetId: { [A]: 2 },
      issuerName: "Lazarios Koppetel Ltda",
    });
    const f = (key: string) => form.sections.flatMap((s) => s.fields).find((x) => x.key === key)?.value ?? null;
    assert.equal(form.bomTable[0].code, "115.01--");
    assert.ok(form.bomTable.every((r) => !/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(r.code ?? "")), "nenhum UUID");
    assert.equal(f("directLabor"), "1,5 h");
    assert.equal(f("directLaborCost"), "R$ 120,00".replace(" ", " "));
    assert.equal(f("customerInSystem"), "Sim — vinculado ao cadastro de clientes");
    assert.equal(f("mainContact"), "Joana Lima");
    assert.equal(f("cityState"), "Joinville/SC");
    assert.equal(f("priority"), "Alta");
    assert.equal(f("application"), "Linha de envase");
    assert.equal(f("paymentTerms"), "28/56 DDL");
    assert.equal(f("freightIncoterm"), "FOB (frete por conta do destinatário)");
    assert.equal(f("companyGroup"), "Lazarios Koppetel Ltda");
    assert.match(f("suggestedPrice") ?? "", /11,66/); // 3,33×2 + 5,00
  });

  it("ficha rápida: prioridade, prazo e aplicação reais; quantidade prevista não presumida", () => {
    const q = buildQuickIntakeFormFromDetail(docDetail(detail({ simulatedProducts: [{ id: A, provisionalCode: "PEC-A", description: "Tampa", unit: "UN", notes: null } as never] })), {
      quantitiesByTargetId: {},
    });
    assert.equal(q.header.priority, "Alta");
    assert.equal(q.header.desiredDeadline, "01/12/2026");
    assert.equal(q.productFields.find((p) => p.label === "Aplicação")?.value, "Linha de envase");
    assert.equal(q.deliverableProducts[0].plannedQuantity, null);
  });

  it("planilha: dados reais nas abas 01–08, exemplo só na 99_Exemplo e aba 00_Documento", () => {
    const d = docDetail(detail());
    const data = buildProjectSpreadsheetData(d, { quantitiesByTargetId: {} });
    assert.equal(data.sheets["01_Projeto"].rows[0].nome_projeto, "PRJ-00012 — Conjunto Tampa + Base");
    assert.equal(data.sheets["01_Projeto"].rows[0].prioridade, "Alta");
    assert.ok(!JSON.stringify(data).includes("610.51AA"), "sem exemplo misturado");
    const header = buildProjectDocumentHeader({
      type: "SPREADSHEET", detail: d, issuer: buildIssuerFromBranding(null), valueSource: d.documentValueSource!,
      issuedAt: "2026-10-15T12:00:00.000Z", issuedBy: { userId: null, name: "Paulo" }, revision: 1,
    });
    const wb = XLSX.read(projectIntakeSpreadsheetToBytes(buildProjectSpreadsheetWorkbookFromData(data, header)), { type: "array" });
    assert.equal(wb.SheetNames[0], "00_Documento");
    assert.equal(wb.SheetNames.at(-1), "99_Exemplo");
    const doc = XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets["00_Documento"]);
    assert.equal(doc.find((r) => r.campo === "Número")?.valor, "PRJ-00012-PL-R01");
    assert.equal(toSheetNumber("R$ 1.234,56"), 1234.56);
    assert.equal(toSheetNumber("0,0029"), 0.0029);
    assert.equal(toSheetNumber("texto"), "texto");
  });
});

function pngDataUrl(width: number, height: number, rgba: number[]): string {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rows: number[] = [];
  for (let y = 0; y < height; y += 1) rows.push(0, ...rgba.slice(y * width * 4, (y + 1) * width * 4));
  const png = Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.from(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

describe("PDF da proposta (motor existente + logo)", () => {
  it("PNG RGBA vira imagem com SMask; JPEG lê dimensões do SOF; formato inválido → null", () => {
    const img = pdfImageFromDataUrl(pngDataUrl(2, 1, [255, 0, 0, 255, 0, 0, 255, 128]));
    assert.equal(img?.width, 2);
    assert.ok(img?.smask, "alfa vira SMask");
    const jpeg = Buffer.from("ffd8ffc0001108000a001403012200021101031101ffd9", "hex");
    const j = pdfImageFromDataUrl(`data:image/jpeg;base64,${jpeg.toString("base64")}`);
    assert.equal(j?.width, 20);
    assert.equal(j?.height, 10);
    assert.equal(pdfImageFromDataUrl("data:image/gif;base64,R0lGOD"), null);
  });

  it("gera PDF multipágina com logo, acentos, condições 'A definir', número e paginação", () => {
    const d = docDetail(detail({ paymentTerms: null }));
    const many = Array.from({ length: 40 }, (_, i) => i);
    const report = buildProjectClientReport(d, { [A]: 2 }, { issuerName: "Lazarios Koppetel Ltda", issuedAt: "2026-10-15T12:00:00.000Z" });
    report.products = many.map((i) => ({ ...report.products[0], id: `p${i}`, name: `Peça ação nº ${i}` }));
    const issuer = buildIssuerFromBranding({ companyName: "Lazarios Koppetel Ltda", document: "14055501000180", proposalLogoDataUrl: pngDataUrl(1, 1, [0, 0, 0, 255]) });
    const header = buildProjectDocumentHeader({
      type: "CLIENT_PROPOSAL", detail: d, issuer, valueSource: d.documentValueSource!,
      issuedAt: "2026-10-15T12:00:00.000Z", issuedBy: { userId: null, name: "Paulo" }, revision: 1,
    });
    const pdf = buildProjectProposalPdf({ header, body: report }, { sha256: "a".repeat(64) });
    const text = pdf.toString("latin1");
    assert.ok(text.startsWith("%PDF-1.4"));
    assert.match(text, /\/Im1 \d+ 0 R/);
    const pages = (text.match(/\/Type \/Page /g) ?? []).length;
    assert.ok(pages >= 2, "multipágina");
    // Acentos são gravados como códigos WinAnsi em octal (á = \341, ç = \347, ã = \343).
    assert.ok(text.includes(`P\\341gina 1 de ${pages}`));
    assert.ok(text.includes("PRJ-00012-PC-R01"));
    assert.ok(text.includes("Pe\\347a a\\347\\343o"), "acentos WinAnsi preservados");
    assert.ok(text.includes("A definir"));
    assert.ok(!text.includes("INTERNO"), "observação interna nunca vai ao cliente");
    const preview = buildProjectProposalPdf({ header: { ...header, status: "PREVIEW", documentNumber: null, revision: null }, body: report });
    assert.ok(preview.toString("latin1").includes("PR\\311VIA"));
  });
});
