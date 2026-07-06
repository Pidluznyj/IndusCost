export const FLEET_RESERVATIONS_CLEANUP_CONFIRM_PHRASE = "APAGAR TODAS AS RESERVAS DE FROTA";

export const FLEET_RESERVATIONS_CLEANUP_AUDIT_ENTITY_TYPE = "FleetReservationsCleanup";

export type FleetReservationsCleanupCounts = {
  fleetPublicReservationApprovalHistory: number;
  fleetPublicReservationRequest: number;
  fleetChecklistItem: number;
  fleetChecklist: number;
  fleetAttachment: number;
  fleetAuditLog: number;
  fleetUsage: number;
  fleetReservation: number;
  vehiclesRecalculated: number;
  preserved: {
    fleetVehicle: number;
    fleetDriver: number;
  };
};

export type FleetReservationsCleanupPreview = FleetReservationsCleanupCounts & {
  confirmPhraseRequired: string;
};
