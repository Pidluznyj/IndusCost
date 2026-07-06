export type MaintenanceStatus =
  | "NOVA_SOLICITACAO"
  | "EM_ANALISE"
  | "AGUARDANDO_MATERIAL"
  | "AGUARDANDO_COMPRA"
  | "PROGRAMADO"
  | "EM_EXECUCAO"
  | "CONCLUIDO"
  | "CANCELADO";

export type MaintenancePriority = "BAIXA" | "MEDIA" | "ALTA" | "CRITICA";

export type MaintenanceCategory =
  | "ELETRICA"
  | "HIDRAULICA"
  | "PINTURA"
  | "CIVIL_ALVENARIA"
  | "TELHADO_CALHA"
  | "INFRAESTRUTURA"
  | "SEGURANCA"
  | "LIMPEZA_CORRETIVA"
  | "OUTRO";

export type MaintenanceRequestRow = {
  id: string;
  number: number;
  title: string;
  description: string;
  requester: string;
  areaSector: string;
  location: string;
  category: MaintenanceCategory;
  priority: MaintenancePriority;
  status: MaintenanceStatus;
  responsible: string | null;
  desiredDate: string | null;
  notes: string | null;
  needsMaterial: boolean;
  materialNotes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MaintenanceRequestStatusHistoryRow = {
  id: string;
  maintenanceRequestId: string;
  fromStatus: MaintenanceStatus | null;
  toStatus: MaintenanceStatus;
  comment: string | null;
  changedBy: string | null;
  changedAt: string;
};

export type MaintenanceRequestDetail = MaintenanceRequestRow & {
  statusHistory?: MaintenanceRequestStatusHistoryRow[];
};

export type MaintenanceListResponse = {
  rows: MaintenanceRequestRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};
