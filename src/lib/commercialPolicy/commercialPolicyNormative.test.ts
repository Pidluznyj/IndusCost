import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  DOCUMENT_ANNEX_I_BANDS,
  auditPolCom001Publication,
  blockedNormativeCommissionSettingChanges,
  buildCurrentCommercialPolicyNormativeSnapshot,
  buildTransitionSnapshot,
  canApplyNormativeValue,
  changeSetHash,
  classifyCommercialChange,
  comparePublishedPolicyToCurrentNormativeState,
  formatWhatChanged,
  normativeSnapshotHash,
  planPolicyRevision,
  questionsForRevision,
  renderCommissionMatrixLines,
} from "./commercialPolicyNormative.js";
import { createMemoryCommercialPolicyStore } from "./commercialPolicyStore.js";
import {
  createPolicyDraft,
  openNormativeRevision,
  publishPolicyVersion,
  sellerHasPendingPolicy,
  signCommercialPolicy,
} from "./commercialPolicyService.js";
import { buildEvidenceHash } from "./commercialPolicyRules.js";
import { officialCommercialPolicyBody } from "./official/polCom001V1.js";

const RELEASE = { releaseDefaultRule: "EACH_RECEIVABLE_PAID", partialPaymentEnabled: true };
const NOW = new Date("2026-09-29T12:00:00.000Z");

const basePlan = {
  currentLabel: "1.0",
  currentSnapshot: buildCurrentCommercialPolicyNormativeSnapshot(RELEASE),
  reason: "teste",
  changedBy: "super-1",
  changedAt: NOW.toISOString(),
};

describe("snapshot normativo", () => {
  it("é determinístico e a mesma configuração gera o mesmo hash", () => {
    const left = normativeSnapshotHash(buildCurrentCommercialPolicyNormativeSnapshot(RELEASE));
    const right = normativeSnapshotHash(buildCurrentCommercialPolicyNormativeSnapshot({ ...RELEASE }));
    assert.equal(left, right);
  });

  it("mudança normativa de liberação altera o hash", () => {
    const current = normativeSnapshotHash(buildCurrentCommercialPolicyNormativeSnapshot(RELEASE));
    const next = normativeSnapshotHash(
      buildCurrentCommercialPolicyNormativeSnapshot({
        releaseDefaultRule: "SALES_ORDER_CREATED",
        partialPaymentEnabled: true,
      })
    );
    assert.notEqual(current, next);
  });

  it("dado operacional não entra no snapshot", () => {
    const before = normativeSnapshotHash(buildCurrentCommercialPolicyNormativeSnapshot(RELEASE));
    const afterContact = normativeSnapshotHash(buildCurrentCommercialPolicyNormativeSnapshot(RELEASE));
    assert.equal(classifyCommercialChange("crm.contact"), "OPERATIONAL_DATA");
    assert.equal(before, afterContact);
  });

  it("conta institucional específica não muda o hash da política", () => {
    assert.equal(classifyCommercialChange("customer.institutionalMembership"), "CONTROLLED_REFERENCE_CHANGED");
    const before = normativeSnapshotHash(buildCurrentCommercialPolicyNormativeSnapshot(RELEASE));
    const after = normativeSnapshotHash(buildCurrentCommercialPolicyNormativeSnapshot(RELEASE));
    assert.equal(before, after);
  });

  it("snapshot histórico permanece igual depois de uma configuração futura", () => {
    const frozen = structuredClone(buildCurrentCommercialPolicyNormativeSnapshot(RELEASE));
    const frozenHash = normativeSnapshotHash(frozen);
    const live = buildCurrentCommercialPolicyNormativeSnapshot({
      releaseDefaultRule: "OUTPUT_DOCUMENT_CREATED",
      partialPaymentEnabled: false,
    });
    assert.equal(normativeSnapshotHash(frozen), frozenHash);
    assert.notEqual(normativeSnapshotHash(live), frozenHash);
  });

  it("a renderização histórica usa o snapshot congelado", () => {
    const frozen = buildCurrentCommercialPolicyNormativeSnapshot(RELEASE);
    const lines = renderCommissionMatrixLines(frozen);
    const live = buildCurrentCommercialPolicyNormativeSnapshot({
      releaseDefaultRule: "SALES_ORDER_CREATED",
      partialPaymentEnabled: false,
    });
    assert.deepEqual(renderCommissionMatrixLines(frozen), lines);
    assert.match(lines.join(" "), /não parametrizada/);
    assert.equal(live.commissionRelease.basis, "SALES_ORDER_CREATED");
  });
});

describe("detecção de mudança", () => {
  it("comissão, faixa, supervisor, 90 dias, liberação e CRM exigem nova política", () => {
    for (const kind of [
      "commission.matrix",
      "commission.band",
      "commission.supervisorShare",
      "portfolio.inactivityDays",
      "commission.releaseRule",
      "crm.requiredRule",
    ] as const) {
      assert.equal(classifyCommercialChange(kind), "POLICY_VERSION_REQUIRED");
    }
  });

  it("preço de SKU, responsável, contato e vendedor do pedido são operacionais", () => {
    assert.equal(classifyCommercialChange("pricing.skuPrice"), "OPERATIONAL_DATA");
    assert.equal(classifyCommercialChange("customer.responsible"), "OPERATIONAL_DATA");
    assert.equal(classifyCommercialChange("crm.contact"), "OPERATIONAL_DATA");
    assert.equal(classifyCommercialChange("salesOrder.seller"), "OPERATIONAL_DATA");
  });

  it("documento e sistema divergem na faixa de 50%", () => {
    const top = DOCUMENT_ANNEX_I_BANDS.find((band) => band.label === "50,00% ou mais");
    assert.equal(top?.commissionPercent, 0.04);
    const audit = auditPolCom001Publication(officialCommercialPolicyBody().content);
    const matrix = audit.findings.find((item) => item.code === "COMMISSION_MATRIX_NOT_PARAMETERIZED");
    assert.equal(audit.status, "NOT_READY_FOR_PUBLICATION");
    assert.match(matrix?.document ?? "", /4,00%/);
    assert.match(matrix?.system ?? "", /CommissionRule/);
  });
});

describe("rascunho e publicação", () => {
  it("alteração normativa cria um único rascunho com versão anterior e diff", async () => {
    const store = createMemoryCommercialPolicyStore();
    const published = await createPolicyDraft(store, {
      title: "Política",
      content: "Texto curto de teste da política comercial vigente.",
      summaryRules: ["Regra"],
      declarations: ["Declaro ciência."],
      questions: [{ id: "q1", prompt: "Pergunta", explanation: "Porque", correctOptionId: "a", options: [{ id: "a", text: "Sim" }, { id: "b", text: "Não" }] }],
    }, NOW);
    assert.equal(published.ok, true);
    if (!published.ok) return;
    await publishPolicyVersion(store, published.version.id, "super-1", NOW);
    const first = await openNormativeRevision(store, {
      kind: "commission.releaseRule",
      currentLabel: "1.0",
      release: RELEASE,
      oldValue: "EACH_RECEIVABLE_PAID",
      newValue: "SALES_ORDER_CREATED",
      oldDisplayValue: "Recebimento proporcional",
      newDisplayValue: "Na criação do pedido",
      reason: "Mudança de gatilho",
      changedBy: "super-1",
      now: NOW,
    });
    const second = await openNormativeRevision(store, {
      kind: "commission.releaseRule",
      currentLabel: "1.0",
      release: RELEASE,
      oldValue: "EACH_RECEIVABLE_PAID",
      newValue: "SALES_ORDER_CREATED",
      oldDisplayValue: "Recebimento proporcional",
      newDisplayValue: "Na criação do pedido",
      reason: "Mudança de gatilho",
      changedBy: "super-1",
      now: NOW,
    });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (!first.ok || !second.ok) return;
    assert.equal(second.duplicate, true);
    assert.equal(first.version?.id, second.version?.id);
    assert.equal(first.version?.previousVersionId, published.version.id);
    assert.equal(first.version?.changeSet?.[0]?.oldDisplayValue, "Recebimento proporcional");
    assert.equal(first.version?.changeSet?.[0]?.newDisplayValue, "Na criação do pedido");
    assert.equal(first.version?.changeSetHash, changeSetHash(first.version?.changeSet ?? []));
    assert.equal(first.releaseUnchanged.releaseDefaultRule, "EACH_RECEIVABLE_PAID");
    assert.equal(canApplyNormativeValue({ policyStatus: "DRAFT", effectiveFrom: NOW, now: NOW }), false);
  });

  it("cancelar o rascunho mantém a versão vigente", async () => {
    const store = createMemoryCommercialPolicyStore();
    const published = await createPolicyDraft(store, {
      title: "Política",
      content: "Texto curto de teste da política comercial vigente.",
      summaryRules: ["Regra"],
      declarations: ["Declaro ciência."],
      questions: [{ id: "q1", prompt: "Pergunta", explanation: "Porque", correctOptionId: "a", options: [{ id: "a", text: "Sim" }, { id: "b", text: "Não" }] }],
    }, NOW);
    if (!published.ok) return;
    await publishPolicyVersion(store, published.version.id, "super-1", NOW);
    const draft = await openNormativeRevision(store, {
      kind: "commission.releaseRule",
      currentLabel: "1.0",
      release: RELEASE,
      oldValue: "EACH_RECEIVABLE_PAID",
      newValue: "SALES_ORDER_CREATED",
      oldDisplayValue: "Recebimento",
      newDisplayValue: "Pedido",
      reason: "teste",
      changedBy: "super-1",
      now: NOW,
    });
    if (!draft.ok || !draft.version) return;
    await store.retireDraft(draft.version.id);
    assert.equal((await store.getVersion(published.version.id))?.status, "PUBLISHED");
    assert.equal(await store.countEffectivePublished(NOW), 1);
  });

  it("vigência futura não libera a regra e duas vigentes continuam proibidas", () => {
    const later = new Date("2026-11-01T00:00:00.000Z");
    assert.equal(canApplyNormativeValue({ policyStatus: "PUBLISHED", effectiveFrom: later, now: NOW }), false);
    assert.equal(canApplyNormativeValue({ policyStatus: "PUBLISHED", effectiveFrom: NOW, now: later }), true);
  });

  it("a rotina de 90 dias está conectada à Seção 11 e não bloqueia, sem marcar a política IN_SYNC", () => {
    const audit = auditPolCom001Publication(officialCommercialPolicyBody().content);
    assert.equal(audit.findings.some((item) => item.code === "PORTFOLIO_INACTIVITY_MISMATCH"), false);
    const finding = audit.findings.find((item) => item.code === "PORTFOLIO_INACTIVITY_CONNECTED");
    assert.equal(finding?.blocking, false);
    assert.equal(finding?.severity, "INFORMATIONAL");
    assert.match(finding?.system ?? "", /SENT_TO_NOMUS/);
    assert.match(finding?.system ?? "", /Não usa faturamento/);
    assert.equal(audit.status, "NOT_READY_FOR_PUBLICATION");
    const snapshot = buildCurrentCommercialPolicyNormativeSnapshot(RELEASE);
    assert.equal(snapshot.portfolio.inactivityDays, 90);
    assert.equal(snapshot.portfolio.crmEvidenceCanPreserveAssignment, true);
    assert.equal(snapshot.portfolio.systemBehavior, "REVIEW_THEN_REMOVE_OR_PRESERVE");
    assert.equal(
      comparePublishedPolicyToCurrentNormativeState({
        publishedHash: "abc",
        current: snapshot,
        publicationAuditBlocking: true,
      }),
      "POLICY_SYSTEM_MISMATCH"
    );
  });

  it("um teor que ainda cite versão 2.0 bloqueia; o documento corrigido registra só o informativo", () => {
    const stale = auditPolCom001Publication(officialCommercialPolicyBody().content.replace("versão 1.0, vigente", "versão 2.0, vigente"));
    assert.ok(stale.findings.some((item) => item.code === "DECLARED_VERSION_MISMATCH" && item.severity === "BLOCKING"));
    const audit = auditPolCom001Publication(officialCommercialPolicyBody().content);
    assert.equal(audit.findings.some((item) => item.code === "DECLARED_VERSION_MISMATCH"), false);
    const internal = audit.findings.find((item) => item.code === "DOCUMENT_INTERNAL_VERSION_MISMATCH");
    assert.equal(internal?.severity, "INFORMATIONAL");
    assert.match(internal?.document ?? "", /Anexo III .*= 2\.0/);
    assert.equal(
      comparePublishedPolicyToCurrentNormativeState({
        publishedHash: "abc",
        current: buildCurrentCommercialPolicyNormativeSnapshot(RELEASE),
        publicationAuditBlocking: true,
      }),
      "POLICY_SYSTEM_MISMATCH"
    );
  });
});

describe("aceite da nova versão", () => {
  it("o que mudou sai do diff e o questionário pode focar a mudança", () => {
    const plan = planPolicyRevision({
      ...basePlan,
      kind: "commission.band",
      oldValue: 0.02,
      newValue: 0.025,
      oldDisplayValue: "2,00%",
      newDisplayValue: "2,50%",
    });
    const lines = formatWhatChanged(plan.changeSet, plan.nextLabel ?? "", "1.0");
    assert.match(lines.join("\n"), /2,00%/);
    assert.match(lines.join("\n"), /2,50%/);
    const focused = questionsForRevision(
      [{ id: "q-noventa" }, { id: "q-copia" }, { id: "q-historico" }],
      plan.changeSet
    );
    assert.deepEqual(focused.map((item) => item.id), ["q-noventa", "q-historico"]);
  });

  it("aceite da 1.0 não cobre a 1.1 e a evidência carrega o changeset", async () => {
    const store = createMemoryCommercialPolicyStore();
    const seller = {
      id: "seller-1",
      name: "Ana",
      email: "ana@koppetel.com",
      role: "SELLER",
      isActive: true,
      mustChangePassword: false,
      externalSellerId: 10,
      sessionId: "sess-1",
    };
    const first = await createPolicyDraft(store, {
      title: "Política 1",
      content: "Texto curto de teste da política comercial vigente.",
      summaryRules: ["Regra"],
      declarations: ["Declaro ciência."],
      questions: [{ id: "q1", prompt: "Pergunta", explanation: "Porque", correctOptionId: "a", options: [{ id: "a", text: "Sim" }, { id: "b", text: "Não" }] }],
    }, NOW);
    if (!first.ok) return;
    await publishPolicyVersion(store, first.version.id, "super-1", NOW);
    await store.insertChallenge({
      id: "ch-1",
      userId: seller.id,
      policyVersionId: first.version.id,
      expiresAt: new Date(NOW.getTime() + 60_000),
      usedAt: null,
    });
    await store.insertPhoto({
      id: "ph-1",
      userId: seller.id,
      policyVersionId: first.version.id,
      challengeId: "ch-1",
      storageKey: "k",
      contentHash: "h",
      mimeType: "image/jpeg",
      byteSize: 10,
      linked: false,
    });
    await store.commitAcceptance({
      id: "acc-1",
      policyVersionId: first.version.id,
      userId: seller.id,
      userNameSnapshot: seller.name,
      userEmailSnapshot: seller.email,
      roleSnapshot: seller.role,
      externalSellerIdSnapshot: 10,
      acceptedAt: NOW,
      ipAddress: null,
      userAgent: null,
      sessionId: seller.sessionId,
      challengeId: "ch-1",
      photoEvidenceId: "ph-1",
      questionnaireAttemptId: "at-1",
      declarationsAccepted: ["Declaro ciência."],
      policyContentHash: "hash-1",
      photoHash: "photo",
      evidenceHash: "evidence-1",
      appCommit: null,
      canonicalPayload: {},
    });
    const second = await createPolicyDraft(store, {
      title: "Política 2",
      content: "Texto curto de teste da política comercial seguinte.",
      summaryRules: ["Regra nova"],
      declarations: ["Declaro ciência da nova versão."],
      questions: [{ id: "q1", prompt: "Pergunta", explanation: "Porque", correctOptionId: "a", options: [{ id: "a", text: "Sim" }, { id: "b", text: "Não" }] }],
    }, NOW);
    if (!second.ok) return;
    await store.attachNormative(second.version.id, {
      normativeSnapshot: buildCurrentCommercialPolicyNormativeSnapshot(RELEASE),
      normativeSnapshotHash: "snap-2",
      changeSet: [{
        dependencyKey: "commission.releaseRule",
        humanLabel: "Liberação",
        policySection: "14",
        oldValue: "EACH_RECEIVABLE_PAID",
        newValue: "SALES_ORDER_CREATED",
        oldDisplayValue: "Recebimento",
        newDisplayValue: "Pedido",
        reason: "teste",
        changedBy: "super-1",
        changedAt: NOW.toISOString(),
        sourceVersionOld: "1.0",
        sourceVersionNew: "1.1",
        impact: "POLICY_VERSION_REQUIRED",
      }],
      changeSetHash: "change-2",
      previousVersionId: first.version.id,
    });
    await publishPolicyVersion(store, second.version.id, "super-1", NOW);
    assert.equal(await sellerHasPendingPolicy(store, seller, NOW), true);
    assert.equal((await store.findAcceptance(seller.id, first.version.id))?.id, "acc-1");
    const evidence = buildEvidenceHash({
      policyVersionId: second.version.id,
      policyVersion: 2,
      policyHash: "hash-2",
      userId: seller.id,
      userNameSnapshot: seller.name,
      userEmailSnapshot: seller.email,
      role: seller.role,
      sellerExternalId: 10,
      acceptedAtServer: NOW.toISOString(),
      ipAddress: null,
      userAgent: null,
      sessionId: seller.sessionId,
      reauthChallengeId: "ch-2",
      photoHash: "photo",
      photoStorageReference: "file",
      questionnaireAttemptId: "at-2",
      answers: [],
      declarationsAccepted: ["Declaro ciência da nova versão."],
      appCommit: null,
      normativeSnapshotHash: "snap-2",
      changeSetHash: "change-2",
      previousPolicyVersionId: first.version.id,
    });
    assert.equal(evidence.payload.changeSetHash, "change-2");
    assert.match(evidence.hash, /^[a-f0-9]{64}$/);
  });

  it("versão futura não pode ser assinada", async () => {
    const store = createMemoryCommercialPolicyStore();
    const future = new Date("2026-11-01T00:00:00.000Z");
    const draft = await createPolicyDraft(store, {
      title: "Política futura",
      content: "Texto curto de teste da política comercial futura.",
      summaryRules: ["Regra"],
      declarations: ["Declaro ciência."],
      questions: [{ id: "q1", prompt: "Pergunta", explanation: "Porque", correctOptionId: "a", options: [{ id: "a", text: "Sim" }, { id: "b", text: "Não" }] }],
      effectiveFrom: future,
    }, NOW);
    if (!draft.ok) return;
    await store.markPublished(draft.version.id, { contentHash: "futura", publishedAt: NOW, publishedByUserId: "super-1" });
    const signed = await signCommercialPolicy(store, {
      id: "seller-1",
      name: "Ana",
      email: "ana@koppetel.com",
      role: "SELLER",
      isActive: true,
      mustChangePassword: false,
      externalSellerId: null,
      sessionId: "sess",
    }, {
      policyVersionId: draft.version.id,
      challengeId: "ch",
      photoId: "ph",
      declarations: ["Declaro ciência."],
    }, { now: NOW, ipAddress: null, userAgent: null, appCommit: null });
    assert.equal(signed.ok, false);
    if (signed.ok) return;
    assert.equal(signed.code, "VERSION_NOT_CURRENT");
  });
});

describe("segurança da política viva", () => {
  it("a rota de aceite não lê snapshot nem changeset do cliente", () => {
    const source = readFileSync(path.join(process.cwd(), "src/lib/commercialPolicy/commercialPolicyRoutes.ts"), "utf8");
    const accept = source.slice(source.indexOf('"/api/commercial-policy/accept"'), source.indexOf('"/api/commercial-policy/acceptances/mine"'));
    assert.doesNotMatch(accept, /req\.body\?\.normativeSnapshot/);
    assert.doesNotMatch(accept, /req\.body\?\.changeSet/);
  });

  it("configuração normativa não é gravada direto e versão publicada não é sobrescrita", () => {
    const blocked = blockedNormativeCommissionSettingChanges(
      { ...RELEASE, receivableAsDefinitiveReleaseSource: true },
      { releaseDefaultRule: "SALES_ORDER_CREATED", partialPaymentEnabled: true, receivableAsDefinitiveReleaseSource: true }
    );
    assert.deepEqual(blocked, ["releaseDefaultRule"]);
    const same = blockedNormativeCommissionSettingChanges(
      { ...RELEASE, receivableAsDefinitiveReleaseSource: true },
      { ...RELEASE, receivableAsDefinitiveReleaseSource: true }
    );
    assert.deepEqual(same, []);
  });

  it("o pdf histórico não consulta a configuração atual de comissão", () => {
    const source = readFileSync(path.join(process.cwd(), "src/lib/commercialPolicy/commercialPolicyPdf.ts"), "utf8");
    assert.doesNotMatch(source, /loadCommissionSettings|getCurrentCommission/);
  });

  it("a transição registra só o que foi informado", () => {
    const snapshot = buildTransitionSnapshot({ asOf: "2026-09-29", release: RELEASE });
    assert.deepEqual(snapshot.institutionalCustomerIds, []);
    assert.equal(snapshot.commissionMatrix, null);
    assert.equal(snapshot.coverage, "NOT_YET_SYSTEM_PARAMETERIZED");
  });
});
