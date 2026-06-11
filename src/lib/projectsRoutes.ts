import type express from "express";
import type { RequestHandler } from "express";
import { Prisma, type ProjectStatus, type ProjectType } from "@prisma/client";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { prisma } from "@/src/lib/prisma.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireAnyPermission: (permissions: string[]) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};
import { buildProjectsDashboard } from "@/src/lib/projectsDashboard.js";
import {
  buildProjectsCustomerLookupWhere,
  PROJECTS_CUSTOMER_LOOKUP_LIMIT,
  serializeCustomerLookupItem,
} from "@/src/lib/projectsCustomerLookup.js";
import {
  buildCommercialOwnerSearchWhere,
  COMMERCIAL_ROLES,
  PROJECTS_COMMERCIAL_OWNER_LOOKUP_LIMIT,
  serializeCommercialOwnerLookupItem,
} from "@/src/lib/projectsCommercialOwnerLookup.js";
import {
  PROJECTS_LOOKUP_PERMISSIONS,
  PROJECTS_MANAGE_PERMISSIONS,
  PROJECTS_VIEW_PERMISSIONS,
} from "@/src/lib/projectsPermissions.js";
import {
  setProjectsProductCostResolver,
  type ProjectsProductCostResolver,
} from "@/src/lib/projectsProductCostResolver.js";
import {
  importProductEngineeringSnapshotToProject,
  loadOfficialProductEngineeringSnapshot,
} from "@/src/lib/projectsProductEngineeringSnapshot.js";
import {
  importProductSnapshotToProject,
  loadOfficialProductSnapshot,
} from "@/src/lib/projectsProductSnapshot.js";
import {
  buildStructureLineTotal,
  copyVersionFromCurrent,
  createProjectWithVersion,
  dec,
  isValidProjectStatus,
  isValidProjectType,
  loadProjectDetail,
  recalculateAndPersistVersionCosts,
  requireProjectAndVersion,
  resolveMoldAmortizedCost,
  resolveStructureLineSnapshots,
  serializeMold,
  serializeProjectListRow,
  serializeSimulatedItem,
  serializeSimulatedProduct,
  serializeStructureLine,
  serializeVersion,
} from "@/src/lib/projectsService.js";

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function parsePage(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

function parsePageSize(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 20;
  return Math.min(100, Math.max(1, Math.floor(n)));
}

function optStr(value: unknown): string | null {
  if (value == null) return null;
  const t = String(value).trim();
  return t.length ? t : null;
}

function optNum(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function optBool(value: unknown, fallback = false): boolean {
  if (value === true || value === "true" || value === 1 || value === "1") return true;
  if (value === false || value === "false" || value === 0 || value === "0") return false;
  return fallback;
}

export type ProjectsRoutesDeps = {
  resolveOfficialProductCostAnalysis?: ProjectsProductCostResolver;
};

export function registerProjectsRoutes(
  app: express.Express,
  auth: AuthGuards,
  deps: ProjectsRoutesDeps = {}
) {
  if (deps.resolveOfficialProductCostAnalysis) {
    setProjectsProductCostResolver(deps.resolveOfficialProductCostAnalysis);
  }
  const view = [auth.requireAppAuth, auth.requireAnyPermission([...PROJECTS_VIEW_PERMISSIONS])] as const;
  const lookup = [auth.requireAppAuth, auth.requireAnyPermission([...PROJECTS_LOOKUP_PERMISSIONS])] as const;
  const manage = [auth.requireAppAuth, auth.requireAnyPermission([...PROJECTS_MANAGE_PERMISSIONS])] as const;

  app.get("/api/projects/dashboard", ...view, async (_req, res) => {
    try {
      res.json(await buildProjectsDashboard());
    } catch (e: unknown) {
      console.error("GET /api/projects/dashboard", e);
      res.status(500).json({ error: "Erro ao carregar dashboard de projetos." });
    }
  });

  app.get("/api/projects", ...view, async (req, res) => {
    try {
      const search = String(req.query.search ?? "").trim();
      const statusQ = String(req.query.status ?? "").trim();
      const typeQ = String(req.query.projectType ?? "").trim();
      const customerQ = String(req.query.customer ?? "").trim();
      const page = parsePage(req.query.page);
      const pageSize = parsePageSize(req.query.pageSize);
      const skip = (page - 1) * pageSize;

      if (statusQ && !isValidProjectStatus(statusQ)) {
        return res.status(400).json({ error: "Status inválido." });
      }
      if (typeQ && !isValidProjectType(typeQ)) {
        return res.status(400).json({ error: "Tipo de projeto inválido." });
      }

      const where: Prisma.ProjectWhereInput = {
        ...(statusQ && isValidProjectStatus(statusQ)
          ? { status: statusQ as ProjectStatus }
          : {}),
        ...(typeQ && isValidProjectType(typeQ) ? { projectType: typeQ as ProjectType } : {}),
        ...(customerQ
          ? { customerName: { contains: customerQ, mode: "insensitive" } }
          : {}),
        ...(search
          ? {
              OR: [
                { code: { contains: search, mode: "insensitive" } },
                { title: { contains: search, mode: "insensitive" } },
                { customerName: { contains: search, mode: "insensitive" } },
                { commercialOwner: { contains: search, mode: "insensitive" } },
                { technicalOwner: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      };

      const [rows, total] = await Promise.all([
        prisma.project.findMany({
          where,
          orderBy: { updatedAt: "desc" },
          skip,
          take: pageSize,
          include: { versions: { where: { isCurrent: true }, take: 1 } },
        }),
        prisma.project.count({ where }),
      ]);

      const serialized = await Promise.all(rows.map(serializeProjectListRow));
      res.json({
        rows: serialized,
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      });
    } catch (e: unknown) {
      console.error("GET /api/projects", e);
      res.status(500).json({ error: "Erro ao listar projetos." });
    }
  });

  app.get("/api/projects/lookup/commercial-owners", ...lookup, async (req, res) => {
    try {
      const query = String(req.query.query ?? req.query.q ?? "").trim();
      if (!query) {
        return res.json({ rows: [] });
      }
      const searchWhere = buildCommercialOwnerSearchWhere(query);
      const rows = await prisma.appUser.findMany({
        where: {
          isActive: true,
          role: { in: COMMERCIAL_ROLES },
          ...(searchWhere ?? {}),
        },
        take: PROJECTS_COMMERCIAL_OWNER_LOOKUP_LIMIT,
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          sellerResponsibleName: true,
        },
      });
      res.json({ rows: rows.map(serializeCommercialOwnerLookupItem) });
    } catch (e: unknown) {
      console.error("GET /api/projects/lookup/commercial-owners", e);
      res.status(500).json({ error: "Erro na busca de responsáveis comerciais." });
    }
  });

  app.get("/api/projects/lookup/customers", ...lookup, async (req, res) => {
    try {
      const query = String(req.query.query ?? req.query.q ?? "").trim();
      if (!query) {
        return res.json({ rows: [] });
      }
      const rows = await prisma.customer.findMany({
        where: {
          status: "ACTIVE",
          ...buildProjectsCustomerLookupWhere(query),
        },
        take: PROJECTS_CUSTOMER_LOOKUP_LIMIT,
        orderBy: { companyName: "asc" },
        select: {
          id: true,
          companyName: true,
          tradeName: true,
          taxId: true,
        },
      });
      res.json({ rows: rows.map(serializeCustomerLookupItem) });
    } catch (e: unknown) {
      console.error("GET /api/projects/lookup/customers", e);
      res.status(500).json({ error: "Erro na busca de clientes." });
    }
  });

  app.get("/api/projects/lookup/products", ...lookup, async (req, res) => {
    try {
      const q = String(req.query.q ?? "").trim();
      const rows = await prisma.product.findMany({
        where: q
          ? {
              OR: [
                { sku: { contains: q, mode: "insensitive" } },
                { name: { contains: q, mode: "insensitive" } },
              ],
            }
          : undefined,
        take: 30,
        orderBy: { sku: "asc" },
        select: { id: true, sku: true, name: true, type: true },
      });
      res.json({ rows });
    } catch (e: unknown) {
      console.error("GET /api/projects/lookup/products", e);
      res.status(500).json({ error: "Erro na busca de produtos." });
    }
  });

  app.get("/api/projects/lookup/products/:productId/snapshot", ...lookup, async (req, res) => {
    try {
      if (!isUuid(req.params.productId)) {
        return res.status(400).json({ error: "ID de produto inválido." });
      }
      const snapshot = await loadOfficialProductSnapshot(req.params.productId);
      if (!snapshot) return res.status(404).json({ error: "Produto não encontrado." });
      res.json(snapshot);
    } catch (e: unknown) {
      console.error("GET /api/projects/lookup/products/:productId/snapshot", e);
      res.status(500).json({ error: "Erro ao carregar snapshot do produto." });
    }
  });

  app.get("/api/projects/lookup/products/:productId/engineering-snapshot", ...lookup, async (req, res) => {
    try {
      if (!isUuid(req.params.productId)) {
        return res.status(400).json({ error: "ID de produto inválido." });
      }
      const snapshot = await loadOfficialProductEngineeringSnapshot(req.params.productId);
      if (!snapshot) return res.status(404).json({ error: "Produto não encontrado." });
      res.json(snapshot);
    } catch (e: unknown) {
      console.error("GET /api/projects/lookup/products/:productId/engineering-snapshot", e);
      res.status(500).json({ error: "Erro ao carregar engenharia do produto." });
    }
  });

  app.post("/api/projects/:id/import-product-snapshot", ...manage, async (req, res) => {
    try {
      if (!isUuid(req.params.id)) return res.status(400).json({ error: "ID inválido." });
      const body = req.body ?? {};
      const productId = typeof body.productId === "string" ? body.productId : "";
      if (!isUuid(productId)) return res.status(400).json({ error: "productId inválido." });

      const result = await importProductSnapshotToProject(req.params.id, productId, {
        includeBom: body.includeBom !== false,
        includeRouting: body.includeRouting !== false,
        replaceExisting: body.replaceExisting !== false,
      });
      const detail = await loadProjectDetail(req.params.id);
      res.status(201).json({
        createdCount: result.createdCount,
        lineIds: result.lineIds,
        project: detail,
      });
    } catch (e: unknown) {
      console.error("POST /api/projects/:id/import-product-snapshot", e);
      res.status(500).json({
        error: e instanceof Error ? e.message : "Erro ao importar snapshot do produto.",
      });
    }
  });

  app.get("/api/projects/lookup/materials", ...lookup, async (req, res) => {
    try {
      const q = String(req.query.q ?? "").trim();
      const rows = await prisma.material.findMany({
        where: q
          ? {
              OR: [
                { code: { contains: q, mode: "insensitive" } },
                { description: { contains: q, mode: "insensitive" } },
              ],
            }
          : undefined,
        take: 30,
        orderBy: { code: "asc" },
        select: {
          id: true,
          code: true,
          description: true,
          unit: true,
          currentCost: true,
        },
      });
      res.json({
        rows: rows.map((r) => ({
          ...r,
          currentCost: dec(r.currentCost),
        })),
      });
    } catch (e: unknown) {
      console.error("GET /api/projects/lookup/materials", e);
      res.status(500).json({ error: "Erro na busca de materiais." });
    }
  });

  app.get("/api/projects/:id", ...view, async (req, res) => {
    try {
      if (!isUuid(req.params.id)) return res.status(400).json({ error: "ID inválido." });
      const detail = await loadProjectDetail(req.params.id);
      if (!detail) return res.status(404).json({ error: "Projeto não encontrado." });
      res.json(detail);
    } catch (e: unknown) {
      console.error("GET /api/projects/:id", e);
      res.status(500).json({ error: "Erro ao carregar projeto." });
    }
  });

  app.post("/api/projects", ...manage, async (req, res) => {
    try {
      const body = req.body ?? {};
      const title = typeof body.title === "string" ? body.title.trim() : "";
      const customerName = typeof body.customerName === "string" ? body.customerName.trim() : "";
      const customerDocument =
        body.customerDocument === undefined || body.customerDocument === null
          ? null
          : optStr(body.customerDocument);
      const projectType = body.projectType;

      if (!title) return res.status(400).json({ error: "Título é obrigatório." });
      if (!customerName) return res.status(400).json({ error: "Cliente é obrigatório." });
      if (!isValidProjectType(projectType)) {
        return res.status(400).json({ error: "Tipo de projeto inválido." });
      }
      if (body.status != null && !isValidProjectStatus(body.status)) {
        return res.status(400).json({ error: "Status inválido." });
      }

      const project = await createProjectWithVersion({
        title,
        customerName,
        customerDocument,
        description: optStr(body.description),
        projectType,
        status: body.status,
        commercialOwner: optStr(body.commercialOwner),
        technicalOwner: optStr(body.technicalOwner),
        expectedMonthlyVolume: optNum(body.expectedMonthlyVolume),
        targetPrice: optNum(body.targetPrice),
        targetMarginPercent: optNum(body.targetMarginPercent),
        notes: optStr(body.notes),
      });

      const detail = await loadProjectDetail(project.id);
      res.status(201).json(detail);
    } catch (e: unknown) {
      console.error("POST /api/projects", e);
      res.status(500).json({ error: "Erro ao criar projeto." });
    }
  });

  app.patch("/api/projects/:id", ...manage, async (req, res) => {
    try {
      if (!isUuid(req.params.id)) return res.status(400).json({ error: "ID inválido." });
      const body = req.body ?? {};
      if (body.status != null && !isValidProjectStatus(body.status)) {
        return res.status(400).json({ error: "Status inválido." });
      }
      if (body.projectType != null && !isValidProjectType(body.projectType)) {
        return res.status(400).json({ error: "Tipo de projeto inválido." });
      }

      const data: Prisma.ProjectUpdateInput = {};
      if (body.title != null) data.title = String(body.title).trim();
      if (body.customerName != null) data.customerName = String(body.customerName).trim();
      if (body.customerDocument !== undefined) data.customerDocument = optStr(body.customerDocument);
      if (body.description !== undefined) data.description = optStr(body.description);
      if (body.projectType != null) data.projectType = body.projectType;
      if (body.status != null) data.status = body.status;
      if (body.commercialOwner !== undefined) data.commercialOwner = optStr(body.commercialOwner);
      if (body.technicalOwner !== undefined) data.technicalOwner = optStr(body.technicalOwner);
      if (body.expectedMonthlyVolume !== undefined) {
        data.expectedMonthlyVolume = optNum(body.expectedMonthlyVolume);
      }
      if (body.targetPrice !== undefined) data.targetPrice = optNum(body.targetPrice);
      if (body.targetMarginPercent !== undefined) {
        data.targetMarginPercent = optNum(body.targetMarginPercent);
      }
      if (body.notes !== undefined) data.notes = optStr(body.notes);

      await prisma.project.update({ where: { id: req.params.id }, data });
      const version = await requireProjectAndVersion(req.params.id);
      if (version.version) {
        await recalculateAndPersistVersionCosts(version.version.id);
      }
      const detail = await loadProjectDetail(req.params.id);
      res.json(detail);
    } catch (e: unknown) {
      console.error("PATCH /api/projects/:id", e);
      res.status(500).json({ error: "Erro ao atualizar projeto." });
    }
  });

  app.post("/api/projects/:id/versions", ...manage, async (req, res) => {
    try {
      if (!isUuid(req.params.id)) return res.status(400).json({ error: "ID inválido." });
      const last = await prisma.projectVersion.findFirst({
        where: { projectId: req.params.id },
        orderBy: { versionNumber: "desc" },
      });
      const nextNumber = (last?.versionNumber ?? 0) + 1;
      const version = await copyVersionFromCurrent(req.params.id, nextNumber);
      res.status(201).json(serializeVersion(version));
    } catch (e: unknown) {
      console.error("POST /api/projects/:id/versions", e);
      res.status(500).json({ error: "Erro ao criar nova versão." });
    }
  });

  app.get("/api/projects/:id/versions/:versionId", ...view, async (req, res) => {
    try {
      if (!isUuid(req.params.id) || !isUuid(req.params.versionId)) {
        return res.status(400).json({ error: "ID inválido." });
      }
      const version = await prisma.projectVersion.findFirst({
        where: { id: req.params.versionId, projectId: req.params.id },
      });
      if (!version) return res.status(404).json({ error: "Versão não encontrada." });
      res.json(serializeVersion(version));
    } catch (e: unknown) {
      console.error("GET /api/projects/:id/versions/:versionId", e);
      res.status(500).json({ error: "Erro ao carregar versão." });
    }
  });

  app.post("/api/projects/:id/simulated-products", ...manage, async (req, res) => {
    try {
      if (!isUuid(req.params.id)) return res.status(400).json({ error: "ID inválido." });
      const ctx = await requireProjectAndVersion(req.params.id);
      if ("error" in ctx) return res.status(404).json({ error: ctx.error });
      const body = req.body ?? {};
      const description = typeof body.description === "string" ? body.description.trim() : "";
      if (!description) return res.status(400).json({ error: "Descrição é obrigatória." });

      const row = await prisma.projectSimulatedProduct.create({
        data: {
          projectId: req.params.id,
          versionId: ctx.version.id,
          provisionalCode: optStr(body.provisionalCode),
          description,
          unit: optStr(body.unit) ?? "UN",
          estimatedWeight: optNum(body.estimatedWeight),
          expectedVolume: optNum(body.expectedVolume),
          batchSize: optNum(body.batchSize),
          notes: optStr(body.notes),
        },
      });
      res.status(201).json(serializeSimulatedProduct(row));
    } catch (e: unknown) {
      console.error("POST simulated-products", e);
      res.status(500).json({ error: "Erro ao criar produto simulado." });
    }
  });

  app.patch("/api/projects/:id/simulated-products/:simulatedProductId", ...manage, async (req, res) => {
    try {
      if (!isUuid(req.params.id) || !isUuid(req.params.simulatedProductId)) {
        return res.status(400).json({ error: "ID inválido." });
      }
      const body = req.body ?? {};
      const row = await prisma.projectSimulatedProduct.update({
        where: { id: req.params.simulatedProductId, projectId: req.params.id },
        data: {
          ...(body.provisionalCode !== undefined
            ? { provisionalCode: optStr(body.provisionalCode) }
            : {}),
          ...(body.description != null ? { description: String(body.description).trim() } : {}),
          ...(body.unit != null ? { unit: String(body.unit).trim() } : {}),
          ...(body.estimatedWeight !== undefined
            ? { estimatedWeight: optNum(body.estimatedWeight) }
            : {}),
          ...(body.expectedVolume !== undefined
            ? { expectedVolume: optNum(body.expectedVolume) }
            : {}),
          ...(body.batchSize !== undefined ? { batchSize: optNum(body.batchSize) } : {}),
          ...(body.notes !== undefined ? { notes: optStr(body.notes) } : {}),
        },
      });
      res.json(serializeSimulatedProduct(row));
    } catch (e: unknown) {
      console.error("PATCH simulated-products", e);
      res.status(500).json({ error: "Erro ao atualizar produto simulado." });
    }
  });

  app.delete("/api/projects/:id/simulated-products/:simulatedProductId", ...manage, async (req, res) => {
    try {
      if (!isUuid(req.params.id) || !isUuid(req.params.simulatedProductId)) {
        return res.status(400).json({ error: "ID inválido." });
      }
      const existing = await prisma.projectSimulatedProduct.findFirst({
        where: { id: req.params.simulatedProductId, projectId: req.params.id },
      });
      if (!existing) return res.status(404).json({ error: "Produto simulado não encontrado." });
      await prisma.projectSimulatedProduct.delete({ where: { id: req.params.simulatedProductId } });
      res.json({ ok: true });
    } catch (e: unknown) {
      console.error("DELETE simulated-products", e);
      res.status(500).json({ error: "Erro ao excluir produto simulado." });
    }
  });

  app.post("/api/projects/:id/simulated-items", ...manage, async (req, res) => {
    try {
      if (!isUuid(req.params.id)) return res.status(400).json({ error: "ID inválido." });
      const ctx = await requireProjectAndVersion(req.params.id);
      if ("error" in ctx) return res.status(404).json({ error: ctx.error });
      const body = req.body ?? {};
      const description = typeof body.description === "string" ? body.description.trim() : "";
      if (!description) return res.status(400).json({ error: "Descrição é obrigatória." });

      const row = await prisma.projectSimulatedItem.create({
        data: {
          projectId: req.params.id,
          versionId: ctx.version.id,
          provisionalCode: optStr(body.provisionalCode),
          description,
          itemType: body.itemType ?? "OTHER",
          unit: optStr(body.unit) ?? "UN",
          estimatedUnitCost: optNum(body.estimatedUnitCost),
          quotedUnitCost: optNum(body.quotedUnitCost),
          supplierName: optStr(body.supplierName),
          leadTimeDays: body.leadTimeDays != null ? Number(body.leadTimeDays) : null,
          estimatedWeight: optNum(body.estimatedWeight),
          lossPercent: optNum(body.lossPercent) ?? 0,
          requiresQuotation: optBool(body.requiresQuotation),
          requiresEngineeringReview: optBool(body.requiresEngineeringReview),
          canBecomeOfficial: body.canBecomeOfficial !== false,
          notes: optStr(body.notes),
        },
      });
      res.status(201).json(serializeSimulatedItem(row));
    } catch (e: unknown) {
      console.error("POST simulated-items", e);
      res.status(500).json({ error: "Erro ao criar item simulado." });
    }
  });

  app.patch("/api/projects/:id/simulated-items/:simulatedItemId", ...manage, async (req, res) => {
    try {
      if (!isUuid(req.params.id) || !isUuid(req.params.simulatedItemId)) {
        return res.status(400).json({ error: "ID inválido." });
      }
      const body = req.body ?? {};
      const row = await prisma.projectSimulatedItem.update({
        where: { id: req.params.simulatedItemId, projectId: req.params.id },
        data: {
          ...(body.provisionalCode !== undefined
            ? { provisionalCode: optStr(body.provisionalCode) }
            : {}),
          ...(body.description != null ? { description: String(body.description).trim() } : {}),
          ...(body.itemType != null ? { itemType: body.itemType } : {}),
          ...(body.unit != null ? { unit: String(body.unit).trim() } : {}),
          ...(body.estimatedUnitCost !== undefined
            ? { estimatedUnitCost: optNum(body.estimatedUnitCost) }
            : {}),
          ...(body.quotedUnitCost !== undefined
            ? { quotedUnitCost: optNum(body.quotedUnitCost) }
            : {}),
          ...(body.supplierName !== undefined ? { supplierName: optStr(body.supplierName) } : {}),
          ...(body.leadTimeDays !== undefined
            ? { leadTimeDays: body.leadTimeDays != null ? Number(body.leadTimeDays) : null }
            : {}),
          ...(body.estimatedWeight !== undefined
            ? { estimatedWeight: optNum(body.estimatedWeight) }
            : {}),
          ...(body.lossPercent !== undefined ? { lossPercent: optNum(body.lossPercent) } : {}),
          ...(body.requiresQuotation !== undefined
            ? { requiresQuotation: optBool(body.requiresQuotation) }
            : {}),
          ...(body.requiresEngineeringReview !== undefined
            ? { requiresEngineeringReview: optBool(body.requiresEngineeringReview) }
            : {}),
          ...(body.canBecomeOfficial !== undefined
            ? { canBecomeOfficial: body.canBecomeOfficial !== false }
            : {}),
          ...(body.notes !== undefined ? { notes: optStr(body.notes) } : {}),
        },
      });
      res.json(serializeSimulatedItem(row));
    } catch (e: unknown) {
      console.error("PATCH simulated-items", e);
      res.status(500).json({ error: "Erro ao atualizar item simulado." });
    }
  });

  app.delete("/api/projects/:id/simulated-items/:simulatedItemId", ...manage, async (req, res) => {
    try {
      if (!isUuid(req.params.id) || !isUuid(req.params.simulatedItemId)) {
        return res.status(400).json({ error: "ID inválido." });
      }
      const existing = await prisma.projectSimulatedItem.findFirst({
        where: { id: req.params.simulatedItemId, projectId: req.params.id },
      });
      if (!existing) return res.status(404).json({ error: "Item simulado não encontrado." });
      await prisma.projectSimulatedItem.delete({ where: { id: req.params.simulatedItemId } });
      const ctx = await requireProjectAndVersion(req.params.id);
      if (!("error" in ctx) && ctx.version) {
        await recalculateAndPersistVersionCosts(ctx.version.id);
      }
      res.json({ ok: true });
    } catch (e: unknown) {
      console.error("DELETE simulated-items", e);
      res.status(500).json({ error: "Erro ao excluir item simulado." });
    }
  });

  app.post("/api/projects/:id/structure-lines", ...manage, async (req, res) => {
    try {
      if (!isUuid(req.params.id)) return res.status(400).json({ error: "ID inválido." });
      const ctx = await requireProjectAndVersion(req.params.id);
      if ("error" in ctx) return res.status(404).json({ error: ctx.error });
      const body = req.body ?? {};
      const sourceType = body.sourceType ?? "MANUAL";
      const quantity = optNum(body.quantity) ?? 0;
      const lossPercent = optNum(body.lossPercent) ?? 0;

      let existingProduct = null;
      let existingMaterial = null;
      let simulatedItem = null;

      if (sourceType === "EXISTING_PRODUCT" && isUuid(body.existingProductId)) {
        existingProduct = await prisma.product.findUnique({
          where: { id: body.existingProductId },
        });
        if (!existingProduct) return res.status(400).json({ error: "Produto não encontrado." });
      }
      if (sourceType === "EXISTING_MATERIAL" && isUuid(body.existingMaterialId)) {
        existingMaterial = await prisma.material.findUnique({
          where: { id: body.existingMaterialId },
        });
        if (!existingMaterial) return res.status(400).json({ error: "Material não encontrado." });
      }
      if (sourceType === "SIMULATED_ITEM" && isUuid(body.simulatedItemId)) {
        simulatedItem = await prisma.projectSimulatedItem.findFirst({
          where: { id: body.simulatedItemId, projectId: req.params.id },
        });
        if (!simulatedItem) return res.status(400).json({ error: "Item simulado não encontrado." });
      }

      const snapshots = resolveStructureLineSnapshots({
        sourceType,
        existingProduct,
        existingMaterial,
        simulatedItem,
        manualDescription: body.description,
        manualUnit: body.unit,
        manualUnitCost: optNum(body.unitCost) ?? 0,
      });

      const unitCost =
        body.unitCost != null ? (optNum(body.unitCost) ?? 0) : snapshots.unitCost;
      const totalCost = buildStructureLineTotal(quantity, unitCost, lossPercent);

      const row = await prisma.projectStructureLine.create({
        data: {
          projectId: req.params.id,
          versionId: ctx.version.id,
          simulatedProductId: isUuid(body.simulatedProductId) ? body.simulatedProductId : null,
          lineType: body.lineType ?? "OTHER",
          sourceType,
          existingProductId: existingProduct?.id ?? null,
          existingMaterialId: existingMaterial?.id ?? null,
          simulatedItemId: simulatedItem?.id ?? null,
          descriptionSnapshot: snapshots.description,
          unitSnapshot: snapshots.unit,
          quantity,
          lossPercent,
          unitCostSnapshot: unitCost,
          totalCost,
          supplierNameSnapshot: optStr(body.supplierName),
          notes: optStr(body.notes),
          sortOrder: Number(body.sortOrder) || 0,
        },
      });

      await recalculateAndPersistVersionCosts(ctx.version.id);
      res.status(201).json(serializeStructureLine(row));
    } catch (e: unknown) {
      console.error("POST structure-lines", e);
      res.status(500).json({ error: "Erro ao criar linha de estrutura." });
    }
  });

  app.patch("/api/projects/:id/structure-lines/:lineId", ...manage, async (req, res) => {
    try {
      if (!isUuid(req.params.id) || !isUuid(req.params.lineId)) {
        return res.status(400).json({ error: "ID inválido." });
      }
      const existing = await prisma.projectStructureLine.findFirst({
        where: { id: req.params.lineId, projectId: req.params.id },
      });
      if (!existing) return res.status(404).json({ error: "Linha não encontrada." });

      const body = req.body ?? {};
      const quantity = body.quantity != null ? (optNum(body.quantity) ?? 0) : dec(existing.quantity) ?? 0;
      const unitCost =
        body.unitCost != null ? (optNum(body.unitCost) ?? 0) : dec(existing.unitCostSnapshot) ?? 0;
      const lossPercent =
        body.lossPercent != null ? (optNum(body.lossPercent) ?? 0) : dec(existing.lossPercent) ?? 0;
      const totalCost = buildStructureLineTotal(quantity, unitCost, lossPercent);

      const descriptionSnapshot =
        body.descriptionSnapshot != null
          ? String(body.descriptionSnapshot).trim()
          : body.description != null
            ? String(body.description).trim()
            : undefined;
      const unitSnapshot =
        body.unitSnapshot != null
          ? String(body.unitSnapshot).trim()
          : body.unit != null
            ? String(body.unit).trim()
            : undefined;

      const officialQty = dec(existing.officialQuantitySnapshot);
      const officialLoss = dec(existing.officialLossPercentSnapshot);
      const officialUnit = dec(existing.officialUnitCostSnapshot);
      const changed =
        (officialQty != null && Math.abs(officialQty - quantity) > 0.000001) ||
        (officialLoss != null && Math.abs(officialLoss - lossPercent) > 0.000001) ||
        (officialUnit != null && Math.abs(officialUnit - unitCost) > 0.000001) ||
        (officialUnit == null && unitCost > 0);

      const row = await prisma.projectStructureLine.update({
        where: { id: req.params.lineId },
        data: {
          ...(body.lineType != null ? { lineType: body.lineType } : {}),
          ...(descriptionSnapshot != null ? { descriptionSnapshot } : {}),
          ...(unitSnapshot != null ? { unitSnapshot } : {}),
          ...(body.quantity != null ? { quantity } : {}),
          ...(body.lossPercent != null ? { lossPercent } : {}),
          ...(body.unitCost != null ? { unitCostSnapshot: unitCost } : {}),
          totalCost,
          isChangedFromOfficial: changed,
          isMissingCost: unitCost <= 0,
          ...(body.notes !== undefined ? { notes: optStr(body.notes) } : {}),
          ...(body.sortOrder != null ? { sortOrder: Number(body.sortOrder) || 0 } : {}),
        },
      });

      await recalculateAndPersistVersionCosts(existing.versionId);
      res.json(serializeStructureLine(row));
    } catch (e: unknown) {
      console.error("PATCH structure-lines", e);
      res.status(500).json({ error: "Erro ao atualizar linha de estrutura." });
    }
  });

  app.delete("/api/projects/:id/structure-lines/:lineId", ...manage, async (req, res) => {
    try {
      if (!isUuid(req.params.id) || !isUuid(req.params.lineId)) {
        return res.status(400).json({ error: "ID inválido." });
      }
      const existing = await prisma.projectStructureLine.findFirst({
        where: { id: req.params.lineId, projectId: req.params.id },
      });
      if (!existing) return res.status(404).json({ error: "Linha não encontrada." });
      await prisma.projectStructureLine.delete({ where: { id: req.params.lineId } });
      await recalculateAndPersistVersionCosts(existing.versionId);
      res.json({ ok: true });
    } catch (e: unknown) {
      console.error("DELETE structure-lines", e);
      res.status(500).json({ error: "Erro ao excluir linha de estrutura." });
    }
  });

  app.post("/api/projects/:id/molds", ...manage, async (req, res) => {
    try {
      if (!isUuid(req.params.id)) return res.status(400).json({ error: "ID inválido." });
      const ctx = await requireProjectAndVersion(req.params.id);
      if ("error" in ctx) return res.status(404).json({ error: ctx.error });
      const body = req.body ?? {};
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) return res.status(400).json({ error: "Nome do molde é obrigatório." });

      const constructionCost = optNum(body.constructionCost) ?? 0;
      const chargeMode = body.chargeMode ?? "CHARGED_SEPARATELY";
      const amortizationQuantity = optNum(body.amortizationQuantity);
      const amortizedCostPerUnit =
        body.amortizedCostPerUnit != null
          ? optNum(body.amortizedCostPerUnit)
          : resolveMoldAmortizedCost(constructionCost, chargeMode, amortizationQuantity);

      const row = await prisma.projectMold.create({
        data: {
          projectId: req.params.id,
          versionId: ctx.version.id,
          name,
          moldType: optStr(body.moldType),
          cavities: body.cavities != null ? Number(body.cavities) : null,
          estimatedLifeCycles:
            body.estimatedLifeCycles != null ? Number(body.estimatedLifeCycles) : null,
          supplierName: optStr(body.supplierName),
          constructionCost,
          maintenanceCost: optNum(body.maintenanceCost),
          changeCost: optNum(body.changeCost),
          leadTimeDays: body.leadTimeDays != null ? Number(body.leadTimeDays) : null,
          chargeMode,
          amortizationQuantity,
          amortizedCostPerUnit,
          ownership: body.ownership ?? "UNDEFINED",
          notes: optStr(body.notes),
        },
      });

      await recalculateAndPersistVersionCosts(ctx.version.id);
      res.status(201).json(serializeMold(row));
    } catch (e: unknown) {
      console.error("POST molds", e);
      res.status(500).json({ error: "Erro ao criar molde." });
    }
  });

  app.patch("/api/projects/:id/molds/:moldId", ...manage, async (req, res) => {
    try {
      if (!isUuid(req.params.id) || !isUuid(req.params.moldId)) {
        return res.status(400).json({ error: "ID inválido." });
      }
      const existing = await prisma.projectMold.findFirst({
        where: { id: req.params.moldId, projectId: req.params.id },
      });
      if (!existing) return res.status(404).json({ error: "Molde não encontrado." });

      const body = req.body ?? {};
      const constructionCost =
        body.constructionCost != null
          ? (optNum(body.constructionCost) ?? 0)
          : (dec(existing.constructionCost) ?? 0);
      const chargeMode = body.chargeMode ?? existing.chargeMode;
      const amortizationQuantity =
        body.amortizationQuantity !== undefined
          ? optNum(body.amortizationQuantity)
          : dec(existing.amortizationQuantity);
      const amortizedCostPerUnit =
        body.amortizedCostPerUnit != null
          ? optNum(body.amortizedCostPerUnit)
          : resolveMoldAmortizedCost(constructionCost, chargeMode, amortizationQuantity);

      const row = await prisma.projectMold.update({
        where: { id: req.params.moldId },
        data: {
          ...(body.name != null ? { name: String(body.name).trim() } : {}),
          ...(body.moldType !== undefined ? { moldType: optStr(body.moldType) } : {}),
          ...(body.cavities !== undefined
            ? { cavities: body.cavities != null ? Number(body.cavities) : null }
            : {}),
          ...(body.estimatedLifeCycles !== undefined
            ? {
                estimatedLifeCycles:
                  body.estimatedLifeCycles != null ? Number(body.estimatedLifeCycles) : null,
              }
            : {}),
          ...(body.supplierName !== undefined ? { supplierName: optStr(body.supplierName) } : {}),
          ...(body.constructionCost != null ? { constructionCost } : {}),
          ...(body.maintenanceCost !== undefined
            ? { maintenanceCost: optNum(body.maintenanceCost) }
            : {}),
          ...(body.changeCost !== undefined ? { changeCost: optNum(body.changeCost) } : {}),
          ...(body.leadTimeDays !== undefined
            ? { leadTimeDays: body.leadTimeDays != null ? Number(body.leadTimeDays) : null }
            : {}),
          ...(body.chargeMode != null ? { chargeMode } : {}),
          ...(body.amortizationQuantity !== undefined ? { amortizationQuantity } : {}),
          amortizedCostPerUnit,
          ...(body.ownership != null ? { ownership: body.ownership } : {}),
          ...(body.notes !== undefined ? { notes: optStr(body.notes) } : {}),
        },
      });

      await recalculateAndPersistVersionCosts(existing.versionId);
      res.json(serializeMold(row));
    } catch (e: unknown) {
      console.error("PATCH molds", e);
      res.status(500).json({ error: "Erro ao atualizar molde." });
    }
  });

  app.delete("/api/projects/:id/molds/:moldId", ...manage, async (req, res) => {
    try {
      if (!isUuid(req.params.id) || !isUuid(req.params.moldId)) {
        return res.status(400).json({ error: "ID inválido." });
      }
      const existing = await prisma.projectMold.findFirst({
        where: { id: req.params.moldId, projectId: req.params.id },
      });
      if (!existing) return res.status(404).json({ error: "Molde não encontrado." });
      await prisma.projectMold.delete({ where: { id: req.params.moldId } });
      await recalculateAndPersistVersionCosts(existing.versionId);
      res.json({ ok: true });
    } catch (e: unknown) {
      console.error("DELETE molds", e);
      res.status(500).json({ error: "Erro ao excluir molde." });
    }
  });
}
