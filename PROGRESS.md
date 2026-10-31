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

### Account menu and tighter grouping — 2026-10-31

- Grouped the full clickable address directly under the account/header row, removing the extra main-content gap. Send now uses the same neutral button style as the other home actions.
- Replaced the native account select with an anchored, wallet-styled popover menu. Added selected-account indicators, arrow/Home/End navigation, Enter selection, Escape/Tab dismissal, outside-click dismissal, and focus restoration after selection. Screen changes remove the menu.
- Typecheck, lint, both package checks, and four Chrome browser flows pass, including a new multi-account keyboard/dismissal check and the existing clipboard/no-overflow/transfer coverage. Inspected the open menu in isolated Firefox 159; the home occupies about 410 CSS pixels vertically. Rebuilt both browser distributions and archives.

### Inline address-copy feedback — 2026-10-31

- Clicking the address now shows “Address copied ✓” in the same place for two seconds, then restores the full address. Copy failures also report inline. No bottom status or loading message is added; the address row retains its dimensions during feedback.
- Lint, typecheck, both package checks, and the Chrome wallet transfer flow pass. Clipboard coverage verifies the copied value, inline success, empty bottom status, unchanged layout bounds, and address restoration. Both distributions and archives rebuilt.

### Unlock session persistence — implementation checkpoint, 2026-10-31

- Added trusted-context-only browser session storage for a temporary vault-unlock key, vault salt, last activity, and expiry. Passwords, mnemonic phrases, and account payloads are not stored in session storage; the disk vault remains encrypted. Restoration validates the key against the vault and verifies expiry before granting access.
- Serialized session updates/deletion and retained immediate epoch invalidation on Lock. Added alarm-driven expiry while backgrounds are unloaded, plus explicit browser-start/extension-install-update clearing. Default timeout is now 30 minutes; legacy five-minute settings migrate to 30, other existing values remain, and new explicit five-minute settings persist.
- Unlock input receives focus and no longer shows password-creation help. 31 unit tests and eight Chrome browser flows pass (two optional external checks skipped). Unit coverage includes actual restored signing, deadlines, stale password keys, reset, malformed session data, lock/restoration/write races, and storage failure. An existing queued-unlock regression was caught and fixed before this checkpoint.
- Chrome and Firefox real lifecycle validation is in progress. Push is pending a repository URL: this checkout has no configured remote; requested it from the user.

### Unlock session persistence — verified, 2026-10-31

- Chrome 156.0.8078.76 debugger-free lifecycle checks pass: 45-second idle continuity, fresh worker restoration after forced termination, one-minute expiry after 65 seconds, locked developer reload/version update, and locked browser restart with the same recovered address.
- Firefox 159 debugger-free lifecycle checks pass: with every wallet page closed for 40 seconds, the background identity changes and the session restores unlocked. A one-minute timeout expires with pages closed for 65 seconds and removes session material. Extension reload preserves the vault but clears the session. Unlock focuses the password field and omits the creation hint. Reproduce with `npm run test:lifecycle:firefox`; evidence is in `artifacts/firefox-lifecycle.json`.
- Nine local-chain tests pass. Eight Chrome browser flows pass (two optional external-service checks skipped); the dapp flow was extended and rerun to confirm that the actual extension content-script context cannot read `storage.session`, and the session key is absent from local storage. Added and passed explicit legacy-timeout migration coverage, bringing unit coverage to 32 tests. Lint, typecheck, and package checks pass; both browser distributions and archives rebuilt.
- The core checkpoint is `4142b4c`. Push remains blocked by the missing Git remote URL; no remote repository was guessed or created.

### Compact Settings — 2026-10-31

- Removed the phishing status/timestamp paragraph and update-source explanation from Settings. The update action remains. Backup now uses the same neutral style as every other setting.
- Arranged settings in a compact two-column grid, retaining the shared shell/header padding and Lock/open-tab placement. All settings, including the conditional imported-key export and Back, fit at 320×600 and 380×600 without hiding overflow.
- Lint, typecheck, and both package checks pass. Three targeted Chrome flows pass: settings layout/header geometry, backup/restore, and native/token transfers using network settings. Inspected Firefox 159 Settings (about 450 CSS pixels tall) and Chrome screenshots. Both distributions and archives rebuilt.

### Settings Back navigation — 2026-10-31

- Back now returns to Settings from connected sites, network/account/password/auto-lock/reset forms, and both backup/export screens, including the revealed-secret view. Back on Settings still returns home.
- Lint, typecheck, both package checks, and three targeted Chrome flows pass. Navigation coverage opens and backs out of all ten settings destinations and both revealed-secret views, verifying the secret is removed on return. Both browser distributions and archives rebuilt.

### Private-key import wording — 2026-10-31

- Removed the backup/test-key help text from the private-key import form. Lint and both package checks pass; both distributions and archives rebuilt. No behavior changed.

### Make account backup sources explicit — 2026-10-31

- Split the account dropdown into “Recovery phrase accounts” (one phrase backs up the group) and “Imported accounts” (each key needs its own backup), omitting empty groups. The closed selector also identifies the selected source. Grouping preserves the original account indices, and keyboard navigation follows visual order.
- Settings identifies the selected account's backup type and offers “Back up selected private key” for imported accounts. Phrase/key reveal screens state which accounts the backup covers. The add-account form identifies that it creates a recovery-phrase account. Header sizing remains consistent and ordinary home/Settings layouts still fit the popup.
- Lint, typecheck, package checks, and four targeted Chrome flows have passing coverage. Mixed-order account coverage verifies grouping, keyboard selection, selected focus, dismissal, and export of the exact selected disposable private key. Fixed a delayed-popover focus race discovered by that test. Inspected the grouped Firefox 159 menu. Both distributions and archives rebuilt.

### Account source wording — 2026-10-31

- Removed the source subtitle from the closed account selector and restored its compact header height. Renamed the dropdown's “Imported accounts” group to “Private key accounts,” describing the backup source instead of how accounts were added. No storage or account data changed.
- Lint, typecheck, both package checks, and two targeted Chrome layout/account-navigation flows pass. Both browser distributions and archives rebuilt.

### Remove dropdown backup notices — 2026-10-31

- Removed both backup explanation lines from the account dropdown. Lint and both package checks pass; both distributions and archives rebuilt. Discussing named-wallet/account grouping separately before changing the vault model.

### Named wallets and child accounts — core checkpoint, 2026-10-31

- Added encrypted payload v2 with named wallets holding a mnemonic, raw BIP32 seed, or private key. Accounts reference their owning wallet; mnemonic/seed wallets derive independent Ethereum account indices, while a private-key wallet has one account. Wallet rename, import/create, backup reveal, and confirmation target a stable wallet ID.
- Legacy vaults migrate in memory without changing account names, addresses, ordering, selection, or encrypted storage on unlock. The next successful mutation writes v2; failed writes preserve the original vault. Session restoration and password changes support all wallet types. New-wallet/account selection invalidates pending approvals.
- Added migration, failed-write, seed/mnemonic equivalence, per-wallet derivation/backup, multi-source session/password restoration, duplicate/invalid seed, and corrupt ownership tests. UI integration and browser verification are in progress.

### Named wallets and child accounts — interface checkpoint, 2026-10-31

- Replaced source-category dropdown groups with named wallet groups labeled Mnemonic, Seed, or Private key. Each group contains its accounts and a wallet management menu; mnemonic/seed wallets offer Add account. Add wallet supports fresh mnemonics and importing all three sources, including initial setup. Removed the old generic phrase/key group headings and backup notices.
- Wallet management provides Rename and reauthenticated Backup for the exact wallet, even when another wallet is selected. Settings uses the selected wallet and preserves Back navigation. Existing account names and the compact main header remain intact. Backups hide on navigation, visibility loss, or timeout.
- All 38 unit tests pass, including approval invalidation when adding a wallet/account. Nine Chrome browser flows pass (two optional external-service checks skipped); three targeted layout, keyboard, and multi-wallet flows pass again after the final sizing adjustment. Inspected Firefox 159 grouping. Chrome and Firefox distributions/ZIPs rebuilt; both package checks pass. Real background-lifecycle checks are finishing.
