/**
 * Carrega Leaflet + plugins sob demanda (fora do bundle principal).
 *
 * `leaflet.markercluster` e `leaflet.heat` se registram no `L` GLOBAL, então a
 * ordem importa: primeiro o Leaflet, depois os plugins — por isso import
 * dinâmico em sequência, e não imports estáticos (que seriam içados).
 */

import type * as Leaflet from "leaflet";

export type LeafletRuntime = typeof Leaflet;

let runtime: Promise<LeafletRuntime> | null = null;

export function loadLeafletRuntime(): Promise<LeafletRuntime> {
  runtime ??= (async () => {
    const module = await import("leaflet");
    const L = ((module as unknown as { default?: LeafletRuntime }).default ?? module) as LeafletRuntime;
    (window as unknown as { L: LeafletRuntime }).L = L;
    await import("leaflet.markercluster");
    await import("leaflet.heat");
    return L;
  })().catch((error) => {
    runtime = null;
    throw error;
  });
  return runtime;
}
