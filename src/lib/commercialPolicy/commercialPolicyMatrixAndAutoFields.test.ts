/**
 * Matriz do Anexo I × Formação de Preço, campos automáticos do documento
 * (datas, aprovação e termo de ciência) e vigência informada na publicação.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import {
  auditPolCom001Publication,
  buildCurrentCommercialPolicyNormativeSnapshot,
  buildPolCom001ReconciliationMatrix,
  normativeSnapshotHash,
  readDocumentCommissionMatrix,
  type CommissionMatrixInput,
} from "./commercialPolicyNormative.js";
import { loadCommissionMatrixFromPriceTables } from "./commercialPolicyCommissionMatrix.server.js";
import { applyPolicyAutoFields, policyCommissionMatrixFromSnapshot, resolvePolicyIdentity, type PolicyAutoFieldContext } from "./policyAutoFields.js";
import { resolveCommercialCommissionFromTiers } from "../commercialMarginCore.js";
import { roundRatePercent } from "../commissions/commission-commercial-tier.js";
import { OUT_OF_TABLE_COMMISSION_PERCENT } from "../commissions/commissionOutOfTable.js";
import { parsePolicyChapters, policyChaptersPlainText } from "./policyDocumentFormat.js";
import { parsePublicationEffectiveDate, registerCommercialPolicyRoutes } from "./commercialPolicyRoutes.js";
import { createMemoryCommercialPolicyStore } from "./commercialPolicyStore.js";
import { createPolicyDraft, type PolicyActor } from "./commercialPolicyService.js";
import { buildControlledCopyPdf } from "./commercialPolicyControlledCopyPdf.js";
import { officialCommercialPolicyBody, officialCommercialPolicyHash } from "./official/polCom001V1.js";

const RELEASE = { releaseDefaultRule: "EACH_RECEIVABLE_PAID", partialPaymentEnabled: true };
const NOW = new Date("2026-09-30T15:00:00.000Z");
const CONTENT = officialCommercialPolicyBody().content;

/** Tabelas publicadas como na tela de Formação de Preço: 30→1, 35→2, 40→3, 50→4. */
const PRICING: CommissionMatrixInput = {
  tiers: [
    { code: "ATACADO", name: "Atacado", marginPercent: 30, commissionPercent: 1 },
    { code: "VAREJO_1", name: "Varejo 1", marginPercent: 35, commissionPercent: 2 },
    { code: "VAREJO_2", name: "Varejo 2", marginPercent: 40, commissionPercent: 3 },
    { code: "VAREJO_3", name: "Varejo 3", marginPercent: 50, commissionPercent: 4 },
  ],
  outOfTableCommissionPercent: 1,
  engineRuleActive: true,
};

const matrixFinding = (content: string, matrix: CommissionMatrixInput | null) =>
  auditPolCom001Publication(content, buildCurrentCommercialPolicyNormativeSnapshot(RELEASE, matrix)).findings.find((item) =>
    item.code.startsWith("COMMISSION_MATRIX_")
  );

/** Anexo I com os níveis escritos por extenso (em vez da linha preenchida pelo snapshot). */
const withWrittenLevels = (rows: Array<[string, string, string]>) =>
  CONTENT.replace("| ____ | ____ | ____ |", rows.map((row) => `| ${row.join(" | ")} |`).join("\n"));

/** Anexo I do DOCX original: comissão em degraus por faixa de Margem Oficial. */
const LEGACY_STEP_CONTENT = [
  "# 7. MARGEM OFICIAL, MATRIZ DE COMISSÃO, PRECIFICAÇÃO E ALÇADAS",
  "O percentual de comissão de cada Item de Venda é o da faixa de Margem Oficial do Anexo I.",
  "# ANEXO I — MATRIZ NORMATIVA DE COMISSÃO, MARGEM E ALÇADA",
  "",
  "| Margem Oficial do Item | Comissão do Vendedor | Alçada Comercial |",
  "| Abaixo de 30,00% | 1,00% | Aprovação prévia da Diretoria |",
  "| 30,00% a 34,99% | 1,00% | Aprovação prévia do Supervisor Comercial |",
  "| 35,00% a 39,99% | 2,00% | Fluxo comercial ordinário |",
  "| 40,00% a 49,99% | 3,00% | Fluxo comercial ordinário |",
  "| 50,00% ou mais | 4,00% | Fluxo comercial ordinário |",
  "",
].join("\n");

describe("Anexo I × Formação de Preço", () => {
  it("1/2: a Seção 7 e o Anexo I descrevem níveis de referência e interpolação pelo preço; a tabela não traz valor fixo", () => {
    const document = readDocumentCommissionMatrix(CONTENT);
    assert.equal(document.form, "SNAPSHOT");
    assert.deepEqual(document.levels, []);
    assert.deepEqual(document.bands, []);
    assert.equal(document.describesInterpolation, true);
    assert.deepEqual(
      document.approvals.map((row) => row.label),
      ["Abaixo de 30,00%", "30,00% a 34,99%", "35,00% ou mais"]
    );
    const text = policyChaptersPlainText(parsePolicyChapters(CONTENT));
    assert.match(text, /quatro níveis comerciais de referência: Atacado, Varejo 1, Varejo 2 e Varejo 3/);
    assert.match(text, /interpolação linear entre os percentuais desses dois níveis/);
    assert.match(text, /A interpolação é feita pelo preço praticado, e não pela margem/);
    assert.match(text, /aplica-se o percentual do Varejo 3, que é o teto da Matriz/);
    assert.match(text, /A comissão efetiva é sempre calculada pelo IndusCost/);
    // A matriz em degraus do DOCX não está mais no texto.
    assert.doesNotMatch(text, /50,00% ou mais/);
    assert.doesNotMatch(text, /Comissão do Vendedor/);
  });

  it("3/4: o Anexo I é renderizado com os níveis do snapshot da versão, na ordem, com a linha de preço abaixo da tabela", () => {
    const snapshot = buildCurrentCommercialPolicyNormativeSnapshot(RELEASE, PRICING);
    const annex = applyPolicyAutoFields(parsePolicyChapters(CONTENT), {
      versionLabel: "1.0", publishedAt: null, effectiveFrom: null, approver: null, signer: null, acceptance: null, today: NOW.toISOString(),
      commissionMatrix: policyCommissionMatrixFromSnapshot(snapshot),
    }).find((chapter) => chapter.title.startsWith("ANEXO I —"));
    const table = annex?.blocks.find((block) => block.type === "table" && /nível comercial/i.test(block.rows[0]?.[0] ?? ""));
    assert.ok(table && table.type === "table");
    assert.deepEqual(table.rows, [
      ["Nível comercial", "Margem de referência", "Comissão de referência"],
      ["Atacado", "30,00%", "1,00%"],
      ["Varejo 1", "35,00%", "2,00%"],
      ["Varejo 2", "40,00%", "3,00%"],
      ["Varejo 3", "50,00%", "4,00%"],
      ["Preço abaixo do Atacado (abaixo da tabela)", "—", "1,00%"],
    ]);
  });

  it("5: versão publicada continua mostrando a matriz congelada quando a Formação de Preço muda", () => {
    const frozen = buildCurrentCommercialPolicyNormativeSnapshot(RELEASE, PRICING);
    const later = buildCurrentCommercialPolicyNormativeSnapshot(RELEASE, {
      ...PRICING,
      tiers: PRICING.tiers.map((tier) => (tier.code === "VAREJO_3" ? { ...tier, marginPercent: 55, commissionPercent: 5 } : tier)),
    });
    assert.deepEqual(policyCommissionMatrixFromSnapshot(frozen)?.levels.at(-1), { name: "Varejo 3", marginPercent: 50, commissionPercent: 4 });
    assert.deepEqual(policyCommissionMatrixFromSnapshot(later)?.levels.at(-1), { name: "Varejo 3", marginPercent: 55, commissionPercent: 5 });
    assert.notEqual(normativeSnapshotHash(frozen), normativeSnapshotHash(later));
    assert.equal(policyCommissionMatrixFromSnapshot(buildCurrentCommercialPolicyNormativeSnapshot(RELEASE, null)), null);
  });

  it("sem as quatro tabelas publicadas continua bloqueando como não parametrizada", () => {
    const finding = matrixFinding(CONTENT, null);
    assert.equal(finding?.code, "COMMISSION_MATRIX_NOT_PARAMETERIZED");
    assert.equal(finding?.severity, "BLOCKING");
    assert.match(finding?.resolution.where ?? "", /Formação de Preço/);
  });

  it("11: a política candidata fica alinhada — o texto representa o motor; as alçadas seguem como processo manual", () => {
    const audit = auditPolCom001Publication(CONTENT, buildCurrentCommercialPolicyNormativeSnapshot(RELEASE, PRICING));
    const finding = audit.findings.find((item) => item.code.startsWith("COMMISSION_MATRIX_"));
    assert.equal(finding?.code, "COMMISSION_MATRIX_ALIGNED");
    assert.equal(finding?.severity, "INFORMATIONAL");
    assert.equal(finding?.blocking, false);
    assert.match(finding?.system ?? "", /Atacado — margem 30,00% → comissão 1,00%/);
    assert.match(finding?.system ?? "", /Varejo 3 — margem 50,00% → comissão 4,00%/);
    assert.equal(audit.findings.find((item) => item.code === "APPROVAL_AUTHORITY_MANUAL_PROCESS")?.severity, "WARNING");
    assert.equal(audit.findings.some((item) => item.code === "COMMISSION_MATRIX_INTERPOLATED"), false);
  });

  it("11: COMMISSION_MATRIX_INTERPOLATED só some por comparação real — texto em degraus ou sem interpolação continua bloqueando", () => {
    const legacy = readDocumentCommissionMatrix(LEGACY_STEP_CONTENT);
    assert.equal(legacy.form, "STEP_BANDS");
    assert.deepEqual(
      legacy.bands.map((band) => [band.marginFrom, band.commissionPercent]),
      [[null, 1], [30, 1], [35, 2], [40, 3], [50, 4]]
    );
    const stepped = matrixFinding(LEGACY_STEP_CONTENT, PRICING);
    assert.equal(stepped?.code, "COMMISSION_MATRIX_INTERPOLATED");
    assert.equal(stepped?.severity, "BLOCKING");
    assert.match(stepped?.document ?? "", /faixas em degrau/);
    assert.match(stepped?.system ?? "", /recebe 1,50%/);
    // Tabela nova, mas sem dizer que a interpolação é pelo preço: ainda não representa o motor.
    const silent = CONTENT.replace(/interpola[^\s.,;:]*/gi, "proporção");
    assert.notEqual(silent, CONTENT);
    const finding = matrixFinding(silent, PRICING);
    assert.equal(finding?.code, "COMMISSION_MATRIX_INTERPOLATED");
    assert.equal(finding?.severity, "BLOCKING");
  });

  it("níveis escritos no Anexo I diferentes dos publicados bloqueiam apontando a diferença; iguais ficam alinhados", () => {
    const same = withWrittenLevels([["Atacado", "30,00%", "1,00%"], ["Varejo 1", "35,00%", "2,00%"], ["Varejo 2", "40,00%", "3,00%"], ["Varejo 3", "50,00%", "4,00%"], ["Preço abaixo do Atacado", "—", "1,00%"]]);
    assert.equal(readDocumentCommissionMatrix(same).form, "LEVELS");
    assert.equal(matrixFinding(same, PRICING)?.code, "COMMISSION_MATRIX_ALIGNED");
    const different = withWrittenLevels([["Atacado", "30,00%", "1,00%"], ["Varejo 1", "40,00%", "2,00%"], ["Varejo 2", "45,00%", "3,00%"], ["Varejo 3", "50,00%", "5,00%"], ["Preço abaixo do Atacado", "—", "0,50%"]]);
    const finding = matrixFinding(different, PRICING);
    assert.equal(finding?.code, "COMMISSION_MATRIX_MISMATCH");
    assert.equal(finding?.severity, "BLOCKING");
    assert.match(finding?.system ?? "", /nível "Varejo 1" tem margem 40,00% e a tabela Varejo 1 tem margem 35,00%/);
    assert.match(finding?.system ?? "", /nível "Varejo 3" paga 5,00% e a tabela Varejo 3 paga 4,00%/);
    assert.match(finding?.system ?? "", /preço abaixo da tabela paga 0,50% no Anexo I e 1,00% no motor/);
    // Matriz em degraus do DOCX com números diferentes dos publicados também é divergência.
    const legacy = matrixFinding(LEGACY_STEP_CONTENT, { ...PRICING, tiers: PRICING.tiers.map((tier) => (tier.code === "VAREJO_3" ? { ...tier, commissionPercent: 5 } : tier)) });
    assert.equal(legacy?.code, "COMMISSION_MATRIX_MISMATCH");
    assert.match(legacy?.system ?? "", /"50,00% ou mais" paga 4,00% e a tabela Varejo 3 paga 5,00%/);
  });

  it("matriz igual mas sem regra \"Faixa comercial\" ativa bloqueia: o motor não lê as tabelas", () => {
    const finding = matrixFinding(CONTENT, { ...PRICING, engineRuleActive: false });
    assert.equal(finding?.code, "COMMISSION_MATRIX_ENGINE_RULE_INACTIVE");
    assert.equal(finding?.severity, "BLOCKING");
  });

  it("o snapshot congela só margem e comissão: mudar a matriz muda o hash, republicar igual não", () => {
    const base = normativeSnapshotHash(buildCurrentCommercialPolicyNormativeSnapshot(RELEASE, PRICING));
    assert.equal(base, normativeSnapshotHash(buildCurrentCommercialPolicyNormativeSnapshot(RELEASE, structuredClone(PRICING))));
    const changed = { ...PRICING, tiers: PRICING.tiers.map((tier) => (tier.code === "VAREJO_3" ? { ...tier, commissionPercent: 5 } : tier)) };
    assert.notEqual(base, normativeSnapshotHash(buildCurrentCommercialPolicyNormativeSnapshot(RELEASE, changed)));
  });

  it("a matriz de reconciliação mostra a linha da matriz conforme o achado e a das alçadas como processo manual", () => {
    const snapshot = buildCurrentCommercialPolicyNormativeSnapshot(RELEASE, PRICING);
    const rows = buildPolCom001ReconciliationMatrix(snapshot, CONTENT);
    assert.equal(rows.find((row) => row.findingCode === "COMMISSION_MATRIX_ALIGNED")?.status, "ALINHADO");
    assert.equal(rows.find((row) => row.findingCode === "APPROVAL_AUTHORITY_MANUAL_PROCESS")?.status, "PROCESSO_MANUAL");
    const legacy = buildPolCom001ReconciliationMatrix(snapshot, LEGACY_STEP_CONTENT);
    assert.equal(legacy.find((row) => row.findingCode === "COMMISSION_MATRIX_INTERPOLATED")?.status, "DIVERGENTE");
  });
});

describe("o texto da política × o motor de comissão (testes 6–10)", () => {
  // Um produto com os quatro preços de referência publicados; comissões iguais às da matriz.
  const tiers = [
    { id: "ATACADO", marginRate: 0.3, salePrice: 100, commissionRate: 0.01 },
    { id: "VAREJO_1", marginRate: 0.35, salePrice: 110, commissionRate: 0.02 },
    { id: "VAREJO_2", marginRate: 0.4, salePrice: 120, commissionRate: 0.03 },
    { id: "VAREJO_3", marginRate: 0.5, salePrice: 140, commissionRate: 0.04 },
  ];
  const percent = (netUnitPrice: number) => {
    const result = resolveCommercialCommissionFromTiers({ netUnitPrice, tiers, belowLowestCommissionRate: OUT_OF_TABLE_COMMISSION_PERCENT / 100 });
    assert.equal(result.ok, true);
    return result.ok && result.commissionRate !== null ? roundRatePercent(result.commissionRate * 100) : null;
  };

  it("6: preço igual ao de referência de um nível paga o percentual do nível", () => {
    assert.equal(percent(100), 1);
    assert.equal(percent(110), 2);
    assert.equal(percent(120), 3);
    assert.equal(percent(140), 4);
  });

  it("7: no meio do intervalo entre dois preços de referência o motor paga 1,50%, como o exemplo da Seção 7", () => {
    assert.equal(percent(105), 1.5);
    assert.equal(percent(115), 2.5);
    // A proporção é do preço, não da margem: 1/4 do caminho entre Varejo 2 e Varejo 3.
    assert.equal(percent(125), 3.25);
    assert.match(CONTENT, /vendido exatamente na metade do intervalo entre os dois preços de referência recebe 1,50%/);
  });

  it("8: abaixo do preço do Atacado vale o percentual de preço abaixo da tabela, o mesmo que o Anexo I mostra", () => {
    assert.equal(percent(99.99), OUT_OF_TABLE_COMMISSION_PERCENT);
    assert.equal(percent(50), OUT_OF_TABLE_COMMISSION_PERCENT);
    const matrix = policyCommissionMatrixFromSnapshot(buildCurrentCommercialPolicyNormativeSnapshot(RELEASE, PRICING));
    assert.equal(matrix?.belowLowestCommissionPercent, OUT_OF_TABLE_COMMISSION_PERCENT);
  });

  it("9: a partir do preço do Varejo 3 o percentual não sobe: o Varejo 3 é o teto", () => {
    assert.equal(percent(140), 4);
    assert.equal(percent(141), 4);
    assert.equal(percent(1000), 4);
  });

  it("10: o percentual sai com quatro casas decimais, como a Seção 7 informa", () => {
    assert.equal(percent(103.333333), 1.3333);
    assert.equal(percent(133.3), 3.665);
    assert.match(CONTENT, /apurado com quatro casas decimais/);
  });
});

describe("leitura da matriz nas tabelas publicadas", () => {
  type Version = { id: string; priceTableId: string; targetMarginPercent: number | null; commissionPerc: number | null };
  function fakeDb(input: { versions: Version[]; itemCommissions?: Record<string, number[]>; tierRules?: number; tables?: string[] }) {
    const codes = input.tables ?? ["ATACADO", "VAREJO_1", "VAREJO_2", "VAREJO_3"];
    const defaults: Record<string, number> = { ATACADO: 30, VAREJO_1: 40, VAREJO_2: 50, VAREJO_3: 60 };
    return {
      priceTable: { findMany: async () => codes.map((code) => ({ id: `t-${code}`, code, name: code, defaultMarginPct: defaults[code] })) },
      priceTableVersion: { findFirst: async (args: { where: { priceTableId: string } }) => input.versions.find((row) => row.priceTableId === args.where.priceTableId) ?? null },
      priceTableItem: {
        findMany: async (args: { where: { priceTableVersionId: string } }) =>
          (input.itemCommissions?.[args.where.priceTableVersionId] ?? []).map((commissionPerc) => ({ commissionPerc })),
      },
      commissionRule: { count: async () => input.tierRules ?? 1 },
    } as unknown as Parameters<typeof loadCommissionMatrixFromPriceTables>[0];
  }
  const published = (code: string, margin: number | null, commission: number | null): Version => ({ id: `v-${code}`, priceTableId: `t-${code}`, targetMarginPercent: margin, commissionPerc: commission });

  it("usa a margem-alvo e a comissão gravadas na versão publicada de cada tabela", async () => {
    const matrix = await loadCommissionMatrixFromPriceTables(
      fakeDb({ versions: [published("ATACADO", 30, 1), published("VAREJO_1", 35, 2), published("VAREJO_2", 40, 3), published("VAREJO_3", 50, 4)] }),
      NOW
    );
    assert.deepEqual(matrix?.tiers.map((tier) => [tier.code, tier.marginPercent, tier.commissionPercent]), [["ATACADO", 30, 1], ["VAREJO_1", 35, 2], ["VAREJO_2", 40, 3], ["VAREJO_3", 50, 4]]);
    assert.equal(matrix?.outOfTableCommissionPercent, 1);
    assert.equal(matrix?.engineRuleActive, true);
  });

  it("sem margem na versão usa a margem padrão da tabela; sem comissão na versão só aceita percentual único nos itens", async () => {
    const versions = [published("ATACADO", null, null), published("VAREJO_1", 35, 2), published("VAREJO_2", 40, 3), published("VAREJO_3", 50, 4)];
    const single = await loadCommissionMatrixFromPriceTables(fakeDb({ versions, itemCommissions: { "v-ATACADO": [1] } }), NOW);
    assert.deepEqual([single?.tiers[0].marginPercent, single?.tiers[0].commissionPercent], [30, 1]);
    assert.equal(await loadCommissionMatrixFromPriceTables(fakeDb({ versions, itemCommissions: { "v-ATACADO": [1, 2] } }), NOW), null);
  });

  it("tabela sem versão publicada ou regra \"Faixa comercial\" inativa são reportadas, nunca presumidas", async () => {
    assert.equal(await loadCommissionMatrixFromPriceTables(fakeDb({ versions: [published("ATACADO", 30, 1)] }), NOW), null);
    const inactive = await loadCommissionMatrixFromPriceTables(
      fakeDb({ versions: [published("ATACADO", 30, 1), published("VAREJO_1", 35, 2), published("VAREJO_2", 40, 3), published("VAREJO_3", 50, 4)], tierRules: 0 }),
      NOW
    );
    assert.equal(inactive?.engineRuleActive, false);
  });
});

describe("campos automáticos do documento", () => {
  const chapters = parsePolicyChapters(CONTENT);
  const text = (context: PolicyAutoFieldContext) => policyChaptersPlainText(applyPolicyAutoFields(chapters, context));
  const base: PolicyAutoFieldContext = { versionLabel: "1.0", publishedAt: null, effectiveFrom: null, approver: null, signer: null, acceptance: null, today: NOW.toISOString() };
  const published: PolicyAutoFieldContext = {
    ...base,
    publishedAt: "2026-09-30T15:00:00.000Z",
    effectiveFrom: "2026-10-15T03:00:00.000Z",
    approver: { name: "Paulo Diretor", role: "SUPER_ADMIN" },
  };

  it("antes de publicar não sobra lacuna: datas e aprovação aparecem como definidas na publicação", () => {
    const preview = text(base);
    assert.doesNotMatch(preview, /_{3,}/);
    assert.match(preview, /Data de aprovação\ndefinida na publicação/);
    assert.match(preview, /Data de vigência\ndefinida na publicação/);
  });

  it("publicada: aprovação = data da publicação, vigência = a informada pelo admin, aprovação eletrônica de quem publicou", () => {
    const document = text(published);
    assert.match(document, /Data de aprovação\n30\/09\/2026/);
    assert.match(document, /Data de vigência\n15\/10\/2026/);
    assert.match(document, /vigente a partir de 15\/10\/2026,/);
    assert.match(document, /Diretoria\nPaulo Diretor — Super administrador\n30\/09\/2026 12:00 · aprovação eletrônica por usuário autenticado no IndusCost/);
  });

  it("aprovação e termo de ciência mostram nome completo e cargo do cadastro; sem cargo, o perfil de acesso", () => {
    const withTitle = text({
      ...published,
      approver: { name: "Paulo Henrique Pidluznyj", role: "SUPER_ADMIN", jobTitle: "Diretor Comercial" },
      signer: { name: "Joseane Maria da Silva", email: "joseane@koppetel.com", role: "SELLER", jobTitle: "Executiva de Vendas" },
    });
    assert.match(withTitle, /Diretoria\nPaulo Henrique Pidluznyj — Diretor Comercial\n/);
    assert.doesNotMatch(withTitle, /Super administrador/);
    assert.match(withTitle, /Profissional: Joseane Maria da Silva/);
    assert.match(withTitle, /Função: Executiva de Vendas/);
    assert.match(withTitle, /publicação eletrônica por Paulo Henrique Pidluznyj/);
    // Usuário sem vínculo com Pessoas/RH: vale o perfil de acesso.
    const withoutTitle = text({ ...published, signer: { name: "Ana", email: "ana@koppetel.com", role: "SELLER", jobTitle: null } });
    assert.match(withoutTitle, /Paulo Diretor — Super administrador/);
    assert.match(withoutTitle, /Função: Vendedor\(a\)/);
  });

  it("a identidade vem de Pessoas/RH: vínculo do usuário, mesma Pessoa canônica ou e-mail corporativo", () => {
    const user = { name: "Paulo", role: "SUPER_ADMIN" };
    const director = { name: "Paulo Pidluznyj", status: "ACTIVE", jobTitle: "Diretor" };
    // 1. Colaborador vinculado ao usuário.
    assert.deepEqual(resolvePolicyIdentity({ user, linkedEmployee: director }), { name: "Paulo Pidluznyj", role: "SUPER_ADMIN", jobTitle: "Diretor" });
    // 2. Sem vínculo direto, mas usuário e colaborador são a mesma Pessoa canônica.
    assert.deepEqual(resolvePolicyIdentity({ user, personDisplayName: "Paulo Pidluznyj", personEmployees: [director] }), {
      name: "Paulo Pidluznyj",
      role: "SUPER_ADMIN",
      jobTitle: "Diretor",
    });
    // 3. Só o e-mail corporativo do colaborador coincide com o login.
    assert.deepEqual(resolvePolicyIdentity({ user, emailEmployees: [director] }).jobTitle, "Diretor");
    // Vínculo encerrado não ganha do ativo; dois ativos não são escolhidos no chute.
    const former = { name: "Paulo Pidluznyj", status: "INACTIVE", jobTitle: "Analista" };
    assert.equal(resolvePolicyIdentity({ user, personEmployees: [former, director] }).jobTitle, "Diretor");
    const ambiguous = resolvePolicyIdentity({ user, personDisplayName: "Paulo Pidluznyj", personEmployees: [director, { ...director, jobTitle: "Sócio" }] });
    assert.deepEqual(ambiguous, { name: "Paulo Pidluznyj", role: "SUPER_ADMIN", jobTitle: null });
    // Sem colaborador nenhum: nome do login e perfil de acesso, como antes.
    assert.deepEqual(resolvePolicyIdentity({ user }), { name: "Paulo", role: "SUPER_ADMIN", jobTitle: null });
  });

  it("o termo de ciência vem preenchido com o usuário logado e, após o aceite, com a assinatura eletrônica", () => {
    const signer = { name: "Ana Vendedora", email: "ana@koppetel.com", role: "SELLER" };
    const reading = text({ ...published, signer });
    assert.match(reading, /Profissional: Ana Vendedora/);
    assert.match(reading, /Função: Vendedor\(a\)/);
    assert.match(reading, /Versão recebida: 1\.0 {4}Data: 30\/09\/2026/);
    assert.match(reading, /Assinatura: assinatura eletrônica de Ana Vendedora \(ana@koppetel\.com\), registrada ao concluir o aceite/);
    const signed = text({ ...published, signer, acceptance: { id: "ac-1", acceptedAt: "2026-10-02T13:30:00.000Z", evidenceHash: "abc123" } });
    assert.match(signed, /Versão recebida: 1\.0 {4}Data: 02\/10\/2026/);
    assert.match(signed, /Assinatura: assinado eletronicamente por Ana Vendedora \(ana@koppetel\.com\) em 02\/10\/2026 10:30, com reautenticação por senha e registro visual · aceite ac-1 · SHA-256 abc123/);
    assert.match(signed, /Responsável pela apresentação\/entrega: IndusCost — publicação eletrônica por Paulo Diretor/);
  });

  it("não altera o conteúdo gravado nem o seu hash, e não mexe em texto já preenchido à mão", () => {
    const before = officialCommercialPolicyHash();
    applyPolicyAutoFields(chapters, published);
    assert.equal(officialCommercialPolicyHash(), before);
    assert.match(policyChaptersPlainText(chapters), /____\/____\/________/);
    const manual = parsePolicyChapters("# Capa\n| Data de vigência | 01/01/2027 |\n\nProfissional: Fulano");
    assert.deepEqual(applyPolicyAutoFields(manual, published), manual);
  });

  it("a cópia controlada em PDF sai com as datas e a assinatura preenchidas", () => {
    const pdf = buildControlledCopyPdf({
      content: CONTENT,
      title: "POLÍTICA COMERCIAL E DE COMISSIONAMENTO",
      versionLabel: "1.0",
      code: "POL-COM-001",
      company: "Koppetel",
      cnpj: "14.055.501/0001-80",
      classification: "USO INTERNO E RESTRITO",
      contentHash: "abc",
      effectiveFrom: published.effectiveFrom,
      publishedAt: published.publishedAt,
      summaryRules: [],
      notice: [],
      copyId: "copy-1",
      recipientName: "Ana Vendedora",
      recipientEmail: "ana@koppetel.com",
      generatedAt: NOW.toISOString(),
      autoFields: {
        ...published,
        signer: { name: "Ana Vendedora", email: "ana@koppetel.com", role: "SELLER" },
        acceptance: { id: "ac-1", acceptedAt: "2026-10-02T13:30:00.000Z", evidenceHash: "abc123" },
        commissionMatrix: policyCommissionMatrixFromSnapshot(buildCurrentCommercialPolicyNormativeSnapshot(RELEASE, PRICING)),
      },
    });
    const latin = pdf.toString("latin1");
    assert.equal(latin.includes("____"), false);
    // 12: a Matriz de Referência impressa é a do snapshot.
    assert.ok(latin.includes("Varejo 3"));
    assert.ok(latin.includes("50,00%"));
    assert.ok(latin.includes("4,00%"));
    assert.ok(latin.includes("abaixo da tabela"));
    assert.ok(latin.includes("Profissional: Ana Vendedora"));
    assert.ok(latin.includes("aceite ac-1"));
  });
});

describe("vigência informada na publicação", () => {
  it("exige a data, recusa data anterior a hoje (Brasília) e aceita hoje ou futuro", () => {
    assert.equal(parsePublicationEffectiveDate(undefined, NOW).ok, false);
    assert.equal(parsePublicationEffectiveDate("15/10/2026", NOW).ok, false);
    const past = parsePublicationEffectiveDate("2026-09-29", NOW);
    assert.equal(past.ok === false && past.code, "EFFECTIVE_FROM_IN_PAST");
    const today = parsePublicationEffectiveDate("2026-09-30", NOW);
    assert.equal(today.ok && today.effectiveFrom.toISOString(), "2026-09-30T03:00:00.000Z");
    // 01:00 UTC ainda é o dia anterior em Brasília.
    assert.equal(parsePublicationEffectiveDate("2026-09-30", new Date("2026-10-01T01:00:00.000Z")).ok, true);
  });

  async function serve() {
    const store = createMemoryCommercialPolicyStore();
    const admin: PolicyActor = { id: "super-1", name: "Paulo Diretor", email: "paulo@koppetel.com", role: "SUPER_ADMIN", isActive: true, mustChangePassword: false, externalSellerId: null, sessionId: "s" };
    const app = express();
    app.use(express.json());
    registerCommercialPolicyRoutes(app, {
      requireAppAuth: (_req, _res, next) => next(),
      getCurrentAppUser: async () => admin,
      store,
      now: () => NOW,
      loadRelease: async () => RELEASE,
      loadCommissionMatrix: async () => PRICING,
      loadUserIdentity: async (id) => (id === admin.id ? { name: "Paulo Diretor da Silva", role: admin.role, jobTitle: "Diretor Comercial" } : null),
    });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    return { server, store, url: `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}` };
  }

  it("publicar sem vigência é recusado; com vigência grava a data informada, a data real da publicação e quem aprovou", async () => {
    const { server, store, url } = await serve();
    try {
      const draft = await createPolicyDraft(store, { ...officialCommercialPolicyBody(), title: "Política de teste", content: "Texto curto de teste da política comercial, sem código oficial, para publicar." }, NOW);
      assert.equal(draft.ok, true);
      if (!draft.ok) return;
      const publishUrl = `${url}/api/admin/commercial-policy/versions/${draft.version.id}/publish`;
      const missing = await fetch(publishUrl, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      assert.equal(missing.status, 422);
      assert.equal(((await missing.json()) as { code: string }).code, "EFFECTIVE_FROM_REQUIRED");
      const done = await fetch(publishUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ effectiveFrom: "2026-10-15" }) });
      assert.equal(done.status, 200);
      const body = (await done.json()) as { version: { effectiveFrom: string; publishedAt: string; approver: { name: string; role: string; jobTitle?: string } } };
      assert.equal(body.version.effectiveFrom, "2026-10-15T03:00:00.000Z");
      assert.equal(body.version.publishedAt, NOW.toISOString());
      // Nome completo e cargo do cadastro de Pessoas/RH, não o nome de login e o perfil de acesso.
      assert.deepEqual(body.version.approver, { name: "Paulo Diretor da Silva", role: "SUPER_ADMIN", jobTitle: "Diretor Comercial" });
    } finally {
      server.close();
    }
  });

  it("a integridade lê a matriz da Formação de Preço e mostra só o que ainda bloqueia", async () => {
    const { server, url } = await serve();
    try {
      const res = await fetch(`${url}/api/admin/commercial-policy/integrity`);
      const body = (await res.json()) as { findings: Array<{ code: string; severity: string }>; currentSnapshot: { commissionMatrix: { parameterized: boolean } } };
      assert.equal(body.currentSnapshot.commissionMatrix.parameterized, true);
      assert.equal(body.findings.some((item) => item.code === "COMMISSION_MATRIX_NOT_PARAMETERIZED"), false);
      assert.deepEqual(body.findings.filter((item) => item.severity === "BLOCKING").map((item) => item.code), []);
      const code = (prefix: string) => body.findings.find((item) => item.code.startsWith(prefix));
      assert.deepEqual([code("COMMISSION_MATRIX_")?.code, code("COMMISSION_MATRIX_")?.severity], ["COMMISSION_MATRIX_ALIGNED", "INFORMATIONAL"]);
      assert.deepEqual([code("SUPERVISOR_SHARE_")?.code, code("SUPERVISOR_SHARE_")?.severity], ["SUPERVISOR_SHARE_MANUAL_PROCESS", "INFORMATIONAL"]);
      assert.deepEqual([code("PORTFOLIO_INACTIVITY_")?.code, code("PORTFOLIO_INACTIVITY_")?.severity], ["PORTFOLIO_INACTIVITY_ALIGNED", "INFORMATIONAL"]);
    } finally {
      server.close();
    }
  });
});
