import { randomUUID } from "node:crypto";
import {
  COMMERCIAL_POLICY_AUDIENCE,
  COMMERCIAL_POLICY_CHALLENGE_TTL_MS,
  COMMERCIAL_POLICY_PHOTO_REQUIRED,
  buildEvidenceHash,
  declarationsMatch,
  decodePolicyPhoto,
  hashPolicyContent,
  inspectPolicyPhoto,
  scoreQuestionnaire,
  sha256Hex,
  toPublicQuestions,
  validatePolicyDraft,
  type PolicyVersionBody,
  type SubmittedAnswer,
} from "./commercialPolicyRules.js";
import { officialCommercialPolicyBody, officialCommercialPolicyHash } from "./official/polCom001V1.js";
import type { CommercialPolicyStore, StoredAcceptance, StoredVersion } from "./commercialPolicyStore.js";

export type PolicyFailure = { ok: false; status: number; code: string; message: string };

export type PolicyActor = {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  mustChangePassword: boolean;
  externalSellerId: number | null;
  sessionId: string;
};

function fail(status: number, code: string, message: string): PolicyFailure {
  return { ok: false, status, code, message };
}

async function loadCurrent(
  store: CommercialPolicyStore,
  now: Date
): Promise<{ conflict: true } | { conflict: false; version: StoredVersion | null }> {
  if ((await store.countEffectivePublished(now)) > 1) return { conflict: true };
  return { conflict: false, version: await store.currentPublished(now) };
}

function bodyOf(version: StoredVersion): PolicyVersionBody {
  return {
    title: version.title,
    content: version.content,
    summaryRules: version.summaryRules,
    declarations: version.declarations,
    questions: version.questions,
  };
}

export function versionPublicView(version: StoredVersion) {
  return {
    id: version.id,
    version: version.versionNumber,
    title: version.title,
    content: version.content,
    summaryRules: version.summaryRules,
    declarations: version.declarations,
    questions: toPublicQuestions(version.questions),
    contentHash: version.contentHash,
    effectiveFrom: version.effectiveFrom.toISOString(),
    publishedAt: version.publishedAt?.toISOString() ?? null,
    status: version.status,
  };
}

export async function sellerHasPendingPolicy(
  store: CommercialPolicyStore,
  user: { id: string; role: string; isActive: boolean; mustChangePassword: boolean },
  now: Date
): Promise<boolean> {
  if (user.role !== COMMERCIAL_POLICY_AUDIENCE || user.mustChangePassword || user.isActive === false) return false;
  const current = await loadCurrent(store, now);
  if (current.conflict === true) return true;
  if (!current.version) return false;
  const accepted = await store.findAcceptance(user.id, current.version.id);
  return !accepted;
}

export async function createPolicyDraft(
  store: CommercialPolicyStore,
  input: PolicyVersionBody & { effectiveFrom?: Date },
  now: Date
): Promise<{ ok: true; version: StoredVersion } | PolicyFailure> {
  const error = validatePolicyDraft(input);
  if (error) return fail(422, "INVALID_POLICY", error);
  const policy = await store.ensurePolicy();
  const versions = await store.listVersions();
  const next = versions.reduce((max, row) => Math.max(max, row.versionNumber), 0) + 1;
  const version: StoredVersion = {
    ...input,
    id: randomUUID(),
    policyId: policy.id,
    versionNumber: next,
    contentHash: "",
    status: "DRAFT",
    effectiveFrom: input.effectiveFrom ?? now,
    publishedAt: null,
    publishedByUserId: null,
  };
  await store.insertDraft(version);
  return { ok: true, version };
}

export async function publishPolicyVersion(
  store: CommercialPolicyStore,
  versionId: string,
  actorUserId: string,
  now: Date
): Promise<{ ok: true; version: StoredVersion } | PolicyFailure> {
  const version = await store.getVersion(versionId);
  if (!version) return fail(404, "NOT_FOUND", "Versão não encontrada.");
  if (version.status !== "DRAFT") {
    return fail(409, "VERSION_IMMUTABLE", "Versão publicada não pode ser alterada. Crie uma nova versão.");
  }
  const error = validatePolicyDraft(bodyOf(version));
  if (error) return fail(422, "INVALID_POLICY", error);
  const contentHash = hashPolicyContent(bodyOf(version));
  const published = await store.markPublished(version.id, {
    contentHash,
    publishedAt: now,
    publishedByUserId: actorUserId,
  });
  if (!published) return fail(409, "VERSION_IMMUTABLE", "A versão deixou de ser rascunho.");
  await store.retirePublishedExcept(version.policyId, version.id);
  return { ok: true, version: published };
}

export async function publishOfficialCommercialPolicy(
  store: CommercialPolicyStore,
  actorUserId: string,
  now: Date
): Promise<{ ok: true; version: StoredVersion; alreadyPublished: boolean } | PolicyFailure> {
  const hash = officialCommercialPolicyHash();
  const versions = await store.listVersions();
  const existing = versions.find((row) => row.status === "PUBLISHED" && row.contentHash === hash);
  if (existing) return { ok: true, version: existing, alreadyPublished: true };
  const draft = await createPolicyDraft(store, officialCommercialPolicyBody(), now);
  if (draft.ok === false) return draft;
  const published = await publishPolicyVersion(store, draft.version.id, actorUserId, now);
  if (published.ok === false) return published;
  return { ok: true, version: published.version, alreadyPublished: false };
}

export async function readPendingForSeller(
  store: CommercialPolicyStore,
  actor: PolicyActor,
  now: Date
) {
  if (actor.mustChangePassword) {
    return fail(403, "PASSWORD_CHANGE_REQUIRED", "Conclua a troca de senha antes da política.");
  }
  if (actor.role !== COMMERCIAL_POLICY_AUDIENCE) {
    return fail(403, "NOT_REQUIRED", "Esta política não é obrigatória para o seu perfil.");
  }
  const resolved = await loadCurrent(store, now);
  if (resolved.conflict === true) {
    return fail(409, "CONFLICTING_PUBLISHED_VERSIONS", "Há mais de uma versão vigente. Regularize a publicação antes do aceite.");
  }
  const current = resolved.version;
  if (!current) return { ok: true as const, pending: false as const, version: null };
  const accepted = await store.findAcceptance(actor.id, current.id);
  if (accepted) return { ok: true as const, pending: false as const, version: null };
  return { ok: true as const, pending: true as const, version: versionPublicView(current), signer: signerOf(actor) };
}

function signerOf(actor: PolicyActor) {
  return {
    name: actor.name,
    email: actor.email,
    role: actor.role,
    externalSellerId: actor.externalSellerId,
  };
}

export async function recordKnowledgeAttempt(
  store: CommercialPolicyStore,
  actor: PolicyActor,
  input: { policyVersionId: string; answers: SubmittedAnswer[] },
  now: Date
) {
  if (actor.role !== COMMERCIAL_POLICY_AUDIENCE || actor.mustChangePassword) {
    return fail(403, "FORBIDDEN", "O questionário só vale para o vendedor depois da senha pessoal.");
  }
  const resolved = await loadCurrent(store, now);
  if (resolved.conflict === true) {
    return fail(409, "CONFLICTING_PUBLISHED_VERSIONS", "Há mais de uma versão vigente. Regularize a publicação antes do aceite.");
  }
  const current = resolved.version;
  if (!current || current.id !== input.policyVersionId) {
    return fail(409, "VERSION_NOT_CURRENT", "Só é possível responder a versão vigente.");
  }
  const scored = scoreQuestionnaire(current.questions, input.answers);
  const attempt = await store.insertAttempt({
    id: randomUUID(),
    policyVersionId: current.id,
    userId: actor.id,
    attemptNumber: await store.nextAttemptNumber(actor.id, current.id),
    answers: input.answers,
    passed: scored.passed,
    createdAt: now,
  });
  return {
    ok: true as const,
    attemptId: attempt.id,
    attemptNumber: attempt.attemptNumber,
    passed: scored.passed,
    results: scored.results,
  };
}

export async function createSignatureChallenge(
  store: CommercialPolicyStore,
  actor: PolicyActor,
  input: { policyVersionId: string; password: string },
  deps: { now: Date; verifyPassword: (password: string, userId: string) => Promise<boolean> }
) {
  if (actor.role !== COMMERCIAL_POLICY_AUDIENCE || actor.mustChangePassword) {
    return fail(403, "FORBIDDEN", "Reautenticação indisponível neste estado.");
  }
  const resolved = await loadCurrent(store, deps.now);
  if (resolved.conflict === true) {
    return fail(409, "CONFLICTING_PUBLISHED_VERSIONS", "Há mais de uma versão vigente. Regularize a publicação antes do aceite.");
  }
  const current = resolved.version;
  if (!current || current.id !== input.policyVersionId) {
    return fail(409, "VERSION_NOT_CURRENT", "A versão informada não é a vigente.");
  }
  const passed = await store.latestPassedAttempt(actor.id, current.id);
  if (!passed) return fail(422, "QUIZ_NOT_PASSED", "Conclua o teste de compreensão antes de confirmar a identidade.");
  const valid = await deps.verifyPassword(input.password, actor.id);
  if (!valid) return fail(401, "INVALID_CREDENTIALS", "Senha incorreta.");
  const challenge = await store.insertChallenge({
    id: randomUUID(),
    userId: actor.id,
    policyVersionId: current.id,
    expiresAt: new Date(deps.now.getTime() + COMMERCIAL_POLICY_CHALLENGE_TTL_MS),
    usedAt: null,
  });
  return { ok: true as const, challengeId: challenge.id, expiresAt: challenge.expiresAt.toISOString() };
}

export async function saveSignaturePhoto(
  store: CommercialPolicyStore,
  actor: PolicyActor,
  input: { policyVersionId: string; challengeId: string; mimeType: string; imageBase64: string },
  deps: { now: Date; saveFile: (userId: string, bytes: Buffer, fileName: string) => Promise<{ storageKey: string }> }
) {
  if (!COMMERCIAL_POLICY_PHOTO_REQUIRED) {
    return fail(400, "PHOTO_DISABLED", "A captura não está habilitada.");
  }
  const challenge = await store.getChallenge(input.challengeId);
  if (!challenge || challenge.userId !== actor.id || challenge.policyVersionId !== input.policyVersionId) {
    return fail(403, "CHALLENGE_INVALID", "Confirme a identidade de novo antes da foto.");
  }
  if (challenge.usedAt) return fail(409, "CHALLENGE_USED", "Esta confirmação já foi usada.");
  if (challenge.expiresAt.getTime() <= deps.now.getTime()) {
    return fail(401, "CHALLENGE_EXPIRED", "A confirmação expirou. Informe a senha novamente.");
  }
  const bytes = decodePolicyPhoto(input.imageBase64);
  if (!bytes) return fail(422, "INVALID_PHOTO", "A imagem não pôde ser lida.");
  const inspected = inspectPolicyPhoto({ mimeType: input.mimeType, bytes });
  if (inspected.ok === false) return fail(422, "INVALID_PHOTO", inspected.message);
  const saved = await deps.saveFile(actor.id, bytes, inspected.mimeType === "image/png" ? "aceite.png" : "aceite.jpg");
  const photo = await store.insertPhoto({
    id: randomUUID(),
    userId: actor.id,
    policyVersionId: input.policyVersionId,
    challengeId: challenge.id,
    storageKey: saved.storageKey,
    contentHash: sha256Hex(bytes),
    mimeType: inspected.mimeType,
    byteSize: bytes.byteLength,
    linked: false,
  });
  return { ok: true as const, photoId: photo.id, photoHash: photo.contentHash };
}

export async function signCommercialPolicy(
  store: CommercialPolicyStore,
  actor: PolicyActor,
  input: {
    policyVersionId: string;
    challengeId: string;
    photoId: string;
    declarations: string[];
    clientUserId?: string;
  },
  deps: { now: Date; ipAddress: string | null; userAgent: string | null; appCommit: string | null }
): Promise<{ ok: true; acceptance: StoredAcceptance } | PolicyFailure> {
  if (input.clientUserId && input.clientUserId !== actor.id) {
    return fail(403, "SIGNER_MISMATCH", "O signatário é o usuário autenticado.");
  }
  if (actor.role !== COMMERCIAL_POLICY_AUDIENCE || actor.mustChangePassword || !actor.isActive) {
    return fail(403, "FORBIDDEN", "O aceite não está disponível neste estado.");
  }
  const resolved = await loadCurrent(store, deps.now);
  if (resolved.conflict === true) {
    return fail(409, "CONFLICTING_PUBLISHED_VERSIONS", "Há mais de uma versão vigente. Regularize a publicação antes do aceite.");
  }
  const current = resolved.version;
  if (!current || current.id !== input.policyVersionId || current.status !== "PUBLISHED") {
    return fail(409, "VERSION_NOT_CURRENT", "Só é possível assinar a versão vigente.");
  }
  if (!declarationsMatch(current.declarations, input.declarations)) {
    return fail(422, "DECLARATIONS_REQUIRED", "Aceite todas as declarações exatamente como estão na versão.");
  }
  const challenge = await store.getChallenge(input.challengeId);
  if (!challenge || challenge.userId !== actor.id || challenge.policyVersionId !== current.id) {
    return fail(403, "CHALLENGE_INVALID", "Confirme a senha novamente.");
  }
  if (challenge.usedAt) return fail(409, "CHALLENGE_USED", "Esta confirmação já foi usada.");
  if (challenge.expiresAt.getTime() <= deps.now.getTime()) {
    return fail(401, "CHALLENGE_EXPIRED", "A confirmação expirou. Informe a senha novamente.");
  }
  const photo = await store.getPhoto(input.photoId);
  if (!photo || photo.userId !== actor.id || photo.challengeId !== challenge.id || photo.linked) {
    return fail(422, "PHOTO_REQUIRED", "Capture e confirme a imagem antes de assinar.");
  }
  const attempt = await store.latestPassedAttempt(actor.id, current.id);
  if (!attempt) return fail(422, "QUIZ_NOT_PASSED", "O teste ainda não foi aprovado.");

  const evidence = buildEvidenceHash({
    policyVersionId: current.id,
    policyVersion: current.versionNumber,
    policyHash: current.contentHash,
    userId: actor.id,
    userNameSnapshot: actor.name,
    userEmailSnapshot: actor.email,
    role: actor.role,
    sellerExternalId: actor.externalSellerId,
    acceptedAtServer: deps.now.toISOString(),
    ipAddress: deps.ipAddress,
    userAgent: deps.userAgent,
    sessionId: actor.sessionId,
    reauthChallengeId: challenge.id,
    photoHash: photo.contentHash,
    photoStorageReference: photo.storageKey,
    questionnaireAttemptId: attempt.id,
    answers: attempt.answers,
    declarationsAccepted: current.declarations,
    appCommit: deps.appCommit,
  });

  const committed = await store.commitAcceptance({
    id: randomUUID(),
    policyVersionId: current.id,
    userId: actor.id,
    userNameSnapshot: actor.name,
    userEmailSnapshot: actor.email,
    roleSnapshot: actor.role,
    externalSellerIdSnapshot: actor.externalSellerId,
    acceptedAt: deps.now,
    ipAddress: deps.ipAddress,
    userAgent: deps.userAgent,
    sessionId: actor.sessionId,
    challengeId: challenge.id,
    photoEvidenceId: photo.id,
    questionnaireAttemptId: attempt.id,
    declarationsAccepted: [...current.declarations],
    policyContentHash: current.contentHash,
    photoHash: photo.contentHash,
    evidenceHash: evidence.hash,
    appCommit: deps.appCommit,
    canonicalPayload: evidence.payload,
  });
  if (committed.ok === false) {
    return fail(409, committed.code, "Não foi possível registrar o aceite. Nada foi gravado.");
  }
  return { ok: true, acceptance: committed.acceptance };
}

export async function invalidateCommercialPolicyAcceptance(
  store: CommercialPolicyStore,
  input: { acceptanceId: string; actorUserId: string; reason: string },
  now: Date
) {
  const acceptance = await store.getAcceptance(input.acceptanceId);
  if (!acceptance) return fail(404, "NOT_FOUND", "Aceite não encontrado.");
  const reason = input.reason.trim();
  if (!reason) return fail(422, "REASON_REQUIRED", "Informe o motivo da invalidação.");
  const event = await store.insertInvalidation({
    id: randomUUID(),
    acceptanceId: acceptance.id,
    actorUserId: input.actorUserId,
    reason,
    createdAt: now,
  });
  return { ok: true as const, invalidationId: event.id, acceptanceId: acceptance.id };
}

