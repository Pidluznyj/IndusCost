/**
 * Prontidão de publicação da POL-COM-001 v1.0 e política viva.
 * Cobre os testes 1–20 do pedido de publicação e os complementares 1–15 da
 * política viva que ainda não estavam em commercialPolicy.test.ts,
 * polCom001V1.test.ts e commercialPolicyNormative.test.ts.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import express from "express";
import http from "node:http";
import { createMemoryCommercialPolicyStore } from "./commercialPolicyStore.js";
import {
  createPolicyDraft,
  findPendingRevisionDraft,
  openNormativeRevision,
  publishOfficialCommercialPolicy,
  publishPolicyVersion,
  sellerHasPendingPolicy,
  versionLabelOf,
  versionPublicView,
  type PolicyActor,
} from "./commercialPolicyService.js";
import {
  DOCUMENT_ANNEX_I_BANDS,
  DOCUMENT_ANNEX_III_VERSION,
  DOCUMENT_DECLARED_VERSION,
  DOCUMENT_INACTIVITY_DAYS,
  DOCUMENT_SOURCE_ANNEX_III_VERSION,
  DOCUMENT_SUPERVISOR_SHARE,
  POLICY_SECTIONS,
  auditPolCom001Publication,
  buildCurrentCommercialPolicyNormativeSnapshot,
  buildPolCom001ReconciliationMatrix,
  classifyCommercialChange,
  compareDraftToCurrentNormativeState,
  evaluatePublicationReadiness,
  normativeSnapshotHash,
  planPolicyRevision,
  type PrePublishFinding,
} from "./commercialPolicyNormative.js";
import { registerCommercialPolicyRoutes, resolvePublicationStatus } from "./commercialPolicyRoutes.js";
import { policyDocumentLines, wrapPdfLines } from "./commercialPolicyPdf.js";
import { buildControlledCopyPdf } from "./commercialPolicyControlledCopyPdf.js";
import { hashPolicyContent } from "./commercialPolicyRules.js";
import {
  POL_COM_001_CLASSIFICATION,
  POL_COM_001_CNPJ,
  POL_COM_001_CODE,
  POL_COM_001_COMPANY,
  POL_COM_001_DECLARATIONS,
  POL_COM_001_QUESTIONS,
  POL_COM_001_TITLE,
  POL_COM_001_VERSION_LABEL,
  officialCommercialPolicyBody,
  officialCommercialPolicyContent,
  officialCommercialPolicyHash,
} from "./official/polCom001V1.js";
import { POL_COM_001_CHAPTERS, officialPolicyPlainText } from "./official/polCom001V1Document.js";

const NOW = new Date("2026-09-29T12:00:00.000Z");
const RELEASE = { releaseDefaultRule: "EACH_RECEIVABLE_PAID", partialPaymentEnabled: true };
const SNAPSHOT = buildCurrentCommercialPolicyNormativeSnapshot(RELEASE);

const SHORT_BODY = {
  title: "Política de teste",
  content: "Texto curto de teste da política comercial vigente.",
  summaryRules: ["Regra"],
  declarations: ["Declaro ciência."],
  questions: [{ id: "q1", prompt: "Pergunta", explanation: "Porque", correctOptionId: "a", options: [{ id: "a", text: "Sim" }, { id: "b", text: "Não" }] }],
};

function superAdmin(): PolicyActor {
  return { id: "super-1", name: "Super", email: "super@koppetel.com", role: "SUPER_ADMIN", isActive: true, mustChangePassword: false, externalSellerId: null, sessionId: "s" };
}

function chapter(id: string) {
  const found = POL_COM_001_CHAPTERS.find((item) => item.id === id);
  assert.ok(found, id);
  return found;
}

describe("POL-COM-001 v1.0 — documento oficial (testes 1–7, 20)", () => {
  it("1–4: fonte oficial, título, CNPJ, empresa e classificação estão na capa e no pacote", () => {
    const body = officialCommercialPolicyBody();
    assert.equal(POL_COM_001_CODE, "POL-COM-001");
    assert.equal(POL_COM_001_VERSION_LABEL, "1.0");
    assert.equal(POL_COM_001_TITLE, "POLÍTICA COMERCIAL E DE COMISSIONAMENTO");
    assert.equal(POL_COM_001_CNPJ, "14.055.501/0001-80");
    assert.equal(POL_COM_001_COMPANY, "Koppetel Comercio de Plásticos LTDA");
    assert.equal(POL_COM_001_CLASSIFICATION, "POLÍTICA OFICIAL — USO INTERNO E RESTRITO");
    const cover = chapter("capa");
    const table = cover.blocks.find((block) => block.type === "table");
    assert.ok(table && table.type === "table");
    assert.deepEqual(table.rows[0], ["Código", "POL-COM-001"]);
    assert.deepEqual(table.rows[1], ["Versão", "1.0"]);
    assert.deepEqual(table.rows[2], ["Classificação", "POLÍTICA OFICIAL — USO INTERNO E RESTRITO"]);
    assert.deepEqual(table.rows[7], ["Empresa / CNPJ", "14.055.501/0001-80 Koppetel Comercio de Plásticos LTDA"]);
    assert.equal(body.title, POL_COM_001_TITLE);
  });

  it("5: Anexo III representa POL-COM-001 versão 1.0 sem renúncia", () => {
    const annex = chapter("anexo-iii-termo-de-ciencia");
    const text = annex.blocks.map((block) => (block.type === "table" ? block.rows.flat().join(" ") : block.type === "term" ? block.definition : block.text)).join("\n");
    assert.match(text, /código POL-COM-001, versão 1\.0/);
    assert.doesNotMatch(text, /versão 2\.0/);
    assert.match(text, /não implicando renúncia de direitos, quitação, confissão ou concordância com fatos anteriores/);
    assert.equal(DOCUMENT_DECLARED_VERSION, "1.0");
    assert.equal(DOCUMENT_ANNEX_III_VERSION, "1.0");
    assert.equal(DOCUMENT_SOURCE_ANNEX_III_VERSION, "2.0");
  });

  it("6: condutas vedadas (Seção 22) estão integrais no documento, no aceite e no questionário", () => {
    const forbidden = chapter("22-condutas-vedadas");
    const bullets = forbidden.blocks.filter((block) => block.type === "bullet");
    assert.equal(bullets.length, 9);
    const text = officialPolicyPlainText();
    for (const block of bullets) {
      if (block.type === "bullet") assert.equal(text.includes(block.text), true, block.text);
    }
    assert.match(text, /criar registros artificiais para impedir revisão de inatividade/);
    assert.match(text, /utilizar comissão adquirida como penalidade disciplinar/);
    assert.ok(POL_COM_001_DECLARATIONS.some((line) => /condutas vedadas da Seção 22/.test(line)));
    assert.ok(POL_COM_001_QUESTIONS.some((question) => question.reviewChapterId === "22-condutas-vedadas"));
  });

  it("7: confidencialidade (Seção 23) integral, com documento controlado e uso restrito", () => {
    const section = chapter("23-confidencialidade-documento-controlado-e-uso-restrito");
    const text = section.blocks.map((block) => (block.type === "table" ? block.rows.flat().join(" ") : block.type === "term" ? block.definition : block.text)).join("\n");
    assert.match(text, /USO INTERNO E RESTRITO/);
    assert.match(text, /DOCUMENTO CONTROLADO/i);
    assert.match(text, /não autorizam sua distribuição externa/);
    assert.ok(section.blocks.length >= 10);
    assert.ok(POL_COM_001_QUESTIONS.some((question) => question.reviewChapterId === section.id));
  });

  it("20: documento integral, não truncado, idêntico ao texto do DOCX (exceto Anexo III → 1.0), com tabelas", () => {
    const text = officialPolicyPlainText();
    assert.ok(text.length > 50_000, String(text.length));
    assert.equal(POL_COM_001_CHAPTERS.length, 33);
    assert.equal(POL_COM_001_CHAPTERS.at(-1)?.id, "anexo-iv-fluxo-operacional-de-cobertura-e-mapa-de-transicao");
    assert.match(text, /O Mapa de Transição será arquivado juntamente com a versão oficial desta Política/);
    for (const title of ["1. OBJETIVO", "8. VENDAS RECORRENTES", "11. INATIVIDADE", "14. COMISSÃO DO SUPERVISOR", "22. CONDUTAS VEDADAS", "23. CONFIDENCIALIDADE", "28. VIGÊNCIA E APROVAÇÃO", "ANEXO I", "ANEXO II", "ANEXO III", "ANEXO IV"]) {
      assert.equal(text.includes(title), true, title);
    }
    const tables = POL_COM_001_CHAPTERS.flatMap((item) => item.blocks.filter((block) => block.type === "table"));
    assert.equal(tables.length, 6);
    const matrix = chapter("anexo-i-matriz-normativa-de-comissao-margem-e-alcada").blocks.filter((block) => block.type === "table");
    assert.equal(matrix.length, 2);
    assert.ok(matrix[1].type === "table");
    assert.deepEqual(matrix[1].rows[0], ["Margem Oficial do Item", "Comissão do Vendedor", "Alçada Comercial"]);
    assert.deepEqual(matrix[1].rows[5], ["50,00% ou mais", "4,00%", "Fluxo comercial ordinário"]);
    assert.equal(hashPolicyContent(officialCommercialPolicyBody()), officialCommercialPolicyHash());
  });
});

describe("POL-COM-001 v1.0 — regras que bloqueiam (testes 8–10)", () => {
  it("8: a matriz do Anexo I termina em 4% para ≥ 50% e o motor não a executa → BLOCKING", () => {
    assert.deepEqual(
      DOCUMENT_ANNEX_I_BANDS.map((band) => [band.label, band.commissionPercent]),
      [["Abaixo de 30,00%", 0.01], ["30,00% a 34,99%", 0.01], ["35,00% a 39,99%", 0.02], ["40,00% a 49,99%", 0.03], ["50,00% ou mais", 0.04]]
    );
    assert.equal(DOCUMENT_ANNEX_I_BANDS[0].approval, "Aprovação prévia da Diretoria");
    assert.equal(DOCUMENT_ANNEX_I_BANDS[1].approval, "Aprovação prévia do Supervisor Comercial");
    const audit = auditPolCom001Publication(officialCommercialPolicyBody().content, SNAPSHOT);
    const matrix = audit.findings.find((item) => item.code === "COMMISSION_MATRIX_NOT_PARAMETERIZED");
    assert.equal(matrix?.severity, "BLOCKING");
    assert.equal(matrix?.blocking, true);
    assert.equal(matrix?.policySection, POLICY_SECTIONS.matrix);
    assert.match(matrix?.document ?? "", /50,00% ou mais = 4,00%/);
    assert.doesNotMatch(matrix?.document ?? "", /5,00%/);
  });

  it("9: supervisor 33% adicional não parametrizado → BLOCKING, sem fingir parametrização", () => {
    assert.equal(DOCUMENT_SUPERVISOR_SHARE, 0.33);
    assert.equal(SNAPSHOT.supervisorCommission.parameterized, false);
    assert.equal(SNAPSHOT.supervisorCommission.share, null);
    const audit = auditPolCom001Publication(officialCommercialPolicyBody().content, SNAPSHOT);
    const finding = audit.findings.find((item) => item.code === "SUPERVISOR_SHARE_NOT_PARAMETERIZED");
    assert.equal(finding?.severity, "BLOCKING");
    assert.match(finding?.document ?? "", /33%/);
    assert.match(finding?.system ?? "", /não possui percentual de supervisor/);
  });

  it("10: documento = 90 dias sem PV aprovado + CRM material; sistema = relógio por NF/DS válido → PORTFOLIO_INACTIVITY_MISMATCH (BLOCKING)", () => {
    assert.equal(DOCUMENT_INACTIVITY_DAYS, 90);
    assert.equal(SNAPSHOT.portfolio.inactivityDays, 90);
    assert.equal(SNAPSHOT.portfolio.systemBehavior, "REVIEW_THEN_REMOVE_OR_PRESERVE");
    assert.equal(SNAPSHOT.portfolio.crmEvidenceCanPreserveAssignment, true);
    const source = readFileSync(new URL("../commercial/customerCommercialOwnerInactivity.ts", import.meta.url), "utf8");
    assert.match(source, /última NF \/ Documento de Saída válido/);
    assert.match(source, /NEVER_INVOICED/);
    assert.match(source, /REMOVE_OWNER/);
    assert.match(source, /PRESERVED_BY_CRM|PORTFOLIO_REVIEW_PRESERVED/);
    const audit = auditPolCom001Publication(officialCommercialPolicyBody().content, SNAPSHOT);
    const mismatch = audit.findings.find((item) => item.code === "PORTFOLIO_INACTIVITY_MISMATCH");
    assert.equal(mismatch?.severity, "BLOCKING");
    assert.equal(mismatch?.blocking, true);
    assert.match(mismatch?.document ?? "", /90 dias corridos sem novo Pedido de Venda aprovado/);
    assert.match(mismatch?.system ?? "", /NF \/ Documento de Saída válido/);
    assert.match(mismatch?.system ?? "", /NEVER_INVOICED não remove/);
  });
});

describe("POL-COM-001 v1.0 — prontidão, severidade e publicação (testes 11–19)", () => {
  it("13/14: blocker impede, warning e informativo não impedem; abrangência do gate é WARNING", () => {
    const audit = auditPolCom001Publication(officialCommercialPolicyBody().content, SNAPSHOT);
    assert.equal(audit.ready, false);
    assert.equal(audit.status, "NOT_READY_FOR_PUBLICATION");
    assert.equal(audit.blockers, 3);
    const gate = audit.findings.find((item) => item.code === "ELECTRONIC_GATE_AUDIENCE");
    assert.equal(gate?.severity, "WARNING");
    assert.equal(gate?.blocking, false);
    const release = audit.findings.find((item) => item.code === "COMMISSION_RELEASE_ALIGNED");
    assert.equal(release?.severity, "INFORMATIONAL");
    const withoutBlockers: PrePublishFinding[] = audit.findings.filter((item) => item.severity !== "BLOCKING");
    assert.equal(evaluatePublicationReadiness(withoutBlockers).ready, true);
    assert.equal(evaluatePublicationReadiness(audit.findings).ready, false);
    assert.equal(resolvePublicationStatus({ published: false, blockers: 0 }), "READY_FOR_PUBLICATION");
    assert.equal(resolvePublicationStatus({ published: false, blockers: 2 }), "AWAITING_COMPATIBILIZATION");
    assert.equal(resolvePublicationStatus({ published: true, blockers: 0 }), "PUBLISHED");
    for (const finding of audit.findings) {
      assert.ok(["BLOCKING", "WARNING", "INFORMATIONAL"].includes(finding.severity), finding.code);
      assert.equal(finding.blocking, finding.severity === "BLOCKING", finding.code);
      assert.ok(finding.category && finding.document && finding.system && finding.action, finding.code);
    }
  });

  it("13 (bidirecional): sistema com liberação diferente da Seção 16 vira BLOCKING; sem snapshot vira WARNING", () => {
    const mismatch = auditPolCom001Publication(
      officialCommercialPolicyBody().content,
      buildCurrentCommercialPolicyNormativeSnapshot({ releaseDefaultRule: "SALES_ORDER_CREATED", partialPaymentEnabled: true })
    );
    assert.equal(mismatch.findings.find((item) => item.code === "COMMISSION_RELEASE_MISMATCH")?.severity, "BLOCKING");
    const fullOnly = auditPolCom001Publication(
      officialCommercialPolicyBody().content,
      buildCurrentCommercialPolicyNormativeSnapshot({ releaseDefaultRule: "EACH_RECEIVABLE_PAID", partialPaymentEnabled: false })
    );
    assert.equal(fullOnly.findings.find((item) => item.code === "COMMISSION_RELEASE_NOT_PROPORTIONAL")?.severity, "WARNING");
    const unknown = auditPolCom001Publication(officialCommercialPolicyBody().content, null);
    assert.equal(unknown.findings.find((item) => item.code === "COMMISSION_RELEASE_UNVERIFIED")?.severity, "WARNING");
  });

  it("matriz de reconciliação cobre as seções centrais com status e severidade", () => {
    const rows = buildPolCom001ReconciliationMatrix(SNAPSHOT);
    const bySection = new Map(rows.map((row) => [row.section, row]));
    assert.equal(bySection.get(POLICY_SECTIONS.matrix)?.status, "DIVERGENTE");
    assert.equal(bySection.get(POLICY_SECTIONS.supervisor)?.status, "NÃO_IMPLEMENTADO");
    assert.equal(bySection.get(POLICY_SECTIONS.inactivity)?.status, "DIVERGENTE");
    assert.equal(bySection.get(POLICY_SECTIONS.inactivity)?.severity, "BLOCKING");
    assert.equal(bySection.get(POLICY_SECTIONS.coverage)?.status, "PROCESSO_MANUAL");
    assert.equal(bySection.get(POLICY_SECTIONS.campaigns)?.status, "TEXTO_NORMATIVO");
    assert.equal(bySection.get(POLICY_SECTIONS.payment)?.status, "ALINHADO");
    assert.equal(bySection.get("2")?.severity, "WARNING");
    assert.equal(bySection.get("Capa / Anexo III")?.findingCode, "DOCUMENT_INTERNAL_VERSION_MISMATCH");
  });

  it("13: a publicação oficial é recusada com os achados bloqueantes e não grava versão", async () => {
    const store = createMemoryCommercialPolicyStore();
    const result = await publishOfficialCommercialPolicy(store, "super-1", NOW, { currentSnapshot: SNAPSHOT });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "NOT_READY_FOR_PUBLICATION");
    assert.deepEqual(
      result.findings?.filter((item) => item.blocking).map((item) => item.code),
      ["COMMISSION_MATRIX_NOT_PARAMETERIZED", "SUPERVISOR_SHARE_NOT_PARAMETERIZED", "PORTFOLIO_INACTIVITY_MISMATCH"]
    );
    assert.equal(store.versions.length, 0);
  });

  it("15/16/17: versão publicada é imutável, congela o snapshot, e o aceite registra versão, hash e snapshot", async () => {
    const store = createMemoryCommercialPolicyStore();
    const draft = await createPolicyDraft(store, SHORT_BODY, NOW);
    assert.equal(draft.ok, true);
    if (!draft.ok) return;
    const published = await publishPolicyVersion(store, draft.version.id, "super-1", NOW, { currentSnapshot: SNAPSHOT });
    assert.equal(published.ok, true);
    if (!published.ok) return;
    assert.equal(published.version.normativeSnapshotHash, normativeSnapshotHash(SNAPSHOT));
    assert.equal(published.version.changeSet?.length, 0);
    assert.equal(published.version.contentHash, hashPolicyContent(SHORT_BODY));
    const again = await publishPolicyVersion(store, draft.version.id, "super-1", NOW, { currentSnapshot: SNAPSHOT });
    assert.equal(again.ok, false);
    if (!again.ok) assert.equal(again.code, "VERSION_IMMUTABLE");
    assert.equal(await store.saveDraft(draft.version.id, { ...SHORT_BODY, title: "Editada" }, NOW), null);
    assert.equal(await store.attachNormative(draft.version.id, { normativeSnapshot: {}, normativeSnapshotHash: "x", changeSet: [], changeSetHash: "y", previousVersionId: null }), null);
    const view = versionPublicView(published.version);
    assert.equal(view.normativeSnapshotHash, normativeSnapshotHash(SNAPSHOT));
    assert.equal(view.label, "1");
  });

  it("rascunho com snapshot desatualizado não publica (sistema mudou, rascunho ainda descreve o estado antigo)", async () => {
    const store = createMemoryCommercialPolicyStore();
    const draft = await createPolicyDraft(store, SHORT_BODY, NOW);
    if (!draft.ok) return;
    await store.attachNormative(draft.version.id, {
      normativeSnapshot: SNAPSHOT,
      normativeSnapshotHash: normativeSnapshotHash(SNAPSHOT),
      changeSet: [],
      changeSetHash: "c",
      previousVersionId: null,
    });
    const live = buildCurrentCommercialPolicyNormativeSnapshot({ releaseDefaultRule: "SALES_ORDER_CREATED", partialPaymentEnabled: true });
    assert.equal(compareDraftToCurrentNormativeState({ draftSnapshotHash: normativeSnapshotHash(SNAPSHOT), current: live }), "DRAFT_STALE");
    const result = await publishPolicyVersion(store, draft.version.id, "super-1", NOW, { currentSnapshot: live });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "DRAFT_SNAPSHOT_STALE");
    assert.equal(store.versions[0].status, "DRAFT");
  });

  it("18: questionário e declarações referenciam a versão 1.0 e as seções reais", () => {
    assert.ok(POL_COM_001_DECLARATIONS[0].includes("POL-COM-001, versão 1.0"));
    assert.equal(POL_COM_001_DECLARATIONS.some((line) => /renúncia|quitação|renuncio/i.test(line)), false);
    for (const needle of ["ativos da empresa", "Seção 8", "Seção 11", "Seção 22", "Seção 23", "USO INTERNO E RESTRITO", "registrado eletronicamente"]) {
      assert.ok(POL_COM_001_DECLARATIONS.some((line) => line.includes(needle)), needle);
    }
    const ids = new Set(POL_COM_001_CHAPTERS.map((item) => item.id));
    for (const question of POL_COM_001_QUESTIONS) {
      assert.ok(question.reviewChapterId && ids.has(question.reviewChapterId), question.id);
      assert.ok(question.options.some((option) => option.id === question.correctOptionId), question.id);
    }
    const covered = new Set(POL_COM_001_QUESTIONS.map((question) => question.reviewChapterId));
    for (const chapterId of [
      "10-responsabilidade-comercial-e-carteira",
      "8-vendas-recorrentes-oem-cobertura-e-canais-de-entrada",
      "11-inatividade-de-cliente-e-revisao-de-carteira",
      "4-definicoes",
      "anexo-i-matriz-normativa-de-comissao-margem-e-alcada",
      "14-comissao-do-supervisor-comercial",
      "9-campanhas-e-condicoes-comerciais-especificas",
      "22-condutas-vedadas",
      "23-confidencialidade-documento-controlado-e-uso-restrito",
      "7-margem-oficial-matriz-de-comissao-precificacao-e-alcadas",
    ]) {
      assert.ok(covered.has(chapterId), chapterId);
    }
    const matrixQuestion = POL_COM_001_QUESTIONS.find((question) => question.id === "q-matriz");
    assert.match(matrixQuestion?.options.find((option) => option.id === matrixQuestion.correctOptionId)?.text ?? "", /4,00%/);
  });

  it("19: o gate eletrônico continua restrito ao SELLER e SUPER_ADMIN não fica pendente", async () => {
    const store = createMemoryCommercialPolicyStore();
    const draft = await createPolicyDraft(store, SHORT_BODY, NOW);
    if (!draft.ok) return;
    await publishPolicyVersion(store, draft.version.id, "super-1", NOW, { currentSnapshot: SNAPSHOT });
    assert.equal(await sellerHasPendingPolicy(store, { id: "s", role: "SELLER", isActive: true, mustChangePassword: false }, NOW), true);
    assert.equal(await sellerHasPendingPolicy(store, { id: "a", role: "SUPER_ADMIN", isActive: true, mustChangePassword: false }, NOW), false);
    assert.equal(await sellerHasPendingPolicy(store, { id: "m", role: "COMMERCIAL_MANAGER", isActive: true, mustChangePassword: false }, NOW), false);
    const guard = readFileSync(new URL("./commercialPolicyGuard.ts", import.meta.url), "utf8");
    assert.doesNotMatch(guard, /SUPER_ADMIN.*pending|COMMERCIAL_MANAGER.*pending/);
  });
});

describe("POL-COM-001 v1.0 — prévia e cópia controlada antes da publicação (testes 11, 12)", () => {
  async function serve(store = createMemoryCommercialPolicyStore(), current: PolicyActor = superAdmin()) {
    const app = express();
    app.use(express.json());
    registerCommercialPolicyRoutes(app, {
      requireAppAuth: (_req, _res, next) => next(),
      getCurrentAppUser: async () => current,
      store,
      now: () => NOW,
      verifyPassword: async () => true,
      saveFile: async () => ({ storageKey: "k" }),
      readFile: async () => Buffer.from(""),
      loadRelease: async () => RELEASE,
    });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    return { server, url: `http://127.0.0.1:${port}`, store };
  }

  it("11: a integridade expõe o cartão do documento, o status e os achados antes de publicar", async () => {
    const { server, url } = await serve();
    try {
      const res = await fetch(`${url}/api/admin/commercial-policy/integrity`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as {
        publicationStatus: string;
        document: { code: string; versionLabel: string; cnpj: string; classification: string; contentHash: string };
        counts: { blockers: number; warnings: number };
        findings: PrePublishFinding[];
        reconciliation: unknown[];
        currentVersion: unknown;
        pendingDraft: unknown;
        settingsSource: string;
      };
      assert.equal(body.publicationStatus, "AWAITING_COMPATIBILIZATION");
      assert.equal(body.document.code, "POL-COM-001");
      assert.equal(body.document.versionLabel, "1.0");
      assert.equal(body.document.cnpj, "14.055.501/0001-80");
      assert.equal(body.document.contentHash, officialCommercialPolicyHash());
      assert.equal(body.counts.blockers, 3);
      assert.ok(body.counts.warnings >= 1);
      assert.ok(body.reconciliation.length >= 10);
      assert.equal(body.currentVersion, null);
      assert.equal(body.pendingDraft, null);
      assert.equal(body.settingsSource, "DATABASE");
    } finally {
      server.close();
    }
  });

  it("12: SUPER_ADMIN gera a cópia controlada em PDF antes da publicação; SELLER não", async () => {
    let current = superAdmin();
    const { server, url } = await serve(createMemoryCommercialPolicyStore(), current);
    try {
      const res = await fetch(`${url}/api/admin/commercial-policy/official/pol-com-001/document`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type"), "application/pdf");
      const bytes = Buffer.from(await res.arrayBuffer());
      const latin = bytes.toString("latin1");
      assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
      // O texto entra em WinAnsi com escapes octais (\303 = Ã, \343 = ã, \341 = á, \227 = —).
      assert.match(latin, /POL-COM-001 \\267 VERS\\303O 1\.0/);
      assert.match(latin, /PR\\311VIA \\227 VERS\\303O AINDA N\\303O PUBLICADA/);
      assert.match(latin, /14\.055\.501\/0001-80/);
      assert.match(latin, /Koppetel Comercio de Pl\\341sticos LTDA/);
      assert.match(latin, /USO INTERNO E RESTRITO/);
      assert.match(latin, /C\\323PIA CONTROLADA/);
      assert.match(latin, /P\\341gina 1 de \d+/);
      assert.match(latin, /super@koppetel\.com/);
      // Linhas quebradas por largura são reunidas para conferir o teor do Anexo III.
      const joined = [...latin.matchAll(/\(((?:[^()\\]|\\.)*)\) Tj/g)].map((match) => match[1]).join(" ");
      assert.match(joined, /c\\363digo POL-COM-001, vers\\343o 1\.0, vigente a partir de/);
      assert.doesNotMatch(joined, /vers\\343o 2\.0/);
      current = { ...superAdmin(), role: "SELLER", id: "seller-1" };
      void current;
    } finally {
      server.close();
    }
    const asSeller = await serve(createMemoryCommercialPolicyStore(), { ...superAdmin(), role: "SELLER", id: "seller-1" });
    try {
      const denied = await fetch(`${asSeller.url}/api/admin/commercial-policy/official/pol-com-001/document`);
      assert.equal(denied.status, 403);
    } finally {
      asSeller.server.close();
    }
  });

  it("12: o PDF preserva identidade, versão, empresa, CNPJ, classificação, paginação e conteúdo integral com quebra de linha", () => {
    const body = officialCommercialPolicyBody();
    const lines = policyDocumentLines({
      title: body.title,
      versionLabel: "1.0",
      code: POL_COM_001_CODE,
      company: POL_COM_001_COMPANY,
      cnpj: POL_COM_001_CNPJ,
      classification: POL_COM_001_CLASSIFICATION,
      contentHash: officialCommercialPolicyHash(),
      effectiveFrom: null,
      publishedAt: null,
      content: body.content,
      summaryRules: body.summaryRules,
    });
    assert.ok(lines.includes("Versão 1.0"));
    assert.ok(lines.includes(`Código: ${POL_COM_001_CODE}`));
    const wrapped = wrapPdfLines(lines, 108);
    assert.ok(wrapped.every((line) => line.length <= 108));
    assert.equal(wrapped.join(" ").includes("utilizar comissão adquirida como penalidade disciplinar"), true);
    const pdf = buildControlledCopyPdf({
      content: body.content,
      title: body.title,
      versionLabel: "1.0",
      code: POL_COM_001_CODE,
      company: POL_COM_001_COMPANY,
      cnpj: POL_COM_001_CNPJ,
      classification: POL_COM_001_CLASSIFICATION,
      contentHash: officialCommercialPolicyHash(),
      effectiveFrom: null,
      publishedAt: null,
      summaryRules: body.summaryRules,
      notice: ["CONFIDENCIALIDADE E RESTRIÇÃO DE USO"],
      copyId: "copy-1",
      recipientName: "Super",
      recipientEmail: "super@koppetel.com",
      generatedAt: NOW.toISOString(),
    });
    const latin = pdf.toString("latin1");
    const pages = latin.match(/\/Type \/Page\b/g)?.length ?? 0;
    assert.ok(pages >= 10, String(pages));
    assert.match(latin, new RegExp(`P\\\\341gina ${pages} de ${pages}`));
    assert.match(latin, /\\227/);
    assert.ok(latin.includes("POL-COM-001 \\267 Vers\\343o 1.0"));
    assert.ok(latin.includes("CNPJ 14.055.501/0001-80"));
    assert.ok(latin.includes("USO INTERNO E RESTRITO"));
    // Texto integral: toda palavra do documento oficial está impressa, e nenhuma virou "?".
    const printed = [...latin.matchAll(/\(((?:[^()\\]|\\.)*)\) Tj/g)]
      .map((match) =>
        match[1]
          .replace(/\\(\d{3})/g, (_m, octal: string) => ({ 0o222: "’", 0o227: "—" })[parseInt(octal, 8)] ?? String.fromCharCode(parseInt(octal, 8)))
          .replace(/\\([()\\])/g, "$1")
      );
    assert.equal(printed.some((text) => text.includes("?")), false);
    const words = new Set(printed.flatMap((text) => text.split(/\s+/)));
    const missing = officialPolicyPlainText().split(/\s+/).filter((word) => word && !/^_+$/.test(word) && !words.has(word));
    assert.deepEqual(missing.slice(0, 5), []);
  });
});

describe("política viva — v1.0 como baseline (complementares 1–15)", () => {
  async function baseline() {
    const store = createMemoryCommercialPolicyStore();
    const draft = await createPolicyDraft(store, { ...officialCommercialPolicyBody(), content: SHORT_BODY.content }, NOW);
    assert.equal(draft.ok, true);
    if (!draft.ok) throw new Error("draft");
    const published = await publishPolicyVersion(store, draft.version.id, "super-1", NOW, { currentSnapshot: SNAPSHOT });
    assert.equal(published.ok, true);
    if (!published.ok) throw new Error("publish");
    return { store, version: published.version };
  }

  const change = (kind: Parameters<typeof openNormativeRevision>[1]["kind"], oldValue: unknown, newValue: unknown, oldDisplayValue: string, newDisplayValue: string) => ({
    kind,
    release: RELEASE,
    oldValue,
    newValue,
    oldDisplayValue,
    newDisplayValue,
    reason: "teste",
    changedBy: "super-1",
    now: NOW,
  });

  it("2/3/11: metodologia de preço, faixa, percentual, liberação, supervisor e 90 dias abrem revisão; SKU, responsável, contato e pedido não", () => {
    for (const kind of ["pricing.methodology", "commission.matrix", "commission.band", "commission.releaseRule", "commission.supervisorShare", "portfolio.inactivityDays", "portfolio.crmPreservation", "campaign.generalRule"] as const) {
      assert.equal(classifyCommercialChange(kind), "POLICY_VERSION_REQUIRED", kind);
    }
    for (const kind of ["pricing.skuPrice", "customer.responsible", "crm.contact", "salesOrder.created", "salesOrder.seller"] as const) {
      assert.equal(classifyCommercialChange(kind), "OPERATIONAL_DATA", kind);
    }
    assert.equal(classifyCommercialChange("customer.institutionalMembership"), "CONTROLLED_REFERENCE_CHANGED");
    assert.equal(classifyCommercialChange("campaign.instance"), "CONTROLLED_REFERENCE_CHANGED");
    const sku = planPolicyRevision({ kind: "pricing.skuPrice", currentLabel: "1.0", currentSnapshot: SNAPSHOT, oldValue: 10, newValue: 12, oldDisplayValue: "10", newDisplayValue: "12", reason: "", changedBy: "u", changedAt: NOW.toISOString() });
    assert.equal(sku.draftRequired, false);
    assert.equal(sku.snapshotHash, normativeSnapshotHash(SNAPSHOT));
  });

  it("4/5/6: dois eventos coexistem em um único rascunho, o snapshot anterior fica intacto e o changeset guarda antes/depois", async () => {
    const { store, version } = await baseline();
    const first = await openNormativeRevision(store, change("commission.band", 0.02, 0.025, "2,00%", "2,50%"));
    const second = await openNormativeRevision(store, change("portfolio.inactivityDays", 90, 120, "90 dias", "120 dias"));
    const repeat = await openNormativeRevision(store, change("commission.band", 0.02, 0.025, "2,00%", "2,50%"));
    assert.equal(first.ok && second.ok && repeat.ok, true);
    if (!first.ok || !second.ok || !repeat.ok) return;
    assert.equal(second.aggregated, true);
    assert.equal(repeat.duplicate, true);
    assert.equal(first.version?.id, second.version?.id);
    assert.equal(repeat.version?.id, first.version?.id);
    assert.equal(store.versions.filter((row) => row.status === "DRAFT").length, 1);
    const draft = findPendingRevisionDraft(store.versions);
    assert.ok(draft);
    assert.equal(draft.changeSet?.length, 2);
    // A baseline de teste é manual (rótulo "1"); a revisão dela é "1.1". Para a POL-COM-001 publicada, "1.0" → "1.1".
    assert.deepEqual(draft.changeSet?.map((item) => [item.dependencyKey, item.oldDisplayValue, item.newDisplayValue, item.sourceVersionOld, item.sourceVersionNew]), [
      ["commission.band", "2,00%", "2,50%", "1", "1.1"],
      ["portfolio.inactivityDays", "90 dias", "120 dias", "1", "1.1"],
    ]);
    assert.equal(draft.previousVersionId, version.id);
    assert.equal(versionLabelOf(draft), "1.1");
    assert.equal(versionLabelOf({ content: officialCommercialPolicyContent(), versionNumber: 7, changeSet: undefined }), "1.0");
    const proposed = draft.normativeSnapshot as typeof SNAPSHOT;
    assert.equal(proposed.portfolio.inactivityDays, 120);
    assert.equal(SNAPSHOT.portfolio.inactivityDays, 90);
    assert.equal((await store.getVersion(version.id))?.normativeSnapshotHash, normativeSnapshotHash(SNAPSHOT));
    assert.equal((await store.getVersion(version.id))?.status, "PUBLISHED");
    assert.deepEqual(versionPublicView(draft).whatChanged.slice(0, 2), ["POLÍTICA COMERCIAL 1.1", "Alterações desde a versão 1"]);
  });

  it("7/8/9/10: nova publicação exige novo aceite, mantém o anterior, respeita a vigência futura e não altera o histórico", async () => {
    const { store, version } = await baseline();
    const seller = { id: "seller-1", role: "SELLER", isActive: true, mustChangePassword: false };
    await store.insertChallenge({ id: "ch-1", userId: seller.id, policyVersionId: version.id, expiresAt: new Date(NOW.getTime() + 60_000), usedAt: null });
    await store.insertPhoto({ id: "ph-1", userId: seller.id, policyVersionId: version.id, challengeId: "ch-1", storageKey: "k", contentHash: "h", mimeType: "image/jpeg", byteSize: 10, linked: false });
    const committed = await store.commitAcceptance({
      id: "acc-1", policyVersionId: version.id, userId: seller.id, userNameSnapshot: "Ana", userEmailSnapshot: "ana@koppetel.com", roleSnapshot: "SELLER", externalSellerIdSnapshot: 1,
      acceptedAt: NOW, ipAddress: null, userAgent: null, sessionId: "s", challengeId: "ch-1", photoEvidenceId: "ph-1", questionnaireAttemptId: "at-1",
      declarationsAccepted: version.declarations, policyContentHash: version.contentHash, normativeSnapshotHash: version.normativeSnapshotHash, changeSetHash: version.changeSetHash,
      photoHash: "photo", evidenceHash: "ev", appCommit: null, canonicalPayload: {},
    });
    assert.equal(committed.ok, true);
    assert.equal(await sellerHasPendingPolicy(store, seller, NOW), false);
    const opened = await openNormativeRevision(store, change("commission.releaseRule", "EACH_RECEIVABLE_PAID", "SALES_ORDER_CREATED", "Recebimento", "Pedido"));
    assert.equal(opened.ok, true);
    if (!opened.ok || !opened.version) return;
    const future = new Date("2026-11-01T00:00:00.000Z");
    await store.saveDraft(opened.version.id, { ...SHORT_BODY, title: "Política Comercial 1.1" }, future);
    const live = buildCurrentCommercialPolicyNormativeSnapshot({ releaseDefaultRule: "SALES_ORDER_CREATED", partialPaymentEnabled: true });
    const published = await publishPolicyVersion(store, opened.version.id, "super-1", NOW, { currentSnapshot: live });
    assert.equal(published.ok, true);
    if (!published.ok) return;
    assert.equal(published.version.normativeSnapshotHash, normativeSnapshotHash(live));
    assert.equal(await store.countEffectivePublished(NOW), 1);
    assert.equal((await store.currentPublished(NOW))?.id, version.id, "até a vigência, a 1.0 continua vigente");
    assert.equal(await sellerHasPendingPolicy(store, seller, NOW), false);
    assert.equal((await store.currentPublished(future))?.id, published.version.id);
    assert.equal(await sellerHasPendingPolicy(store, seller, future), true);
    assert.equal((await store.findAcceptance(seller.id, version.id))?.id, "acc-1");
    const history = await store.getVersion(version.id);
    assert.equal(history?.status, "RETIRED", "na vigência da 1.1 a anterior é aposentada, não apagada");
    assert.equal(history?.normativeSnapshotHash, normativeSnapshotHash(SNAPSHOT));
    assert.equal(history?.contentHash, version.contentHash);
    assert.notEqual(history?.normativeSnapshotHash, published.version.normativeSnapshotHash);
  });

  it("1/6: a versão vigente não recebe changeset nem snapshot novo; só o rascunho muda", async () => {
    const { store, version } = await baseline();
    const before = structuredClone(await store.getVersion(version.id));
    await openNormativeRevision(store, change("commission.supervisorShare", 0.33, 0.3, "33%", "30%"));
    const after = await store.getVersion(version.id);
    assert.deepEqual(after, before);
    const attached = await store.attachNormative(version.id, { normativeSnapshot: {}, normativeSnapshotHash: "x", changeSet: [], changeSetHash: "y", previousVersionId: null });
    assert.equal(attached, null);
  });

  it("o rascunho de revisão carrega o texto oficial integral e as seções afetadas para a revisão assistida", async () => {
    const { store } = await baseline();
    const opened = await openNormativeRevision(store, change("portfolio.inactivityDays", 90, 120, "90 dias", "120 dias"));
    assert.equal(opened.ok, true);
    if (!opened.ok || !opened.version) return;
    assert.equal(opened.version.content, officialCommercialPolicyContent());
    assert.deepEqual(opened.version.changeSet?.map((item) => item.policySection), [POLICY_SECTIONS.inactivity]);
    assert.equal(opened.version.title, "Política Comercial 1.1");
  });
});
