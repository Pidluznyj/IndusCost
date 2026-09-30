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
import { applyPolicyAutoFields, type PolicyAutoFieldContext } from "./policyAutoFields.js";
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

describe("Anexo I × Formação de Preço", () => {
  it("lê a matriz do próprio conteúdo auditado", () => {
    const document = readDocumentCommissionMatrix(CONTENT);
    assert.deepEqual(
      document.bands.map((band) => [band.marginFrom, band.commissionPercent]),
      [[null, 1], [30, 1], [35, 2], [40, 3], [50, 4]]
    );
    assert.equal(document.describesInterpolation, false);
  });

  it("sem as quatro tabelas publicadas continua bloqueando como não parametrizada", () => {
    const finding = matrixFinding(CONTENT, null);
    assert.equal(finding?.code, "COMMISSION_MATRIX_NOT_PARAMETERIZED");
    assert.equal(finding?.severity, "BLOCKING");
    assert.match(finding?.resolution.where ?? "", /Formação de Preço/);
  });

  it("margens e comissões iguais às do Anexo I deixam de acusar matriz ausente, mas a interpolação do motor é dita e bloqueia", () => {
    const finding = matrixFinding(CONTENT, PRICING);
    assert.equal(finding?.code, "COMMISSION_MATRIX_INTERPOLATED");
    assert.equal(finding?.severity, "BLOCKING");
    assert.match(finding?.system ?? "", /Atacado — margem 30,00% → comissão 1,00%/);
    assert.match(finding?.system ?? "", /Varejo 3 — margem 50,00% → comissão 4,00%/);
    assert.match(finding?.system ?? "", /recebe 1,50%/);
  });

  it("quando o texto descreve o percentual proporcional entre faixas, a matriz fica alinhada", () => {
    const revised = CONTENT.replace(
      "# ANEXO I — MATRIZ NORMATIVA DE COMISSÃO, MARGEM E ALÇADA",
      "# ANEXO I — MATRIZ NORMATIVA DE COMISSÃO, MARGEM E ALÇADA\nEntre uma faixa e a seguinte, o percentual de comissão é proporcional ao preço praticado."
    );
    assert.notEqual(revised, CONTENT);
    const audit = auditPolCom001Publication(revised, buildCurrentCommercialPolicyNormativeSnapshot(RELEASE, PRICING));
    const finding = audit.findings.find((item) => item.code.startsWith("COMMISSION_MATRIX_"));
    assert.equal(finding?.code, "COMMISSION_MATRIX_ALIGNED");
    assert.equal(finding?.severity, "INFORMATIONAL");
    // As alçadas seguem como processo manual: alerta, não bloqueio.
    assert.equal(audit.findings.find((item) => item.code === "APPROVAL_AUTHORITY_MANUAL_PROCESS")?.severity, "WARNING");
  });

  it("tabela publicada com comissão ou margem diferente do Anexo I bloqueia apontando a diferença", () => {
    const finding = matrixFinding(CONTENT, {
      ...PRICING,
      tiers: PRICING.tiers.map((tier) => (tier.code === "VAREJO_3" ? { ...tier, commissionPercent: 5 } : tier.code === "VAREJO_1" ? { ...tier, marginPercent: 40 } : tier)),
    });
    assert.equal(finding?.code, "COMMISSION_MATRIX_MISMATCH");
    assert.equal(finding?.severity, "BLOCKING");
    assert.match(finding?.system ?? "", /"50,00% ou mais" paga 4,00% e a tabela Varejo 3 paga 5,00%/);
    assert.match(finding?.system ?? "", /começa em 35,00% e a tabela Varejo 1 tem margem 40,00%/);
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
    const rows = buildPolCom001ReconciliationMatrix(buildCurrentCommercialPolicyNormativeSnapshot(RELEASE, PRICING));
    assert.equal(rows.find((row) => row.findingCode === "COMMISSION_MATRIX_INTERPOLATED")?.status, "DIVERGENTE");
    assert.equal(rows.find((row) => row.findingCode === "APPROVAL_AUTHORITY_MANUAL_PROCESS")?.status, "PROCESSO_MANUAL");
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
      autoFields: { ...published, signer: { name: "Ana Vendedora", email: "ana@koppetel.com", role: "SELLER" }, acceptance: { id: "ac-1", acceptedAt: "2026-10-02T13:30:00.000Z", evidenceHash: "abc123" } },
    });
    const latin = pdf.toString("latin1");
    assert.equal(latin.includes("____"), false);
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
      loadUserIdentity: async (id) => (id === admin.id ? { name: admin.name, role: admin.role } : null),
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
      const body = (await done.json()) as { version: { effectiveFrom: string; publishedAt: string; approver: { name: string; role: string } } };
      assert.equal(body.version.effectiveFrom, "2026-10-15T03:00:00.000Z");
      assert.equal(body.version.publishedAt, NOW.toISOString());
      assert.deepEqual(body.version.approver, { name: "Paulo Diretor", role: "SUPER_ADMIN" });
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
      assert.deepEqual(
        body.findings.filter((item) => item.severity === "BLOCKING").map((item) => item.code).sort(),
        ["COMMISSION_MATRIX_INTERPOLATED", "PORTFOLIO_INACTIVITY_MISMATCH", "SUPERVISOR_SHARE_NOT_PARAMETERIZED"]
      );
    } finally {
      server.close();
    }
  });
});
