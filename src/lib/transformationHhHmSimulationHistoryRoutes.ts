import type express from "express";
import type { RequestHandler } from "express";
import type { PrismaClient } from "@prisma/client";
import {
  parseTransformationHhHmSimulationCreateBody,
  parseTransformationHhHmSimulationType,
  TRANSFORMATION_HH_HM_SIMULATION_HISTORY_API,
} from "./transformationHhHmSimulationHistory.js";
import {
  createTransformationHhHmCostSimulation,
  getTransformationHhHmCostSimulationById,
  listTransformationHhHmCostSimulations,
} from "./transformationHhHmSimulationHistory.server.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireBootstrapOrAnyPermission: (permissions: string[]) => RequestHandler;
  getCurrentAppUser: (
    req: express.Request
  ) => Promise<{ id: string; name?: string | null } | null>;
};

const VIEW_PERMISSIONS = ["products.view", "simulations.view", "costs.view"];

export function registerTransformationHhHmSimulationHistoryRoutes(
  app: express.Application,
  guards: AuthGuards,
  deps: { prisma: PrismaClient; isUuid: (value: unknown) => value is string }
): void {
  const { requireAppAuth, requireBootstrapOrAnyPermission, getCurrentAppUser } = guards;

  app.get(
    TRANSFORMATION_HH_HM_SIMULATION_HISTORY_API,
    requireAppAuth,
    requireBootstrapOrAnyPermission(VIEW_PERMISSIONS),
    async (req, res) => {
      try {
        const type = parseTransformationHhHmSimulationType(req.query.type);
        const limitRaw = typeof req.query.limit === "string" ? Number(req.query.limit) : 50;
        const payload = await listTransformationHhHmCostSimulations(deps.prisma, {
          type,
          limit: Number.isFinite(limitRaw) ? limitRaw : 50,
        });
        return res.json(payload);
      } catch (error) {
        console.error("GET transformation hh-hm simulations", error);
        return res.status(500).json({
          error: "HH_HM_SIMULATION_LIST_FAILED",
          message: "Não foi possível carregar as simulações salvas.",
          items: [],
          total: 0,
        });
      }
    }
  );

  app.get(
    `${TRANSFORMATION_HH_HM_SIMULATION_HISTORY_API}/:id`,
    requireAppAuth,
    requireBootstrapOrAnyPermission(VIEW_PERMISSIONS),
    async (req, res) => {
      try {
        if (!deps.isUuid(req.params.id)) {
          return res.status(400).json({
            error: "INVALID_ID",
            message: "Identificador inválido.",
          });
        }
        const item = await getTransformationHhHmCostSimulationById(deps.prisma, req.params.id);
        if (!item) {
          return res.status(404).json({
            error: "NOT_FOUND",
            message: "Simulação não encontrada.",
          });
        }
        return res.json(item);
      } catch (error) {
        console.error("GET transformation hh-hm simulation by id", error);
        return res.status(500).json({
          error: "HH_HM_SIMULATION_GET_FAILED",
          message: "Não foi possível carregar a simulação.",
        });
      }
    }
  );

  app.post(
    TRANSFORMATION_HH_HM_SIMULATION_HISTORY_API,
    requireAppAuth,
    requireBootstrapOrAnyPermission(VIEW_PERMISSIONS),
    async (req, res) => {
      try {
        const parsed = parseTransformationHhHmSimulationCreateBody(req.body);
        if (!parsed.ok) {
          return res.status(400).json({ error: parsed.code, message: parsed.message });
        }
        const authUser = await getCurrentAppUser(req);
        const created = await createTransformationHhHmCostSimulation(deps.prisma, {
          ...parsed.value,
          createdByUserId: authUser?.id ?? null,
          createdByName: authUser?.name ?? null,
        });
        return res.status(201).json(created);
      } catch (error) {
        console.error("POST transformation hh-hm simulation", error);
        return res.status(500).json({
          error: "HH_HM_SIMULATION_CREATE_FAILED",
          message: "Não foi possível salvar a simulação.",
        });
      }
    }
  );
}
