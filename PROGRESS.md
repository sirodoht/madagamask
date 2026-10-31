# Madagamask progress

Target: roadmap milestones 1–7, through a testnet-only alpha. Hardware wallets and public release are outside this run. Work proceeds in milestone order with frequent commits. Unmet acceptance checks stay explicit.

## Status

| Milestone                 | Status                                        | Evidence / remaining work                                                                                                        |
| ------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 1. Foundation             | Implemented and validated                     | Both builds, CI configuration, message boundaries, stable Chrome and debugger-free lifecycle checks.                             |
| 2. Vault and accounts     | Implemented and validated                     | Recovery, encryption, accounts, backup, lock/restart/update behavior, interrupted writes.                                        |
| 3. Networks and receiving | Implemented and validated                     | Sepolia and Base Sepolia balances/QR in Chrome; custom RPC checks.                                                               |
| 4. Native transfers       | Implemented; acceptance incomplete            | Local UI/chain sends, replacement and failure tests pass. Funded public-testnet transfer still required.                         |
| 5. Dapp connections       | Implemented and validated for declared subset | Local connect/sign/transaction flows, external EIP-6963 reference demo; unsupported methods documented.                          |
| 6. Tokens and protection  | Implemented and validated                     | Token import/send, edited allowances confirmed on-chain, execution checks, local phishing list and limitations.                  |
| 7. Testnet alpha          | Packaged candidate; conditional acceptance    | Reproducible archives, production checks, documentation and measured budgets. Milestone 4 public-testnet criterion remains open. |

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

### Alpha hardening and failure testing

- Added an always-available lock control, stale UI-result suppression, and epoch checks for queued operations. Reset authentication now precedes permission deletion. Missing recovery phrases cannot silently create a new wallet.
- Expanded checks: 21 unit tests, eight local-chain tests, and both package checks pass. Chain tests now exercise pre-broadcast storage failure, a lost submission response without duplicate sends, and confirmation rollback after a reorganization.
- Fresh official Chrome stable installer supplied 156.0.8078.80. A separate raw-CDP harness, without a worker debugger attached, demonstrated 45-second idle continuity, locking after forced worker termination, and auto-lock after 65 seconds while the heartbeat retained the same worker. Reload/update harness work remains unresolved; no passing update result is claimed yet.

- Review follow-up: receipt RPC failures now retain explicit stale status instead of implying replacement; rolled-back receipts clear old block metadata. Approval cancellation remains effective during asynchronous processing and immediately before broadcast. Permission writes are serialized.
- Validation now passes 24 unit tests and nine local-chain tests, including typed-data signature recovery, network-switch approval, and dismissal during signing/persistence. Chrome production UI passed native/token sends and two-network balances/receiving. Main actions use a compact two-column layout; Lock stays in the header.
- Reload diagnosis: Chrome disabled the unpacked test extension on reload because its disposable profile had Developer mode off. Enabling it through Chrome's extension manager allowed a version change to 0.1.1, preserved the vault, and required unlocking again. Browser restart then restored the same address. Full lifecycle rerun remains queued.
- External compatibility limitation discovered: the bundled upstream phishing feed contains `metamask.github.io`, so that demo is blocked. No bypass was added. The EIP-6963 reference demo is being checked separately.

- Full debugger-free lifecycle run now passes: idle continuity, forced termination, auto-lock, developer update, and browser restart. Developer update testing is not Chrome Web Store update validation.
- Reference-demo integration exposed detached `provider.request` calls. Bound the provider's public methods; `eip6963.org` now discovers and connects through its own Connect control. Local dapp testing now verifies a reviewed unlimited ERC20 allowance edited to seven base units and confirmed on-chain.
- Production lint/type/unit/package checks pass. Runtime dependency audit reports zero known vulnerabilities. Archives are generated; clean-checkout reproducibility and final isolated browser runs remain before sign-off.

- Final fixed-artifact Chrome 156.0.8078.80 run: all nine browser tests pass, including live Sepolia/Base balances, EIP-6963 reference-demo connection, and local dapp allowance editing. Chromium 156.0.8078.4: seven pass, two external-service tests intentionally skipped. Chrome popup startup across nine fresh profiles measured 193–300 ms (median 282 ms), with the worker already loaded.
- Clean-checkout comparison found identical file contents but different source file modes in ZIP metadata. Packaging now normalizes file permissions as well as timestamps and ordering; clean rebuild comparison is being repeated.

### Final checkpoint

- Clean source rebuild produces byte-identical Chrome and Firefox archives after permission normalization. Final code and packaging commits: `70613a0` and `70c06ea`.
- Final validation: 24 unit, nine chain, nine Chrome, seven Chromium, and two package checks pass; two optional network tests skipped only in the Chromium run. Debugger-free Chrome lifecycle checks pass. Full results, exact versions, size/timing/idle observations, archive hashes, and limits are in `VERIFICATION.md`.
- Documentation now covers installation, updates, recovery, supported methods/chains, privacy, simulation and phishing limitations, history coverage, and test commands. ROADMAP checkboxes reflect implemented work; funded public-testnet acceptance is explicitly unchecked.
- Work is committed locally in small milestones and follow-up fixes. No push, deployment, store submission, or real-money operation was performed.
- **Next acceptance action:** use a funded disposable Sepolia or Base Sepolia wallet to complete and record a public-testnet native transfer in Chrome, including restart tracking. Do not use existing real-asset keys. This is the outstanding criterion before calling all seven milestones complete.

### Onboarding wording

- Replaced the promotional welcome heading with the plain label “Ethereum wallet” and updated the existing browser selectors. Rebuilt both browser packages.
- Lint, typecheck, 24 unit tests, and both package checks pass. The initial sandboxed check could not open the local RPC test server; rerunning with local-server access passed. Browser flows were not rerun for this text-only change. Current archive hashes are in `artifacts/SHA256SUMS`; the verification report retains the original alpha baseline.

### Compact wallet header — 2026-10-31

- Combined the separate alpha badge and warning into one short notice: “Testnet alpha · Use test keys only.” Reduced shell padding, logo size, heading size, and the gap before the wallet controls; removed the large extra top padding in tab views.
- Lint and both package checks pass. Three targeted Chrome browser checks pass, covering onboarding, narrow/enlarged-text layouts, and native/token/dapp transaction screens. Inspected Chrome and isolated Firefox 159 screenshots; the Firefox wallet heading starts about 103 CSS pixels from the top. Both browser distributions and ZIPs rebuilt.
- Firefox remains on Manifest V3; its session lifecycle behavior is unchanged, as requested.

### Account-first wallet home — 2026-10-31

- Moved the account dropdown to the top left and the open-tab control to the top right, alongside Lock. The full address below the account row copies on click. Removed the alpha notice, redundant home heading, bottom address/Copy button, and home backup prompt; recovery backup remains available in Settings and the existing signing requirement is unchanged.
- Balance loads automatically on opening the wallet and changing account/network. Refresh remains available; duplicate in-flight refreshes are suppressed and results remain bound to their original screen/account/network.
- Lint, typecheck, both package checks, and four targeted Chrome browser flows pass. Existing local-chain coverage now verifies automatic balance loading, full-address copying, and no overflow at 320×600 and 380×600. Backup/restore through Settings, transfers, and enlarged-text navigation pass. Isolated Firefox 159 renders the home in about 438 CSS pixels of height. Both distributions and archives rebuilt; no session lifecycle changes.
