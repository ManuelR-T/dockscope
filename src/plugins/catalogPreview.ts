// Trust-on-first-use inspection of a catalog the user is about to add.
//
// A catalog's signature carries only a key id, never the key itself, so the
// signing key has to be discovered from the publisher. By convention the
// release tooling publishes `catalog.public.pem` and `catalog-trust.json`
// beside `catalog.json`, so those siblings are probed and the discovered key is
// checked against the actual signature before anything is shown to the user.
//
// The preview deliberately never persists anything: it reports what the catalog
// claims and what its key fingerprint is, and the user decides whether that
// fingerprint matches what the publisher advertises out of band.

import {
  loadPluginCatalog,
  parsePluginCatalogTrustStore,
  readTextSource,
  type PluginCatalogTrustStore,
} from './catalog.js';
import { publicKeyFingerprint } from './catalogStore.js';
import { errorMessage } from '../utils.js';

export interface PluginCatalogPreview {
  source: string;
  name?: string;
  entryCount: number;
  /** Key id the catalog's signature declares, when it is signed at all. */
  keyId?: string;
  /** Signing key discovered from the publisher and confirmed to sign this catalog. */
  publicKey?: string;
  fingerprint?: string;
  signed: boolean;
  signatureVerified: boolean;
  /** Where the signing key was found, for display. */
  keySource?: string;
  /** Why the catalog cannot be trusted, when it cannot. */
  problem?: string;
}

function siblingUrls(source: string): string[] {
  const trimmed = source.trim();
  const base = trimmed.replace(/[^/]*$/, '');
  return [`${base}catalog.public.pem`, `${base}catalog-trust.json`];
}

function keysFromTrustStore(store: PluginCatalogTrustStore, keyId?: string): string[] {
  const active = store.keys.filter((key) => !store.revokedKeyIds.includes(key.keyId));
  const matching = keyId ? active.filter((key) => key.keyId === keyId) : [];
  return [...matching, ...active].map((key) => key.publicKey);
}

/** Candidate signing keys published alongside the catalog, best match first. */
async function discoverPublisherKeys(
  source: string,
  keyId: string | undefined,
): Promise<{ publicKey: string; keySource: string }[]> {
  const candidates: { publicKey: string; keySource: string }[] = [];
  for (const url of siblingUrls(source)) {
    let text: string;
    try {
      text = await readTextSource(url);
    } catch {
      continue;
    }
    if (url.endsWith('.pem')) {
      if (text.includes('BEGIN PUBLIC KEY')) {
        candidates.push({ publicKey: text, keySource: url });
      }
      continue;
    }
    try {
      for (const publicKey of keysFromTrustStore(parsePluginCatalogTrustStore(text), keyId)) {
        candidates.push({ publicKey, keySource: url });
      }
    } catch {
      continue;
    }
  }
  return candidates;
}

/**
 * Inspects a catalog without trusting or persisting it. Returns what the user
 * needs in order to make the trust decision: the catalog's identity, the
 * discovered signing key, and that key's fingerprint.
 */
export async function previewPluginCatalog(source: string): Promise<PluginCatalogPreview> {
  const trimmed = source.trim();
  if (!trimmed) {
    return {
      source,
      entryCount: 0,
      signed: false,
      signatureVerified: false,
      problem: 'Catalog source is required',
    };
  }

  // Unverified read first, purely to learn the catalog's identity and key id.
  let unverified;
  try {
    unverified = await loadPluginCatalog(trimmed);
  } catch (error) {
    return {
      source: trimmed,
      entryCount: 0,
      signed: false,
      signatureVerified: false,
      problem: errorMessage(error),
    };
  }

  const base = {
    source: trimmed,
    name: unverified.name,
    entryCount: unverified.entries.length,
    keyId: unverified.signature?.keyId,
    signed: Boolean(unverified.signature),
  };

  if (!unverified.signature) {
    return {
      ...base,
      signatureVerified: false,
      problem: 'This catalog is not signed, so its contents cannot be verified.',
    };
  }

  const candidates = await discoverPublisherKeys(trimmed, unverified.signature.keyId);
  if (candidates.length === 0) {
    return {
      ...base,
      signatureVerified: false,
      problem:
        'No signing key was published alongside this catalog (expected catalog.public.pem or catalog-trust.json next to it).',
    };
  }

  for (const candidate of candidates) {
    try {
      // Re-load with the candidate key: this throws on mismatch, so success
      // proves the discovered key actually signed this catalog.
      const verified = await loadPluginCatalog(trimmed, { publicKey: candidate.publicKey });
      if (verified.signatureVerified) {
        return {
          ...base,
          signatureVerified: true,
          publicKey: candidate.publicKey,
          fingerprint: publicKeyFingerprint(candidate.publicKey),
          keySource: candidate.keySource,
        };
      }
    } catch {
      continue;
    }
  }

  return {
    ...base,
    signatureVerified: false,
    problem:
      'The signing key published with this catalog does not match its signature. Do not trust this catalog.',
  };
}
