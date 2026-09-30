import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import express from "express";
import http from "node:http";
import { resolveAuthenticatedAccessGate } from "@/src/lib/auth/passwordChangeRequiredGuard.js";
import { resolveAuditIpAddress } from "@/src/lib/auth/securityAudit.server.js";
import {
  buildEvidenceHash,
  hashPolicyContent,
  inspectPolicyPhoto,
  scoreQuestionnaire,
  type PolicyVersionBody,
} from "./commercialPolicyRules.js";
import { createMemoryCommercialPolicyStore } from "./commercialPolicyStore.js";
import {
  createPolicyDraft,
  publishPolicyVersion,
  recordKnowledgeAttempt,
  resetCommercialPolicyAcceptances,
  RESET_ALL_ACCEPTANCES_CONFIRMATION,
  saveSignaturePhoto,
  sellerHasPendingPolicy,
  signCommercialPolicy,
  createSignatureChallenge,
  type PolicyActor,
} from "./commercialPolicyService.js";
import {
  createCommercialPolicyAcceptanceGuard,
  decidePolicyAcceptanceGuard,
} from "./commercialPolicyGuard.js";
import { registerCommercialPolicyRoutes } from "./commercialPolicyRoutes.js";
import { buildTextPdf } from "./commercialPolicyPdf.js";
import { buildAcceptanceCertificatePdf } from "./commercialPolicyControlledCopyPdf.js";

const BODY: PolicyVersionBody = {
  title: "Política Comercial de teste",
  content: "Texto oficial fictício usado só no teste. Não é a política da empresa e não é publicado em produção.",
  summaryRules: ["O vendedor comissionável é o do pedido."],
  declarations: ["Declaro que li a versão de teste."],
  questions: [
    {
      id: "q1",
      prompt: "Quem é o vendedor comissionável do PV?",
      options: [
        { id: "a", text: "O responsável comercial" },
        { id: "b", text: "O vendedor do pedido" },
      ],
      correctOptionId: "b",
      explanation: "A comissão segue o vendedor gravado no pedido.",
    },
  ],
};

function seller(overrides: Partial<PolicyActor> = {}): PolicyActor {
  return {
    id: "seller-1",
    name: "Vendedor Teste",
    email: "vendedor@exemplo.test",
    role: "SELLER",
    isActive: true,
    mustChangePassword: false,
    externalSellerId: 42,
    sessionId: "session-1",
    ...overrides,
  };
}

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(32, 1)]);

async function published(store = createMemoryCommercialPolicyStore(), now = new Date("2026-09-28T12:00:00.000Z")) {
  const draft = await createPolicyDraft(store, BODY, now);
  assert.equal(draft.ok, true);
  if (!draft.ok) throw new Error("draft");
  const publishedVersion = await publishPolicyVersion(store, draft.version.id, "super-1", now);
  assert.equal(publishedVersion.ok, true);
  if (!publishedVersion.ok) throw new Error("publish");
  return { store, version: publishedVersion.version, now };
}

describe("audiência e ordem dos gates", () => {
  for (const role of ["ADMIN", "SUPER_ADMIN", "COMMERCIAL_MANAGER", "VIEWER"]) {
    it(`${role} não fica pendente`, async () => {
      const { store, now } = await published();
      assert.equal(
        await sellerHasPendingPolicy(store, { id: "u", role, isActive: true, mustChangePassword: false }, now),
        false
      );
    });
  }

  it("SELLER sem versão publicada entra", async () => {
    const store = createMemoryCommercialPolicyStore();
    assert.equal(
      await sellerHasPendingPolicy(store, seller(), new Date()),
      false
    );
  });

  it("SELLER com versão vigente não aceita fica pendente", async () => {
    const { store, now } = await published();
    assert.equal(await sellerHasPendingPolicy(store, seller(), now), true);
  });

  it("senha obrigatória vem antes da política", () => {
    assert.equal(
      resolveAuthenticatedAccessGate({
        mustChangePassword: true,
        role: "SELLER",
        hasPendingCommercialPolicy: true,
      }),
      "PASSWORD_CHANGE_REQUIRED"
    );
  });

  it("SELLER inativo não entra no fluxo", async () => {
    const { store, now } = await published();
    assert.equal(
      await sellerHasPendingPolicy(store, seller({ isActive: false }), now),
      false
    );
  });
});

describe("versão, questionário e aceite", () => {
  it("falha ao publicar não aposenta a versão vigente", async () => {
    const { store, version, now } = await published();
    const draft = await createPolicyDraft(
      store,
      { ...BODY, content: BODY.content + "\nCorreção que não chega a publicar." },
      now
    );
    assert.equal(draft.ok, true);
    if (!draft.ok) return;
    store.markPublished = async () => null;
    const failed = await publishPolicyVersion(store, draft.version.id, "super-1", now);
    assert.equal(failed.ok, false);
    assert.equal(store.versions.find((row) => row.id === version.id)?.status, "PUBLISHED");
  });

  it("não publica rascunho inválido e não edita versão publicada", async () => {
    const store = createMemoryCommercialPolicyStore();
    const bad = await createPolicyDraft(store, { ...BODY, content: "curto" }, new Date());
    assert.equal(bad.ok, false);
    const { store: ready, version } = await published();
    const again = await publishPolicyVersion(ready, version.id, "super-1", new Date());
    assert.equal(again.ok, false);
    if (!again.ok) assert.equal(again.code, "VERSION_IMMUTABLE");
    const saved = await ready.saveDraft(version.id, BODY, new Date());
    assert.equal(saved, null);
    assert.equal(version.contentHash, hashPolicyContent(BODY));
  });

  it("nova versão exige novo aceite e preserva o antigo", async () => {
    const first = await published();
    const actor = seller();
    await passAndSign(first.store, actor, first.version.id, first.now);
    assert.equal(await sellerHasPendingPolicy(first.store, actor, first.now), false);
    const secondDraft = await createPolicyDraft(
      first.store,
      { ...BODY, content: BODY.content + "\nSegunda versão oficial de teste." },
      first.now
    );
    assert.equal(secondDraft.ok, true);
    if (!secondDraft.ok) return;
    await publishPolicyVersion(first.store, secondDraft.version.id, "super-1", first.now);
    assert.equal(first.store.acceptances.length, 1);
    assert.equal(first.store.acceptances[0].policyContentHash, hashPolicyContent(BODY));
    assert.equal(await sellerHasPendingPolicy(first.store, actor, first.now), true);
    assert.notEqual(secondDraft.version.id, first.version.id);
  });

  it("reprova resposta errada, aprova a certa e exige declarações", async () => {
    const { store, version, now } = await published();
    const actor = seller();
    const wrong = await recordKnowledgeAttempt(store, actor, {
      policyVersionId: version.id,
      answers: [{ questionId: "q1", optionId: "a" }],
    }, now);
    assert.equal(wrong.ok && wrong.passed, false);
    assert.equal(store.attempts.length, 1);
    const right = await recordKnowledgeAttempt(store, actor, {
      policyVersionId: version.id,
      answers: [{ questionId: "q1", optionId: "b" }],
    }, now);
    assert.equal(right.ok && right.passed, true);
    const missing = await signCommercialPolicy(store, actor, {
      policyVersionId: version.id,
      challengeId: "nao",
      photoId: "nao",
      declarations: [],
    }, origin(now));
    assert.equal(missing.ok, false);
  });

  it("reautenticação inválida, expirada e reutilizada falha", async () => {
    const { store, version, now } = await published();
    const actor = seller();
    await recordKnowledgeAttempt(store, actor, {
      policyVersionId: version.id,
      answers: [{ questionId: "q1", optionId: "b" }],
    }, now);
    const bad = await createSignatureChallenge(store, actor, { policyVersionId: version.id, password: "errada" }, {
      now,
      verifyPassword: async () => false,
    });
    assert.equal(bad.ok, false);
    const good = await createSignatureChallenge(store, actor, { policyVersionId: version.id, password: "certa" }, {
      now,
      verifyPassword: async () => true,
    });
    assert.equal(good.ok, true);
    if (!good.ok) return;
    const challenge = store.challenges[0];
    challenge.expiresAt = new Date(now.getTime() - 1000);
    const expired = await saveSignaturePhoto(store, actor, {
      policyVersionId: version.id,
      challengeId: good.challengeId,
      mimeType: "image/jpeg",
      imageBase64: JPEG.toString("base64"),
    }, { now, saveFile: async () => ({ storageKey: "private/foto.jpg" }) });
    assert.equal(expired.ok, false);
    challenge.expiresAt = new Date(now.getTime() + 60_000);
    const photo = await saveSignaturePhoto(store, actor, {
      policyVersionId: version.id,
      challengeId: good.challengeId,
      mimeType: "image/jpeg",
      imageBase64: JPEG.toString("base64"),
    }, { now, saveFile: async () => ({ storageKey: "private/foto.jpg" }) });
    assert.equal(photo.ok, true);
    if (!photo.ok) return;
    const signed = await signCommercialPolicy(store, actor, {
      policyVersionId: version.id,
      challengeId: good.challengeId,
      photoId: photo.photoId,
      declarations: BODY.declarations,
      clientUserId: "outro-usuario",
    }, origin(now));
    assert.equal(signed.ok, false);
    const ok = await signCommercialPolicy(store, actor, {
      policyVersionId: version.id,
      challengeId: good.challengeId,
      photoId: photo.photoId,
      declarations: BODY.declarations,
    }, origin(now));
    assert.equal(ok.ok, true);
    if (!ok.ok) return;
    assert.equal(ok.acceptance.acceptedAt.toISOString(), now.toISOString());
    assert.equal(ok.acceptance.userId, actor.id);
    assert.equal(ok.acceptance.ipAddress, "203.0.113.9");
    assert.equal(ok.acceptance.userAgent, "teste");
    const again = await signCommercialPolicy(store, actor, {
      policyVersionId: version.id,
      challengeId: good.challengeId,
      photoId: photo.photoId,
      declarations: BODY.declarations,
    }, origin(now));
    assert.equal(again.ok, false);
  });

  it("foto inválida não cria aceite e falha de persistência não grava aceite", async () => {
    const { store, version, now } = await published();
    const actor = seller();
    const badPhoto = inspectPolicyPhoto({ mimeType: "image/gif", bytes: Buffer.from("GIF89a") });
    assert.equal(badPhoto.ok, false);
    await recordKnowledgeAttempt(store, actor, {
      policyVersionId: version.id,
      answers: [{ questionId: "q1", optionId: "b" }],
    }, now);
    const challenge = await createSignatureChallenge(store, actor, { policyVersionId: version.id, password: "certa" }, {
      now,
      verifyPassword: async () => true,
    });
    assert.equal(challenge.ok, true);
    if (!challenge.ok) return;
    const photo = await saveSignaturePhoto(store, actor, {
      policyVersionId: version.id,
      challengeId: challenge.challengeId,
      mimeType: "text/html",
      imageBase64: Buffer.from("<script>").toString("base64"),
    }, { now, saveFile: async () => ({ storageKey: "nao" }) });
    assert.equal(photo.ok, false);
    assert.equal(store.acceptances.length, 0);
    const goodPhoto = await saveSignaturePhoto(store, actor, {
      policyVersionId: version.id,
      challengeId: challenge.challengeId,
      mimeType: "image/jpeg",
      imageBase64: JPEG.toString("base64"),
    }, { now, saveFile: async () => ({ storageKey: "private/foto.jpg" }) });
    assert.equal(goodPhoto.ok, true);
    if (!goodPhoto.ok) return;
    store.failCommit = true;
    const failed = await signCommercialPolicy(store, actor, {
      policyVersionId: version.id,
      challengeId: challenge.challengeId,
      photoId: goodPhoto.photoId,
      declarations: BODY.declarations,
    }, origin(now));
    assert.equal(failed.ok, false);
    assert.equal(store.acceptances.length, 0);
    assert.equal(store.challenges[0].usedAt, null);
  });

  it("hash do pacote é estável e muda se a evidência mudar", () => {
    const base = {
      policyVersionId: "v",
      policyVersion: 1,
      policyHash: "abc",
      userId: "seller-1",
      userNameSnapshot: "Ana",
      userEmailSnapshot: "ana@exemplo.test",
      role: "SELLER",
      sellerExternalId: 7,
      acceptedAtServer: "2026-09-28T12:00:00.000Z",
      ipAddress: "203.0.113.9",
      userAgent: "teste",
      sessionId: "s",
      reauthChallengeId: "c",
      photoHash: "foto",
      photoStorageReference: "private/foto.jpg",
      questionnaireAttemptId: "t",
      answers: [{ questionId: "q1", optionId: "b" }],
      declarationsAccepted: ["Li"],
      appCommit: "sha",
    };
    const first = buildEvidenceHash(base);
    const second = buildEvidenceHash(base);
    assert.equal(first.hash, second.hash);
    const changed = buildEvidenceHash({ ...base, userId: "outro" });
    assert.notEqual(changed.hash, first.hash);
  });

  it("comprovante em PDF cita a versão e o hash, sem a imagem", () => {
    const pdf = buildTextPdf(["Política Comercial", "SHA-256 da política: abc", "SHA-256 da imagem: def"]);
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    assert.equal(pdf.toString("latin1").includes("abc"), true);
  });

  it("o comprovante é um certificado formal: signatário, documento, data, declarações, selo e hashes — sem a imagem", async () => {
    const { store, version, now } = await published();
    const acceptance = await passAndSign(store, seller(), version.id, now);
    const pdf = buildAcceptanceCertificatePdf({
      acceptanceId: acceptance.id,
      company: "Koppetel Comercio de Plásticos LTDA",
      cnpj: "14.055.501/0001-80",
      code: "POL-COM-001",
      title: version.title,
      versionLabel: "1.0",
      signerName: acceptance.userNameSnapshot,
      signerEmail: acceptance.userEmailSnapshot,
      signerRole: "Vendedor(a)",
      externalSellerId: acceptance.externalSellerIdSnapshot,
      acceptedAt: acceptance.acceptedAt.toISOString(),
      ipAddress: acceptance.ipAddress,
      challengeId: acceptance.challengeId,
      declarations: acceptance.declarationsAccepted,
      policyHash: acceptance.policyContentHash,
      photoHash: acceptance.photoHash,
      evidenceHash: acceptance.evidenceHash,
    });
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    const text = pdf.toString("latin1");
    for (const expected of [
      "CERTIFICADO DE ACEITE ELETR\\324NICO",
      "Certificamos que",
      "Vendedor Teste",
      "vendedor@exemplo.test",
      "POL-COM-001",
      "28/09/2026 09:00",
      acceptance.id,
      acceptance.challengeId,
      acceptance.policyContentHash,
      acceptance.photoHash,
      acceptance.evidenceHash,
      "203.0.113.9",
      "Declaro que li a vers",
      "ACEITE",
      "REGISTRADO",
      "Assinado eletronicamente no IndusCost",
      "P\\341gina 1 de ",
    ]) {
      assert.ok(text.includes(expected), expected);
    }
    // A fotografia nunca entra no certificado: não há objeto de imagem no PDF.
    assert.doesNotMatch(text, /\/Subtype \/Image/);
    // A rota entrega o certificado, não mais o texto corrido.
    const routes = readFileSync(new URL("./commercialPolicyRoutes.ts", import.meta.url), "utf8");
    assert.match(routes, /buildAcceptanceCertificatePdf\(/);
    assert.doesNotMatch(routes, /acceptanceReceiptLines/);
  });

  it("questionário está ligado à versão e não vaza a resposta na pontuação pública", () => {
    const scored = scoreQuestionnaire(BODY.questions, [{ questionId: "q1", optionId: "b" }]);
    assert.equal(scored.passed, true);
    assert.equal(JSON.stringify(scored).includes("correctOptionId"), false);
  });
});

describe("gate HTTP", () => {
  it("nega CRM/API e libera só a superfície da política", async () => {
    assert.equal(decidePolicyAcceptanceGuard({
      hasSessionCookie: true,
      pending: true,
      method: "GET",
      path: "/api/sales-orders",
    }).action, "deny");
    assert.equal(decidePolicyAcceptanceGuard({
      hasSessionCookie: true,
      pending: true,
      method: "GET",
      path: "/api/commercial-policy/pending",
    }).action, "allow");
    assert.equal(decidePolicyAcceptanceGuard({
      hasSessionCookie: true,
      pending: true,
      method: "POST",
      path: "/api/auth/logout",
    }).action, "allow");
    assert.equal(decidePolicyAcceptanceGuard({
      hasSessionCookie: true,
      pending: true,
      method: "GET",
      path: "/api/admin/commercial-policy/acceptances",
    }).action, "deny");
    assert.equal(decidePolicyAcceptanceGuard({
      hasSessionCookie: false,
      pending: true,
      method: "GET",
      path: "/api/crm",
    }).action, "allow");

    const app = express();
    app.use("/api", createCommercialPolicyAcceptanceGuard({
      hasSessionCookie: (cookie) => Boolean(cookie?.includes("induscost_session=")),
      resolvePending: async () => true,
    }));
    app.get("/api/sales-orders", (_req, res) => res.json({ ok: true }));
    app.get("/api/commercial-policy/pending", (_req, res) => res.json({ ok: true }));
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    try {
      const denied = await fetch(`http://127.0.0.1:${port}/api/sales-orders`, {
        headers: { cookie: "induscost_session=abc" },
      });
      assert.equal(denied.status, 403);
      assert.match(await denied.text(), /POLICY_ACCEPTANCE_REQUIRED/);
      const allowed = await fetch(`http://127.0.0.1:${port}/api/commercial-policy/pending`, {
        headers: { cookie: "induscost_session=abc" },
      });
      assert.equal(allowed.status, 200);
    } finally {
      server.close();
    }
  });

  it("seller não lê aceite de outro e ADMIN não publica", async () => {
    const { store, version, now } = await published();
    const actor = seller();
    const signed = await passAndSign(store, actor, version.id, now);
    const files = new Map<string, Buffer>();
    const app = express();
    app.use(express.json());
    let current: PolicyActor = actor;
    registerCommercialPolicyRoutes(app, {
      requireAppAuth: (_req, _res, next) => next(),
      getCurrentAppUser: async () => current,
      store,
      now: () => now,
      verifyPassword: async () => true,
      saveFile: async (_userId, bytes) => {
        files.set("k", bytes);
        return { storageKey: "k" };
      },
      readFile: async (key) => files.get(key) ?? Buffer.from(""),
    });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const url = `http://127.0.0.1:${port}`;
    try {
      current = seller({ id: "seller-2", sessionId: "session-2" });
      const other = await fetch(`${url}/api/commercial-policy/acceptances/${signed.id}/receipt`);
      assert.equal(other.status, 404);
      current = seller({ role: "ADMIN", id: "admin-1" });
      const publish = await fetch(`${url}/api/admin/commercial-policy/versions`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      assert.equal(publish.status, 403);
      current = seller({ role: "SUPER_ADMIN", id: "super-1" });
      const list = await fetch(`${url}/api/admin/commercial-policy/acceptances`);
      assert.equal(list.status, 200);
      const body = await list.json() as { acceptances: Array<{ id: string }> };
      assert.equal(body.acceptances[0].id, signed.id);
    } finally {
      server.close();
    }
  });
});

describe("exigência manual da política por usuário (flag do SUPER_ADMIN)", () => {
  it("pessoa marcada fica pendente em qualquer perfil, faz o fluxo inteiro e deixa de ficar pendente ao aceitar", async () => {
    const { store, version, now } = await published();
    const manager = seller({ id: "manager-1", role: "COMMERCIAL_MANAGER", sessionId: "session-m", externalSellerId: null });
    // Sem a marcação, gestor não é obrigado nem consegue iniciar o fluxo.
    assert.equal(await sellerHasPendingPolicy(store, manager, now), false);
    const refused = await recordKnowledgeAttempt(store, manager, { policyVersionId: version.id, answers: [{ questionId: "q1", optionId: "b" }] }, now);
    assert.equal(refused.ok, false);
    // Marcado: pendente, como o vendedor.
    const flagged = { ...manager, mustAcceptCommercialPolicy: true };
    assert.equal(await sellerHasPendingPolicy(store, flagged, now), true);
    const acceptance = await passAndSign(store, flagged, version.id, now);
    assert.equal(acceptance.roleSnapshot, "COMMERCIAL_MANAGER");
    assert.equal(await sellerHasPendingPolicy(store, flagged, now), false);
    // A marcação continua valendo: nova versão publicada volta a exigir o aceite.
    const later = new Date(now.getTime() + 60_000);
    const draft = await createPolicyDraft(store, { ...BODY, title: "Política Comercial de teste v2" }, later);
    assert.equal(draft.ok, true);
    if (!draft.ok) return;
    const next = await publishPolicyVersion(store, draft.version.id, "super-1", later);
    assert.equal(next.ok, true);
    assert.equal(await sellerHasPendingPolicy(store, flagged, later), true);
    assert.equal(await sellerHasPendingPolicy(store, manager, later), false);
  });

  it("senha obrigatória e usuário inativo continuam na frente da marcação", async () => {
    const { store, now } = await published();
    const flagged = seller({ id: "admin-1", role: "ADMIN", mustAcceptCommercialPolicy: true });
    assert.equal(await sellerHasPendingPolicy(store, { ...flagged, mustChangePassword: true }, now), false);
    assert.equal(await sellerHasPendingPolicy(store, { ...flagged, isActive: false }, now), false);
  });

  it("só SUPER_ADMIN marca ou desmarca; a rota valida o corpo e o usuário", async () => {
    const { store, now } = await published();
    const flags = new Map<string, boolean>([["user-1", false]]);
    const calls: Array<{ actorUserId: string; targetUserId: string; required: boolean }> = [];
    const app = express();
    app.use(express.json());
    let current: PolicyActor = seller({ role: "ADMIN", id: "admin-1" });
    registerCommercialPolicyRoutes(app, {
      requireAppAuth: (_req, _res, next) => next(),
      getCurrentAppUser: async () => current,
      store,
      now: () => now,
      setAcceptanceRequired: async (input) => {
        if (!flags.has(input.targetUserId)) return null;
        calls.push({ actorUserId: input.actorUserId, targetUserId: input.targetUserId, required: input.required });
        const changed = flags.get(input.targetUserId) !== input.required;
        flags.set(input.targetUserId, input.required);
        return { required: input.required, changed };
      },
    });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    const url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
    const post = (id: string, body: unknown) =>
      fetch(`${url}/api/admin/users/${id}/commercial-policy-required`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    try {
      assert.equal((await post("user-1", { required: true })).status, 403);
      assert.equal(calls.length, 0);
      current = seller({ role: "SUPER_ADMIN", id: "super-1" });
      assert.equal((await post("user-1", { required: "sim" })).status, 400);
      assert.equal((await post("nao-existe", { required: true })).status, 404);
      const set = await post("user-1", { required: true });
      assert.equal(set.status, 200);
      assert.deepEqual(await set.json(), { success: true, mustAcceptCommercialPolicy: true, changed: true });
      const again = await post("user-1", { required: true });
      assert.deepEqual(await again.json(), { success: true, mustAcceptCommercialPolicy: true, changed: false });
      const cleared = await post("user-1", { required: false });
      assert.deepEqual(await cleared.json(), { success: true, mustAcceptCommercialPolicy: false, changed: true });
      assert.deepEqual(calls.map((call) => [call.actorUserId, call.required]), [["super-1", true], ["super-1", true], ["super-1", false]]);
    } finally {
      server.close();
    }
  });
});

describe("zerar aceites (fase de testes, só SUPER_ADMIN)", () => {
  it("zerar um aceite apaga o fluxo daquele vendedor, que volta a ficar pendente e consegue aceitar de novo", async () => {
    const { store, version, now } = await published();
    const first = seller();
    const second = seller({ id: "seller-2", sessionId: "session-2", email: "outro@exemplo.test" });
    const accepted = await passAndSign(store, first, version.id, now);
    const kept = await passAndSign(store, second, version.id, now);
    assert.equal(await sellerHasPendingPolicy(store, first, now), false);

    const noReason = await resetCommercialPolicyAcceptances(store, { acceptanceId: accepted.id, reason: "  " });
    assert.equal(noReason.ok === false && noReason.code, "REASON_REQUIRED");
    const missing = await resetCommercialPolicyAcceptances(store, { acceptanceId: "nao-existe", reason: "teste" });
    assert.equal(missing.ok === false && missing.code, "NOT_FOUND");

    const reset = await resetCommercialPolicyAcceptances(store, { acceptanceId: accepted.id, reason: "teste do fluxo" });
    assert.equal(reset.ok, true);
    if (!reset.ok) return;
    assert.deepEqual(reset.acceptances.map((row) => row.id), [accepted.id]);
    assert.deepEqual([reset.attempts, reset.challenges, reset.photos], [1, 1, 1]);
    // O outro vendedor não é tocado.
    assert.deepEqual(store.acceptances.map((row) => row.id), [kept.id]);
    assert.equal(store.attempts.every((row) => row.userId === second.id), true);
    assert.equal(await sellerHasPendingPolicy(store, first, now), true);
    assert.equal(await sellerHasPendingPolicy(store, second, now), false);
    // O fluxo recomeça do zero e o novo aceite é gravado normalmente.
    const again = await passAndSign(store, first, version.id, now);
    assert.notEqual(again.id, accepted.id);
    assert.equal(await sellerHasPendingPolicy(store, first, now), false);
  });

  it("zerar todos exige a frase de confirmação e apaga todo o material de aceite", async () => {
    const { store, version, now } = await published();
    await passAndSign(store, seller(), version.id, now);
    await passAndSign(store, seller({ id: "seller-2", sessionId: "session-2" }), version.id, now);
    const unconfirmed = await resetCommercialPolicyAcceptances(store, { reason: "teste", confirmation: "sim" });
    assert.equal(unconfirmed.ok === false && unconfirmed.code, "CONFIRMATION_REQUIRED");
    assert.equal(store.acceptances.length, 2);
    const reset = await resetCommercialPolicyAcceptances(store, { reason: "teste", confirmation: RESET_ALL_ACCEPTANCES_CONFIRMATION });
    assert.equal(reset.ok, true);
    if (!reset.ok) return;
    assert.equal(reset.acceptances.length, 2);
    assert.deepEqual([store.acceptances.length, store.attempts.length, store.challenges.length, store.photos.length], [0, 0, 0, 0]);
    // A versão publicada continua vigente: só os aceites somem.
    assert.equal((await store.currentPublished(now))?.id, version.id);
  });

  it("as rotas de zerar só atendem SUPER_ADMIN", async () => {
    const { store, version, now } = await published();
    const actor = seller();
    const signed = await passAndSign(store, actor, version.id, now);
    const app = express();
    app.use(express.json());
    let current: PolicyActor = actor;
    registerCommercialPolicyRoutes(app, {
      requireAppAuth: (_req, _res, next) => next(),
      getCurrentAppUser: async () => current,
      store,
      now: () => now,
    });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    const url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
    const post = (path: string, body: unknown) =>
      fetch(`${url}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    try {
      for (const role of ["SELLER", "ADMIN", "COMMERCIAL_MANAGER"]) {
        current = seller({ role, id: `user-${role}` });
        const one = await post(`/api/admin/commercial-policy/acceptances/${signed.id}/reset`, { reason: "teste" });
        const all = await post("/api/admin/commercial-policy/acceptances/reset", { reason: "teste", confirmation: RESET_ALL_ACCEPTANCES_CONFIRMATION });
        assert.notEqual(one.status, 200, role);
        assert.notEqual(all.status, 200, role);
      }
      assert.equal(store.acceptances.length, 1);
      current = seller({ role: "SUPER_ADMIN", id: "super-1" });
      const refused = await post("/api/admin/commercial-policy/acceptances/reset", { reason: "teste" });
      assert.equal(refused.status, 422);
      const done = await post(`/api/admin/commercial-policy/acceptances/${signed.id}/reset`, { reason: "teste do fluxo" });
      assert.equal(done.status, 200);
      assert.equal(((await done.json()) as { removedAcceptances: number }).removedAcceptances, 1);
      assert.equal(store.acceptances.length, 0);
    } finally {
      server.close();
    }
  });
});

describe("integridade do código", () => {
  it("rotas não fazem update/delete direto de aceite (só o zerar do SUPER_ADMIN, pelo store) e o IP não lê X-Forwarded-For", () => {
    const routes = readFileSync(new URL("./commercialPolicyRoutes.ts", import.meta.url), "utf8");
    assert.doesNotMatch(routes, /commercialPolicyAcceptance\.(update|delete)/);
    assert.doesNotMatch(routes.toLowerCase(), /x-forwarded-for/);
    assert.doesNotMatch(routes, /console\.(log|info|debug).*password/);
    assert.equal(resolveAuditIpAddress("203.0.113.9"), "203.0.113.9");
  });
});

function origin(now: Date) {
  return { now, ipAddress: "203.0.113.9", userAgent: "teste", appCommit: "abc" };
}

async function passAndSign(
  store: ReturnType<typeof createMemoryCommercialPolicyStore>,
  actor: PolicyActor,
  versionId: string,
  now: Date
) {
  await recordKnowledgeAttempt(store, actor, {
    policyVersionId: versionId,
    answers: [{ questionId: "q1", optionId: "b" }],
  }, now);
  const challenge = await createSignatureChallenge(store, actor, { policyVersionId: versionId, password: "certa" }, {
    now,
    verifyPassword: async () => true,
  });
  assert.equal(challenge.ok, true);
  if (!challenge.ok) throw new Error("challenge");
  const photo = await saveSignaturePhoto(store, actor, {
    policyVersionId: versionId,
    challengeId: challenge.challengeId,
    mimeType: "image/jpeg",
    imageBase64: JPEG.toString("base64"),
  }, { now, saveFile: async () => ({ storageKey: "private/foto.jpg" }) });
  assert.equal(photo.ok, true);
  if (!photo.ok) throw new Error("photo");
  const signed = await signCommercialPolicy(store, actor, {
    policyVersionId: versionId,
    challengeId: challenge.challengeId,
    photoId: photo.photoId,
    declarations: BODY.declarations,
  }, origin(now));
  assert.equal(signed.ok, true);
  if (!signed.ok) throw new Error("sign");
  return signed.acceptance;
}
