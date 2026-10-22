/**
 * Catálogo cadastral e filiais da mesma raiz, paginados.
 * A lista, o detalhe e a exportação usam estes limites. Não há teto global
 * que descarte uma raiz porque outra consulta trouxe muitos clientes.
 * Não grava cadastro e não consulta bureau.
 */
import { normalizeCnpj } from "@/src/lib/companyCnpjFormat.js";
import { cnpjRoot, type RadarParty } from "./corporateRadar.js";

const ROOT_PAGE = 80;
const ROOT_MAX_EXAMINED = 500;
const CATALOG_PAGE = 400;
const CATALOG_MAX_ROWS = 20000;

type CustomerReader = {
  findMany(args: unknown): Promise<unknown>;
};

export type SameRootLoad = {
  peers: Map<string, string[]>;
  /** Raiz não enumerada por completo. O cliente fica em análise, não liberado. */
  overflowCustomerIds: Set<string>;
  readFailed: boolean;
};

export type RadarCatalog = {
  parties: RadarParty[];
  readFailed: boolean;
  complete: boolean;
};

function text(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value == null) return null;
  return null;
}

function customerReader(db: object): CustomerReader | null {
  const reader = (db as { customer?: CustomerReader }).customer;
  return reader?.findMany ? reader : null;
}

function formattedRootPrefix(root: string): string {
  return `${root.slice(0, 2)}.${root.slice(2, 5)}.${root.slice(5, 8)}`;
}

async function loadRootCustomerIds(
  customer: CustomerReader,
  root: string,
  examineLimit: number
): Promise<{ ids: string[]; incomplete: boolean }> {
  const ids: string[] = [];
  const seen = new Set<string>();
  let skip = 0;
  let examined = 0;
  const formatted = formattedRootPrefix(root);
  while (examined < examineLimit) {
    const take = Math.min(ROOT_PAGE, examineLimit - examined);
    const rows = await customer.findMany({
      where: {
        OR: [{ taxId: { startsWith: root } }, { taxId: { startsWith: formatted } }],
      },
      orderBy: { id: "asc" },
      skip,
      take,
      select: { id: true, taxId: true },
    });
    const list = Array.isArray(rows) ? rows : [];
    for (const row of list) {
      const record = row as { id?: unknown; taxId?: unknown };
      const id = text(record.id);
      if (!id || seen.has(id)) continue;
      if (cnpjRoot(text(record.taxId)) !== root) continue;
      seen.add(id);
      ids.push(id);
    }
    examined += list.length;
    if (list.length < take) return { ids, incomplete: false };
    skip += list.length;
    if (list.length === 0) return { ids, incomplete: false };
  }
  return { ids, incomplete: true };
}

export async function loadSameRootPeerMap(
  db: object,
  customers: readonly { id: string; taxId?: string | null }[],
  options?: { examineLimit?: number }
): Promise<SameRootLoad> {
  const peers = new Map<string, string[]>();
  const overflowCustomerIds = new Set<string>();
  const byRoot = new Map<string, string[]>();
  for (const customer of customers) {
    peers.set(customer.id, []);
    const root = cnpjRoot(customer.taxId);
    if (!root) continue;
    const subjects = byRoot.get(root) ?? [];
    subjects.push(customer.id);
    byRoot.set(root, subjects);
  }
  const reader = customerReader(db);
  if (!reader) {
    for (const customer of customers) overflowCustomerIds.add(customer.id);
    return { peers, overflowCustomerIds, readFailed: true };
  }
  if (byRoot.size === 0) return { peers, overflowCustomerIds, readFailed: false };
  const examineLimit = options?.examineLimit ?? ROOT_MAX_EXAMINED;
  try {
    const roots = [...byRoot.keys()];
    for (let index = 0; index < roots.length; index += 8) {
      const slice = roots.slice(index, index + 8);
      await Promise.all(
        slice.map(async (root) => {
          const loaded = await loadRootCustomerIds(reader, root, examineLimit);
          const subjects = byRoot.get(root) ?? [];
          for (const subjectId of subjects) {
            const list = loaded.ids.filter((id) => id !== subjectId);
            peers.set(subjectId, list);
            if (loaded.incomplete) overflowCustomerIds.add(subjectId);
          }
        })
      );
    }
    return { peers, overflowCustomerIds, readFailed: false };
  } catch (error) {
    console.error("same-root-peers", error instanceof Error ? error.name : "error");
    return { peers, overflowCustomerIds, readFailed: true };
  }
}

export async function loadRadarCatalog(db: object, options?: { maxRows?: number }): Promise<RadarCatalog> {
  const reader = customerReader(db);
  if (!reader) return { parties: [], readFailed: true, complete: false };
  const maxRows = options?.maxRows ?? CATALOG_MAX_ROWS;
  const parties: RadarParty[] = [];
  const seen = new Set<string>();
  let skip = 0;
  try {
    while (parties.length < maxRows) {
      const take = Math.min(CATALOG_PAGE, maxRows - parties.length);
      const rows = await reader.findMany({
        orderBy: { id: "asc" },
        skip,
        take,
        select: {
          id: true,
          taxId: true,
          companyName: true,
          phone: true,
          email: true,
          address: true,
          city: true,
          state: true,
          zipCode: true,
        },
      });
      const list = Array.isArray(rows) ? rows : [];
      for (const row of list) {
        const record = row as Record<string, unknown>;
        const id = text(record.id);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        parties.push({
          customerId: id,
          cnpj: normalizeCnpj(text(record.taxId)),
          companyName: text(record.companyName) ?? "",
          phone: text(record.phone),
          email: text(record.email),
          address: text(record.address),
          city: text(record.city),
          state: text(record.state),
          zipCode: text(record.zipCode),
        });
      }
      if (list.length < take) return { parties, readFailed: false, complete: true };
      skip += list.length;
      if (skip >= maxRows) break;
    }
    return { parties, readFailed: false, complete: false };
  } catch (error) {
    console.error("radar-catalog", error instanceof Error ? error.name : "error");
    return { parties: [], readFailed: true, complete: false };
  }
}
