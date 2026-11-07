import { ShieldsEngine } from '@vz/components/shields_engine/shields_engine';
import { signBlob } from '@vz/components/shields_engine/list_signature';

export function compile(texts: string[], version: number, privateKeyPem: string) {
  const blob = ShieldsEngine.fromLists(texts).serialize();
  return { blob, manifest: signBlob(blob, version, privateKeyPem) };
}
