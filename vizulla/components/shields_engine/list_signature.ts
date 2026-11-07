// Signed filter-list blobs (P1-CLD-03). The CDN serves:
//   engine.bin   serialized engine
//   engine.json  { version, sha256, size, created_at, signature }  signature = ed25519 over
//                "vizulla-shields-v1\n<version>\n<sha256>\n<size>"
// The client verifies the signature against pinned public keys and the hash
// against the blob, and only then swaps engines. A tampered blob is rejected.
import { createHash, createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';

export interface ListManifest {
  version: number;
  sha256: string;
  size: number;
  created_at: string;
  signature: string;
}

const payload = (m: Pick<ListManifest, 'version' | 'sha256' | 'size'>) => Buffer.from(`vizulla-shields-v1\n${m.version}\n${m.sha256}\n${m.size}`);

export function signBlob(blob: Uint8Array, version: number, privateKeyPem: string): ListManifest {
  const sha256 = createHash('sha256').update(blob).digest('hex');
  const m = { version, sha256, size: blob.byteLength };
  const signature = sign(null, payload(m), createPrivateKey(privateKeyPem)).toString('base64');
  return { ...m, created_at: new Date().toISOString(), signature };
}

export type VerifyResult = { ok: true } | { ok: false; reason: 'bad-signature' | 'hash-mismatch' | 'size-mismatch' | 'rollback' | 'malformed' };

export function verifyBlob(blob: Uint8Array, manifest: ListManifest, publicKeysPem: readonly string[], minVersion = 0): VerifyResult {
  if (typeof manifest?.version !== 'number' || typeof manifest.signature !== 'string' || typeof manifest.sha256 !== 'string') return { ok: false, reason: 'malformed' };
  const keys: KeyObject[] = publicKeysPem.map((k) => createPublicKey(k));
  const sigOk = keys.some((k) => {
    try {
      return verify(null, payload(manifest), k, Buffer.from(manifest.signature, 'base64'));
    } catch {
      return false;
    }
  });
  if (!sigOk) return { ok: false, reason: 'bad-signature' };
  if (blob.byteLength !== manifest.size) return { ok: false, reason: 'size-mismatch' };
  if (createHash('sha256').update(blob).digest('hex') !== manifest.sha256) return { ok: false, reason: 'hash-mismatch' };
  // Never accept an older list than the one we have (rollback protection).
  if (manifest.version < minVersion) return { ok: false, reason: 'rollback' };
  return { ok: true };
}
