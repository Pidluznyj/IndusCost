/**
 * Metas (OKR) — rotas HTTP. Guard: recurso `admin.goals` (contrato canônico).
 *   view   → listar/consultar (todos os perfis com o recurso liberado)
 *   create → criar Objetivo/KR
 *   update → editar, lançar valor realizado
 *   manage → excluir/arquivar
 */

import type express from "express";
import type { RequestHandler } from "express";
import { prisma } from "@/src/lib/prisma.js";
import {
  GoalContractError,
  parseGoalAchievedValueInput,
  parseGoalCreateInput,
  parseGoalInitiativeCreateInput,
  parseGoalInitiativeUpdateInput,
  parseGoalKeyResultCreateInput,
  parseGoalKeyResultUpdateInput,
  parseGoalQuotasInput,
  parseGoalUpdateInput,
  parseGoalWizardInput,
  GOAL_STATUSES,
  type GoalStatusValue,
} from "./goalContracts.js";
import { buildGoalMetadataPublicView } from "./goalMetadata.js";
import { GoalDomainError, createGoalService, type GoalService } from "./goalService.server.js";

export const GOALS_RESOURCE_KEY = "admin.goals" as const;

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
  getCurrentAppUser: (
    req: express.Request
  ) => Promise<{ id: string } | null> | { id: string } | null;
  /** Injeção para teste — em produção usa createGoalService({ prisma }). */
  service?: GoalService;
};

function sendGoalError(res: express.Response, err: unknown): void {
  if (err instanceof GoalContractError) {
    res.status(400).json({ error: err.message, field: err.field, code: err.code });
    return;
  }
  if (err instanceof GoalDomainError) {
    const status =
      err.code === "NOT_FOUND"
        ? 404
        : err.code === "CONFLICT"
          ? 409
          : err.code === "BUSY"
            ? 423
            : 400;
    res.status(status).json({ error: err.message, code: err.code });
    return;
  }
  console.error("[goals] erro:", err);
  res.status(500).json({ error: "Erro interno no módulo de Metas." });
}

export function registerGoalRoutes(app: express.Express, guards: AuthGuards): void {
  const { requireAppAuth, requireResource, getCurrentAppUser } = guards;
  const service = guards.service ?? createGoalService({ prisma });

  const view = requireResource(GOALS_RESOURCE_KEY, "view");
  const create = requireResource(GOALS_RESOURCE_KEY, "create");
  const update = requireResource(GOALS_RESOURCE_KEY, "update");
  const manage = requireResource(GOALS_RESOURCE_KEY, "manage");

  app.get("/api/goals", requireAppAuth, view, async (req, res) => {
    try {
      const onlyMine = req.query.onlyMine === "true";
      const user = onlyMine ? await getCurrentAppUser(req) : null;
      const statusRaw = typeof req.query.status === "string" ? req.query.status : null;
      const status =
        statusRaw && (GOAL_STATUSES as readonly string[]).includes(statusRaw)
          ? (statusRaw as GoalStatusValue)
          : null;
      const yearRaw = Number.parseInt(String(req.query.year ?? ""), 10);
      const goals = await service.listGoals({
        ownerAppUserId: onlyMine ? user?.id ?? "__none__" : null,
        status,
        includeArchived: req.query.includeArchived === "true",
        year: Number.isFinite(yearRaw) && yearRaw > 2000 ? yearRaw : null,
      });
      res.json({ goals });
    } catch (err) {
      sendGoalError(res, err);
    }
  });

  // Seletor de Owner — id+nome de usuários ativos (nada sensível).
  app.get("/api/goals/owner-options", requireAppAuth, view, async (_req, res) => {
    try {
      res.json({ owners: await service.listOwnerOptions() });
    } catch (err) {
      sendGoalError(res, err);
    }
  });

  // Dicionário de metadados (visão pública — só chaves/labels, nunca colunas).
  app.get("/api/goals/metadata", requireAppAuth, view, async (_req, res) => {
    try {
      res.json({ entities: buildGoalMetadataPublicView() });
    } catch (err) {
      sendGoalError(res, err);
    }
  });

  // "Testar medição agora" — SOMENTE LEITURA: valida a regra contra o
  // dicionário e devolve o valor atual na janela; nada é persistido.
  app.post("/api/goals/rules/preview", requireAppAuth, view, async (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const startCivilDate = String(body.startDate ?? "");
      const endCivilDate = String(body.endDate ?? "");
      const civilDate = /^\d{4}-\d{2}-\d{2}$/;
      if (
        !civilDate.test(startCivilDate) ||
        !civilDate.test(endCivilDate) ||
        endCivilDate < startCivilDate
      ) {
        res.status(400).json({
          error: "Informe o período da medição (datas de início e fim).",
          field: "startDate",
          code: "VALIDATION_ERROR",
        });
        return;
      }
      res.json(await service.previewRule(body.rule, { startCivilDate, endCivilDate }));
    } catch (err) {
      sendGoalError(res, err);
    }
  });

  // Wizard: Objetivo + KR (com regra opcional) + cotas numa transação.
  app.post("/api/goals/wizard", requireAppAuth, create, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      const input = parseGoalWizardInput((req.body ?? {}) as Record<string, unknown>);
      res
        .status(201)
        .json({ goal: await service.createFromWizard(input, user?.id ?? "") });
    } catch (err) {
      sendGoalError(res, err);
    }
  });

  // Iniciativas (kanban) — membros da equipe gerenciam com "update".
  app.post("/api/goals/initiatives", requireAppAuth, update, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      const input = parseGoalInitiativeCreateInput(
        (req.body ?? {}) as Record<string, unknown>
      );
      res
        .status(201)
        .json({ initiative: await service.createInitiative(input, user?.id ?? "") });
    } catch (err) {
      sendGoalError(res, err);
    }
  });

  app.put("/api/goals/initiatives/:id", requireAppAuth, update, async (req, res) => {
    try {
      const input = parseGoalInitiativeUpdateInput(
        (req.body ?? {}) as Record<string, unknown>
      );
      res.json({ initiative: await service.updateInitiative(req.params.id, input) });
    } catch (err) {
      sendGoalError(res, err);
    }
  });

  app.delete("/api/goals/initiatives/:id", requireAppAuth, update, async (req, res) => {
    try {
      res.json(await service.deleteInitiative(req.params.id));
    } catch (err) {
      sendGoalError(res, err);
    }
  });

  app.get("/api/goals/:id", requireAppAuth, view, async (req, res) => {
    try {
      res.json({ goal: await service.getGoal(req.params.id) });
    } catch (err) {
      sendGoalError(res, err);
    }
  });

  app.post("/api/goals", requireAppAuth, create, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      const input = parseGoalCreateInput((req.body ?? {}) as Record<string, unknown>);
      res.status(201).json({ goal: await service.createGoal(input, user?.id ?? "") });
    } catch (err) {
      sendGoalError(res, err);
    }
  });

  app.put("/api/goals/:id", requireAppAuth, update, async (req, res) => {
    try {
      const input = parseGoalUpdateInput((req.body ?? {}) as Record<string, unknown>);
      res.json({ goal: await service.updateGoal(req.params.id, input) });
    } catch (err) {
      sendGoalError(res, err);
    }
  });

  app.delete("/api/goals/:id", requireAppAuth, manage, async (req, res) => {
    try {
      res.json(await service.deleteGoal(req.params.id));
    } catch (err) {
      sendGoalError(res, err);
    }
  });

  app.post("/api/goals/:id/key-results", requireAppAuth, create, async (req, res) => {
    try {
      const input = parseGoalKeyResultCreateInput(
        (req.body ?? {}) as Record<string, unknown>
      );
      res.status(201).json({
        keyResult: await service.createKeyResult(req.params.id, input),
      });
    } catch (err) {
      sendGoalError(res, err);
    }
  });

  app.put("/api/goals/key-results/:id", requireAppAuth, update, async (req, res) => {
    try {
      const input = parseGoalKeyResultUpdateInput(
        (req.body ?? {}) as Record<string, unknown>
      );
      res.json({ keyResult: await service.updateKeyResult(req.params.id, input) });
    } catch (err) {
      sendGoalError(res, err);
    }
  });

  app.delete("/api/goals/key-results/:id", requireAppAuth, manage, async (req, res) => {
    try {
      res.json(await service.deleteKeyResult(req.params.id));
    } catch (err) {
      sendGoalError(res, err);
    }
  });

  // MVP 1: valor realizado manual — grava valor vivo + snapshot do dia (RN-009).
  app.post(
    "/api/goals/key-results/:id/achieved-value",
    requireAppAuth,
    update,
    async (req, res) => {
      try {
        const input = parseGoalAchievedValueInput(
          (req.body ?? {}) as Record<string, unknown>
        );
        res.json({ keyResult: await service.setAchievedValue(req.params.id, input) });
      } catch (err) {
        sendGoalError(res, err);
      }
    }
  );

  // "Atualizar Painel" — recalcula o KR de regra AGORA (advisory lock; 423 se ocupado).
  app.post(
    "/api/goals/key-results/:id/refresh",
    requireAppAuth,
    update,
    async (req, res) => {
      try {
        res.json({ keyResult: await service.refreshKeyResult(req.params.id) });
      } catch (err) {
        sendGoalError(res, err);
      }
    }
  );

  // Desdobramento (US-04): substitui as cotas do KR (Σ ≤ target — bloqueio).
  app.put(
    "/api/goals/key-results/:id/quotas",
    requireAppAuth,
    update,
    async (req, res) => {
      try {
        const quotas = parseGoalQuotasInput((req.body ?? {}) as Record<string, unknown>);
        res.json({ keyResult: await service.setQuotas(req.params.id, quotas) });
      } catch (err) {
        sendGoalError(res, err);
      }
    }
  );

  app.get(
    "/api/goals/key-results/:id/snapshots",
    requireAppAuth,
    view,
    async (req, res) => {
      try {
        res.json({ snapshots: await service.listSnapshots(req.params.id) });
      } catch (err) {
        sendGoalError(res, err);
      }
    }
  );
}
