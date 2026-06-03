import type express from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { FleetValidationError } from "@/src/lib/fleetValidation.js";
import { writeFleetAuditLog } from "@/src/lib/fleetService.js";
import {
  CHECKLIST_INCLUDE,
  completeChecklist,
  DEFAULT_CHECKIN_ITEMS,
  DEFAULT_CHECKOUT_ITEMS,
  getChecklistOrThrow,
  parseChecklistItemBody,
  serializeChecklist,
} from "@/src/lib/fleetChecklistOps.js";
import type { FleetChecklistType } from "@prisma/client";
import { createFleetRouteGuards, type FleetAuthGuards } from "@/src/lib/fleetRouteGuards.js";

type AuthGuards = FleetAuthGuards;

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function fleetError(res: express.Response, e: unknown, logLabel: string) {
  if (e instanceof FleetValidationError) return res.status(400).json({ error: e.message });
  console.error(logLabel, e);
  return res.status(500).json({ error: e instanceof Error ? e.message : "Erro interno." });
}

export function registerFleetChecklistRoutes(app: express.Express, auth: AuthGuards) {
  const { getCurrentAppUser } = auth;
  const g = createFleetRouteGuards(auth);

  app.get("/api/fleet/checklists", ...g.view, async (req, res) => {
    try {
      const vehicleId = String(req.query.vehicleId ?? "").trim();
      const reservationId = String(req.query.reservationId ?? "").trim();
      const checklistType = String(req.query.checklistType ?? "").trim();
      const where: Prisma.FleetChecklistWhereInput = {};
      if (vehicleId && isUuid(vehicleId)) where.vehicleId = vehicleId;
      if (reservationId && isUuid(reservationId)) where.reservationId = reservationId;
      if (checklistType) where.checklistType = checklistType as FleetChecklistType;

      const rows = await prisma.fleetChecklist.findMany({
        where,
        include: CHECKLIST_INCLUDE,
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      res.json({ checklists: rows.map(serializeChecklist) });
    } catch (e) {
      fleetError(res, e, "GET checklists");
    }
  });

  app.get("/api/fleet/checklists/:id", ...g.view, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const checklist = await getChecklistOrThrow(id);
      res.json({ checklist: serializeChecklist(checklist) });
    } catch (e) {
      fleetError(res, e, "GET checklist");
    }
  });

  app.post("/api/fleet/checklists", ...g.checklistOps, async (req, res) => {
    try {
      const body = req.body ?? {};
      const vehicleId = body.vehicleId;
      if (!isUuid(vehicleId)) return res.status(400).json({ error: "Veículo inválido." });
      const checklistType = body.checklistType as FleetChecklistType;
      if (!["CHECKOUT", "CHECKIN", "INSPECTION", "MAINTENANCE"].includes(checklistType)) {
        return res.status(400).json({ error: "Tipo de checklist inválido." });
      }

      const user = await getCurrentAppUser(req);
      const template =
        body.useDefaultTemplate !== false
          ? checklistType === "CHECKIN"
            ? DEFAULT_CHECKIN_ITEMS
            : checklistType === "CHECKOUT"
              ? DEFAULT_CHECKOUT_ITEMS
              : []
          : [];

      const customItems = Array.isArray(body.items) ? body.items : [];
      const itemRows =
        customItems.length > 0
          ? customItems.map((raw: Record<string, unknown>) => {
              const parsed = parseChecklistItemBody(raw);
              return {
                itemName: parsed.itemName,
                isCritical: parsed.isCritical,
                result: parsed.result,
                notes: parsed.notes,
                attachmentUrl: parsed.attachmentUrl,
              };
            })
          : template.map((t) => ({
              itemName: t.itemName,
              isCritical: t.isCritical,
              result: null,
              notes: null,
              attachmentUrl: null,
            }));

      if (itemRows.length === 0) {
        return res.status(400).json({ error: "Informe itens ou use modelo padrão." });
      }

      const created = await prisma.fleetChecklist.create({
        data: {
          vehicleId,
          reservationId: isUuid(body.reservationId) ? body.reservationId : null,
          usageId: isUuid(body.usageId) ? body.usageId : null,
          checklistType,
          status: "DRAFT",
          notes: typeof body.notes === "string" ? body.notes.trim() || null : null,
          performedBy: user?.email ?? user?.name ?? null,
          items: { create: itemRows },
        },
        include: CHECKLIST_INCLUDE,
      });

      await writeFleetAuditLog({
        entityType: "FleetChecklist",
        entityId: created.id,
        action: "CREATE",
        newValue: checklistType,
        userId: user?.id ?? null,
      });

      res.status(201).json({ checklist: serializeChecklist(created) });
    } catch (e) {
      fleetError(res, e, "POST checklist");
    }
  });

  app.put("/api/fleet/checklists/:id", ...g.checklistOps, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const user = await getCurrentAppUser(req);
      const body = req.body ?? {};

      if (body.status === "COMPLETED" || body.complete === true) {
        const checklist = await completeChecklist(
          id,
          user?.email ?? user?.name ?? null,
          user?.id ?? null
        );
        return res.json({ checklist });
      }

      const updated = await prisma.fleetChecklist.update({
        where: { id },
        data: {
          notes:
            body.notes !== undefined
              ? typeof body.notes === "string"
                ? body.notes.trim() || null
                : null
              : undefined,
        },
        include: CHECKLIST_INCLUDE,
      });
      res.json({ checklist: serializeChecklist(updated) });
    } catch (e) {
      fleetError(res, e, "PUT checklist");
    }
  });

  app.post("/api/fleet/checklists/:id/items", ...g.checklistOps, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      await getChecklistOrThrow(id);
      const parsed = parseChecklistItemBody(req.body ?? {});
      const item = await prisma.fleetChecklistItem.create({
        data: { checklistId: id, ...parsed },
      });
      res.status(201).json({ item });
    } catch (e) {
      fleetError(res, e, "POST checklist item");
    }
  });

  app.put("/api/fleet/checklist-items/:id", ...g.checklistOps, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const body = req.body ?? {};
      const data: Record<string, unknown> = {};
      if (body.itemName !== undefined) {
        data.itemName =
          typeof body.itemName === "string" ? body.itemName.trim() : undefined;
      }
      if (body.result !== undefined) data.result = body.result;
      if (body.isCritical !== undefined) data.isCritical = Boolean(body.isCritical);
      if (body.notes !== undefined) {
        data.notes = typeof body.notes === "string" ? body.notes.trim() || null : null;
      }
      if (body.attachmentUrl !== undefined) {
        data.attachmentUrl =
          typeof body.attachmentUrl === "string" ? body.attachmentUrl.trim() || null : null;
      }

      const item = await prisma.fleetChecklistItem.update({
        where: { id },
        data,
      });
      res.json({ item });
    } catch (e) {
      fleetError(res, e, "PUT checklist item");
    }
  });
}
