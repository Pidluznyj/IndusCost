/**
 * Controller HTTP — availability da Tesouraria.
 */

import type { Request, Response } from "express";
import { getTreasuryAvailability } from "../services/treasuryAvailabilityService.js";

export function treasuryAvailabilityHandler(_req: Request, res: Response): void {
  const payload = getTreasuryAvailability({ serverTime: new Date() });
  res.status(200).json(payload);
}
