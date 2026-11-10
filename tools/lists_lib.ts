import { ShieldsEngine } from '@vz/components/shields_engine/shields_engine';
import { signBlob } from '@vz/components/shields_engine/list_signature';

/** The engine bundled with the app: lists + uBlock Origin resources, unsigned (the app itself is signed). */
export function compileBundled(texts: string[], resources: string): Uint8Array {
  return ShieldsEngine.fromListsWithResources(texts, resources).serialize();
}

export function compile(texts: string[], version: number, privateKeyPem: string) {
  const blob = ShieldsEngine.fromLists(texts).serialize();
  return { blob, manifest: signBlob(blob, version, privateKeyPem) };
}
