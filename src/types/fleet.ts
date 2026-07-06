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

export type FleetDocumentStatus = "VALID" | "EXPIRING" | "EXPIRED" | "REPLACED";

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

export type FleetMaintenanceRow = {
  id: string;
  vehicleId: string;
  reservationId: string | null;
  maintenanceType: string;
  status: FleetMaintenanceStatus;
  priority: string;
  description: string;
  openedAt: string;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  supplierName: string | null;
  estimatedValue: number | null;
  finalValue: number | null;
  currentKm: number | null;
  blocksVehicle: boolean;
  notes: string | null;
  preventiveMeta?: { nextScheduledAt: string | null; nextMaintenanceKm: number | null } | null;
  vehicle?: {
    id: string;
    plate: string | null;
    brand: string;
    model: string;
    status?: FleetVehicleStatus;
    currentKm?: number;
    costCenter?: string | null;
  };
  costs?: { id: string; amount: number; status: string; costType: string }[];
};

export const MAINTENANCE_STATUS_LABEL: Record<FleetMaintenanceStatus, string> = {
  OPEN: "Aberta",
  SCHEDULED: "Agendada",
  QUOTING: "Orçamento",
  PENDING_APPROVAL: "Aguardando aprovação",
  APPROVED: "Aprovada",
  IN_PROGRESS: "Em execução",
  COMPLETED: "Concluída",
  CANCELED: "Cancelada",
};

export const MAINTENANCE_TYPE_OPTIONS = [
  { value: "CORRETIVA", label: "Corretiva" },
  { value: "PREVENTIVA", label: "Preventiva" },
] as const;

export const MAINTENANCE_PRIORITY_OPTIONS = [
  { value: "BAIXA", label: "Baixa" },
  { value: "MEDIA", label: "Média" },
  { value: "ALTA", label: "Alta" },
  { value: "CRITICA", label: "Crítica" },
] as const;

export type FleetVehicleAlert = {
  level: "critical" | "warning" | "info";
  code: string;
  message: string;
};

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
  renavam?: string | null;
  chassis?: string | null;
  modelYear?: number | null;
  manufactureYear?: number | null;
  color?: string | null;
  ownershipType?: string | null;
  initialKm?: number;
  alerts?: FleetVehicleAlert[];
};

export type FleetContractRow = {
  id: string;
  vehicleId: string;
  supplierName: string;
  supplierDocument: string | null;
  contractNumber: string | null;
  contractType: string;
  startDate: string;
  endDate: string | null;
  monthlyValue: number | null;
  billingDay: number | null;
  kmFranchise: number | null;
  excessKmValue: number | null;
  status: string;
  notes: string | null;
  financialMasked?: boolean;
};

export type FleetDocumentRow = {
  id: string;
  vehicleId: string;
  documentType: string;
  documentNumber: string | null;
  issueDate: string | null;
  expirationDate: string | null;
  status: FleetDocumentStatus;
  responsible: string | null;
  attachmentUrl: string | null;
  notes: string | null;
};

export type FleetAuditLogRow = {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  oldValue: string | null;
  newValue: string | null;
  reason: string | null;
  userId: string | null;
  createdAt: string;
};

export type FleetVehicleDetail = FleetVehicleRow & {
  alerts: FleetVehicleAlert[];
  contracts?: FleetContractRow[];
  documents?: FleetDocumentRow[];
};

export type FleetDriverAlert = {
  level: "critical" | "warning";
  code: string;
  message: string;
};

export type CnhComputedStatus = "VALID" | "EXPIRING" | "EXPIRED" | "MISSING";

export type FleetDriverRow = {
  id: string;
  name: string;
  cpf: string;
  cnhNumber: string | null;
  cnhCategory: string | null;
  cnhExpirationDate: string | null;
  cnhStatus?: CnhComputedStatus;
  phone: string | null;
  email: string | null;
  unit: string | null;
  costCenter: string | null;
  status: FleetDriverStatus;
  notes: string | null;
  alerts?: FleetDriverAlert[];
};

export type FleetReservationRow = {
  id: string;
  vehicleId: string;
  driverId: string | null;
  requesterUserId: string | null;
  startDateTime: string;
  endDateTime: string;
  destination: string | null;
  reason: string | null;
  costCenter: string | null;
  status: FleetReservationStatus;
  approvalStatus: string | null;
  rejectionReason: string | null;
  cancelReason: string | null;
  notes: string | null;
  vehicle?: {
    id: string;
    plate: string | null;
    brand: string;
    model: string;
    vehicleType?: string | null;
    status?: FleetVehicleStatus;
    unit?: string | null;
    costCenter?: string | null;
    currentKm?: number;
  };
  driver?: {
    id: string;
    name: string;
    status: FleetDriverStatus;
    cnhExpirationDate: string | null;
    cnhCategory?: string | null;
  } | null;
};

export type FleetAvailabilityVehicle = {
  id: string;
  plate: string | null;
  brand: string;
  model: string;
  vehicleType: string | null;
  status: FleetVehicleStatus;
  unit: string | null;
  costCenter: string | null;
  currentKm: number;
};

export const CNH_CATEGORY_OPTIONS = ["A", "B", "C", "D", "E", "AB", "AC", "AD", "AE"] as const;

export const DRIVER_STATUS_OPTIONS: { value: FleetDriverStatus; label: string }[] = [
  { value: "AUTHORIZED", label: "Autorizado" },
  { value: "PENDING", label: "Pendente" },
  { value: "BLOCKED", label: "Bloqueado" },
  { value: "INACTIVE", label: "Inativo" },
];

export type FleetChecklistResult = "OK" | "NOT_OK" | "NOT_APPLICABLE";
export type FleetChecklistType = "CHECKOUT" | "CHECKIN" | "INSPECTION" | "MAINTENANCE";
export type FleetChecklistStatus = "DRAFT" | "COMPLETED" | "CANCELED";

export type FleetChecklistItemRow = {
  id: string;
  checklistId: string;
  itemName: string;
  result: FleetChecklistResult | null;
  isCritical: boolean;
  notes: string | null;
  attachmentUrl: string | null;
};

export type FleetChecklistRow = {
  id: string;
  vehicleId: string;
  reservationId: string | null;
  usageId: string | null;
  checklistType: FleetChecklistType;
  status: FleetChecklistStatus;
  performedBy: string | null;
  performedAt: string | null;
  notes: string | null;
  items: FleetChecklistItemRow[];
};

export type FleetUsageRow = {
  id: string;
  reservationId: string;
  vehicleId: string;
  driverId: string | null;
  checkoutAt: string | null;
  checkoutKm: number | null;
  checkoutFuelLevel: string | null;
  checkoutNotes: string | null;
  checkinAt: string | null;
  checkinKm: number | null;
  checkinFuelLevel: string | null;
  checkinNotes: string | null;
  kmDriven: number | null;
  status: string;
  driver?: { id: string; name: string } | null;
  vehicle?: {
    id: string;
    plate: string | null;
    brand: string;
    model: string;
    currentKm?: number;
  };
  reservation?: {
    id: string;
    status: FleetReservationStatus;
    startDateTime: string;
    endDateTime: string;
    destination: string | null;
  };
};

export const CHECKLIST_RESULT_OPTIONS: { value: FleetChecklistResult; label: string }[] = [
  { value: "OK", label: "OK" },
  { value: "NOT_OK", label: "Não OK" },
  { value: "NOT_APPLICABLE", label: "N/A" },
];

export const RESERVATION_STATUS_OPTIONS: { value: FleetReservationStatus; label: string }[] = [
  { value: "PENDING_APPROVAL", label: "Aguardando aprovação" },
  { value: "APPROVED", label: "Aprovada" },
  { value: "REJECTED", label: "Rejeitada" },
  { value: "CANCELED", label: "Cancelada" },
  { value: "IN_USE", label: "Em uso" },
  { value: "FINISHED", label: "Finalizada" },
];

export type FleetFinancialDashboard = {
  competence: string;
  totalMonth: number | null;
  totalMonthMasked?: boolean;
  byType: Record<string, number | null>;
  pendingFines: number;
  openIncidents: number;
  recentFuelings: {
    id: string;
    fuelingDate: string;
    liters: number;
    totalValue: number | null;
    totalValueMasked?: boolean;
    vehicle?: { plate: string | null; brand: string; model: string };
    driver?: { name: string } | null;
    avgConsumption: number | null;
  }[];
  kmMonth: number;
  costPerKm: number | null;
  costPerKmMasked?: boolean;
};

export type FleetCostRow = {
  id: string;
  vehicleId: string;
  costType: string;
  costDate: string;
  competence: string;
  amount: number | null;
  amountMasked?: boolean;
  status: string;
  supplierName: string | null;
  notes: string | null;
  vehicle?: { plate: string | null; brand: string; model: string };
};

export type FleetFuelingRow = {
  id: string;
  vehicleId: string;
  driverId: string | null;
  fuelingDate: string;
  km: number;
  liters: number;
  unitPrice: number | null;
  totalValue: number | null;
  totalValueMasked?: boolean;
  stationName: string | null;
  receiptUrl: string | null;
  vehicle?: { plate: string | null; brand: string; model: string };
  driver?: { name: string } | null;
};

export type FleetFineRow = {
  id: string;
  vehicleId: string;
  driverId: string | null;
  infractionDate: string;
  noticeNumber: string | null;
  amount: number | null;
  amountMasked?: boolean;
  status: string;
  vehicle?: { plate: string | null; brand: string; model: string };
  driver?: { name: string } | null;
};

export type FleetIncidentRow = {
  id: string;
  vehicleId: string;
  incidentType: string;
  incidentDate: string;
  description: string;
  severity: string;
  status: string;
  blocksVehicle: boolean;
  vehicle?: { plate: string | null; brand: string; model: string };
};

export type FleetAttachmentRow = {
  id: string;
  vehicleId: string | null;
  attachmentType: string;
  fileName: string;
  fileUrl: string;
  uploadedAt: string;
  notes: string | null;
};

export const FLEET_COST_TYPE_OPTIONS = [
  { value: "LOCACAO", label: "Locação" },
  { value: "MANUTENCAO", label: "Manutenção" },
  { value: "COMBUSTIVEL", label: "Combustível" },
  { value: "MULTA", label: "Multa" },
  { value: "SINISTRO", label: "Sinistro" },
  { value: "AVARIA", label: "Avaria" },
  { value: "SEGURO", label: "Seguro" },
  { value: "TAXA", label: "Taxa" },
  { value: "OUTRO", label: "Outros" },
] as const;

export const FINE_STATUS_OPTIONS = [
  { value: "RECEIVED", label: "Recebida" },
  { value: "IDENTIFYING_DRIVER", label: "Identificar motorista" },
  { value: "PENDING_PAYMENT", label: "Pagamento pendente" },
  { value: "PAID", label: "Paga" },
  { value: "CONTESTED", label: "Contestada" },
  { value: "CANCELED", label: "Cancelada" },
] as const;

export const INCIDENT_STATUS_OPTIONS = [
  { value: "OPEN", label: "Aberta" },
  { value: "IN_PROGRESS", label: "Em andamento" },
  { value: "RESOLVED", label: "Resolvida" },
  { value: "CANCELED", label: "Cancelada" },
] as const;

export type FleetAlertDto = {
  level: "critical" | "warning" | "info";
  code?: string;
  message: string;
  entityType?: string;
  entityId?: string;
};

export type FleetDashboardCards = {
  totalVehicles: number;
  totalOperational: number;
  available: number;
  reserved: number;
  inUse: number;
  maintenance: number;
  blocked: number;
  claimed: number;
  inactiveReturnedSold: number;
  reservationsToday: number;
  reservationsOverdue: number;
  documentsExpired: number;
  documentsExpiring: number;
  cnhsExpired: number;
  cnhsExpiring: number;
  contractsExpired: number;
  contractsExpiring: number;
  openMaintenances: number;
  maintenanceOverdue: number;
  maintenanceUpcoming: number;
  pendingFines: number;
  openIncidents: number;
};

export type FleetExecutiveDashboardFilters = {
  year: number;
  month: number;
  vehicleStatus?: string;
  vehicleType?: string;
  plate?: string;
  unit?: string;
  driverId?: string;
  vehicleId?: string;
};

export type FleetExecutiveTopVehicle = {
  vehicleId: string;
  plate: string;
  brand: string;
  model: string;
  value: number;
  label: string;
};

export type FleetExecutiveVehicleRow = {
  id: string;
  plate: string;
  brand: string;
  model: string;
  modelYear: number | null;
  status: string;
  vehicleType: string | null;
  unit: string | null;
  currentKm: number | null;
  monthlyKm: number;
  monthlyReservations: number;
  lastReservation: {
    id: string;
    startDateTime: string;
    endDateTime: string;
    status: string;
    driverName?: string | null;
  } | null;
  nextReservation: {
    id: string;
    startDateTime: string;
    endDateTime: string;
    status: string;
    driverName?: string | null;
  } | null;
  idleDays: number | null;
  alerts: FleetAlertDto[];
  alertCount: number;
};

export type FleetExecutiveDashboard = {
  filters: FleetExecutiveDashboardFilters;
  competenceLabel: string;
  summary: {
    totalVehicles: number;
    activeVehicles: number;
    inactiveVehicles: number;
    availableVehicles: number;
    inUseVehicles: number;
    reservedVehicles: number;
    maintenanceVehicles: number;
    openReservations: number;
    closedReservationsInMonth: number;
    monthlyKm: number;
    monthlyKmDataAvailable: boolean;
    topReservedVehicle: FleetExecutiveTopVehicle | null;
    topKmVehicle: FleetExecutiveTopVehicle | null;
    activeAlerts: number;
    criticalAlerts: number;
    warningAlerts: number;
    infoAlerts: number;
  };
  reservationsByStatus: Array<{ status: string; count: number }>;
  reservationSummary: {
    open: number;
    inProgress: number;
    finished: number;
    canceled: number;
    overdue: number;
    today: number;
    upcoming: number;
  };
  kmByVehicle: Array<{ vehicleId: string; plate: string; label: string; km: number }>;
  topVehiclesByReservation: FleetExecutiveTopVehicle[];
  topVehiclesByKm: FleetExecutiveTopVehicle[];
  topIdleVehicles: Array<FleetExecutiveTopVehicle & { idleDays: number }>;
  topDrivers: Array<{ driverId: string; name: string; reservations: number }>;
  attentionReservations: Array<{
    id: string;
    plate: string;
    status: string;
    endDateTime: string;
    reason: string;
    severity: "critical" | "warning" | "info";
  }>;
  vehicles: FleetExecutiveVehicleRow[];
  alerts: FleetAlertDto[];
};

export type FleetDashboardResponse = {
  cards: FleetDashboardCards;
  alerts: FleetAlertDto[];
  financial?: FleetFinancialDashboard;
  executive?: FleetExecutiveDashboard;
  filters?: FleetExecutiveDashboardFilters;
};

export const FLEET_REPORT_TYPES = [
  { id: "fleet", label: "Frota", path: "/api/fleet/reports/fleet" },
  { id: "usage", label: "Utilização", path: "/api/fleet/reports/usage" },
  { id: "costs", label: "Custos", path: "/api/fleet/reports/costs" },
  { id: "maintenance", label: "Manutenção", path: "/api/fleet/reports/maintenance" },
  { id: "documents", label: "Documentos / CNH", path: "/api/fleet/reports/documents" },
] as const;

export const CONTRACT_TYPE_OPTIONS = [
  { value: "LOCACAO", label: "Locação" },
  { value: "LEASING", label: "Leasing" },
  { value: "COMODATO", label: "Comodato" },
  { value: "TERCEIRO", label: "Terceiro" },
  { value: "PROPRIO", label: "Próprio" },
] as const;

export const DOCUMENT_TYPE_OPTIONS = [
  "CRLV",
  "IPVA",
  "SEGURO",
  "LICENCIAMENTO",
  "INSPECAO",
  "RASTREADOR",
  "OUTRO",
] as const;
