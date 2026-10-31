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
- Chrome/Chromium behavior is tested. Firefox 159.0 lifecycle and core flows run in CI as a temporary add-on; its package stays labeled unsigned.
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

### Named wallets and child accounts — verified, 2026-10-31

- Chrome 156.0.8078.76 lifecycle checks pass: 45-second idle continuity, restored unlock after forced worker termination, one-minute expiry, locked extension reload/version update, and locked browser restart with preserved address. The bundled Chrome-for-Testing run passed idle/restoration/expiry but timed out in automated developer reload; rerunning the complete suite with installed Chrome passed.
- Firefox 159 lifecycle checks pass: fresh background restores the session after 40 seconds, expiry locks and clears session material after 65 seconds, and extension reload preserves the vault while locking. Nine local-chain transaction tests pass.
- Final validation: lint/typecheck, 38 unit tests, nine Chrome browser flows (two optional external checks skipped), both package checks, and real Chrome/Firefox lifecycle checks. Inspected the final three-source Chrome dropdown and Firefox grouping. Both distributions and ZIP archives rebuilt. Implementation commits 3f73177 and 0d05931 are pushed; this entry records final verification.

### Compact wallet action dropdown — 2026-10-31

- Replaced the full-screen wallet management page with a small nested dropdown anchored to the three-dot button. The account list stays visible; actions remain scoped to that wallet. Back from an action reopens its dropdown.
- Added keyboard navigation, Escape/Left dismissal with focus restoration, outside-click dismissal, and viewport-aware positioning. Private-key wallets omit Add account.
- Lint/typecheck, both package checks, and three targeted Chrome browser flows pass, including compact dimensions at 320px width, keyboard/outside dismissal, rename, and exact-wallet backup. Inspected Chrome and Firefox 159 screenshots and confirmed nested dismissal in Firefox. Both browser distributions and archives rebuilt.

### Dedicated wallet selector screen — 2026-10-31

- Replaced the account popover and nested action menus with a stable Wallets screen. Wallets retain source labels and child accounts, with visible Rename actions on every wallet/account, wallet backup, conditional Add account, Add wallet, and Back. Selecting an account returns home; renaming or cancelling returns to the list.
- Account renaming accepts a validated target index so an unselected account can be renamed without switching the signing account. Existing Settings renaming still targets the selected account. Renames persist across reload/unlock.
- Lint/typecheck, 39 unit tests, both package checks, and three targeted Chrome flows pass. Coverage includes stable outside clicks, keyboard selection, unselected account rename, invalid rename indices, persistence, wallet-specific backups and return navigation. Inspected Chrome and Firefox 159 screens. Both distributions and archives rebuilt.

### Wallet and account overflow actions — 2026-10-31

- Moved wallet Rename and Add account into each wallet’s compact three-dot menu. Each account has its own three-dot Rename action. Removed Backup and the action footer from wallet cards; backup remains in Settings. Private-key wallet menus omit Add account.
- Menus support keyboard navigation, focus restoration on Escape, outside-click dismissal, and positioning within the viewport. The underlying Wallets screen remains stable.
- Lint/typecheck, both package checks, and three targeted Chrome browser flows pass, covering rename targeting, account creation, menu sizing/navigation/dismissal, and removed visible actions. Inspected compact three-wallet Chrome layout and Firefox 159 action menu. Both browser distributions and archives rebuilt.

### Wallet source icons and explanations — 2026-10-31

- Replaced wallet source text labels with small local SVG icons: document for mnemonic, sprout for seed, and key for private key. Hovering or focusing an icon explains the material held and which accounts it restores. Accessible source names and descriptions remain available to screen readers.
- Lint/typecheck, both package checks, and the Chrome multi-source wallet flow pass, including all three icons, hover/focus explanations, and tooltip bounds. Inspected Chrome icons and Firefox 159 tooltip. Both browser distributions and archives rebuilt.

### Wallets Back button placement — 2026-10-31

- Moved Back from the Wallets heading to directly below Add wallet. Returning home still restores focus to the account selector.
- Lint/typecheck, both package checks, and the existing Chrome wallet selection/rename/navigation flow pass. Both browser distributions and archives rebuilt.

### Consistent selector header and menu toggle — 2026-10-31

- The account list now shares the home screen’s account name, full copyable address, Lock, and open-tab header. Removed the Wallets heading, logo substitution, and account button’s dropdown arrow. Back remains below Add wallet; the header account button also returns home from the list.
- Associated each three-dot button with its native popover target, so clicking the same button again closes the menu instead of reopening it after light dismissal. Native autofocus preserves keyboard navigation; positioning remains bounded by the viewport.
- Lint/typecheck, both package checks, and three targeted Chrome flows pass, including identical header/address geometry, absent heading/arrow, keyboard navigation, and repeated-click dismissal. Firefox 159 actual pointer-click validation confirms closure; inspected the consistent header. Both distributions and archives rebuilt.

### Wallet title alignment and full-row highlights — 2026-10-31

- Aligned wallet title text with account names and added spacing beneath the title row. Hover, keyboard focus, and selection now shade the whole account row, including its three-dot button, with one continuous rounded background.
- Lint and both package checks pass. Inspected Firefox 159 with the pointer over an unselected account’s three-dot button and another account selected; both full-row highlights render correctly. Both distributions and archives rebuilt.

### Network-switch feedback and selected-account styling — 2026-10-31

- Network changes no longer show the generic Working status row, preventing its temporary popup-height expansion. Balance loading remains in place, and errors still appear normally.
- Removed the selected account’s checkmark; its full-row highlight remains, along with accessible pressed state.
- Lint/typecheck and both package checks pass. The Chrome local-chain browser flow passes with a mutation observer confirming no transient Working message during network selection, and the correct balance loads. Both browser distributions and archives rebuilt.

### Separate global settings from wallet actions — 2026-10-31

- Settings now contains only phishing-list updates, connected sites, network configuration, password changes, auto-lock, and Reset all wallets. Removed the selected-wallet subtitle and wallet/account management shortcuts. The reset form and delete button explicitly name all local wallets.
- Added Back up wallet to each wallet’s three-dot menu, bound to that wallet’s ID. Wallet rename/add-account and account rename stay in their existing menus; Add wallet remains below the account list. Back from backup returns to the list.
- Lint/typecheck, both package checks, and four Chrome browser flows pass. Coverage verifies global-only Settings/navigation, wallet creation and backup confirmation, and revealing a nonselected seed wallet’s exact backup without switching accounts. Inspected compact Settings. Both distributions and archives rebuilt.

### Account button action on hover — 2026-10-31

- The account header button shows Switch account on hover or keyboard focus, restoring the account name otherwise. The label overlays the existing name so button dimensions stay unchanged. On the account list it shows Back to account, matching that screen’s return action. Accessible descriptions include the account name and action.
- Lint/typecheck, both package checks, and two Chrome wallet flows pass, including hover restoration, keyboard focus, unchanged button bounds, and account selection. Verified actual pointer hover in Firefox 159 and inspected the result. Both distributions and archives rebuilt.

### Network dropdown cursor — 2026-10-31

- Added a pointer cursor to the Network dropdown. Lint and both package checks pass; both browser distributions and archives rebuilt.

### Wallet overview hierarchy — 2026-10-31

- Reorganized the area below the existing account/address header: compact centered network selector without a separate visible label, larger centered balance with an adjacent refresh icon, equal Send/Receive buttons, and a quieter Tokens/Activity/Settings navigation row.
- Reserved balance-row space for loading/error feedback and disabled the refresh icon while a request is pending. Network selection keeps its accessible label and pointer cursor; existing automatic balance loading and stale-response guards remain.
- Lint/typecheck and both package checks pass. Three targeted Chrome flows pass for layout/header continuity, account selection, and local-chain transfers; the transfer flow passes again after final refresh spacing, including refresh with stable layout and 320/380px fit. Inspected final Chrome and Firefox 159 overviews. Both browser distributions and archives rebuilt.

### Balance loading spinner — 2026-10-31

- Replaced visible Loading balance text with a small spinner, retaining an accessible loading description and reduced-motion support. Refresh is hidden while the request is pending and returns on success/error; its reserved space and the balance row keep the layout steady.
- Lint/typecheck and both package checks pass. The existing Chrome local-chain balance/refresh/transfer flow passes. Firefox 159 inspection confirms a spinner with no visible loading text, hidden refresh, and identical 393px shell height before/after loading. Both distributions and archives rebuilt.

### Three-dot button hover frame — 2026-10-31

- Added a subtle inset frame around wallet/account three-dot buttons on hover and keyboard focus. The inset styling preserves button dimensions and the full-row highlight.
- Lint and both package checks pass; inspected the account-menu hover frame in Firefox 159. Both distributions and archives rebuilt.

### Bordered address copy control — 2026-10-31

- Added an overlapping-squares copy icon and subtle rounded border around the full address, with an accent hover state. Copy confirmation stays in place without changing the control's dimensions; the shared home/account-list header retains the complete address.
- Lint/typecheck, both package checks, and two targeted Chrome browser flows pass, including exact address copying, stable confirmation layout, narrow-width fit, and shared header geometry. Inspected Chrome and Firefox address controls. Both distributions and archives rebuilt.

### Filled three-dot button highlight — 2026-10-31

- Replaced the three-dot hover/focus inset border with a filled green background, slightly darker than the account-row highlight so the whole button remains distinct within selected or hovered rows.
- Lint and both package checks pass. Inspected the filled account-menu hover state in Firefox 159; both distributions and archives rebuilt.

### Popup width for full addresses — 2026-10-31

- Increased the popup shell from 380px to 396px, adding roughly two monospace characters of room for the address when a scrollbar is present.
- Lint and both package checks pass. Firefox 159 confirms the full address occupies one line with the shell constrained to 381px, simulating 15px of scrollbar space. Both distributions and archives rebuilt.

### Compact Send form and transaction review — 2026-10-31

- Native and token sends retain the account/address header, show the selected network and available balance, and use compact recipient/amount fields with inline errors and button-local progress. Editing clears stale errors; Back returns token sends to Tokens.
- Reviews emphasize the amount, full recipient, maximum network fee, and maximum total. Token reviews receive normalized recipient/amount/contract metadata from the background and show tokens plus native fees instead of leading with 0 ETH. Detailed interpretation, simulation, source, chain ID, and calldata remain expandable; contract and failed-simulation warnings stay visible.
- Edit cancels the prior draft and preserves entered values. Failed confirmation disables the consumed review; editing creates a fresh one. Submitted/uncertain results keep their status distinction and transaction hash, with a direct View activity action. Navigation during asynchronous preparation discards the resulting draft instead of replacing the new screen.
- Added early native-funds validation and a readable gas-estimation failure message. All 39 unit tests and nine local-chain tests pass, including insufficient funds, a reverting contract, exact token metadata, ambiguous submission, and duplicate approval protection. The expanded Chrome transfer flow covers address/amount errors, preserved inputs, invalidated-review recovery, successful native/token sends, and 320/396px review layouts. Inspected Firefox Send and Chrome review screens; lint, typecheck, and both package checks pass. Both distributions and archives rebuilt.

### Compact Receive screen — 2026-10-31

- Receive now shares the account/full-address copy header and network badge with Send, with a centered 224px QR code and compact Back action. Removed the duplicate address and test-assets paragraph.
- Chrome verification decodes the actual canvas pixels for Sepolia and Base Sepolia, checks exact clipboard contents and stable inline feedback, and confirms 320/396px layouts fit without scrolling. Inspected Chrome and Firefox 159 screenshots. Lint/typecheck and both package checks pass; both distributions and archives rebuilt.

### Readable Activity and transaction status — 2026-10-31

- Activity shares the account/address header and network badge. Compact cards show amounts, recipients, local date/time, and distinct pending/confirmed/failed/uncertain statuses. Details holds hashes, contract addresses, known-chain explorer links, and eligible speed-up/cancellation controls. The list explicitly covers sends initiated through Madagamask.
- Background presentation decodes token recipients and exact units using chain-matched metadata, falls back to explicit base units when metadata is missing, and preserves any accompanying native amount. Existing persisted activity remains unchanged. Explorer links use bundled chain metadata; local/custom chains without a known explorer retain their hash without a fabricated link.
- Cached entries render first, refresh on opening, and poll every ten seconds while pending or uncertain entries remain visible. Expanded details survive refresh; polling stops after navigation. Stale status data is identified and never styled as confirmed success; status updates are announced politely.
- All 42 unit tests and nine local-chain tests pass. Chrome flows verify real native/token history, filtering, failed/uncertain states, explorer URLs, automatic refresh with preserved details, and stopping refresh after navigation. Inspected Chrome and Firefox 159 layouts; 320/396px checks have no horizontal overflow. Lint/typecheck and both package checks pass within existing bundle budgets; both distributions and archives rebuilt.

### Token list and asset details — 2026-10-31

- Tokens now shares the account/address header and network badge. Compact rows use locally generated monogram icons, names, and right-aligned balances that load automatically. Long balances ellipsize in the list; their exact values remain available on hover, to screen readers, and in token details. Balances load sequentially and stop requesting additional tokens after navigation; responses must match the originating account, network, token, and screen.
- Clicking a row opens token details with its full balance, contract address, and Send action. Send’s Back action returns to those details. Refresh balance and Remove token live in three-dot menus; Import token stays below the list and its Back action returns to Tokens.
- Moved the existing QR encoder into a local ESM asset loaded only when Receive opens, reducing the main popup bundle to approximately 26.6 KiB while retaining its existing 40 KB limit. No new runtime dependencies or permissions; both packages include and size-check the QR module. Receive reserves its QR area during loading and retains a copy-address fallback on load failure.
- Lint/typecheck and both package checks pass. Chrome checks cover automatic balances, context-mismatch rejection, retry, late-response isolation, menu toggling/removal, import navigation, actual token sends, and narrow layouts. Receive testing confirms no QR-module request on the home screen, loads it on demand, and decodes the actual canvas for both testnets. Inspected token list/details and QR rendering in Firefox 159 and Chrome. Both distributions and archives rebuilt.

### Wallet consistency review — 2026-10-31

- All unlocked screens now share the account/address header, including Settings, wallet management, backup, and site approvals. Onboarding and unlock retain the brand. Forms share bottom Back/submit actions and inline errors; editing clears stale errors. Asynchronous buttons show an accessible spinner in place, preserving their dimensions instead of adding a Working footer.
- Saving network, password, or auto-lock settings returns to Settings. Adding wallets/accounts and confirming a backup returns to the wallet list. Import-form Back returns to the import chooser. Navigation guards prevent late command, connection, or backup responses from replacing another screen.
- Aligned site transaction summaries with Send reviews, grouped rejection/approval actions, and made connected-site cards compact with separate full account addresses. Clarified current/new password labels and limited password-length help to new passwords. Onboarding uses the same wallet terminology as the rest of the UI; signing and backup requirements remain unchanged.
- Lint/typecheck and both package checks pass. The complete Chrome browser suite passes 13 tests, with two optional public-network/external-demo tests skipped. Added checks for shared Settings header geometry, inline validation, stable loading layout, and returning to Settings after saving. Existing flows cover backup/restore, account management, site approvals, native/token transfers, Receive, Activity, Tokens, and narrow/enlarged layouts. Inspected Chrome and Firefox 159 forms and Settings; both distributions and archives rebuilt.

### Network failures and uncertain-send recovery — 2026-10-31

- RPC response-body interruptions now produce useful retry feedback, matching connection timeouts. The background unwraps only our own user-facing errors from library causes, preserving useful messages without exposing raw provider errors or request payloads. Requests retain their ten-second timeout and disabled automatic retries.
- Transactions still absent after twenty minutes remain unresolved: a fresh send stays blocked, while deliberate same-nonce replacement remains available. Activity and background tracking continue checking these transactions instead of abandoning them after the status becomes Not found.
- All 43 unit tests and ten local-chain tests pass. New coverage exercises stalled headers/body, dropped connections, malformed responses, explicit recovery, safe error unwrapping, and a worker restart between persisting a submission hash and recording its outcome. The old review cannot be reused; a late-arriving original resolves without rebroadcasting. Lint/typecheck and both package checks pass; both distributions and archives rebuilt.

### Interrupted sessions and send recovery — 2026-10-31

- Popup state checks continue during busy requests and resume immediately on returning to the page. A lock or selected account/network change clears the old screen and invalidates outstanding UI callbacks. Late responses cannot reveal a backup, overwrite a newer form, or change a newer operation's busy state. Routine polling and worker restarts preserve unfinished forms when the account/network/session remain unchanged.
- A lost confirmation response explicitly directs the user to check Activity before sending again. Failed confirmation keeps the consumed review disabled and provides a direct View activity action. No submission is automatically retried.
- The complete Chrome browser suite passes 16 tests, with two optional public-network/external-demo tests skipped. New flows cover a delayed backup reveal interrupted by a real lock, unlocking before the late reply arrives, forced worker termination with form preservation, closing/reopening the popup, external account/network changes, balance failure/retry, and a lost send reply followed by Not found-to-Confirmed polling with exactly one approval. The three new flows pass again after the final stale-response guard.
- The isolated Chromium lifecycle check passes idle continuity, forced termination/session restoration, real one-minute auto-lock, extension reload, and browser restart without a worker debugger attached. Lint/typecheck and both package checks pass; Chrome and Firefox distributions and archives rebuilt. The earlier 43-unit/ten-local-chain checks remain applicable; this batch changes only popup behavior and browser tests.

### Security review: transaction approval deadline — 2026-10-31

- Reproduced native transactions broadcasting after their review expired during the approval RPC checks or the pre-broadcast storage write. Both regression cases failed before the fix. Approval now rechecks the deadline, unlocked generation, network revision, and request validity immediately before signing, after signing, and immediately before broadcast; the exact expiry boundary is rejected as well.
- All 13 local-chain checks pass, including both expiry cases with zero broadcast attempts. Typecheck passes. Mainnet remains disabled; the broader key-storage, recovery, signing, and release-readiness review is ongoing.

### Security review: storage boundaries, recovery, and mainnet readiness — 2026-10-31

- Wallet storage now awaits trusted-context access restrictions before any get/set/remove. Chrome requires the isolation API; missing support or failed restriction blocks wallet storage access. Tests verify both delayed setup and failure without any underlying read/write. Firefox retains its test-only fallback because its local-storage isolation API is absent.
- Confirmed a Firefox 159.0 release blocker using a disposable extension copy with a content-script probe and public sentinel data: local read/write succeeds, while session access is denied. Repeated the probe against the final package. A production-Chrome browser regression confirms content scripts cannot read or write either storage area. Corrected the overly broad threat-boundary claim in SECURITY.md and documented the Firefox limitation, severity/precondition, and required storage migration.
- Added recovery tests using freshly exported mnemonic/seed/private-key backups, a fresh vault/password, and fixed expected addresses independently cross-checked with Foundry cast. Added tests that chain 1 rejects native sends, dapp transactions, personal_sign, and typed-data signing; unsupported raw-signing/submission methods remain rejected. A real Anvil transaction is checked against the original review after attempted mutation of public preview/approval fields.
- SECURITY.md now records scope, fixed/open findings, temporary unlock-key exposure, recovery compatibility limits, signature replay caveats, RPC trust, and the remaining mainnet release work. Decision remains no real-fund release and no mainnet enablement. This implementation review is not an independent audit.
- All 47 unit tests, 14 local-chain checks, and five targeted Chrome flows pass. Lint/typecheck and both package checks pass; both distributions and archives rebuilt. Runtime npm audit reports zero known advisories on the review date. No real keys or mainnet transactions were used.

### Explicit signing payloads and permission reductions — 2026-10-31

- Added exact-schema recognition for ERC-2612 Permit and Permit2 PermitSingle, preserving integer precision and distinguishing signature submission deadlines from allowance expiry. Other formats remain uninterpreted. The schemas describe declared intent; they do not authenticate contracts or establish their behavior.
- Reducing either a typed permission or an on-chain approval cannot increase the amount. Every change creates a fresh review ID without extending the original request deadline; the old review cannot approve the changed payload. Signature recovery tests verify both permit formats against the revised payload and reject the original payload.
- Typed-data requests reject domain/schema mismatches, unsigned extra message fields (including nested structs), duplicate fields, unsafe numeric integers, and domain-only signatures. This prevents a visible chain or contract from being omitted from the actual signed domain. Complete readable messages and exact bytes for unreadable/control-containing messages have separate presentation helpers.
- All 53 unit tests and 14 local-chain checks pass. Typecheck passes. Signing review UI and browser verification are in progress.

### Transparent signing reviews — 2026-10-31

- Replaced the generic approval screen with request-specific titles/actions and visible site, account, and network context. Message signing shows the complete readable text or exact bytes with an explicit unreadable-message action; Unicode format/control characters cannot silently alter the displayed message.
- ERC-2612 and Permit2 Single reviews show token, spender, exact allowance, unlimited permissions, nonce, and distinct submission/allowance deadlines. On-chain approvals show these permissions separately from transaction costs and the RPC execution check. Reduction requires a new review. Unknown typed schemas show all message/domain fields with explicit uncertainty; full raw payloads remain inspectable for every request. No contract-identity or asset-effect safety claim is made.
- Kept security-relevant fields visible while removing duplicated raw-domain/message summaries for recognized formats. Inspected Chrome screenshots at 396px and 320px; no horizontal overflow. Keyboard disclosure, enlarged text at 320px, literal hostile HTML strings, binary message rejection, Permit2 deadlines, and reduced ERC-2612 signature recovery pass in the new browser flow. Existing provider signing and real local-chain token-approval flows pass with the new action labels (three targeted Chrome tests total).
- All 53 unit tests and 14 local-chain checks passed for the signing changes; the five signing-helper tests passed again after expanding hidden-format-character detection. Lint/typecheck and both package checks pass. Rebuilt Chrome/Firefox distributions and archives; popup bundle remains within its size budget. Firefox visual validation remains deferred, and mainnet signing remains disabled.
- Clarified the earlier SR-1 wording: Firefox local-storage exposure assumes compromised extension content-script execution. It is a conditional isolation/hardening concern, not a demonstrated ordinary-website exploit or an automatic release blocker. Stronger Firefox storage isolation is deferred; no LavaMoat integration was added.

### Approval window positioning — 2026-10-31

- New approval windows align their top and right edges with the browser window containing the requesting tab, in both Chrome and Firefox. Placement uses browser-provided coordinates, including negative coordinates on other monitors; existing approval windows still receive focus rather than being duplicated.
- Verified Firefox 159.0 in an isolated temporary profile with a disposable wallet: parent left/top/width 0/0/1366, approval 946/0/420. Verified actual Chrome window geometry plus connection/message signing in the browser regression. Native geometry checks use `MADAGAMASK_HEADED=1` with viewport emulation disabled so Playwright does not resize the approval window. Default headless coverage remains unchanged.
- Lint/typecheck and both package checks pass. Chrome and Firefox distributions and archives rebuilt.

### Signing notice styling — 2026-10-31

- Removed the left accent border from signing notices, retaining the warning background and text treatment.
- CSS formatting and both package checks pass; Chrome and Firefox distributions and archives rebuilt.

### Direct approval flow and automatic closing — 2026-10-31

- Dedicated approval windows open directly on the pending request, including subsequent queued requests. The normal toolbar popup and full wallet tab retain their Review buttons.
- Successful approval or rejection closes the dedicated window when the queue is empty. If another request is pending, the window remains open and displays it next. Failed operations retain their error feedback. The background clears the old window identity before removing it so a following request cannot reuse a closing window or be invalidated by its removal.
- The windowed Chrome provider regression passes direct connection/signing reviews, automatic closing after connection/signing/rejection, a second-origin queued request, and preservation of the normal wallet tab. An isolated Firefox 159.0 check independently verifies direct connection/message reviews and automatic closing after Connect, Sign, and Reject using disposable keys.
- Lint/typecheck and both package checks pass; Chrome and Firefox distributions and archives rebuilt.

### Isolated wallet storage

- Moved the vault and public wallet state from `storage.local` to extension-origin IndexedDB on Chrome and Firefox, closing SR-1. Added `unlimitedStorage`, and Firefox requests persistent storage. Earlier local installs start empty; no release shipped, so there is no migration.
- The Firefox lifecycle harness now runs a hostile content script against an unlocked wallet and restarts the browser with kept storage. Validated locally on Firefox 159.0.

### Firefox pipeline

- CI now installs a checksum-verified Firefox 159.0 and runs the lifecycle harness plus eight Selenium flows: create, restore, lock, local-chain send, site connect/sign/reject/send/lock, approval-window dismissal, EIP-6963 discovery, and popup bounds. Playwright cannot load Firefox add-ons, so Chrome keeps Playwright and Firefox uses `selenium-webdriver` with geckodriver 0.37.1. Geckodriver needs `--allow-system-access` to reach extension pages.
- The flows found no Firefox-specific wallet defects. Chain and site checks ran against a local chain and a local page only.
- Remaining Firefox evidence: signed installation, real restart and update of a permanently installed add-on, public testnets, and third-party dapps. Signing requires a Mozilla add-on account.

### Readable technical signing details — 2026-10-31

- Replaced the unlabeled request-parameter array with a collapsed Technical details section containing labeled fields and per-field Copy buttons. Message requests show Method, Message bytes, and Signing address; typed requests show the address and formatted JSON instead of an escaped JSON string. Transaction and network requests retain their complete structured payloads.
- Technical values preserve their lines and scroll horizontally inside their field. Focusable fields support keyboard scrolling; copy feedback stays on the individual button. The surrounding approval screen does not gain horizontal overflow.
- The Chrome signing-review regression passes at 320px, including disclosure keyboard access, horizontal scrolling, copied reduced-permit contents, personal-sign values, and signature recovery. Inspected expanded technical-details screenshots. The existing Firefox site connect/sign/reject/send/lock flow also passes. Lint/typecheck and both package checks pass; Chrome and Firefox distributions and archives rebuilt.
