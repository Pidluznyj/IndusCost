/**
 * Mapa de Atuação — rotas (somente leitura).
 *
 * Mesma permissão de Clientes › Indicadores: `commercial.customers` / view.
 * A autorização é do backend; esconder o bloco na tela não é controle.
 */

import type express from "express";
import type { RequestHandler } from "express";
import { prisma } from "@/src/lib/prisma.js";
import {
  parseCustomerMapBounds,
  parseCustomerMapFilters,
} from "./customerActivityMap.js";
import {
  createCustomerActivityMapService,
  type CustomerActivityMapService,
  type CustomerMapDetailScope,
} from "./customerActivityMapService.server.js";

export const CUSTOMER_ACTIVITY_MAP_RESOURCE_KEY = "commercial.customers" as const;

type Guards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
  service?: CustomerActivityMapService;
};

export function registerCustomerActivityMapRoutes(app: express.Express, guards: Guards): void {
  const { requireAppAuth, requireResource } = guards;
  const service = guards.service ?? createCustomerActivityMapService({ prisma });
  const view = requireResource(CUSTOMER_ACTIVITY_MAP_RESOURCE_KEY, "view");

  /** Visão agregada: resumo, UFs e municípios. */
  app.get("/api/customers/indicators/map", requireAppAuth, view, async (req, res) => {
    try {
      res.json(await service.getOverview(parseCustomerMapFilters(req.query)));
    } catch (error) {
      console.error("GET /api/customers/indicators/map", error);
      res.status(500).json({ error: "Não foi possível carregar o Mapa de Atuação." });
    }
  });

  /** Clientes individuais: por área visível (bbox), por município ou sem localização. */
  app.get("/api/customers/indicators/map/customers", requireAppAuth, view, async (req, res) => {
    let scope: CustomerMapDetailScope | null = null;
    if (req.query.unresolved === "true") {
      scope = { kind: "unresolved" };
    } else if (req.query.ibgeCode != null) {
      const ibgeCode = Number.parseInt(String(req.query.ibgeCode), 10);
      if (Number.isFinite(ibgeCode) && ibgeCode > 0) scope = { kind: "city", ibgeCode };
    } else {
      const bounds = parseCustomerMapBounds(req.query.bbox);
      if (bounds) scope = { kind: "bounds", bounds };
    }
    if (!scope) {
      res.status(400).json({
        error: "Informe bbox (oeste,sul,leste,norte), ibgeCode ou unresolved=true.",
      });
      return;
    }

    try {
      res.json(await service.getDetail(parseCustomerMapFilters(req.query), scope));
    } catch (error) {
      console.error("GET /api/customers/indicators/map/customers", error);
      res.status(500).json({ error: "Não foi possível carregar os clientes do mapa." });
    }
  });
}
