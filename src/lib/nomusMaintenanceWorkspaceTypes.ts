import type { NomusParentCodeOption } from "@/src/lib/nomusParentCodeOptionsTypes";

export type NomusMaintenanceTab =
  | "overview"
  | "pending"
  | "effective-pricing-bom"
  | "cost-impact"
  | "apply-plan"
  | "diagnostic";

export type NomusWorkspaceParentSelection = {
  parentCode: string;
  parentDescription: string | null;
  indusProductId: string | null;
  option?: NomusParentCodeOption | null;
};

/** Props compartilhadas pelas subtabs da Manutenção Nomus (sem Prisma). */
export type NomusMaintenanceWorkspaceProps = {
  selectedParentCode?: string;
  selectedParentDescription?: string | null;
  selectedIndusProductId?: string | null;
  onWorkspaceParentChange?: (selection: NomusWorkspaceParentSelection | null) => void;
};
