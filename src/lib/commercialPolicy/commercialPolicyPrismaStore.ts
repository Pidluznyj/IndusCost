import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import type { PolicyChange } from "./commercialPolicyNormative.js";
import {
  COMMERCIAL_POLICY_AUDIENCE,
  COMMERCIAL_POLICY_TYPE,
  type PolicyQuestion,
  type PolicyVersionBody,
} from "./commercialPolicyRules.js";
import type {
  CommercialPolicyStore,
  StoredAcceptance,
  StoredAttempt,
  StoredPhoto,
  StoredVersion,
} from "./commercialPolicyStore.js";

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asQuestions(value: unknown): PolicyQuestion[] {
  if (!Array.isArray(value)) return [];
  return value as PolicyQuestion[];
}

function asAnswers(value: unknown): Array<{ questionId: string; optionId: string }> {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is { questionId: string; optionId: string } =>
      !!item &&
      typeof item === "object" &&
      typeof (item as { questionId?: unknown }).questionId === "string" &&
      typeof (item as { optionId?: unknown }).optionId === "string"
  );
}

function mapVersion(row: {
  id: string;
  policyId: string;
  versionNumber: number;
  title: string;
  content: string;
  summaryRules: unknown;
  declarations: unknown;
  questions: unknown;
  contentHash: string;
  normativeSnapshot: unknown;
  normativeSnapshotHash: string;
  changeSet: unknown;
  changeSetHash: string;
  previousVersionId: string | null;
  status: "DRAFT" | "PUBLISHED" | "RETIRED";
  effectiveFrom: Date;
  publishedAt: Date | null;
  publishedByUserId: string | null;
}): StoredVersion {
  return {
    id: row.id,
    policyId: row.policyId,
    versionNumber: row.versionNumber,
    title: row.title,
    content: row.content,
    summaryRules: asStringList(row.summaryRules),
    declarations: asStringList(row.declarations),
    questions: asQuestions(row.questions),
    contentHash: row.contentHash,
    normativeSnapshot: row.normativeSnapshot,
    normativeSnapshotHash: row.normativeSnapshotHash,
    changeSet: Array.isArray(row.changeSet) ? (row.changeSet as PolicyChange[]) : [],
    changeSetHash: row.changeSetHash,
    previousVersionId: row.previousVersionId,
    status: row.status,
    effectiveFrom: row.effectiveFrom,
    publishedAt: row.publishedAt,
    publishedByUserId: row.publishedByUserId,
  };
}

function mapAcceptance(row: {
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
  declarationsAccepted: unknown;
  policyContentHash: string;
  normativeSnapshotHash: string;
  changeSetHash: string;
  photoHash: string;
  evidenceHash: string;
  appCommit: string | null;
  canonicalPayload: unknown;
}): StoredAcceptance {
  return {
    ...row,
    declarationsAccepted: asStringList(row.declarationsAccepted),
  };
}

export function createPrismaCommercialPolicyStore(client: PrismaClient = prisma): CommercialPolicyStore {
  return {
    async ensurePolicy() {
      const existing = await client.commercialPolicy.findUnique({
        where: { policyType: COMMERCIAL_POLICY_TYPE },
      });
      if (existing) return { id: existing.id };
      const created = await client.commercialPolicy.create({
        data: { policyType: COMMERCIAL_POLICY_TYPE, audienceRole: COMMERCIAL_POLICY_AUDIENCE },
      });
      return { id: created.id };
    },
    async listVersions() {
      const rows = await client.commercialPolicyVersion.findMany({ orderBy: { versionNumber: "asc" } });
      return rows.map(mapVersion);
    },
    async getVersion(id) {
      const row = await client.commercialPolicyVersion.findUnique({ where: { id } });
      return row ? mapVersion(row) : null;
    },
    async insertDraft(row) {
      const created = await client.commercialPolicyVersion.create({
        data: {
          id: row.id,
          policyId: row.policyId,
          versionNumber: row.versionNumber,
          title: row.title,
          content: row.content,
          summaryRules: row.summaryRules,
          declarations: row.declarations,
          questions: row.questions,
          contentHash: "",
          normativeSnapshotHash: "",
          changeSetHash: "",
          status: "DRAFT",
          effectiveFrom: row.effectiveFrom,
        },
      });
      return mapVersion(created);
    },
    async saveDraft(id, body: PolicyVersionBody, effectiveFrom) {
      const current = await client.commercialPolicyVersion.findUnique({ where: { id } });
      if (!current || current.status !== "DRAFT") return null;
      const updated = await client.commercialPolicyVersion.update({
        where: { id },
        data: {
          title: body.title,
          content: body.content,
          summaryRules: body.summaryRules,
          declarations: body.declarations,
          questions: body.questions,
          effectiveFrom,
        },
      });
      return mapVersion(updated);
    },
    async attachNormative(id, patch) {
      const current = await client.commercialPolicyVersion.findUnique({ where: { id } });
      if (!current || current.status !== "DRAFT") return null;
      const updated = await client.commercialPolicyVersion.update({
        where: { id },
        data: {
          normativeSnapshot: patch.normativeSnapshot as Prisma.InputJsonValue,
          normativeSnapshotHash: patch.normativeSnapshotHash,
          changeSet: patch.changeSet as unknown as Prisma.InputJsonValue,
          changeSetHash: patch.changeSetHash,
          previousVersionId: patch.previousVersionId,
        },
      });
      return mapVersion(updated);
    },
    async retireDraft(id) {
      const current = await client.commercialPolicyVersion.findUnique({ where: { id } });
      if (!current || current.status !== "DRAFT") return null;
      const updated = await client.commercialPolicyVersion.update({
        where: { id },
        data: { status: "RETIRED" },
      });
      return mapVersion(updated);
    },
    async currentPublished(now) {
      const row = await client.commercialPolicyVersion.findFirst({
        where: { status: "PUBLISHED", effectiveFrom: { lte: now } },
        orderBy: { versionNumber: "desc" },
      });
      return row ? mapVersion(row) : null;
    },
    async countEffectivePublished(now) {
      return client.commercialPolicyVersion.count({
        where: { status: "PUBLISHED", effectiveFrom: { lte: now } },
      });
    },
    async insertControlledCopy(row) {
      const created = await client.commercialPolicyControlledCopy.create({
        data: {
          id: row.id,
          policyVersionId: row.policyVersionId,
          generatedByUserId: row.generatedByUserId,
          generatedAt: row.generatedAt,
          documentDigest: row.documentDigest,
          copyDigest: row.copyDigest,
          recipientName: row.recipientName,
          recipientEmail: row.recipientEmail,
        },
      });
      return {
        id: created.id,
        policyVersionId: created.policyVersionId,
        generatedByUserId: created.generatedByUserId,
        generatedAt: created.generatedAt,
        documentDigest: created.documentDigest,
        copyDigest: created.copyDigest,
        recipientName: created.recipientName,
        recipientEmail: created.recipientEmail,
      };
    },
    async retirePublishedExcept(policyId, keepId) {
      await client.commercialPolicyVersion.updateMany({
        where: { policyId, status: "PUBLISHED", id: { not: keepId } },
        data: { status: "RETIRED" },
      });
    },
    async retirePublishedEffectiveBefore(policyId, effectiveBefore, keepId) {
      await client.commercialPolicyVersion.updateMany({
        where: { policyId, status: "PUBLISHED", id: { not: keepId }, effectiveFrom: { lt: effectiveBefore } },
        data: { status: "RETIRED" },
      });
    },
    async markPublished(id, patch) {
      const updated = await client.commercialPolicyVersion.updateMany({
        where: { id, status: "DRAFT" },
        data: {
          status: "PUBLISHED",
          contentHash: patch.contentHash,
          publishedAt: patch.publishedAt,
          publishedByUserId: patch.publishedByUserId,
          ...(patch.effectiveFrom ? { effectiveFrom: patch.effectiveFrom } : {}),
        },
      });
      if (updated.count !== 1) return null;
      const row = await client.commercialPolicyVersion.findUnique({ where: { id } });
      return row ? mapVersion(row) : null;
    },
    async findAcceptance(userId, versionId) {
      const row = await client.commercialPolicyAcceptance.findUnique({
        where: { policyVersionId_userId: { policyVersionId: versionId, userId } },
      });
      return row ? mapAcceptance(row) : null;
    },
    async getAcceptance(id) {
      const row = await client.commercialPolicyAcceptance.findUnique({ where: { id } });
      return row ? mapAcceptance(row) : null;
    },
    async listAcceptances() {
      const rows = await client.commercialPolicyAcceptance.findMany({ orderBy: { acceptedAt: "desc" } });
      return rows.map(mapAcceptance);
    },
    async listMyAcceptances(userId) {
      const rows = await client.commercialPolicyAcceptance.findMany({
        where: { userId },
        orderBy: { acceptedAt: "desc" },
      });
      return rows.map(mapAcceptance);
    },
    async nextAttemptNumber(userId, versionId) {
      const count = await client.commercialPolicyKnowledgeAttempt.count({
        where: { userId, policyVersionId: versionId },
      });
      return count + 1;
    },
    async insertAttempt(row: StoredAttempt) {
      const created = await client.commercialPolicyKnowledgeAttempt.create({
        data: {
          id: row.id,
          policyVersionId: row.policyVersionId,
          userId: row.userId,
          attemptNumber: row.attemptNumber,
          answers: row.answers,
          passed: row.passed,
          createdAt: row.createdAt,
        },
      });
      return {
        ...row,
        id: created.id,
        createdAt: created.createdAt,
        answers: asAnswers(created.answers),
      };
    },
    async getAttempt(id) {
      const row = await client.commercialPolicyKnowledgeAttempt.findUnique({ where: { id } });
      if (!row) return null;
      return { ...row, answers: asAnswers(row.answers) };
    },
    async latestPassedAttempt(userId, versionId) {
      const row = await client.commercialPolicyKnowledgeAttempt.findFirst({
        where: { userId, policyVersionId: versionId, passed: true },
        orderBy: { createdAt: "desc" },
      });
      if (!row) return null;
      return { ...row, answers: asAnswers(row.answers) };
    },
    async insertChallenge(row) {
      await client.commercialPolicySignatureChallenge.create({ data: row });
      return row;
    },
    async getChallenge(id) {
      return client.commercialPolicySignatureChallenge.findUnique({ where: { id } });
    },
    async insertPhoto(row: StoredPhoto) {
      await client.commercialPolicyPhotoEvidence.create({
        data: {
          id: row.id,
          userId: row.userId,
          policyVersionId: row.policyVersionId,
          challengeId: row.challengeId,
          storageKey: row.storageKey,
          contentHash: row.contentHash,
          mimeType: row.mimeType,
          byteSize: row.byteSize,
        },
      });
      return row;
    },
    async getPhoto(id) {
      const row = await client.commercialPolicyPhotoEvidence.findUnique({
        where: { id },
        include: { acceptance: { select: { id: true } } },
      });
      if (!row) return null;
      return {
        id: row.id,
        userId: row.userId,
        policyVersionId: row.policyVersionId,
        challengeId: row.challengeId,
        storageKey: row.storageKey,
        contentHash: row.contentHash,
        mimeType: row.mimeType,
        byteSize: row.byteSize,
        linked: !!row.acceptance,
      };
    },
    async commitAcceptance(row) {
      try {
        return await client.$transaction(async (tx) => {
          const challenge = await tx.commercialPolicySignatureChallenge.findUnique({
            where: { id: row.challengeId },
          });
          if (!challenge || challenge.usedAt) return { ok: false as const, code: "USED" as const };
          if (challenge.expiresAt.getTime() <= row.acceptedAt.getTime()) {
            return { ok: false as const, code: "EXPIRED" as const };
          }
          const photo = await tx.commercialPolicyPhotoEvidence.findUnique({ where: { id: row.photoEvidenceId } });
          if (!photo) return { ok: false as const, code: "PHOTO_USED" as const };
          const photoUsed = await tx.commercialPolicyAcceptance.findUnique({
            where: { photoEvidenceId: row.photoEvidenceId },
          });
          if (photoUsed) return { ok: false as const, code: "PHOTO_USED" as const };
          const existing = await tx.commercialPolicyAcceptance.findUnique({
            where: {
              policyVersionId_userId: { policyVersionId: row.policyVersionId, userId: row.userId },
            },
          });
          if (existing) return { ok: false as const, code: "CONFLICT" as const };
          const created = await tx.commercialPolicyAcceptance.create({
            data: {
              id: row.id,
              policyVersionId: row.policyVersionId,
              userId: row.userId,
              userNameSnapshot: row.userNameSnapshot,
              userEmailSnapshot: row.userEmailSnapshot,
              roleSnapshot: row.roleSnapshot,
              externalSellerIdSnapshot: row.externalSellerIdSnapshot,
              acceptedAt: row.acceptedAt,
              ipAddress: row.ipAddress,
              userAgent: row.userAgent,
              sessionId: row.sessionId,
              challengeId: row.challengeId,
              photoEvidenceId: row.photoEvidenceId,
              questionnaireAttemptId: row.questionnaireAttemptId,
              declarationsAccepted: row.declarationsAccepted,
              policyContentHash: row.policyContentHash,
              normativeSnapshotHash: row.normativeSnapshotHash ?? "",
              changeSetHash: row.changeSetHash ?? "",
              photoHash: row.photoHash,
              evidenceHash: row.evidenceHash,
              appCommit: row.appCommit,
              canonicalPayload: row.canonicalPayload as object,
            },
          });
          await tx.commercialPolicySignatureChallenge.update({
            where: { id: row.challengeId },
            data: { usedAt: row.acceptedAt },
          });
          return { ok: true as const, acceptance: mapAcceptance(created) };
        });
      } catch {
        return { ok: false as const, code: "CONFLICT" as const };
      }
    },
    async insertInvalidation(row) {
      await client.commercialPolicyAcceptanceInvalidation.create({ data: row });
      return row;
    },
  };
}
