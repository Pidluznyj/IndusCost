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
  buildTextPdf,
} from "./commercialPolicyPdf.js";
import { buildControlledCopyPdf } from "./commercialPolicyControlledCopyPdf.js";
import { loadCommissionMatrixFromPriceTables } from "./commercialPolicyCommissionMatrix.server.js";
import type { PolicyAutoFieldContext } from "./policyAutoFields.js";
import { createPrismaCommercialPolicyStore } from "./commercialPolicyPrismaStore.js";
import {
  auditPolCom001Publication,
  buildCurrentCommercialPolicyNormativeSnapshot,
  buildPolCom001ReconciliationMatrix,
  COMMERCIAL_POLICY_DEPENDENCIES,
  compareDraftToCurrentNormativeState,
  comparePublishedPolicyToCurrentNormativeState,
  normativeSnapshotHash,
  sectionsAffectedByChanges,
  type CommissionMatrixInput,
  type NormativeSnapshot,
  type ReleaseNormativeInput,
} from "./commercialPolicyNormative.js";
import { officialCommercialPolicyBody, officialCommercialPolicyHash } from "./official/polCom001V1.js";
import {
  createDraftFromOfficialPolicy,
  createPolicyDraft,
  createSignatureChallenge,
  discardPolicyDraft,
  duplicatePolicyVersion,
  findPendingRevisionDraft,
  updatePolicyDraft,
  invalidateCommercialPolicyAcceptance,
  openNormativeRevision,
  publishOfficialCommercialPolicy,
  publishPolicyVersion,
  readPendingForSeller,
  recordKnowledgeAttempt,
  saveSignaturePhoto,
  signCommercialPolicy,
  versionAdminView,
  versionLabelOf,
  versionPublicView,
  type PolicyActor,
} from "./commercialPolicyService.js";
import type { CommercialPolicyStore, StoredAcceptance, StoredVersion } from "./commercialPolicyStore.js";
import { COMMERCIAL_POLICY_AUDIENCE, sha256Hex, validatePolicyDraft, type PolicyQuestion, type PolicyVersionBody } from "./commercialPolicyRules.js";
import {
  POL_COM_001_CLASSIFICATION,
  POL_COM_001_CNPJ,
  POL_COM_001_CODE,
  POL_COM_001_COMPANY,
  POL_COM_001_TITLE,
  POL_COM_001_VERSION_LABEL,
} from "./official/polCom001V1View.js";

const CONTROLLED_COPY_NOTICE = [
  "CONFIDENCIALIDADE E RESTRIÇÃO DE USO",
  "Este documento contém informações internas de natureza comercial, operacional e estratégica.",
  "A presente cópia destina-se exclusivamente ao uso autorizado no exercício das atividades profissionais do destinatário.",
  "Sua reprodução, distribuição, encaminhamento, exposição ou disponibilização externa sem autorização poderá sujeitar o responsável às medidas administrativas, contratuais e legais cabíveis, observadas as normas aplicáveis.",
  "A posse desta cópia não implica autorização para divulgação.",
  "A versão eletrônica vigente mantida no IndusCost constitui a referência oficial para consulta da política.",
];

/** Identificação fixa do documento impressa em toda cópia controlada. */
const CONTROLLED_COPY_IDENTITY = {
  code: POL_COM_001_CODE,
  company: POL_COM_001_COMPANY,
  cnpj: POL_COM_001_CNPJ,
  classification: POL_COM_001_CLASSIFICATION,
  notice: CONTROLLED_COPY_NOTICE,
};

export type PublicationStatus = "NOT_PUBLISHED" | "AWAITING_COMPATIBILIZATION" | "READY_FOR_PUBLICATION" | "PUBLISHED";

export function resolvePublicationStatus(input: { published: boolean; blockers: number }): PublicationStatus {
  if (input.published) return "PUBLISHED";
  if (input.blockers > 0) return "AWAITING_COMPATIBILIZATION";
  return "READY_FOR_PUBLICATION";
}

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
  /** Fonte oficial da regra de liberação (CommissionSettings). Nos testes, injetada. */
  loadRelease?: () => Promise<ReleaseNormativeInput>;
  /** Matriz de comissão lida das tabelas publicadas da Formação de Preço. Nos testes, injetada. */
  loadCommissionMatrix?: (at: Date) => Promise<CommissionMatrixInput | null>;
  /** Nome e perfil de quem publicou a versão (aprovação eletrônica). Nos testes, injetada. */
  loadUserIdentity?: (userId: string) => Promise<{ name: string; role: string } | null>;
};

/**
 * Vigência informada pelo administrador ("AAAA-MM-DD", dia civil de Brasília).
 * A política só tem efeito prospectivo: data anterior a hoje é recusada.
 */
export function parsePublicationEffectiveDate(
  value: unknown,
  now: Date
): { ok: true; effectiveFrom: Date } | { ok: false; code: string; message: string } {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { ok: false, code: "EFFECTIVE_FROM_REQUIRED", message: "Informe a data de vigência para publicar." };
  }
  const effectiveFrom = new Date(`${value}T00:00:00-03:00`);
  if (Number.isNaN(effectiveFrom.getTime())) {
    return { ok: false, code: "EFFECTIVE_FROM_REQUIRED", message: "Data de vigência inválida." };
  }
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
  if (value < today) {
    return { ok: false, code: "EFFECTIVE_FROM_IN_PAST", message: "A vigência não pode ser anterior à data da publicação." };
  }
  return { ok: true, effectiveFrom };
}

export function registerCommercialPolicyRoutes(app: express.Express, deps: CommercialPolicyRouteDeps): void {
  const store = deps.store ?? createPrismaCommercialPolicyStore();
  const now = deps.now ?? (() => new Date());
  const loadRelease =
    deps.loadRelease ??
    (async (): Promise<ReleaseNormativeInput> => {
      const settings = await loadCommissionSettings(prisma);
      return {
        releaseDefaultRule: settings.releaseDefaultRule,
        partialPaymentEnabled: settings.partialPaymentEnabled,
      };
    });
  const loadCommissionMatrix = deps.loadCommissionMatrix ?? ((at: Date) => loadCommissionMatrixFromPriceTables(prisma, at));
  const loadUserIdentity =
    deps.loadUserIdentity ??
    ((userId: string) => prisma.appUser.findUnique({ where: { id: userId }, select: { name: true, role: true } }));

  /** Snapshot normativo atual; sem banco, o snapshot fica nulo e a auditoria registra WARNING em vez de fingir alinhamento. */
  async function currentNormativeState(): Promise<{ snapshot: NormativeSnapshot | null; settingsSource: string }> {
    try {
      const release = await loadRelease();
      // Tabelas ilegíveis = matriz não conferida (a auditoria bloqueia); nunca "alinhada" por omissão.
      const matrix = await loadCommissionMatrix(now()).catch(() => null);
      return { snapshot: buildCurrentCommercialPolicyNormativeSnapshot(release, matrix), settingsSource: "DATABASE" };
    } catch {
      return { snapshot: null, settingsSource: "DATABASE_UNAVAILABLE" };
    }
  }

  const identityCache = new Map<string, { name: string; role: string } | null>();
  /** Quem publicou a versão: é a aprovação eletrônica impressa no documento. */
  async function approverOf(version: { publishedByUserId: string | null } | null): Promise<{ name: string; role: string } | null> {
    const userId = version?.publishedByUserId;
    if (!userId) return null;
    if (!identityCache.has(userId)) {
      identityCache.set(userId, await loadUserIdentity(userId).catch(() => null));
    }
    return identityCache.get(userId) ?? null;
  }

  async function adminView(version: StoredVersion) {
    return { ...versionAdminView(version), approver: await approverOf(version) };
  }

  /** Dados reais que preenchem as lacunas do documento (datas, aprovação e termo de ciência). */
  async function autoFieldsFor(input: {
    version: StoredVersion | null;
    label: string;
    user: PolicyActor;
    acceptance: StoredAcceptance | null;
    at: Date;
  }): Promise<PolicyAutoFieldContext> {
    const { version, acceptance, user } = input;
    const published = version && version.status !== "DRAFT" ? version : null;
    return {
      versionLabel: input.label,
      publishedAt: published?.publishedAt?.toISOString() ?? null,
      effectiveFrom: published?.effectiveFrom.toISOString() ?? null,
      approver: await approverOf(published),
      signer: acceptance
        ? { name: acceptance.userNameSnapshot, email: acceptance.userEmailSnapshot, role: acceptance.roleSnapshot }
        : user.role === COMMERCIAL_POLICY_AUDIENCE
          ? { name: user.name, email: user.email, role: user.role }
          : null,
      acceptance: acceptance
        ? { id: acceptance.id, acceptedAt: acceptance.acceptedAt.toISOString(), evidenceHash: acceptance.evidenceHash }
        : null,
      today: input.at.toISOString(),
    };
  }

  function sendControlledCopy(res: express.Response, pdf: Buffer, copyId: string): express.Response {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="POL-COM-001-copia-${copyId}.pdf"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.send(pdf);
  }
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
    if (result.pending && result.version) {
      const stored = await store.getVersion(result.version.id);
      return res.json({ ...result, version: { ...result.version, approver: await approverOf(stored) } });
    }
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
        versionLabel: version ? versionLabelOf(version) : "—",
        policyHash: row.policyContentHash,
        normativeSnapshotHash: row.normativeSnapshotHash || null,
        changeSetHash: row.changeSetHash || null,
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
    const label = versionLabelOf(version);
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
    const pdf = buildControlledCopyPdf({
      ...CONTROLLED_COPY_IDENTITY,
      content: version.content,
      title: version.title,
      versionLabel: label,
      contentHash: version.contentHash,
      effectiveFrom: version.effectiveFrom.toISOString(),
      publishedAt: version.publishedAt?.toISOString() ?? null,
      summaryRules: version.summaryRules,
      copyId,
      recipientName: user.name,
      recipientEmail: user.email,
      generatedAt: generatedAt.toISOString(),
      autoFields: await autoFieldsFor({ version, label, user, acceptance: mine, at: generatedAt }),
    });
    return sendControlledCopy(res, pdf, copyId);
  });

  /**
   * Cópia controlada da POL-COM-001 v1.0 ANTES da publicação (SUPER_ADMIN).
   * Mesmo texto, mesmo cabeçalho e rodapé; carimbo de prévia; auditada.
   * Não grava CommercialPolicyControlledCopy porque ainda não há versão.
   */
  app.get("/api/admin/commercial-policy/official/pol-com-001/document", deps.requireAppAuth, async (req, res) => {
    const user = await actor(req, res);
    if (!user || !superAdmin(user, res)) return;
    const body = officialCommercialPolicyBody();
    const hash = officialCommercialPolicyHash();
    const versions = await store.listVersions();
    const published = versions.find((row) => row.status === "PUBLISHED" && row.contentHash === hash) ?? null;
    const generatedAt = now();
    const copyId = randomUUID();
    try {
      await writeSecurityAuditLog(prisma, {
        eventType: SECURITY_AUDIT_EVENTS.COMMERCIAL_POLICY_CONTROLLED_COPY,
        actorUserId: user.id,
        targetUserId: user.id,
        ipAddress: resolveAuditIpAddress(req.socket?.remoteAddress),
        userAgent: normalizeUserAgent(req.headers["user-agent"]),
        metadata: {
          copyId,
          policyVersionId: published?.id ?? null,
          prePublication: !published,
          documentDigest: hash,
          generatedAt: generatedAt.toISOString(),
        },
      });
    } catch (error) {
      console.error("[commercial-policy-copy-audit]", error);
    }
    const pdf = buildControlledCopyPdf({
      ...CONTROLLED_COPY_IDENTITY,
      content: body.content,
      title: POL_COM_001_TITLE,
      versionLabel: POL_COM_001_VERSION_LABEL,
      contentHash: hash,
      effectiveFrom: published?.effectiveFrom.toISOString() ?? null,
      publishedAt: published?.publishedAt?.toISOString() ?? null,
      summaryRules: body.summaryRules,
      copyId,
      recipientName: user.name,
      recipientEmail: user.email,
      generatedAt: generatedAt.toISOString(),
      stamp: published ? null : "PRÉVIA — VERSÃO AINDA NÃO PUBLICADA",
      autoFields: await autoFieldsFor({ version: published, label: POL_COM_001_VERSION_LABEL, user, acceptance: null, at: generatedAt }),
    });
    return sendControlledCopy(res, pdf, copyId);
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
    const vigencia = parsePublicationEffectiveDate(req.body?.effectiveFrom, now());
    if (vigencia.ok === false) {
      const officialHash = officialCommercialPolicyHash();
      const alreadyPublished = (await store.listVersions()).some((row) => row.status === "PUBLISHED" && row.contentHash === officialHash);
      if (!alreadyPublished) return res.status(422).json({ error: vigencia.code, code: vigencia.code, message: vigencia.message });
    }
    const state = await currentNormativeState();
    const published = await publishOfficialCommercialPolicy(store, user.id, now(), {
      currentSnapshot: state.snapshot,
      effectiveFrom: vigencia.ok ? vigencia.effectiveFrom : undefined,
    });
    if (published.ok === false) return res.status(published.status).json(published);
    if (!published.alreadyPublished) {
      try {
        await writeSecurityAuditLog(prisma, {
          eventType: SECURITY_AUDIT_EVENTS.POLICY_VERSION_PUBLISHED,
          actorUserId: user.id,
          targetUserId: null,
          ipAddress: resolveAuditIpAddress(req.socket?.remoteAddress),
          userAgent: normalizeUserAgent(req.headers["user-agent"]),
          metadata: {
            policyVersionId: published.version.id,
            label: POL_COM_001_VERSION_LABEL,
            contentHash: published.version.contentHash,
            normativeSnapshotHash: published.version.normativeSnapshotHash ?? null,
            effectiveFrom: published.version.effectiveFrom.toISOString(),
          },
        });
      } catch (error) {
        console.error("[commercial-policy-publish-audit]", error);
      }
    }
    return res.status(published.alreadyPublished ? 200 : 201).json({
      alreadyPublished: published.alreadyPublished,
      version: versionPublicView(published.version),
    });
  });

  /**
   * Painel de integridade da política viva: cartão do documento, situação da
   * publicação, achados com severidade, matriz de reconciliação, versão
   * vigente, rascunho pendente, "o que mudou", snapshots, vigências e aceites.
   */
  app.get("/api/admin/commercial-policy/integrity", deps.requireAppAuth, async (req, res) => {
    const user = await actor(req, res);
    if (!user || !superAdmin(user, res)) return;
    const at = now();
    const official = officialCommercialPolicyBody();
    const officialHash = officialCommercialPolicyHash();
    const state = await currentNormativeState();
    const publication = auditPolCom001Publication(official.content, state.snapshot);
    const versions = await store.listVersions();
    const current = await store.currentPublished(at);
    const officialPublished = versions.find((row) => row.status === "PUBLISHED" && row.contentHash === officialHash) ?? null;
    const scheduled = versions
      .filter((row) => row.status === "PUBLISHED" && row.effectiveFrom.getTime() > at.getTime())
      .sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime());
    const draft = findPendingRevisionDraft(versions);
    const draftState = draft && state.snapshot
      ? compareDraftToCurrentNormativeState({ draftSnapshotHash: draft.normativeSnapshotHash ?? null, current: state.snapshot })
      : draft
        ? "DRAFT_UNVERIFIED"
        : null;
    const compared = state.snapshot
      ? comparePublishedPolicyToCurrentNormativeState({
          publishedHash: current?.normativeSnapshotHash || null,
          current: state.snapshot,
          publicationAuditBlocking: !publication.ready,
        })
      : publication.ready
        ? "INVALID_CONFIGURATION"
        : "POLICY_SYSTEM_MISMATCH";
    const acceptances = await store.listAcceptances();
    const acceptancesByVersion = versions.map((row: StoredVersion) => ({
      versionId: row.id,
      label: versionLabelOf(row),
      status: row.status,
      count: new Set(acceptances.filter((item) => item.policyVersionId === row.id).map((item) => item.userId)).size,
    }));
    return res.json({
      status: compared,
      publication: publication.status,
      publicationStatus: resolvePublicationStatus({ published: Boolean(officialPublished), blockers: publication.blockers }),
      document: {
        code: POL_COM_001_CODE,
        title: POL_COM_001_TITLE,
        versionLabel: POL_COM_001_VERSION_LABEL,
        classification: POL_COM_001_CLASSIFICATION,
        company: POL_COM_001_COMPANY,
        cnpj: POL_COM_001_CNPJ,
        contentHash: officialHash,
        contentLength: official.content.length,
        questions: official.questions.length,
        declarations: official.declarations.length,
        summaryRules: official.summaryRules.length,
      },
      counts: { blockers: publication.blockers, warnings: publication.warnings, informational: publication.informational },
      findings: publication.findings,
      reconciliation: buildPolCom001ReconciliationMatrix(state.snapshot),
      currentSnapshot: state.snapshot,
      currentSnapshotHash: state.snapshot ? normativeSnapshotHash(state.snapshot) : null,
      currentRelease: state.snapshot?.commissionRelease ?? null,
      settingsSource: state.settingsSource,
      currentVersion: current ? await adminView(current) : null,
      officialPublishedVersion: officialPublished ? await adminView(officialPublished) : null,
      scheduledVersions: await Promise.all(scheduled.map(adminView)),
      pendingDraft: draft
        ? {
            ...versionAdminView(draft),
            draftState,
            affectedSections: sectionsAffectedByChanges(draft.changeSet ?? []),
          }
        : null,
      acceptancesByVersion,
      dependencies: COMMERCIAL_POLICY_DEPENDENCIES,
    });
  });

  app.post("/api/admin/commercial-policy/normative-revisions", deps.requireAppAuth, async (req, res) => {
    const user = await actor(req, res);
    if (!user || !superAdmin(user, res)) return;
    const kind = String(req.body?.kind ?? "");
    if (!COMMERCIAL_POLICY_DEPENDENCIES.some((item) => item.key === kind)) {
      return res.status(422).json({ ok: false, code: "INVALID_DEPENDENCY", message: "Dependência normativa desconhecida." });
    }
    let release: ReleaseNormativeInput;
    try {
      release = await loadRelease();
    } catch {
      return res.status(503).json({
        ok: false,
        code: "NORMATIVE_SOURCE_UNAVAILABLE",
        message: "A fonte oficial da regra de liberação não está disponível; a revisão não foi aberta.",
      });
    }
    const opened = await openNormativeRevision(store, {
      kind: kind as "commission.releaseRule",
      release,
      oldValue: req.body?.oldValue ?? null,
      newValue: req.body?.newValue ?? null,
      oldDisplayValue: String(req.body?.oldDisplayValue ?? ""),
      newDisplayValue: String(req.body?.newDisplayValue ?? ""),
      reason: String(req.body?.reason ?? ""),
      changedBy: user.id,
      now: now(),
    });
    if (opened.ok === false) return res.status(opened.status).json(opened);
    if (opened.version && !opened.duplicate) {
      try {
        await writeSecurityAuditLog(prisma, {
          eventType: opened.aggregated ? SECURITY_AUDIT_EVENTS.POLICY_CHANGESET_GENERATED : SECURITY_AUDIT_EVENTS.POLICY_DRAFT_CREATED,
          actorUserId: user.id,
          targetUserId: null,
          ipAddress: resolveAuditIpAddress(req.socket?.remoteAddress),
          userAgent: normalizeUserAgent(req.headers["user-agent"]),
          metadata: {
            dependencyKey: kind,
            sourceVersion: opened.version.changeSet?.[0]?.sourceVersionOld ?? null,
            targetVersion: versionLabelOf(opened.version),
            draftVersionId: opened.version.id,
            changeSetHash: opened.version.changeSetHash ?? null,
          },
        });
      } catch (error) {
        console.error("[commercial-policy-normative-audit]", error);
      }
    }
    return res.status(opened.duplicate || opened.aggregated || !opened.version ? 200 : 201).json({
      impact: opened.impact,
      duplicate: opened.duplicate,
      aggregated: opened.aggregated,
      version: opened.version ? versionAdminView(opened.version) : null,
    });
  });

  app.get("/api/admin/commercial-policy/versions", deps.requireAppAuth, async (req, res) => {
    const user = await actor(req, res);
    if (!user || !superAdmin(user, res)) return;
    const versions = await store.listVersions();
    return res.json({ versions: await Promise.all(versions.map(adminView)) });
  });

  app.post("/api/admin/commercial-policy/versions", deps.requireAppAuth, async (req, res) => {
    const user = await actor(req, res);
    if (!user || !superAdmin(user, res)) return;
    const body = readBody(req.body);
    const invalid = validatePolicyDraft(body);
    if (invalid) return res.status(422).json({ error: "INVALID_POLICY", code: "INVALID_POLICY", message: invalid });
    const created = await createPolicyDraft(store, body, now());
    if (created.ok === false) return res.status(created.status).json(created);
    return res.status(201).json({ version: versionAdminView(created.version) });
  });

  /** CRUD do conteúdo: rascunho a partir do documento oficial, duplicar, ler, editar e descartar. Publicada é imutável. */
  app.post("/api/admin/commercial-policy/versions/from-official", deps.requireAppAuth, async (req, res) => {
    const user = await actor(req, res);
    if (!user || !superAdmin(user, res)) return;
    const created = await createDraftFromOfficialPolicy(store, now());
    if (created.ok === false) return res.status(created.status).json(created);
    return res.status(201).json({ version: versionAdminView(created.version) });
  });

  app.post("/api/admin/commercial-policy/versions/:id/duplicate", deps.requireAppAuth, async (req, res) => {
    const user = await actor(req, res);
    if (!user || !superAdmin(user, res)) return;
    const created = await duplicatePolicyVersion(store, String(req.params.id ?? ""), now());
    if (created.ok === false) return res.status(created.status).json(created);
    return res.status(201).json({ version: versionAdminView(created.version) });
  });

  app.get("/api/admin/commercial-policy/versions/:id", deps.requireAppAuth, async (req, res) => {
    const user = await actor(req, res);
    if (!user || !superAdmin(user, res)) return;
    const version = await store.getVersion(String(req.params.id ?? ""));
    if (!version) return res.status(404).json({ error: "NOT_FOUND", code: "NOT_FOUND", message: "Versão não encontrada." });
    return res.json({ version: versionAdminView(version) });
  });

  app.put("/api/admin/commercial-policy/versions/:id", deps.requireAppAuth, async (req, res) => {
    const user = await actor(req, res);
    if (!user || !superAdmin(user, res)) return;
    const body = readBody(req.body);
    const effectiveRaw = typeof req.body?.effectiveFrom === "string" ? new Date(req.body.effectiveFrom) : null;
    const effectiveFrom = effectiveRaw && !Number.isNaN(effectiveRaw.getTime()) ? effectiveRaw : null;
    const saved = await updatePolicyDraft(store, String(req.params.id ?? ""), { ...body, effectiveFrom });
    if (saved.ok === false) return res.status(saved.status).json(saved);
    return res.json({ version: versionAdminView(saved.version) });
  });

  app.delete("/api/admin/commercial-policy/versions/:id", deps.requireAppAuth, async (req, res) => {
    const user = await actor(req, res);
    if (!user || !superAdmin(user, res)) return;
    const discarded = await discardPolicyDraft(store, String(req.params.id ?? ""));
    if (discarded.ok === false) return res.status(discarded.status).json(discarded);
    return res.json({ version: versionAdminView(discarded.version) });
  });

  app.post("/api/admin/commercial-policy/versions/:id/publish", deps.requireAppAuth, async (req, res) => {
    const user = await actor(req, res);
    if (!user || !superAdmin(user, res)) return;
    const vigencia = parsePublicationEffectiveDate(req.body?.effectiveFrom, now());
    if (vigencia.ok === false) return res.status(422).json({ error: vigencia.code, code: vigencia.code, message: vigencia.message });
    const state = await currentNormativeState();
    const published = await publishPolicyVersion(store, String(req.params.id ?? ""), user.id, now(), {
      currentSnapshot: state.snapshot,
      effectiveFrom: vigencia.effectiveFrom,
    });
    if (published.ok === false) return res.status(published.status).json(published);
    try {
      await writeSecurityAuditLog(prisma, {
        eventType: SECURITY_AUDIT_EVENTS.POLICY_VERSION_PUBLISHED,
        actorUserId: user.id,
        targetUserId: null,
        ipAddress: resolveAuditIpAddress(req.socket?.remoteAddress),
        userAgent: normalizeUserAgent(req.headers["user-agent"]),
        metadata: {
          policyVersionId: published.version.id,
          label: versionLabelOf(published.version),
          contentHash: published.version.contentHash,
          normativeSnapshotHash: published.version.normativeSnapshotHash ?? null,
          changeSetHash: published.version.changeSetHash ?? null,
          effectiveFrom: published.version.effectiveFrom.toISOString(),
        },
      });
    } catch (error) {
      console.error("[commercial-policy-publish-audit]", error);
    }
    return res.json({ version: await adminView(published.version) });
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
