export type FleetVehicleOrigin = "OWNED" | "RENTED" | "LEASING" | "COMODATO" | "THIRD_PARTY";

export type FleetVehicleStatus =
  | "AVAILABLE"
  | "RESERVED"
  | "IN_USE"
  | "MAINTENANCE"
  | "BLOCKED"
  | "CLAIMED"
  | "INACTIVE"
  | "RETURNED"
  | "SOLD";

export type FleetDriverStatus = "AUTHORIZED" | "PENDING" | "BLOCKED" | "INACTIVE";

export type FleetReservationStatus =
  | "REQUESTED"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "REJECTED"
  | "CANCELED"
  | "IN_USE"
  | "FINISHED"
  | "FINISHED_WITH_PENDING"
  | "NO_SHOW";

export type FleetMaintenanceStatus =
  | "OPEN"
  | "SCHEDULED"
  | "QUOTING"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELED";

export type FleetVehicleRow = {
  id: string;
  plate: string | null;
  brand: string;
  model: string;
  origin: FleetVehicleOrigin;
  status: FleetVehicleStatus;
  currentKm: number;
  unit: string | null;
  costCenter: string | null;
  vehicleType?: string | null;
  fuelType?: string | null;
  notes?: string | null;
};

export type FleetDashboardResponse = {
  cards: {
    totalVehicles: number;
    available: number;
    inUse: number;
    maintenance: number;
    blocked: number;
    documentsExpiring: number;
    cnhsExpiring: number;
    reservationsToday: number;
    openMaintenances: number;
  };
  alerts: { level: "critical" | "warning"; message: string; entityType?: string; entityId?: string }[];
};
