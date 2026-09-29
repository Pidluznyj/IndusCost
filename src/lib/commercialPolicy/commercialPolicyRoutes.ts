import { randomUUID } from "node:crypto";
import type express from "express";
import type { RequestHandler } from "express";
import { resolveServerAppBuildInfo } from "@/src/lib/appVersion.js";
import { saveAppLocalFile, readAppLocalFile } from "@/src/lib/appLocalFileStorage.js";
import {
  SECURITY_AUDIT_EVENTS,
  normalizeUserAgent,
  resolveAuditIpAddress,
  writeSecurityAuditLog,
} from "@/src/lib/auth/securityAudit.server.js";
import { verifyPassword } from "@/src/lib/auth/appAuth.server.js";
import { prisma } from "@/src/lib/prisma.js";
import { loadCommissionSettings } from "@/src/lib/commissions/commission-settings.server.js";
import {
  acceptanceReceiptLines,
  buildControlledPolicyPdf,
  buildTextPdf,
  policyDocumentLines,
} from "./commercialPolicyPdf.js";
import { createPrismaCommercialPolicyStore } from "./commercialPolicyPrismaStore.js";
import {
  auditPolCom001Publication,
  buildCurrentCommercialPolicyNormativeSnapshot,
  COMMERCIAL_POLICY_DEPENDENCIES,
  comparePublishedPolicyToCurrentNormativeState,
} from "./commercialPolicyNormative.js";
import { officialCommercialPolicyBody } from "./official/polCom001V1.js";
import {
  createPolicyDraft,
  createSignatureChallenge,
  invalidateCommercialPolicyAcceptance,
  openNormativeRevision,
  publishOfficialCommercialPolicy,
  publishPolicyVersion,
  readPendingForSeller,
  recordKnowledgeAttempt,
  saveSignaturePhoto,
  signCommercialPolicy,
  versionPublicView,
  type PolicyActor,
} from "./commercialPolicyService.js";
import type { CommercialPolicyStore } from "./commercialPolicyStore.js";
import { sha256Hex, validatePolicyDraft, type PolicyQuestion, type PolicyVersionBody } from "./commercialPolicyRules.js";
import {
  POL_COM_001_CLASSIFICATION,
  POL_COM_001_CODE,
  POL_COM_001_VERSION_LABEL,
} from "./official/polCom001V1View.js";

type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  mustChangePassword: boolean;
  externalSellerId: number | null;
  sessionId: string;
};

const reauthHits = new Map<string, number[]>();

function reauthAllowed(userId: string, now = Date.now()): boolean {
  const windowMs = 15 * 60 * 1000;
  const hits = (reauthHits.get(userId) ?? []).filter((at) => now - at < windowMs);
  if (hits.length >= 8) {
    reauthHits.set(userId, hits);
    return false;
  }
  hits.push(now);
  reauthHits.set(userId, hits);
  return true;
}

function asActor(user: SessionUser): PolicyActor {
  return user;
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function readQuestions(value: unknown): PolicyQuestion[] {
  if (!Array.isArray(value)) return [];
  return value as PolicyQuestion[];
}

function readBody(value: unknown): PolicyVersionBody {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    title: typeof record.title === "string" ? record.title : "",
    content: typeof record.content === "string" ? record.content : "",
    summaryRules: readStringList(record.summaryRules),
    declarations: readStringList(record.declarations),
    questions: readQuestions(record.questions),
  };
}

export type CommercialPolicyRouteDeps = {
  requireAppAuth: RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<SessionUser | null>;
  store?: CommercialPolicyStore;
  saveFile?: (userId: string, bytes: Buffer, fileName: string) => Promise<{ storageKey: string }>;
  readFile?: (storageKey: string) => Promise<Buffer>;
  now?: () => Date;
  verifyPassword?: (userId: string, password: string) => Promise<boolean>;
  countActiveSellers?: () => Promise<number>;
};

export function registerCommercialPolicyRoutes(app: express.Express, deps: CommercialPolicyRouteDeps): void {
  const store = deps.store ?? createPrismaCommercialPolicyStore();
  const now = deps.now ?? (() => new Date());
  const saveFile =
    deps.saveFile ??
    (async (userId: string, bytes: Buffer, fileName: string) => {
      const saved = await saveAppLocalFile({
        namespace: "commercial-policy-photos",
        entityId: userId,
        originalFileName: fileName,
        buffer: bytes,
      });
      return { storageKey: saved.storageKey };
    });
  const readFile = deps.readFile ?? ((storageKey: string) => readAppLocalFile(storageKey));

  async function actor(req: express.Request, res: express.Response): Promise<PolicyActor | null> {
    const user = await deps.getCurrentAppUser(req);
    if (!user) {
      res.status(401).json({ error: "UNAUTHORIZED", code: "UNAUTHORIZED", message: "Autenticação necessária." });
      return null;
    }
    return asActor(user);
  }

  function superAdmin(user: PolicyActor, res: express.Response): boolean {
    if (user.role === "SUPER_ADMIN") return true;
    res.status(403).json({
      error: "FORBIDDEN",
      code: "FORBIDDEN",
      message: "Apenas um super administrador publica e consulta os aceites de todos.",
    });
    return false;
  }

  app.get("/api/commercial-policy/pending", deps.requireAppAuth, async (req, res) => {
    const user = await actor(req, res);
    if (!user) return;
    const result = await readPendingForSeller(store, user, now());
    if (result.ok === false) return res.status(result.status).json(result);
    return res.json(result);
  });

  app.post("/api/commercial-policy/attempts", deps.requireAppAuth, async (req, res) => {
    const user = await actor(req, res);
    if (!user) return;
    const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
    const result = await recordKnowledgeAttempt(
      store,
      user,
      {
        policyVersionId: String(req.body?.policyVersionId ?? ""),
        answers: answers
          .filter((item: unknown) => item && typeof item === "object")
          .map((item: { questionId?: unknown; optionId?: unknown }) => ({
            questionId: String(item.questionId ?? ""),
            optionId: String(item.optionId ?? ""),
          })),
      },
      now()
    );
    if (result.ok === false) return res.status(result.status).json(result);
    return res.json(result);
  });

  app.post("/api/commercial-policy/reauth", deps.requireAppAuth, async (req, res) => {
    const user = await actor(req, res);
    if (!user) return;
    if (!reauthAllowed(user.id)) {
      return res.status(429).json({ error: "RATE_LIMITED", code: "RATE_LIMITED", message: "Aguarde para tentar de novo." });
    }
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const checkPassword =
      deps.verifyPassword ??
      (async (userId: string, plain: string) => {
        const record = await prisma.appUser.findUnique({
          where: { id: userId },
          select: { passwordHash: true },
        });
        return record ? verifyPassword(plain, record.passwordHash) : false;
      });
    const result = await createSignatureChallenge(
      store,
      user,
      { policyVersionId: String(req.body?.policyVersionId ?? ""), password },
      {
        now: now(),
        verifyPassword: (plain) => checkPassword(user.id, plain),
      }
    );
    if (result.ok === false) return res.status(result.status).json(result);
    return res.json(result);
  });

  app.post("/api/commercial-policy/photo", deps.requireAppAuth, async (req, res) => {
    const user = await actor(req, res);
    if (!user) return;
    const result = await saveSignaturePhoto(
      store,
      user,
      {
        policyVersionId: String(req.body?.policyVersionId ?? ""),
        challengeId: String(req.body?.challengeId ?? ""),
        mimeType: String(req.body?.mimeType ?? ""),
        imageBase64: String(req.body?.imageBase64 ?? ""),
      },
      { now: now(), saveFile }
    );
    if (result.ok === false) return res.status(result.status).json(result);
    return res.json(result);
  });

  app.post("/api/commercial-policy/accept", deps.requireAppAuth, async (req, res) => {
    const user = await actor(req, res);
    if (!user) return;
    const result = await signCommercialPolicy(
      store,
      user,
      {
        policyVersionId: String(req.body?.policyVersionId ?? ""),
        challengeId: String(req.body?.challengeId ?? ""),
        photoId: String(req.body?.photoId ?? ""),
        declarations: readStringList(req.body?.declarations),
        clientUserId: typeof req.body?.userId === "string" ? req.body.userId : undefined,
      },
      {
        now: now(),
        ipAddress: resolveAuditIpAddress(req.socket?.remoteAddress),
        userAgent: normalizeUserAgent(req.headers["user-agent"]),
        appCommit: resolveServerAppBuildInfo().commit,
      }
    );
    if (result.ok === false) return res.status(result.status).json(result);
    return res.json({
      ok: true,
      acceptanceId: result.acceptance.id,
      acceptedAt: result.acceptance.acceptedAt.toISOString(),
      evidenceHash: result.acceptance.evidenceHash,
    });
  });

  app.get("/api/commercial-policy/acceptances/mine", deps.requireAppAuth, async (req, res) => {
    const user = await actor(req, res);
    if (!user) return;
    const rows = await store.listMyAcceptances(user.id);
    return res.json({
      acceptances: rows.map((row) => ({
        id: row.id,
        policyVersionId: row.policyVersionId,
        acceptedAt: row.acceptedAt.toISOString(),
        evidenceHash: row.evidenceHash,
        policyContentHash: row.policyContentHash,
      })),
    });
  });

  app.get("/api/commercial-policy/acceptances/:id/receipt", deps.requireAppAuth, async (req, res) => {
    const user = await actor(req, res);
    if (!user) return;
    const row = await store.getAcceptance(String(req.params.id ?? ""));
    if (!row) return res.status(404).json({ error: "NOT_FOUND", code: "NOT_FOUND", message: "Aceite não encontrado." });
    if (row.userId !== user.id && user.role !== "SUPER_ADMIN") {
      return res.status(404).json({ error: "NOT_FOUND", code: "NOT_FOUND", message: "Aceite não encontrado." });
    }
    const version = await store.getVersion(row.policyVersionId);
    const pdf = buildTextPdf(
      acceptanceReceiptLines({
        acceptanceId: row.id,
        title: version?.title ?? "Política Comercial",
        version: version?.versionNumber ?? 0,
        policyHash: row.policyContentHash,
        signerName: row.userNameSnapshot,
        signerEmail: row.userEmailSnapshot,
        role: row.roleSnapshot,
        externalSellerId: row.externalSellerIdSnapshot,
        acceptedAt: row.acceptedAt.toISOString(),
        ipAddress: row.ipAddress,
        declarations: row.declarationsAccepted,
        quizPassed: true,
        challengeId: row.challengeId,
        photoHash: row.photoHash,
        evidenceHash: row.evidenceHash,
      })
    );
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="aceite-${row.id}.pdf"`);
    res.setHeader("Cache-Control", "no-store");
    return res.send(pdf);
  });

  app.get("/api/commercial-policy/versions/:id/document", deps.requireAppAuth, async (req, res) => {
    const user = await actor(req, res);
    if (!user) return;
    const version = await store.getVersion(String(req.params.id ?? ""));
    if (!version || version.status === "DRAFT") {
      return res.status(404).json({ error: "NOT_FOUND", code: "NOT_FOUND", message: "Documento não encontrado." });
    }
    const mine = await store.findAcceptance(user.id, version.id);
    const current = await store.currentPublished(now());
    const allowed = user.role === "SUPER_ADMIN" || mine || current?.id === version.id;
    if (!allowed || (user.role === "SELLER" && user.mustChangePassword)) {
      return res.status(404).json({ error: "NOT_FOUND", code: "NOT_FOUND", message: "Documento não encontrado." });
    }
    const generatedAt = now();
    const copyId = randomUUID();
    const lines = [
      "CONFIDENCIALIDADE E RESTRIÇÃO DE USO",
      "Este documento contém informações internas de natureza comercial, operacional e estratégica.",
      "A presente cópia destina-se exclusivamente ao uso autorizado no exercício das atividades profissionais do destinatário.",
      "Sua reprodução, distribuição, encaminhamento, exposição ou disponibilização externa sem autorização poderá sujeitar o responsável às medidas administrativas, contratuais e legais cabíveis, observadas as normas aplicáveis.",
      "A posse desta cópia não implica autorização para divulgação.",
      "A versão eletrônica vigente mantida no IndusCost constitui a referência oficial para consulta da política.",
      `${POL_COM_001_CODE} · versão ${POL_COM_001_VERSION_LABEL} · ${POL_COM_001_CLASSIFICATION}`,
      "",
      ...policyDocumentLines({
        title: version.title,
        version: version.versionNumber,
        contentHash: version.contentHash,
        effectiveFrom: version.effectiveFrom.toISOString(),
        publishedAt: version.publishedAt?.toISOString() ?? null,
        content: version.content,
        summaryRules: version.summaryRules,
      }),
    ];
    const copyDigest = sha256Hex(
      `${copyId}|${version.contentHash}|${user.id}|${generatedAt.toISOString()}|${user.email}`
    );
    await store.insertControlledCopy({
      id: copyId,
      policyVersionId: version.id,
      generatedByUserId: user.id,
      generatedAt,
      documentDigest: version.contentHash,
      copyDigest,
      recipientName: user.name,
      recipientEmail: user.email,
    });
    try {
      await writeSecurityAuditLog(prisma, {
        eventType: SECURITY_AUDIT_EVENTS.COMMERCIAL_POLICY_CONTROLLED_COPY,
        actorUserId: user.id,
        targetUserId: user.id,
        ipAddress: resolveAuditIpAddress(req.socket?.remoteAddress),
        userAgent: normalizeUserAgent(req.headers["user-agent"]),
        metadata: { copyId, policyVersionId: version.id, generatedAt: generatedAt.toISOString() },
      });
    } catch (error) {
      console.error("[commercial-policy-copy-audit]", error);
    }
    const pdf = buildControlledPolicyPdf({
      lines,
      copyId,
      recipientName: user.name,
      recipientEmail: user.email,
      generatedAt: generatedAt.toISOString(),
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="POL-COM-001-copia-${copyId}.pdf"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.send(pdf);
  });

  app.get("/api/commercial-policy/photos/:id", deps.requireAppAuth, async (req, res) => {
    const user = await actor(req, res);
    if (!user) return;
    const photo = await store.getPhoto(String(req.params.id ?? ""));
    if (!photo || (photo.userId !== user.id && user.role !== "SUPER_ADMIN")) {
      return res.status(404).json({ error: "NOT_FOUND", code: "NOT_FOUND", message: "Evidência não encontrada." });
    }
    const bytes = await readFile(photo.storageKey);
    res.setHeader("Content-Type", photo.mimeType);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.send(bytes);
  });

  app.post("/api/admin/commercial-policy/official/pol-com-001", deps.requireAppAuth, async (req, res) => {
    const user = await actor(req, res);
    if (!user || !superAdmin(user, res)) return;
    const published = await publishOfficialCommercialPolicy(store, user.id, now());
    if (published.ok === false) return res.status(published.status).json(published);
    return res.status(published.alreadyPublished ? 200 : 201).json({
      alreadyPublished: published.alreadyPublished,
      version: versionPublicView(published.version),
    });
  });

  app.get("/api/admin/commercial-policy/integrity", deps.requireAppAuth, async (req, res) => {
    const user = await actor(req, res);
    if (!user || !superAdmin(user, res)) return;
    const publication = auditPolCom001Publication(officialCommercialPolicyBody().content);
    let release = { releaseDefaultRule: "EACH_RECEIVABLE_PAID", partialPaymentEnabled: true };
    let settingsSource = "DEFAULT";
    try {
      const settings = await loadCommissionSettings(prisma);
      release = {
        releaseDefaultRule: settings.releaseDefaultRule,
        partialPaymentEnabled: settings.partialPaymentEnabled,
      };
      settingsSource = "DATABASE";
    } catch {
      settingsSource = "DEFAULT_DATABASE_UNAVAILABLE";
    }
    const current = buildCurrentCommercialPolicyNormativeSnapshot(release);
    const published = await store.currentPublished(now());
    const compared = comparePublishedPolicyToCurrentNormativeState({
      publishedHash: published?.normativeSnapshotHash || null,
      current,
      publicationAuditBlocking: !publication.ready,
    });
    return res.json({
      status: compared,
      publication: publication.status,
      findings: publication.findings,
      currentRelease: current.commissionRelease,
      settingsSource,
    });
  });

  app.post("/api/admin/commercial-policy/normative-revisions", deps.requireAppAuth, async (req, res) => {
    const user = await actor(req, res);
    if (!user || !superAdmin(user, res)) return;
    const kind = String(req.body?.kind ?? "");
    if (!COMMERCIAL_POLICY_DEPENDENCIES.some((item) => item.key === kind)) {
      return res.status(422).json({ ok: false, code: "INVALID_DEPENDENCY", message: "Dependência normativa desconhecida." });
    }
    const opened = await openNormativeRevision(store, {
      kind: kind as "commission.releaseRule",
      currentLabel: String(req.body?.currentLabel ?? "1.0"),
      release: {
        releaseDefaultRule: String(req.body?.releaseDefaultRule ?? "EACH_RECEIVABLE_PAID"),
        partialPaymentEnabled: req.body?.partialPaymentEnabled !== false,
      },
      oldValue: req.body?.oldValue ?? null,
      newValue: req.body?.newValue ?? null,
      oldDisplayValue: String(req.body?.oldDisplayValue ?? ""),
      newDisplayValue: String(req.body?.newDisplayValue ?? ""),
      reason: String(req.body?.reason ?? ""),
      changedBy: user.id,
      now: now(),
    });
    if (opened.ok === false) return res.status(opened.status).json(opened);
    if (opened.version) {
      try {
        await writeSecurityAuditLog(prisma, {
          eventType: SECURITY_AUDIT_EVENTS.POLICY_DRAFT_CREATED,
          actorUserId: user.id,
          targetUserId: null,
          ipAddress: resolveAuditIpAddress(req.socket?.remoteAddress),
          userAgent: normalizeUserAgent(req.headers["user-agent"]),
          metadata: {
            dependencyKey: kind,
            sourceVersion: String(req.body?.currentLabel ?? "1.0"),
            draftVersionId: opened.version.id,
          },
        });
      } catch (error) {
        console.error("[commercial-policy-normative-audit]", error);
      }
    }
    return res.status(opened.duplicate ? 200 : 201).json({
      impact: opened.impact,
      duplicate: opened.duplicate,
      version: opened.version ? versionPublicView(opened.version) : null,
    });
  });

  app.get("/api/admin/commercial-policy/versions", deps.requireAppAuth, async (req, res) => {
    const user = await actor(req, res);
    if (!user || !superAdmin(user, res)) return;
    const versions = await store.listVersions();
    return res.json({
      versions: versions.map((version) => ({
        ...versionPublicView(version),
        questions: version.questions,
      })),
    });
  });

  app.post("/api/admin/commercial-policy/versions", deps.requireAppAuth, async (req, res) => {
    const user = await actor(req, res);
    if (!user || !superAdmin(user, res)) return;
    const body = readBody(req.body);
    const invalid = validatePolicyDraft(body);
    if (invalid) return res.status(422).json({ error: "INVALID_POLICY", code: "INVALID_POLICY", message: invalid });
    const created = await createPolicyDraft(store, body, now());
    if (created.ok === false) return res.status(created.status).json(created);
    return res.status(201).json({ version: versionPublicView(created.version) });
  });

  app.post("/api/admin/commercial-policy/versions/:id/publish", deps.requireAppAuth, async (req, res) => {
    const user = await actor(req, res);
    if (!user || !superAdmin(user, res)) return;
    const published = await publishPolicyVersion(store, String(req.params.id ?? ""), user.id, now());
    if (published.ok === false) return res.status(published.status).json(published);
    return res.json({ version: versionPublicView(published.version) });
  });

  app.post("/api/admin/commercial-policy/acceptances/:id/invalidate", deps.requireAppAuth, async (req, res) => {
    const user = await actor(req, res);
    if (!user || !superAdmin(user, res)) return;
    const result = await invalidateCommercialPolicyAcceptance(
      store,
      {
        acceptanceId: String(req.params.id ?? ""),
        actorUserId: user.id,
        reason: typeof req.body?.reason === "string" ? req.body.reason : "",
      },
      now()
    );
    if (result.ok === false) return res.status(result.status).json(result);
    return res.json(result);
  });

  app.get("/api/admin/commercial-policy/acceptances", deps.requireAppAuth, async (req, res) => {
    const user = await actor(req, res);
    if (!user || !superAdmin(user, res)) return;
    const rows = await store.listAcceptances();
    let coverage: { required: number; signed: number; pending: number; percent: number } | null = null;
    if (deps.countActiveSellers) {
      const required = await deps.countActiveSellers();
      const current = await store.currentPublished(now());
      const signed = new Set(
        rows.filter((row) => current && row.policyVersionId === current.id).map((row) => row.userId)
      ).size;
      const pending = Math.max(0, required - signed);
      coverage = {
        required,
        signed,
        pending,
        percent: required === 0 ? 0 : Math.round((signed / required) * 100),
      };
    }
    return res.json({
      coverage,
      acceptances: rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        userNameSnapshot: row.userNameSnapshot,
        userEmailSnapshot: row.userEmailSnapshot,
        policyVersionId: row.policyVersionId,
        acceptedAt: row.acceptedAt.toISOString(),
        evidenceHash: row.evidenceHash,
        photoHash: row.photoHash,
        ipAddress: row.ipAddress,
      })),
    });
  });
}
