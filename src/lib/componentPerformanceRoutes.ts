import type express from "express";
import type { RequestHandler } from "express";
import type { AppAuthContext } from "./appAuth.js";
import { prisma } from "./prisma.js";
import {
  actorFromAppAuth,
  ComponentPerformanceValidationError,
  getComponentPerformanceProduct,
  listComponentPerformanceHistory,
  listComponentPerformanceProducts,
  patchComponentPerformanceProduct,
} from "./componentPerformanceChange.server.js";
import {
  buildComponentPerformanceCoverageReportFromDb,
  serializeCoverageReportForApi,
} from "./componentPerformanceCoverage.server.js";
import {
  COMPONENT_PERFORMANCE_EDIT_PERMISSIONS,
  COMPONENT_PERFORMANCE_VIEW_PERMISSIONS,
} from "./componentPerformancePermissions.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireAnyPermission: (permissions: string[]) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function handleServiceError(error: unknown, res: express.Response, context: string): void {
  if (error instanceof ComponentPerformanceValidationError) {
    const status =
      error.code === "NOT_FOUND"
        ? 404
        : error.code === "NOT_COMPONENT"
          ? 409
          : 400;
    res.status(status).json({ error: error.code, message: error.message });
    return;
  }
  const message = error instanceof Error ? error.message : "Erro interno.";
  console.error(context, error);
  res.status(500).json({ error: "INTERNAL_ERROR", message });
}

export function registerComponentPerformanceRoutes(
  app: express.Express,
  auth: AuthGuards
): void {
  const { requireAppAuth, requireAnyPermission, getCurrentAppUser } = auth;

  app.get(
    "/api/operations/performance/coverage",
    requireAppAuth,
    requireAnyPermission([...COMPONENT_PERFORMANCE_VIEW_PERMISSIONS, "products.view"]),
    async (req, res) => {
      try {
        const report = await buildComponentPerformanceCoverageReportFromDb(
          prisma,
          req.query as Record<string, unknown>
        );
        res.json(serializeCoverageReportForApi(report));
      } catch (error) {
        handleServiceError(error, res, "GET /api/operations/performance/coverage");
      }
    }
  );

  app.get(
    "/api/operations/performance/components",
    requireAppAuth,
    requireAnyPermission([...COMPONENT_PERFORMANCE_VIEW_PERMISSIONS, "products.view"]),
    async (req, res) => {
      try {
        const payload = await listComponentPerformanceProducts(
          prisma,
          req.query as Record<string, unknown>
        );
        res.json(payload);
      } catch (error) {
        handleServiceError(error, res, "GET /api/operations/performance/components");
      }
    }
  );

  app.get(
    "/api/operations/performance/components/:id",
    requireAppAuth,
    requireAnyPermission([...COMPONENT_PERFORMANCE_VIEW_PERMISSIONS, "products.view"]),
    async (req, res) => {
      try {
        const { id } = req.params;
        if (!isUuid(id)) {
          return res.status(400).json({ error: "INVALID_ID", message: "ID inválido." });
        }
        const product = await getComponentPerformanceProduct(prisma, id);
        if (!product) {
          return res.status(404).json({ error: "NOT_FOUND", message: "Componente não encontrado." });
        }
        res.json(product);
      } catch (error) {
        handleServiceError(error, res, "GET /api/operations/performance/components/:id");
      }
    }
  );

  app.patch(
    "/api/operations/performance/components/:id",
    requireAppAuth,
    requireAnyPermission([...COMPONENT_PERFORMANCE_EDIT_PERMISSIONS, "products.edit"]),
    async (req, res) => {
      try {
        const { id } = req.params;
        if (!isUuid(id)) {
          return res.status(400).json({ error: "INVALID_ID", message: "ID inválido." });
        }
        const user = await getCurrentAppUser(req);
        if (!user) {
          return res.status(401).json({ error: "UNAUTHORIZED", message: "Sessão inválida." });
        }
        const result = await patchComponentPerformanceProduct(
          prisma,
          id,
          req.body,
          actorFromAppAuth(user)
        );
        res.json(result);
      } catch (error) {
        handleServiceError(error, res, "PATCH /api/operations/performance/components/:id");
      }
    }
  );

  app.get(
    "/api/operations/performance/components/:id/history",
    requireAppAuth,
    requireAnyPermission([...COMPONENT_PERFORMANCE_VIEW_PERMISSIONS, "products.view"]),
    async (req, res) => {
      try {
        const { id } = req.params;
        if (!isUuid(id)) {
          return res.status(400).json({ error: "INVALID_ID", message: "ID inválido." });
        }
        const limit = req.query.limit != null ? Number(req.query.limit) : undefined;
        const offset = req.query.offset != null ? Number(req.query.offset) : undefined;
        const history = await listComponentPerformanceHistory(prisma, id, { limit, offset });
        if (!history) {
          return res.status(404).json({ error: "NOT_FOUND", message: "Componente não encontrado." });
        }
        res.json(history);
      } catch (error) {
        handleServiceError(error, res, "GET /api/operations/performance/components/:id/history");
      }
    }
  );
}
