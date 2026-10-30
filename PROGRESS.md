# Madagamask progress

Target: roadmap milestones 1–7, through a testnet-only alpha. Hardware wallets and public release are outside this run. Work proceeds in milestone order with frequent commits. Unmet acceptance checks stay explicit.

## Status

| Milestone                 | Status                                            | Evidence / remaining work                                                                                   |
| ------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1. Foundation             | Implemented; acceptance checks pending            | Builds, CI, messaging and Chromium checks pass. Installed Chrome and debugger-free lifecycle checks remain. |
| 2. Vault and accounts     | Implemented; broader browser checks pending       | Encryption, recovery, locking, accounts and backup flows tested.                                            |
| 3. Networks and receiving | Implemented; two-network browser check pending    | RPC validation, balance refresh and QR receiving implemented.                                               |
| 4. Native transfers       | Implemented locally; public-testnet check pending | Local sends/cancellation pass. No funded public-testnet transfer yet.                                       |
| 5. Dapp connections       | Implemented; external compatibility pending       | Provider connection and signing pass in Chromium and unit tests.                                            |
| 6. Tokens and protection  | Implemented; acceptance validation underway       | Local ERC20 import/transfer, allowance decoding/editing, execution checks and phishing protection.          |
| 7. Testnet alpha          | In progress                                       | Hardening, broader browser/lifecycle tests, packaging and documentation next.                               |

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
- Follow-up: the first native-transfer test exposed a precompile out-of-gas revert with the exact estimate. Added a 20% gas margin and asserted receipt success explicitly. Earlier transfer tests were not all green when the initial transfer commit was made; this correction is recorded rather than treating that run as passing.

### Dapp connections and signing

- Added an EIP-1193 request provider and EIP-6963 discovery, isolated content bridge, top-frame HTTPS/localhost origin authorization, per-origin account permissions, connection revocation, message/typed-data signing, transaction requests, and approved network changes.
- Approval payloads are cloned and bound to account, chain, origin, document, and deadline. Queues/rates are bounded. Lock, navigation, tab closure, context changes, and approval-window dismissal reject requests.
- Added a local test dapp (`npm run dev:dapp`). Six production Chromium tests and sixteen unit tests pass, including real injected-provider connect/sign/lock, origin isolation, payload mutation, and stale-document rejection.
- Compatibility is intentionally explicit: unsupported signing methods and transaction fields fail. External dapp compatibility remains unverified; the alpha does not claim MetaMask API parity.

### Tokens and clearer confirmations

- Added ERC20 import, metadata validation, exact-decimal balances/transfers, removal, approval decoding, unlimited-allowance warnings, and allowance editing with a fresh review.
- RPC eth_call is an execution check, not a safety verdict or full asset-delta simulation. Confirmations show decoded intent and explicitly state when actual asset changes are unknown. False-returning token calls and failed checks do not appear successful.
- Bundled a compressed, MIT-licensed PhishDestroy snapshot (232,288 domains), its license and SHA-256 metadata. Matching happens locally; manual updates fetch GitHub without sending visited domains. Lists become stale after 24 hours; known blocked domains stay blocked. Failed updates preserve the previous list.
- Eighteen unit tests, five local-chain tests, and six Chromium browser tests pass. The original Solidity test token was compiled with pinned solc 0.8.30; its source and fixture bytecode are included.
