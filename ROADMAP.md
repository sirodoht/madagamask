# Madagamask roadmap

Build a small, open-source Ethereum and EVM wallet for Chrome and Firefox. The [README](README.md) defines the product scope; this roadmap defines the order of implementation and the evidence required to complete each milestone.

Milestones 1–7 are implemented as a testnet alpha candidate. The funded public-testnet transfer required by milestone 4 is still unverified, so the alpha is not fully signed off. See [PROGRESS.md](PROGRESS.md) and [VERIFICATION.md](VERIFICATION.md) for evidence and limits. The agreed stack is TypeScript, vanilla HTML/CSS/DOM, viem, Node.js, npm, and esbuild, with Biome for formatting and linting, Node's built-in runner for core unit tests, and Playwright for browser automation. The project uses MIT and targets the latest stable desktop Chrome and Firefox. See the [technology stack](README.md#technology-stack) for the recorded decisions and the [design guide](DESIGN.md) for interface requirements. Milestones are ordered by dependency, without speculative delivery dates.

Chrome runs the full browser suite. Firefox runs its lifecycle checks and core wallet and site flows in CI as a temporary add-on. Signed Firefox installation, store updates, public testnets, and third-party dapps on Firefox remain unverified.

## 1. Foundation and browser prototype

- [x] Configure the agreed stack using the latest Node.js LTS release, record Node.js and bundled npm versions, and commit the npm lockfile.
- [x] Review and pin the latest stable TypeScript, viem, and esbuild releases and their dependency trees; keep the UI dependency-free and justify each additional runtime or development dependency.
- [x] Establish source directories for the wallet core, browser integration, and interface, with explicit dependencies between them.
- [x] Create development and production builds for Chrome and Firefox.
- [x] Load a minimal popup, background entry point, and content script in Chrome.
- [x] Define the threat model and boundaries between websites, content scripts, extension pages, and privileged wallet operations.
- [x] Define typed messages with runtime validation and sender authorization.
- [x] Prototype the chosen Chrome service-worker heartbeat: write a timestamp to `chrome.storage.session` on startup and every 2,000 milliseconds. Verify session continuity after popup closure and routine idle periods, and loss of the unlocked session after forced worker termination or browser restart.
- [x] Configure Biome formatting/linting, TypeScript checking, core unit tests, browser smoke tests, and CI.
- [x] Set up Playwright for Chromium extension tests and verify installed-extension flows on latest stable Chrome.
- [x] Check both browser packages for valid manifests, required entry points, and referenced assets.
- [x] Review initial dependency licenses and preserve required notices.

**Done when:** a fresh checkout produces both browser packages and loads in Chrome, messages cross the intended boundaries, unauthorized messages are rejected, and Chrome background lifecycle behavior has been demonstrated and documented.

## 2. Vault, recovery, and accounts

- [x] Create a wallet with a recovery phrase using the reviewed cryptographic implementation selected under the dependency policy.
- [x] Import and validate recovery phrases; explicitly define supported derivation paths and passphrase behavior.
- [x] Design a versioned encrypted vault with authenticated encryption, a reviewed password derivation scheme, and safe persistence.
- [x] Implement password creation/change, unlock, manual lock, and auto-lock.
- [x] Keep unlocked secrets in worker memory, clear them on manual lock and auto-lock, and require unlocking again after worker termination or browser restart. Verify that the heartbeat does not interfere with locking.
- [x] Add recovery phrase backup and confirmation, with reauthentication before revealing secrets.
- [x] Derive multiple accounts, name them, switch between them, and copy addresses.
- [x] Support private-key account import and explain that these accounts are not recovered from the wallet's recovery phrase.
- [x] Define explicit backup/export and reset behavior, including checks before destructive actions.
- [x] Test known derivation vectors, incorrect passwords, tampered vaults, interrupted writes, recovery, and locking.

**Done when:** a wallet can be created, backed up, locked, reopened, and restored with identical addresses in Chrome. Secrets are absent from logs, website messages, and unencrypted persistent storage.

## 3. Networks, balances, and receiving

- [x] Add Ethereum and a small initial network list, including a test network.
- [x] Add custom networks and RPC endpoints with chain ID validation.
- [x] Handle unavailable endpoints, timeouts, stale responses, and network changes.
- [x] Display the selected account's native balance and clearly distinguish loading, stale data, and errors.
- [x] Implement the core home layout: account/network selectors, balance, Send, Receive, Tokens, Activity, and Settings.
- [x] Show the receive address and QR code with the selected network identified.
- [x] Keep polling bounded and document which external services receive requests.

**Done when:** balances and receive details are correct on two EVM networks in Chrome, custom RPCs work, and late responses cannot overwrite data for a different account or network.

## 4. Native transfers and transaction activity

- [x] Validate recipients and amounts without floating-point arithmetic for asset quantities.
- [x] Estimate gas and support the fee models needed by the initial network set.
- [x] Show the sender, network, recipient, amount, estimated fee, and total before approval.
- [x] Build and sign transactions inside the privileged wallet boundary.
- [x] Handle nonce allocation, concurrent sends, duplicate clicks, and ambiguous RPC submission failures.
- [x] Track submitted transactions through pending, confirmed, reverted, dropped, and replaced states where detectable.
- [x] Persist local activity and resume tracking after popup closure or browser restart.
- [x] Implement speed-up and cancel requests as replacement transactions, explaining that success is not guaranteed.
- [x] Test insufficient funds, rejected approvals, RPC failures, and chain reorganizations.

**Done when:** native transfers succeed on a local development chain and a public test network in Chrome, failures are understandable, and restarting does not lose submitted-transaction tracking or trigger duplicate sends.

**Acceptance still open:**

- [ ] Demonstrate a funded native transfer on a public testnet through Chrome and record its receipt and restart tracking.

## 5. Dapp connections and signing

- [x] Implement the standard Ethereum provider interface and wallet discovery, with an explicit supported-method list.
- [x] Build a small local test dapp for connection, account/network changes, transaction requests, and signatures.
- [x] Bind requests to browser-verified site identity and define iframe behavior.
- [x] Ask permission before exposing accounts; support viewing and revoking connections.
- [x] Support network switch/add requests with validation and user approval.
- [x] Support dapp transaction requests, personal message signing, and structured typed-data signing.
- [x] Show the requesting site, account, network where relevant, and exact request details before approval.
- [x] Bind approval to the reviewed payload; handle account/network changes and reject stale requests.
- [x] Bound request queues and handle duplicate requests, tab closure, locking, and popup dismissal.
- [x] Reject unsupported signing methods explicitly and test malformed or hostile requests.

**Done when:** the local test dapp and selected external dapps can connect and request supported operations in Chrome. Unapproved sites cannot access accounts or sign, and requests cannot inherit another site's permission or approval.

## 6. Tokens and clearer confirmations

- [x] Import fungible tokens by contract address and validate metadata responses.
- [x] Display token balances and support token transfers with correct decimal handling.
- [x] Treat token names, symbols, images, and other remote metadata as untrusted input.
- [x] Decode common contract interactions, including token spending approvals.
- [x] Explain spenders, allowance amounts, and unlimited allowances; offer allowance editing where supported.
- [x] Integrate transaction simulation with documented coverage, privacy implications, and failure behavior.
- [x] Show expected asset changes when available, and explicit uncertainty when they are unavailable.
- [x] Add phishing protection with an update strategy and clear behavior when protection data is stale or unavailable.
- [x] Show raw transaction/signature details for inspection without making raw data the default explanation.
- [x] Define history coverage: locally initiated transactions first; decide separately how imported accounts' past and incoming activity will be discovered.

**Done when:** native and token sends, external contract interactions, and approval warnings work in Chrome. Simulation failures never appear as successful safety checks, and history limitations are visible.

## 7. Testnet alpha

- [x] Package an installable alpha for both browsers with clear testnet-only guidance.
- [x] Run the complete create/import, recovery, lock, send, connect, and sign flows against the Chrome production build.
- [x] Test background termination, extension updates, interrupted writes, and storage migrations.
- [x] Verify website isolation, origin spoofing defenses, request mutation defenses, and secret handling.
- [x] Review permissions, dependencies, packaged code, and outbound requests.
- [x] Measure bundle size, startup time, idle resource use, and polling; establish budgets based on the measured baseline.
- [x] Document installation, supported methods/networks, recovery, and known limitations.

**Done when:** both alpha packages are reproducibly buildable and the core flows pass on latest stable Chrome. Firefox packaging checks pass and its runtime validation status is documented. Playwright's Chromium results are recorded separately from latest stable Chrome validation.

**Alpha acceptance remains conditional on the public-testnet transfer above.** Chrome validation covers the fully served stable 156.0.8078.80 build; the 157 early rollout is not tested.

## 8. Hardware wallets and everyday polish

- [ ] Choose the first supported hardware-wallet integration after validating transport support in Chrome.
- [ ] Implement account discovery, derivation path selection, and device-backed signing through the existing signer interface.
- [ ] Handle disconnected devices, user rejection, unsupported requests, and on-device verification.
- [ ] Test with physical devices and publish the supported device/browser matrix.
- [ ] Polish account/network management, token management, connection settings, and transaction details.
- [ ] Add fiat balance values only after selecting a price source and documenting privacy, stale data, and availability behavior.
- [ ] Complete keyboard navigation, focus management, readable errors, and accessibility checks.

**Done when:** the declared hardware combinations pass real-device tests and everyday tasks remain straightforward without adding product promotions or trading interfaces.

## 9. Public release

- [ ] Obtain independent security review of the vault, signing boundary, permissions, browser messaging, and update/migration behavior.
- [ ] Resolve release-blocking findings and publish the review scope and known limitations.
- [ ] Complete dependency license review, attribution, privacy documentation, and vulnerability reporting instructions.
- [ ] Prepare versioned Chrome and Firefox artifacts, checksums, source/build instructions, and Chrome store submission materials; document the Firefox package's validation status.
- [ ] Define the update process, dependency review process, and response process for security issues.
- [ ] Run the Chrome/device release matrix against the exact Chrome artifact and verify the Firefox package contents.

**Done when:** the release artifacts pass the declared checks, required review findings are resolved, and users have clear installation, backup, recovery, and support documentation.

## Working rules

- Complete small, reviewable changes and commit each completed change.
- Keep milestones unchecked until their completion criteria have evidence.
- Test security and recovery behavior throughout implementation; the pre-release review is an additional check.
- Keep secrets out of general UI state, logs, telemetry, and website-facing code. Limit deliberate backup/import exposure to dedicated flows.
- Preserve user data with versioned storage migrations and recovery tests.
- Keep required external services explicit; basic key management and signing should work without a Madagamask-operated server.
- Keep ads, rewards, integrated trading, non-EVM support, and other excluded products outside this roadmap.
