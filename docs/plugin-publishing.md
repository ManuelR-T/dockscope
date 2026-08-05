# Publishing a DockScope Plugin

How to get a plugin you wrote onto someone else's DockScope, from copying a
directory to running a signed catalog.

Writing the plugin itself is covered in [Writing a plugin](plugins.md).

## Publishing Your Plugin

There are three ways to get a plugin into someone else's DockScope. Pick the lightest one that fits your audience. All three use only the `dockscope` CLI from npm, with no clone of this repository.

### Option 1: Load it from a path

For your own machine, a teammate's checkout, or a plugin you never intend to distribute:

```bash
dockscope up --plugins /path/to/my-plugin --plugin-permissions all
```

No packaging and no signing. Plugins loaded this way receive no permissions unless you grant them explicitly, either with `--plugin-permissions` or `DOCKSCOPE_PLUGIN_PERMISSIONS`.

### Option 2: Distribute a package file

The simplest real distribution. Produce a single package file and attach it to a GitHub release:

```bash
dockscope plugin:pack --source ./my-plugin --out ./my-plugin.dockscope-plugin
```

Users install it directly, and can inspect it first:

```bash
dockscope plugin:verify  --package ./my-plugin.dockscope-plugin
dockscope plugin:install --source  ./my-plugin.dockscope-plugin
```

Sign the package so users can verify provenance. `plugin:pack` accepts `--private-key` and `--key-id`, and `plugin:verify` accepts the matching `--public-key`.

### Option 3: Publish a signed catalog

A catalog gives your users the same browse-and-install experience as the official plugins, with signature verification on both the catalog and each package.

Generate a signing key pair once and keep the private keys out of your repository:

```bash
dockscope plugin:keys --out-dir ./keys --name acme
```

Pack the plugin with a signature, then generate its catalog entry:

```bash
dockscope plugin:pack --source ./my-plugin --out ./acme.hello.dockscope-plugin \
  --private-key ./keys/acme.private.pem --key-id acme-v1

dockscope plugin:catalog:entry --package ./acme.hello.dockscope-plugin \
  --public-key ./keys/acme.public.pem --key-id acme-v1 \
  --category Utilities --license MIT > entry.json
```

`plugin:catalog:entry` writes the entry to stdout. Its `packageUrl` defaults to the package filename, so **edit it to the URL users will download from** before publishing.

Assemble `catalog.json` around one or more entries. The `format` value is exact:

```json
{
  "format": "dockscope-plugin-catalog/v1",
  "name": "Acme Plugins",
  "updatedAt": "2026-07-25T00:00:00.000Z",
  "entries": [{ "...": "contents of entry.json" }]
}
```

Sign the catalog in place, which adds its `signature` block:

```bash
dockscope plugin:catalog:sign --catalog ./catalog.json \
  --private-key ./keys/acme.private.pem --key-id acme-catalog-v1
```

Publish `catalog.json` and the package file at stable URLs. Users need your catalog public key to verify the signature, either passed directly or through a trust store that supports key rotation and revocation:

```json
{
  "format": "dockscope-plugin-catalog-trust/v1",
  "keys": [
    {
      "algorithm": "ed25519",
      "keyId": "acme-catalog-v1",
      "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n",
      "status": "active"
    }
  ],
  "revokedKeyIds": []
}
```

Users then browse and install from it:

```bash
dockscope plugin:catalog --catalog https://acme.example/catalog.json \
  --trust ./acme-trust.json
dockscope plugin:catalog:install acme.hello \
  --catalog https://acme.example/catalog.json \
  --catalog-trust ./acme-trust.json
```

To use your catalog for a whole session, pass `--plugin-catalog` and `--plugin-catalog-trust` to `dockscope up`, or set `DOCKSCOPE_PLUGIN_CATALOG` and `DOCKSCOPE_PLUGIN_CATALOG_TRUST`.

Configured catalogs are added to the official one rather than replacing it, so your plugins appear alongside the official ones. Users who want only your catalog can pass `--no-official-plugin-catalog`.

### Choosing an id

Publish under your own publisher segment, for example `acme.hello`. The `official.` prefix is reserved and requires a verified package signature, as described in [Plugin ids and the reserved namespace](plugins.md#plugin-ids-and-the-reserved-namespace).

## Packaging and Signing

Create and verify package artifacts:

```bash
dockscope plugin:pack --source ./plugins/example --out ./example.dockscope-plugin
dockscope plugin:verify --package ./example.dockscope-plugin
```

Add an HMAC signature with a local key:

```bash
dockscope plugin:pack --source ./plugins/example --out ./example.dockscope-plugin --signing-key "$KEY"
dockscope plugin:verify --package ./example.dockscope-plugin --signing-key "$KEY"
dockscope plugin:install --source ./example.dockscope-plugin --signing-key "$KEY"
```

Packages store every file with a SHA-256 hash, plus a whole-package SHA-256. Signatures are optional, but when a signing key is provided verification requires a matching package signature.

For distribution, prefer Ed25519 public-key signatures:

```bash
dockscope plugin:keys --out-dir ./keys
dockscope plugin:pack --source ./plugins/example --out ./example.dockscope-plugin --private-key ./keys/dockscope-plugin.private.pem --key-id maintainer-1
dockscope plugin:verify --package ./example.dockscope-plugin --public-key ./keys/dockscope-plugin.public.pem
dockscope plugin:install --source ./example.dockscope-plugin --public-key ./keys/dockscope-plugin.public.pem
```

Generate a catalog entry from a signed package:

```bash
dockscope plugin:catalog:entry --package ./example.dockscope-plugin --public-key ./keys/dockscope-plugin.public.pem --key-id maintainer-1
```

Build the repo-local official plugin catalog after a DockScope build:

```bash
npm run build
npm run plugins:catalog -- --source plugins/official --out dist/plugin-catalog --dev-keys
```

For release signing, pass real key files instead of `--dev-keys`:

```bash
npm run plugins:catalog -- \
  --source plugins/official \
  --out dist/plugin-catalog \
  --package-private-key ./keys/package.private.pem \
  --package-public-key ./keys/package.public.pem \
  --catalog-private-key ./keys/catalog.private.pem \
  --catalog-public-key ./keys/catalog.public.pem \
  --package-key-id official-package \
  --catalog-key-id official-catalog
```

The script packages every directory under `plugins/official`, writes package artifacts under `dist/plugin-catalog/packages`, writes `catalog.json` and `catalog-trust.json`, and signs the catalog when a catalog private key is provided. Pass `--package-trust-policy <file>` to carry previous package keys and package revocations, and `--catalog-trust-store <file>` to carry overlapping catalog signer keys. The equivalent CI variables are `DOCKSCOPE_PLUGIN_PACKAGE_TRUST_POLICY` and `DOCKSCOPE_PLUGIN_CATALOG_TRUST_STORE`.

Set `SOURCE_DATE_EPOCH` to a Unix timestamp to make `updatedAt`, default `publishedAt`, packages, signatures, and catalog files reproducible from identical inputs:

```bash
SOURCE_DATE_EPOCH="$(git log -1 --format=%ct)" npm run plugins:catalog -- --out dist/plugin-catalog
```

## Catalogs

A plugin catalog is a signed-package index. DockScope connects to the pinned official catalog by default.

`--plugin-catalog` and `DOCKSCOPE_PLUGIN_CATALOG` accept a **comma-separated list** of local JSON files or HTTP(S) URLs. Those catalogs are added to the official one, so official and third-party plugins are browsable together:

```bash
dockscope up \
  --plugin-catalog https://acme.example/catalog.json,https://team.internal/catalog.json \
  --plugin-catalog-trust ./trust.json
```

Catalogs are loaded independently and in order. Rules that follow from that:

- One unreachable or untrusted catalog does not hide the others. Each failure is reported separately in the Plugins panel.
- When the same plugin id appears in more than one catalog, the **earlier** catalog wins. The official catalog is first unless disabled, so a third-party catalog cannot shadow an official plugin.
- Each entry records which catalog it came from, shown next to the entry once more than one catalog is configured.
- The official catalog always keeps its pinned key. A key configured for a third-party catalog is used in addition to the pin, never instead of it.

Use `--no-official-plugin-catalog` or `DOCKSCOPE_DISABLE_OFFICIAL_PLUGIN_CATALOG=1` for an instance that trusts only the catalogs you configure.

### Adding a catalog from the UI

Catalogs can also be added from the **Plugins panel** without restarting, under the Catalogs section of the Marketplace tab. Paste the catalog URL and press Fetch, and DockScope inspects it before anything is stored:

1. The catalog is read unverified, purely to learn its name and signing key id.
2. The signing key is discovered from the publisher. A catalog's signature carries only a key id, never the key, so `catalog.public.pem` and `catalog-trust.json` are probed next to `catalog.json`, which is where the release tooling publishes them.
3. That key must actually verify the catalog's signature. If it does not, or if the catalog is unsigned, or if no key is published, the catalog is refused and the reason is shown.
4. The key's SHA-256 fingerprint is displayed. **Compare it against the fingerprint the publisher advertises** before accepting, since that comparison is what protects you from a substituted key at add time.

Accepting pins the catalog to that exact key, stored in `~/.dockscope/catalogs.json` (override with `DOCKSCOPE_PLUGIN_CATALOGS`). Pinning matters: if the catalog is later signed by a different key, it fails with a signature mismatch instead of loading silently, so a rotated or stolen key is visible rather than invisible. A pinned catalog is verified against its own key alone, never against `DOCKSCOPE_PLUGIN_CATALOG_PUBLIC_KEY`.

Catalogs added this way behave exactly like configured ones: same ordering, same per-catalog error isolation, same provenance badges. Only user-added catalogs show a Remove button; the official catalog and anything set by flag or environment variable cannot be removed from the UI.

A single trust store can hold the signing keys of several catalogs, since keys are matched by `keyId`, so configuring multiple catalogs does not require multiple trust files.

A catalog document looks like this:

```json
{
  "format": "dockscope-plugin-catalog/v1",
  "name": "Official DockScope Plugins",
  "updatedAt": "2026-07-10T19:00:00.000Z",
  "trust": {
    "packageKeys": [
      {
        "algorithm": "ed25519",
        "keyId": "maintainer-2",
        "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n",
        "status": "active"
      }
    ],
    "revokedPackageKeyIds": [],
    "revokedPackages": []
  },
  "signature": {
    "algorithm": "ed25519",
    "value": "catalog-signature-base64",
    "keyId": "catalog-1"
  },
  "entries": [
    {
      "id": "example.plugin",
      "name": "Example Plugin",
      "version": "1.0.0",
      "description": "Adds an example command",
      "homepage": "https://github.com/ManuelR-T/dockscope",
      "repositoryUrl": "https://github.com/ManuelR-T/dockscope",
      "readmeUrl": "https://github.com/ManuelR-T/dockscope/blob/main/docs/plugins.md",
      "readme": "# Example Plugin\n\nRendered in the Marketplace review panel.",
      "iconUrl": "https://example.com/icon.png",
      "license": "MIT",
      "category": "Utilities",
      "status": "active",
      "tags": ["demo"],
      "screenshots": [],
      "publishedAt": "2026-07-10T19:00:00.000Z",
      "releaseNotes": "Initial catalog release.",
      "compatibility": {
        "minDockscopeVersion": "0.7.0"
      },
      "capabilities": ["ui.command"],
      "permissions": [],
      "packageUrl": "./example.dockscope-plugin",
      "packageSha256": "package-bundle-sha256-from-plugin-pack",
      "signature": {
        "algorithm": "ed25519",
        "keyId": "maintainer-2"
      }
    }
  ]
}
```

Package signatures and catalog signatures are separate:

- Each entry `signature` verifies the downloaded plugin package.
- The top-level `signature` verifies the catalog contents and entry metadata.
- The signed top-level `trust` policy resolves package `keyId` values and rejects revoked package keys, versions, or SHA-256 hashes.
- `dockscope plugin:catalog:sign --catalog ./plugin-catalog.json --private-key ./keys/catalog.private.pem --key-id catalog-1` signs the catalog in place.
- `--plugin-catalog-public-key ./keys/catalog.public.pem` or `DOCKSCOPE_PLUGIN_CATALOG_PUBLIC_KEY` makes catalog verification strict. Unsigned catalogs or mismatched signatures are rejected.

Use `dockscope plugin:catalog --catalog ./plugin-catalog.json --trust ./keys/catalog-trust.json` to inspect a signed catalog and `dockscope plugin:catalog:install <pluginId> --catalog ./plugin-catalog.json --catalog-trust ./keys/catalog-trust.json` to install from it. The legacy single-key options remain available. When DockScope is started with `--plugin-catalog`, the Plugin Manager Marketplace tab can install, update, and uninstall catalog plugins in the configured local registry. Install and update actions open a review step with package signature, package hash, capabilities, permissions, compatibility range, target registry, installed version, and release notes.

The local catalog signer trust store is deliberately outside the signed catalog, so a compromised catalog signer cannot un-revoke itself:

```json
{
  "format": "dockscope-plugin-catalog-trust/v1",
  "keys": [
    {
      "algorithm": "ed25519",
      "keyId": "catalog-1",
      "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n",
      "status": "retiring"
    },
    {
      "algorithm": "ed25519",
      "keyId": "catalog-2",
      "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n",
      "status": "active"
    }
  ],
  "revokedKeyIds": []
}
```

For package-key rotation, publish both keys in the signed catalog policy, mark the old key `retiring`, start signing packages with the new key, then add the old id to `revokedPackageKeyIds` after the migration window. For catalog-root rotation, distribute a local trust store containing both signer keys before switching the catalog signature; remove or revoke the old signer only after clients have received the new root. Emergency package revocations may target a plugin id, version, SHA-256, or any combination.

Marketplace installs reject `yanked` entries, incompatible entries, hash mismatches, untrusted or revoked keys, revoked packages, and unsigned package entries by default. The capabilities and permissions displayed from the catalog must exactly match the signed package manifest before installation. Package contents are fully verified in a staging directory, then the plugin directory and registry index are activated atomically. A failed activation restores the previous version. Use `--allow-unsigned-plugins`, `DOCKSCOPE_PLUGIN_ALLOW_UNSIGNED=1`, or `dockscope plugin:catalog:install --allow-unsigned` only for local development catalogs.

Marketplace entries can include `iconUrl`, `screenshots`, `repositoryUrl`, `readmeUrl`, and inline `readme` text. DockScope renders screenshots and inline README content in the install/update review panel.

### Official catalog releases

CI builds a temporary signed catalog, verifies its signature, installs the Kubernetes package, and loads it through the public plugin path. The release workflow builds the production catalog, attaches its files to the GitHub release, and deploys the same files under `/plugins/` on GitHub Pages.

Configure these GitHub Actions secrets before releasing:

- `PLUGIN_PACKAGE_PRIVATE_KEY`: Ed25519 private key used to sign plugin packages.
- `PLUGIN_CATALOG_PRIVATE_KEY`: Ed25519 private key used to sign the catalog metadata.
- `PLUGIN_PACKAGE_TRUST_POLICY`: optional JSON with overlapping package keys and revocations.
- `PLUGIN_CATALOG_TRUST_STORE`: optional JSON with overlapping catalog signing keys and revocations.

Generate each pair with `dockscope plugin:keys`. Keep private keys outside the repository and retain them between releases. The catalog builder derives and publishes `package.public.pem` and `catalog.public.pem`; it also accepts the corresponding `DOCKSCOPE_PLUGIN_*_PRIVATE_KEY` environment variables in CI. Release builds use `--require-signatures` and fail closed when either secret is absent.

GitHub Pages must use **GitHub Actions** as its deployment source. Once enabled, the stable catalog URL is `https://<owner>.github.io/<repository>/plugins/catalog.json`.

