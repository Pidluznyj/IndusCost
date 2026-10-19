/**
 * Projetos — prévia e emissão dos cinco documentos (servidor).
 *
 * - Todos os documentos são montados aqui, com a MESMA fonte de valores (precificação salva,
 *   buildProjectDocumentValueSource) e o mesmo bloco documental (buildProjectDocumentHeader).
 * - Emitir = congelar cabeçalho + conteúdo em ProjectIssuedDocument com número, revisão e
 *   sha256. Abrir uma emissão devolve exatamente o conteúdo gravado (não reconsulta o projeto)
 *   e confere o hash.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import { sha256Hex, stableStringify } from "./commercialPolicy/commercialPolicyRules.js";
import { loadProjectDetail } from "./projectsService.js";
import { loadProjectClientProposalQuantities } from "./projectsClientProposalService.js";
import { buildProjectDocumentValueSource, type ProjectDocumentValueSource } from "./projectsDocumentValues.js";
import {
  buildIssuerFromBranding,
  buildProjectDocumentHeader,
  PROJECT_DOCUMENT_TYPE_META,
  projectDocumentIssueBlockers,
  type ProjectDocumentEnvelope,
  type ProjectDocumentIssuer,
  type ProjectDocumentType,
} from "./projectsDocumentHeader.js";
import { collectStructureEntityIds, type ProjectEntityCodes } from "./projectsDocumentCodes.js";
import { buildQuickIntakeFormFromDetail } from "./projectsIntakeQuickForm.js";
import { buildProjectIntakeFormFromDetail } from "./projectsIntakeForm.js";
import { buildProjectSpreadsheetData } from "./projectsIntakeSpreadsheet.js";
import { buildProjectExecutiveReport } from "./projectsExecutiveReport.js";
import { assertProjectClientReportPayloadIsSafe, buildProjectClientReport } from "./projectsClientReport.js";
import type { ProjectClientReportPayload } from "./projectsClientReportShared.js";
import type { ProjectDetail } from "@/src/types/projects.js";

export type ProjectDocumentActor = { userId: string | null; name: string };

export type ProjectDocumentContext = {
  detail: ProjectDetail;
  valueSource: ProjectDocumentValueSource;
  quantities: Record<string, number>;
  issuer: ProjectDocumentIssuer;
  entityCodes: ProjectEntityCodes;
};

async function loadEntityCodes(detail: ProjectDetail): Promise<ProjectEntityCodes> {
  const { productIds, materialIds } = collectStructureEntityIds(detail.structureLines);
  const [products, materials] = await Promise.all([
    productIds.length
      ? prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, sku: true } })
      : Promise.resolve([]),
    materialIds.length
      ? prisma.material.findMany({ where: { id: { in: materialIds } }, select: { id: true, code: true } })
      : Promise.resolve([]),
  ]);
  return {
    products: Object.fromEntries(products.map((p) => [p.id, p.sku])),
    materials: Object.fromEntries(materials.map((m) => [m.id, m.code])),
  };
}

export async function loadProjectDocumentContext(projectId: string): Promise<ProjectDocumentContext | null> {
  const base = await loadProjectDetail(projectId);
  if (!base) return null;
  const valueSource = buildProjectDocumentValueSource(base);
  const detail: ProjectDetail = { ...base, documentValueSource: valueSource };
  const [quantityMap, branding, entityCodes] = await Promise.all([
    loadProjectClientProposalQuantities(projectId),
    prisma.brandingSettings.findFirst({ orderBy: { updatedAt: "desc" } }),
    loadEntityCodes(detail),
  ]);
  return {
    detail,
    valueSource,
    quantities: Object.fromEntries(quantityMap),
    issuer: buildIssuerFromBranding(branding),
    entityCodes,
  };
}

export function buildProjectDocumentBody(
  type: ProjectDocumentType,
  ctx: ProjectDocumentContext,
  actor: ProjectDocumentActor,
  issuedAt: string,
): unknown {
  const generatedAt = new Date(issuedAt);
  const common = {
    generatedAt,
    generatedBy: actor.name,
    entityCodes: ctx.entityCodes,
    quantitiesByTargetId: ctx.quantities,
  };
  switch (type) {
    case "QUICK_FORM":
      return buildQuickIntakeFormFromDetail(ctx.detail, common);
    case "FULL_FORM":
      return buildProjectIntakeFormFromDetail(ctx.detail, { ...common, issuerName: ctx.issuer.legalName });
    case "SPREADSHEET":
      return buildProjectSpreadsheetData(ctx.detail, common);
    case "EXECUTIVE_REPORT":
      return buildProjectExecutiveReport(ctx.detail, {
        generatedAt,
        quantitiesByTargetId: ctx.quantities,
        preparedBy: actor.name,
      });
    case "CLIENT_PROPOSAL": {
      const payload = buildProjectClientReport(ctx.detail, ctx.quantities, {
        issuerName: ctx.issuer.legalName,
        issuedAt,
      });
      assertProjectClientReportPayloadIsSafe(payload);
      return payload;
    }
  }
}

/** Normaliza (JSON) para que o hash calculado na emissão seja o mesmo após ler do jsonb. */
function normalizeEnvelope<T>(envelope: ProjectDocumentEnvelope<T>): ProjectDocumentEnvelope<T> {
  return JSON.parse(JSON.stringify(envelope)) as ProjectDocumentEnvelope<T>;
}

export function hashProjectDocumentEnvelope(envelope: unknown): string {
  return sha256Hex(stableStringify(envelope));
}

function blockersFor(type: ProjectDocumentType, ctx: ProjectDocumentContext, body: unknown): string[] {
  const proposal = type === "CLIENT_PROPOSAL" ? (body as ProjectClientReportPayload) : null;
  return projectDocumentIssueBlockers(type, ctx.valueSource, {
    pricingPending: proposal?.summary.pricingPending,
    productsCount: proposal?.products.length,
  });
}

export async function previewProjectDocument(
  projectId: string,
  type: ProjectDocumentType,
  actor: ProjectDocumentActor,
): Promise<{ envelope: ProjectDocumentEnvelope; blockers: string[] } | null> {
  const ctx = await loadProjectDocumentContext(projectId);
  if (!ctx) return null;
  const issuedAt = new Date().toISOString();
  const body = buildProjectDocumentBody(type, ctx, actor, issuedAt);
  const header = buildProjectDocumentHeader({
    type,
    detail: ctx.detail,
    issuer: ctx.issuer,
    valueSource: ctx.valueSource,
    issuedAt,
    issuedBy: actor,
    revision: null,
  });
  return { envelope: normalizeEnvelope({ header, body }), blockers: blockersFor(type, ctx, body) };
}

export type ProjectIssuedDocumentSummary = {
  id: string;
  documentType: ProjectDocumentType;
  documentTitle: string;
  documentNumber: string;
  revision: number;
  versionNumber: number | null;
  valueSource: string;
  pricingSavedAt: string | null;
  pricingStale: boolean;
  issuedAt: string;
  issuedByName: string;
  payloadSha256: string;
};

type IssuedRow = {
  id: string;
  documentType: string;
  documentNumber: string;
  revision: number;
  versionNumber: number | null;
  valueSource: string;
  pricingSavedAt: Date | null;
  pricingStale: boolean;
  issuedAt: Date;
  issuedByName: string;
  payloadSha256: string;
};

function summarize(row: IssuedRow): ProjectIssuedDocumentSummary {
  const type = row.documentType as ProjectDocumentType;
  return {
    id: row.id,
    documentType: type,
    documentTitle: PROJECT_DOCUMENT_TYPE_META[type]?.title ?? row.documentType,
    documentNumber: row.documentNumber,
    revision: row.revision,
    versionNumber: row.versionNumber,
    valueSource: row.valueSource,
    pricingSavedAt: row.pricingSavedAt?.toISOString() ?? null,
    pricingStale: row.pricingStale,
    issuedAt: row.issuedAt.toISOString(),
    issuedByName: row.issuedByName,
    payloadSha256: row.payloadSha256,
  };
}

const SUMMARY_SELECT = {
  id: true,
  documentType: true,
  documentNumber: true,
  revision: true,
  versionNumber: true,
  valueSource: true,
  pricingSavedAt: true,
  pricingStale: true,
  issuedAt: true,
  issuedByName: true,
  payloadSha256: true,
} as const;

export type IssueProjectDocumentResult =
  | { ok: true; issued: ProjectIssuedDocumentSummary; envelope: ProjectDocumentEnvelope }
  | { ok: false; status: number; code: string; error: string; blockers?: string[] };

export async function issueProjectDocument(
  projectId: string,
  type: ProjectDocumentType,
  actor: ProjectDocumentActor,
): Promise<IssueProjectDocumentResult> {
  const ctx = await loadProjectDocumentContext(projectId);
  if (!ctx) return { ok: false, status: 404, code: "NOT_FOUND", error: "Projeto não encontrado." };
  const issuedAtDate = new Date();
  const issuedAt = issuedAtDate.toISOString();
  const body = buildProjectDocumentBody(type, ctx, actor, issuedAt);
  const blockers = blockersFor(type, ctx, body);
  if (blockers.length) {
    return {
      ok: false,
      status: 409,
      code: "ISSUE_BLOCKED",
      error: "O documento não pode ser emitido enquanto houver impedimentos.",
      blockers,
    };
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const last = await tx.projectIssuedDocument.findFirst({
          where: { projectId, documentType: type },
          orderBy: { revision: "desc" },
          select: { revision: true },
        });
        const revision = (last?.revision ?? 0) + 1;
        const header = buildProjectDocumentHeader({
          type,
          detail: ctx.detail,
          issuer: ctx.issuer,
          valueSource: ctx.valueSource,
          issuedAt,
          issuedBy: actor,
          revision,
        });
        const envelope = normalizeEnvelope({ header, body });
        const payloadSha256 = hashProjectDocumentEnvelope(envelope);
        const row = await tx.projectIssuedDocument.create({
          data: {
            projectId,
            projectCode: ctx.detail.code,
            documentType: type,
            revision,
            documentNumber: header.documentNumber!,
            versionId: ctx.detail.currentVersion?.id ?? null,
            versionNumber: ctx.detail.currentVersion?.versionNumber ?? null,
            valueSource: ctx.valueSource.mode,
            pricingSavedAt: ctx.valueSource.pricingSavedAt ? new Date(ctx.valueSource.pricingSavedAt) : null,
            pricingStale: ctx.valueSource.stale,
            issuedAt: issuedAtDate,
            issuedByUserId: actor.userId,
            issuedByName: actor.name,
            payload: envelope as unknown as Prisma.InputJsonValue,
            payloadSha256,
          },
          select: SUMMARY_SELECT,
        });
        return { ok: true as const, issued: summarize(row), envelope };
      });
    } catch (e) {
      // Duas emissões simultâneas disputaram a mesma revisão: tenta a próxima.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && attempt < 2) continue;
      throw e;
    }
  }
  return { ok: false, status: 409, code: "REVISION_CONFLICT", error: "Conflito de revisão; tente novamente." };
}

export async function listProjectIssuedDocuments(
  projectId: string,
  type?: ProjectDocumentType,
): Promise<ProjectIssuedDocumentSummary[]> {
  const rows = await prisma.projectIssuedDocument.findMany({
    where: { projectId, ...(type ? { documentType: type } : {}) },
    orderBy: [{ documentType: "asc" }, { revision: "desc" }],
    select: SUMMARY_SELECT,
  });
  return rows.map(summarize);
}

export async function getProjectIssuedDocument(
  projectId: string,
  issuedId: string,
): Promise<{
  issued: ProjectIssuedDocumentSummary;
  envelope: ProjectDocumentEnvelope;
  integrity: { sha256: string; verified: boolean };
} | null> {
  const row = await prisma.projectIssuedDocument.findFirst({
    where: { id: issuedId, projectId },
    select: { ...SUMMARY_SELECT, payload: true },
  });
  if (!row) return null;
  const envelope = row.payload as unknown as ProjectDocumentEnvelope;
  const sha256 = hashProjectDocumentEnvelope(envelope);
  return {
    issued: summarize(row),
    envelope,
    integrity: { sha256, verified: sha256 === row.payloadSha256 },
  };
}
