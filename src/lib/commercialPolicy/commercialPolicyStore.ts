import type { PolicyChange } from "./commercialPolicyNormative.js";
import type { PolicyQuestion, PolicyVersionBody } from "./commercialPolicyRules.js";

export type StoredVersion = PolicyVersionBody & {
  id: string;
  policyId: string;
  versionNumber: number;
  contentHash: string;
  status: "DRAFT" | "PUBLISHED" | "RETIRED";
  effectiveFrom: Date;
  publishedAt: Date | null;
  publishedByUserId: string | null;
  normativeSnapshot?: unknown;
  normativeSnapshotHash?: string;
  changeSet?: PolicyChange[];
  changeSetHash?: string;
  previousVersionId?: string | null;
};

export type StoredAttempt = {
  id: string;
  policyVersionId: string;
  userId: string;
  attemptNumber: number;
  answers: Array<{ questionId: string; optionId: string }>;
  passed: boolean;
  createdAt: Date;
};

export type StoredChallenge = {
  id: string;
  userId: string;
  policyVersionId: string;
  expiresAt: Date;
  usedAt: Date | null;
};

export type StoredPhoto = {
  id: string;
  userId: string;
  policyVersionId: string;
  challengeId: string;
  storageKey: string;
  contentHash: string;
  mimeType: string;
  byteSize: number;
  linked: boolean;
};

export type StoredAcceptance = {
  id: string;
  policyVersionId: string;
  userId: string;
  userNameSnapshot: string;
  userEmailSnapshot: string;
  roleSnapshot: string;
  externalSellerIdSnapshot: number | null;
  acceptedAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
  sessionId: string;
  challengeId: string;
  photoEvidenceId: string;
  questionnaireAttemptId: string;
  declarationsAccepted: string[];
  policyContentHash: string;
  normativeSnapshotHash?: string;
  changeSetHash?: string;
  photoHash: string;
  evidenceHash: string;
  appCommit: string | null;
  canonicalPayload: unknown;
};

export type StoredInvalidation = {
  id: string;
  acceptanceId: string;
  actorUserId: string;
  reason: string;
  createdAt: Date;
};

export type StoredControlledCopy = {
  id: string;
  policyVersionId: string;
  generatedByUserId: string;
  generatedAt: Date;
  documentDigest: string;
  copyDigest: string;
  recipientName: string;
  recipientEmail: string;
};

export type CommercialPolicyStore = {
  ensurePolicy(): Promise<{ id: string }>;
  listVersions(): Promise<StoredVersion[]>;
  getVersion(id: string): Promise<StoredVersion | null>;
  insertDraft(row: StoredVersion): Promise<StoredVersion>;
  saveDraft(id: string, body: PolicyVersionBody, effectiveFrom: Date): Promise<StoredVersion | null>;
  currentPublished(now: Date): Promise<StoredVersion | null>;
  countEffectivePublished(now: Date): Promise<number>;
  insertControlledCopy(row: StoredControlledCopy): Promise<StoredControlledCopy>;
  retirePublishedExcept(policyId: string, keepId: string): Promise<void>;
  /** Vigência prospectiva: aposenta as publicadas com effectiveFrom anterior à da versão que passou a vigorar. */
  retirePublishedEffectiveBefore(policyId: string, effectiveBefore: Date, keepId: string): Promise<void>;
  markPublished(id: string, patch: { contentHash: string; publishedAt: Date; publishedByUserId: string }): Promise<StoredVersion | null>;
  attachNormative(id: string, patch: {
    normativeSnapshot: unknown;
    normativeSnapshotHash: string;
    changeSet: PolicyChange[];
    changeSetHash: string;
    previousVersionId: string | null;
  }): Promise<StoredVersion | null>;
  retireDraft(id: string): Promise<StoredVersion | null>;
  findAcceptance(userId: string, versionId: string): Promise<StoredAcceptance | null>;
  getAcceptance(id: string): Promise<StoredAcceptance | null>;
  listAcceptances(): Promise<StoredAcceptance[]>;
  listMyAcceptances(userId: string): Promise<StoredAcceptance[]>;
  nextAttemptNumber(userId: string, versionId: string): Promise<number>;
  insertAttempt(row: StoredAttempt): Promise<StoredAttempt>;
  getAttempt(id: string): Promise<StoredAttempt | null>;
  latestPassedAttempt(userId: string, versionId: string): Promise<StoredAttempt | null>;
  insertChallenge(row: StoredChallenge): Promise<StoredChallenge>;
  getChallenge(id: string): Promise<StoredChallenge | null>;
  insertPhoto(row: StoredPhoto): Promise<StoredPhoto>;
  getPhoto(id: string): Promise<StoredPhoto | null>;
  commitAcceptance(row: StoredAcceptance): Promise<{ ok: true; acceptance: StoredAcceptance } | { ok: false; code: "CONFLICT" | "EXPIRED" | "USED" | "PHOTO_USED" }>;
  insertInvalidation(row: StoredInvalidation): Promise<StoredInvalidation>;
};

export function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`;
}

export function createMemoryCommercialPolicyStore(): CommercialPolicyStore & {
  versions: StoredVersion[];
  acceptances: StoredAcceptance[];
  challenges: StoredChallenge[];
  photos: StoredPhoto[];
  attempts: StoredAttempt[];
  failCommit: boolean;
} {
  const versions: StoredVersion[] = [];
  const acceptances: StoredAcceptance[] = [];
  const challenges: StoredChallenge[] = [];
  const photos: StoredPhoto[] = [];
  const attempts: StoredAttempt[] = [];
  const invalidations: StoredInvalidation[] = [];
  const copies: StoredControlledCopy[] = [];
  let policyId = "policy-1";
  const state = { failCommit: false };

  const store: CommercialPolicyStore & {
    versions: StoredVersion[];
    acceptances: StoredAcceptance[];
    challenges: StoredChallenge[];
    photos: StoredPhoto[];
    attempts: StoredAttempt[];
    failCommit: boolean;
  } = {
    versions,
    acceptances,
    challenges,
    photos,
    attempts,
    get failCommit() {
      return state.failCommit;
    },
    set failCommit(value: boolean) {
      state.failCommit = value;
    },
    async ensurePolicy() {
      return { id: policyId };
    },
    async listVersions() {
      return versions.map((row) => ({ ...row, questions: row.questions.map((q) => ({ ...q })) }));
    },
    async getVersion(id) {
      return versions.find((row) => row.id === id) ?? null;
    },
    async insertDraft(row) {
      versions.push(row);
      return row;
    },
    async saveDraft(id, body, effectiveFrom) {
      const row = versions.find((item) => item.id === id);
      if (!row || row.status !== "DRAFT") return null;
      row.title = body.title;
      row.content = body.content;
      row.summaryRules = body.summaryRules;
      row.declarations = body.declarations;
      row.questions = body.questions;
      row.effectiveFrom = effectiveFrom;
      return row;
    },
    async currentPublished(now) {
      const published = versions
        .filter((row) => row.status === "PUBLISHED" && row.effectiveFrom.getTime() <= now.getTime())
        .sort((a, b) => b.versionNumber - a.versionNumber);
      return published[0] ?? null;
    },
    async countEffectivePublished(now) {
      return versions.filter((row) => row.status === "PUBLISHED" && row.effectiveFrom.getTime() <= now.getTime()).length;
    },
    async insertControlledCopy(row) {
      copies.push(row);
      return row;
    },
    async retirePublishedExcept(policyIdValue, keepId) {
      for (const row of versions) {
        if (row.policyId === policyIdValue && row.id !== keepId && row.status === "PUBLISHED") {
          row.status = "RETIRED";
        }
      }
    },
    async retirePublishedEffectiveBefore(policyIdValue, effectiveBefore, keepId) {
      for (const row of versions) {
        if (
          row.policyId === policyIdValue &&
          row.id !== keepId &&
          row.status === "PUBLISHED" &&
          row.effectiveFrom.getTime() < effectiveBefore.getTime()
        ) {
          row.status = "RETIRED";
        }
      }
    },
    async markPublished(id, patch) {
      const row = versions.find((item) => item.id === id);
      if (!row || row.status !== "DRAFT") return null;
      row.status = "PUBLISHED";
      row.contentHash = patch.contentHash;
      row.publishedAt = patch.publishedAt;
      row.publishedByUserId = patch.publishedByUserId;
      return row;
    },
    async attachNormative(id, patch) {
      const row = versions.find((item) => item.id === id);
      if (!row || row.status !== "DRAFT") return null;
      row.normativeSnapshot = patch.normativeSnapshot;
      row.normativeSnapshotHash = patch.normativeSnapshotHash;
      row.changeSet = patch.changeSet;
      row.changeSetHash = patch.changeSetHash;
      row.previousVersionId = patch.previousVersionId;
      return row;
    },
    async retireDraft(id) {
      const row = versions.find((item) => item.id === id);
      if (!row || row.status !== "DRAFT") return null;
      row.status = "RETIRED";
      return row;
    },
    async findAcceptance(userId, versionId) {
      return acceptances.find((row) => row.userId === userId && row.policyVersionId === versionId) ?? null;
    },
    async getAcceptance(id) {
      return acceptances.find((row) => row.id === id) ?? null;
    },
    async listAcceptances() {
      return [...acceptances];
    },
    async listMyAcceptances(userId) {
      return acceptances.filter((row) => row.userId === userId);
    },
    async nextAttemptNumber(userId, versionId) {
      const mine = attempts.filter((row) => row.userId === userId && row.policyVersionId === versionId);
      return mine.length + 1;
    },
    async insertAttempt(row) {
      attempts.push(row);
      return row;
    },
    async getAttempt(id) {
      return attempts.find((row) => row.id === id) ?? null;
    },
    async latestPassedAttempt(userId, versionId) {
      const passed = attempts
        .filter((row) => row.userId === userId && row.policyVersionId === versionId && row.passed)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return passed[0] ?? null;
    },
    async insertChallenge(row) {
      challenges.push(row);
      return row;
    },
    async getChallenge(id) {
      return challenges.find((row) => row.id === id) ?? null;
    },
    async insertPhoto(row) {
      photos.push(row);
      return row;
    },
    async getPhoto(id) {
      return photos.find((row) => row.id === id) ?? null;
    },
    async commitAcceptance(row) {
      if (state.failCommit) return { ok: false, code: "CONFLICT" };
      const challenge = challenges.find((item) => item.id === row.challengeId);
      if (!challenge || challenge.usedAt) return { ok: false, code: "USED" };
      if (challenge.expiresAt.getTime() <= row.acceptedAt.getTime()) return { ok: false, code: "EXPIRED" };
      const photo = photos.find((item) => item.id === row.photoEvidenceId);
      if (!photo || photo.linked) return { ok: false, code: "PHOTO_USED" };
      if (acceptances.some((item) => item.userId === row.userId && item.policyVersionId === row.policyVersionId)) {
        return { ok: false, code: "CONFLICT" };
      }
      challenge.usedAt = row.acceptedAt;
      photo.linked = true;
      acceptances.push(row);
      return { ok: true, acceptance: row };
    },
    async insertInvalidation(row) {
      invalidations.push(row);
      return row;
    },
  };
  void policyId;
  void invalidations;
  return store;
}

export type { PolicyQuestion };
