/**
 * HTTP do Exposure. Ciência oficial não tem rota.
 */

import type express from "express";
import type { RequestHandler } from "express";
import { prisma } from "@/src/lib/prisma.js";
import { LEGAL_EXPOSURE_SOURCES, type LegalExposureSource } from "./legalExposureContracts.js";
import { LEGAL_EXPOSURE_RESOURCES } from "./legalExposurePermissions.js";
import { createPrismaExposureRepository } from "./legalExposureRepository.server.js";
import {
  createLegalExposureService,
  ExposureServiceError,
  type ExposureServiceDeps,
} from "./legalExposureService.server.js";

type ExposureService = ReturnType<typeof createLegalExposureService>;

export type LegalExposureRouteGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<{ id: string } | null> | { id: string } | null;
  service?: ExposureService;
  recordIntegrationRun?: ExposureServiceDeps["recordIntegrationRun"];
};

function sendError(res: express.Response, error: unknown): void {
  if (error instanceof ExposureServiceError) {
    const status = error.code === "NOT_FOUND" ? 404 : error.code === "CONFLICT" ? 409 : 400;
    res.status(status).json({ error: error.message, code: error.code });
    return;
  }
  res.status(500).json({ error: "Erro interno no Exposure." });
}

function queryOf(req: express.Request) {
  const q = req.query;
  const text = (key: string) => (typeof q[key] === "string" ? q[key] : null);
  return {
    entityId: text("entityId"),
    status: text("status"),
    tribunal: text("tribunal"),
    source: text("source"),
    severity: text("severity"),
    pole: text("pole"),
    q: text("q"),
    from: text("from"),
    to: text("to"),
    page: q.page,
    pageSize: q.pageSize,
  };
}

export function registerLegalExposureRoutes(
  app: express.Express,
  guards: LegalExposureRouteGuards
): void {
  const service =
    guards.service ??
    createLegalExposureService({
      repository: createPrismaExposureRepository(prisma),
      recordIntegrationRun:
        guards.recordIntegrationRun ??
        (async (input) => {
          await prisma.integrationRun.create({
            data: {
              sourceSystem: "CNJ",
              target: input.target,
              mode: input.mode,
              status: input.status,
              success: input.status === "SUCCESS" || input.status === "NO_RESULTS" || input.status === "PARTIAL",
              summaryJson: input.summary as object,
              startedAt: new Date(),
              finishedAt: new Date(),
            },
          });
        }),
    });

  const auth = guards.requireAppAuth;
  const view = guards.requireResource(LEGAL_EXPOSURE_RESOURCES.module, "view");
  const manage = guards.requireResource(LEGAL_EXPOSURE_RESOURCES.module, "manage");
  const communications = guards.requireResource(LEGAL_EXPOSURE_RESOURCES.communications, "view");
  const sourcesView = guards.requireResource(LEGAL_EXPOSURE_RESOURCES.sources, "view");
  const sync = guards.requireResource(LEGAL_EXPOSURE_RESOURCES.sync, "execute");
  const certificatesView = guards.requireResource(LEGAL_EXPOSURE_RESOURCES.certificates, "view");
  const certificatesManage = guards.requireResource(LEGAL_EXPOSURE_RESOURCES.certificates, "manage");
  const settingsView = guards.requireResource(LEGAL_EXPOSURE_RESOURCES.settings, "view");

  async function userId(req: express.Request): Promise<string> {
    const user = await guards.getCurrentAppUser(req);
    return user?.id ?? "";
  }

  app.get("/api/legal-exposure/dashboard", auth, view, async (_req, res) => {
    try {
      res.json(await service.dashboard());
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get("/api/legal-exposure/entities", auth, view, async (_req, res) => {
    try {
      res.json(await service.listEntities());
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get("/api/legal-exposure/group-companies", auth, view, async (_req, res) => {
    try {
      res.json(await service.listGroupCompanies());
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/legal-exposure/entities", auth, manage, async (req, res) => {
    try {
      res.status(201).json(await service.createEntity(req.body ?? {}, await userId(req)));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.patch("/api/legal-exposure/entities/:id", auth, manage, async (req, res) => {
    try {
      res.json(await service.updateEntity(String(req.params.id), req.body ?? {}, await userId(req)));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get("/api/legal-exposure/entities/:id/aliases", auth, manage, async (req, res) => {
    try {
      res.json(await service.listAliases(String(req.params.id)));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/legal-exposure/entities/:id/aliases", auth, manage, async (req, res) => {
    try {
      res.status(201).json(await service.createAlias(String(req.params.id), req.body ?? {}, await userId(req)));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.patch("/api/legal-exposure/aliases/:id", auth, manage, async (req, res) => {
    try {
      res.json(await service.updateAlias(String(req.params.id), req.body ?? {}, await userId(req)));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get("/api/legal-exposure/cases", auth, view, async (req, res) => {
    try {
      res.json(await service.listCases(queryOf(req)));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get("/api/legal-exposure/cases/:id", auth, view, async (req, res) => {
    try {
      res.json(await service.getCase(String(req.params.id), await userId(req)));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get("/api/legal-exposure/cases/:id/timeline", auth, view, async (req, res) => {
    try {
      res.json(await service.timeline(String(req.params.id), queryOf(req), await userId(req)));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get("/api/legal-exposure/communications", auth, communications, async (req, res) => {
    try {
      res.json(await service.listCommunications(queryOf(req), await userId(req)));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get("/api/legal-exposure/events", auth, view, async (req, res) => {
    try {
      res.json(await service.listEvents(queryOf(req)));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get("/api/legal-exposure/alerts", auth, view, async (req, res) => {
    try {
      res.json(await service.listAlerts(queryOf(req)));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/legal-exposure/alerts/:id/acknowledge", auth, manage, async (req, res) => {
    try {
      await service.acknowledgeAlert(String(req.params.id), await userId(req));
      res.json({ ok: true });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/legal-exposure/alerts/:id/resolve", auth, manage, async (req, res) => {
    try {
      await service.resolveAlert(String(req.params.id), await userId(req));
      res.json({ ok: true });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get("/api/legal-exposure/certificates", auth, certificatesView, async (req, res) => {
    try {
      const entityId = typeof req.query.entityId === "string" ? req.query.entityId : null;
      res.json(await service.listCertificates(entityId));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/legal-exposure/certificates", auth, certificatesManage, async (req, res) => {
    try {
      res.status(201).json(await service.registerCertificate(req.body ?? {}, await userId(req)));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get("/api/legal-exposure/sources/status", auth, sourcesView, async (_req, res) => {
    try {
      res.json(await service.sourceStatus());
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get("/api/legal-exposure/settings", auth, settingsView, async (_req, res) => {
    try {
      const status = await service.sourceStatus();
      res.json({
        configuration: status.configuration.map((row) => ({
          source: row.source,
          configured: row.configured,
          enabled: row.enabled,
        })),
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/legal-exposure/sync", auth, sync, async (req, res) => {
    try {
      res.json(await service.sync(req.body ?? {}, await userId(req)));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/legal-exposure/entities/:id/sync", auth, sync, async (req, res) => {
    try {
      res.json(
        await service.sync(
          { ...(req.body ?? {}), entityId: String(req.params.id) },
          await userId(req)
        )
      );
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/legal-exposure/sources/test", auth, sourcesView, async (req, res) => {
    try {
      const source = String(req.body?.source ?? "");
      if (!(LEGAL_EXPOSURE_SOURCES as readonly string[]).includes(source)) {
        res.status(400).json({ error: "Fonte inválida." });
        return;
      }
      res.json(await service.testConnection(source as LegalExposureSource, {
        entityId: typeof req.body?.entityId === "string" ? req.body.entityId : undefined,
      }));
    } catch (error) {
      sendError(res, error);
    }
  });
}
