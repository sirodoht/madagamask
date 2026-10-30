# Madagamask progress

Target: roadmap milestones 1–7, through a testnet-only alpha. Hardware wallets and public release are outside this run. Work proceeds in milestone order with frequent commits. Unmet acceptance checks stay explicit.

## Status

| Milestone                 | Status      | Evidence / remaining work                                                                                                                           |
| ------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Foundation             | In progress | Pinned mise/Node/npm stack, manifests, builds, message validation, heartbeat, preview UI, unit tests. Browser checks and lifecycle validation next. |
| 2. Vault and accounts     | Pending     |                                                                                                                                                     |
| 3. Networks and receiving | Pending     |                                                                                                                                                     |
| 4. Native transfers       | Pending     |                                                                                                                                                     |
| 5. Dapp connections       | Pending     |                                                                                                                                                     |
| 6. Tokens and protection  | Pending     |                                                                                                                                                     |
| 7. Testnet alpha          | Pending     |                                                                                                                                                     |

## Decisions and limits

- Node 26.13.0 / bundled npm 11.20.0 managed by mise. Exact dependencies and lockfile are committed.
- Chrome/Chromium behavior is tested; Firefox receives package checks only and must remain labeled untested.
- No real assets or existing user wallet data are used. Generated test keys are disposable.
- Public-testnet funding, service availability, and external dapp compatibility require observable evidence; they will not be inferred from local tests.
- The alpha has not received independent security review.

## Work log

### 2026-10-30 — foundation

- Resumed the existing uncommitted scaffold. Fixed a package test that incorrectly treated a closing script tag as inline JavaScript.
- Added this progress record before further implementation.
- Validation: lint, strict typecheck, six unit tests, two production package checks, and four Chromium 156.0.8078.4 browser tests passed. CI added. Installed stable Chrome and debugger-free idle/restart validation remain outstanding and will be exercised with the vault.
- Dependency review: viem and its runtime dependency tree use MIT; TypeScript/Playwright use Apache-2.0; Biome is MIT OR Apache-2.0; esbuild and type declarations use MIT. Runtime license texts are generated into both packages. npm reported zero known vulnerabilities at installation. No wallet runtime imports are bundled yet.

### Vault and accounts

- Implemented versioned AES-GCM vault, 600,000-iteration PBKDF2, BIP39 validation, standard Ethereum derivation, imported keys, account naming/selection, backup confirmation, password changes, auto-lock, and reauthenticated reset/export.
- Eleven unit tests and five Chromium production UI tests pass, including create, backup, lock/unlock, browser restart, and address restoration. Tampering, failed writes, future formats, wrong passwords, and lock-during-unlock are covered.
- Added @scure/bip39 1.6.0 as a direct dependency (already in viem's pinned tree) for explicit checksum validation.
- Remaining evidence: installed stable Chrome, forced worker termination, debugger-free idle continuity, and broader import/export UI coverage.

### Networks and receiving

- Added Sepolia, Base Sepolia, Ethereum, network selection, custom RPC editing with chain-ID verification, bounded RPC bodies/timeouts, and on-demand native balances. Ethereum is view-only for alpha signing.
- Receive screen displays the address, network, and EIP-681 QR payload. Added qr 0.7.2 (MIT OR Apache-2.0, zero dependencies); the older @paulmillr/qr name was deprecated and was removed before commit.
- RPC URLs reject remote plaintext HTTP, embedded credentials, fragments, and non-HTTP schemes. HTTPS host permissions enable user-selected RPCs; localhost HTTP is for local development chains. Balance errors never display a misleading zero.
- Public RPC providers receive the queried address and method; no background balance polling. Real two-network browser validation remains in the alpha checklist.

### Native transfers and activity

- Added exact decimal parsing, fee/total review, EIP-1559 and legacy signing, single-use expiring reviews, persisted pre-broadcast transaction hashes, and explicit uncertain-submission handling.
- Added activity refresh, bounded background tracking, receipt/revert status, shallow-reorg rechecks, external nonce replacement detection, and fee-bumped speed-up/cancel. Unseen transactions are not represented as definitely dropped.
- Local Anvil tests cover transfer confirmation, duplicate approval rejection, insufficient funds, lock invalidation, and pending cancellation. Browser regression checks remain green.
- Public testnet transfer evidence is still outstanding; no funded public-testnet key has been supplied or used.
