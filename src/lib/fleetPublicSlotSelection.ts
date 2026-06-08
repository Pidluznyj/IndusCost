import type { FleetPublicSlot } from "./fleetPublicReservationSlots.js";

export const FLEET_PUBLIC_SLOT_SELECTION_GAP_MESSAGE =
  "Selecione períodos em sequência. Para horários separados, faça solicitações separadas.";

export function parseTimeToMinutes(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return null;
  const hh = parseInt(m[1]!, 10);
  const mm = parseInt(m[2]!, 10);
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) {
    return null;
  }
  return hh * 60 + mm;
}

export function sortSlotsByStart(slots: FleetPublicSlot[]): FleetPublicSlot[] {
  return [...slots].sort((a, b) => a.start.localeCompare(b.start));
}

/** Slots contíguos ou sobrepostos (sem buraco entre eles). */
export function areSlotsContiguous(slots: FleetPublicSlot[]): boolean {
  if (slots.length <= 1) return slots.length === 1;
  const sorted = sortSlotsByStart(slots);
  for (let i = 0; i < sorted.length - 1; i++) {
    const endCur = parseTimeToMinutes(sorted[i]!.end);
    const startNext = parseTimeToMinutes(sorted[i + 1]!.start);
    if (endCur == null || startNext == null) return false;
    if (startNext > endCur) return false;
  }
  return true;
}

/** Verifica se a união dos slots cobre [startMin, endMin] sem lacunas. */
export function slotsCoverInterval(slots: FleetPublicSlot[], startMin: number, endMin: number): boolean {
  if (slots.length === 0 || endMin <= startMin) return false;
  const sorted = sortSlotsByStart(slots);
  let cursor = startMin;
  for (const slot of sorted) {
    const sStart = parseTimeToMinutes(slot.start);
    const sEnd = parseTimeToMinutes(slot.end);
    if (sStart == null || sEnd == null) return false;
    if (sStart > cursor) return false;
    cursor = Math.max(cursor, sEnd);
  }
  return cursor >= endMin;
}

export type ConsolidatedSlotSelection = {
  slots: FleetPublicSlot[];
  startTime: string;
  endTime: string;
  selectedLabels: string[];
};

export function consolidateSelectedSlots(slots: FleetPublicSlot[]): ConsolidatedSlotSelection | null {
  if (slots.length === 0) return null;
  const sorted = sortSlotsByStart(slots);
  if (!areSlotsContiguous(sorted)) return null;
  const startTime = sorted[0]!.start;
  const endTime = sorted[sorted.length - 1]!.end;
  const startMin = parseTimeToMinutes(startTime);
  const endMin = parseTimeToMinutes(endTime);
  if (startMin == null || endMin == null || !slotsCoverInterval(sorted, startMin, endMin)) {
    return null;
  }
  return {
    slots: sorted,
    startTime,
    endTime,
    selectedLabels: sorted.map((s) => s.label),
  };
}

export function selectSlotsByKeys(allSlots: FleetPublicSlot[], keys: string[]): FleetPublicSlot[] {
  const keySet = new Set(keys);
  return sortSlotsByStart(allSlots.filter((s) => keySet.has(s.key)));
}

/**
 * Valida que startTime/endTime correspondem à união de slots contíguos da configuração.
 * Usado no backend para não confiar apenas no payload do frontend.
 */
export function resolveSlotsForConsolidatedPeriod(
  allowedSlots: FleetPublicSlot[],
  startTime: string,
  endTime: string
): FleetPublicSlot[] | null {
  const startMin = parseTimeToMinutes(startTime);
  const endMin = parseTimeToMinutes(endTime);
  if (startMin == null || endMin == null || endMin <= startMin) return null;

  const candidates = allowedSlots.filter((s) => {
    const sStart = parseTimeToMinutes(s.start);
    const sEnd = parseTimeToMinutes(s.end);
    if (sStart == null || sEnd == null) return false;
    return sStart >= startMin && sEnd <= endMin;
  });
  if (candidates.length === 0) return null;

  const sorted = sortSlotsByStart(candidates);
  if (parseTimeToMinutes(sorted[0]!.start) !== startMin) return null;
  if (parseTimeToMinutes(sorted[sorted.length - 1]!.end) !== endMin) return null;
  if (!areSlotsContiguous(sorted) || !slotsCoverInterval(sorted, startMin, endMin)) return null;
  return sorted;
}

export function isFullDaySlotSelection(
  selected: FleetPublicSlot[],
  allDaySlots: FleetPublicSlot[]
): boolean {
  if (allDaySlots.length === 0 || selected.length !== allDaySlots.length) return false;
  const selectedKeys = new Set(selected.map((s) => s.key));
  return allDaySlots.every((s) => selectedKeys.has(s.key));
}

export function formatConsolidatedPeriodLabel(
  consolidated: ConsolidatedSlotSelection,
  allDaySlots?: FleetPublicSlot[]
): string {
  if (allDaySlots && isFullDaySlotSelection(consolidated.slots, allDaySlots)) {
    return `Dia todo — ${consolidated.startTime} às ${consolidated.endTime}`;
  }
  if (consolidated.slots.length === 1) {
    return consolidated.slots[0]!.label;
  }
  return `${consolidated.startTime} às ${consolidated.endTime}`;
}

export function formatSelectedSlotsSummary(consolidated: ConsolidatedSlotSelection): string {
  if (consolidated.slots.length === 1) return consolidated.slots[0]!.label;
  return consolidated.selectedLabels.join(", ");
}
