# Madagamask

Madagamask is a planned open-source wallet extension for Chrome and Firefox, focused on Ethereum and EVM-compatible networks. Its goal is to make everyday wallet tasks simple, with a small, understandable codebase and no advertising or integrated trading products.

This document describes the intended product and architecture. Implementation has not started.

See the [roadmap](ROADMAP.md) for implementation milestones and completion criteria, and the [design guide](DESIGN.md) for visual and interface implementation rules.

## Product scope

Madagamask will support:

- Wallet creation and import, recovery phrase backup and recovery.
- Password protection, encrypted key storage, lock/unlock, and auto-lock.
- Multiple accounts, account names, and account switching.
- Ethereum and other EVM networks, including custom networks and RPC endpoints.
- Native assets and fungible tokens, balances, and token import and management.
- Sending and receiving assets, with addresses and receive QR codes.
- Transaction history, pending transactions, fees, and clear failure states.
- Dapp connections, site permissions, and easy disconnection.
- Transaction and message signing with clear confirmations.
- Hardware-wallet support for EVM accounts.
- Phishing protection, approval warnings, and transaction simulation where available.

These define the intended scope, rather than a promise that every feature will ship in the first release. Reliable core wallet behavior takes priority over expanding the feature set.

Browser targets are the latest stable desktop Chrome and Firefox releases. Current development and browser testing focus on Chrome. Build and package for Firefox as well; Firefox runtime and UI testing are deferred. Record the exact browser versions used for validation and identify Firefox packages as untested until that work resumes.

## Everyday interface

The home screen should make the essentials easy to find:

- Account and network selectors at the top.
- Balance, address, Send, and Receive.
- Tokens and Activity as the primary views.
- A compact indicator for the current site's connection.
- Settings accessible through one menu.

Confirmations should identify the requesting site, account, and network. Transactions should show estimated network fees and expected asset changes when available. Message signatures should be clearly distinguished from transactions. Token approvals should explain the spending permission being granted, including unlimited allowances.

When a transaction's effects cannot be determined, the interface should say so. Simulations and warnings should never imply certainty they cannot provide.

## Deliberate boundaries

Madagamask will not include ads, promotional cards, rewards, referral programs, subscriptions, or product upsells. Integrated swaps, bridging, fiat buy/sell flows, perpetual futures, market discovery, DeFi portfolio dashboards, and NFT galleries are outside its scope. Non-EVM networks are also outside its scope.

Users can access swaps, bridges, NFT applications, and other services through external dapps using the wallet's EVM connection and signing flows. Supporting contract interactions does not require building each application's interface into the wallet.

## Technology stack

| Area                   | Choice                                                                        |
| ---------------------- | ----------------------------------------------------------------------------- |
| Language               | Latest stable TypeScript with strict type checking                            |
| Interface              | Vanilla HTML, CSS, and browser DOM APIs                                       |
| Ethereum operations    | Latest stable viem                                                            |
| Development runtime    | Latest Node.js LTS release                                                    |
| Package manager        | npm, with a committed `package-lock.json`                                     |
| Bundler                | Latest stable esbuild, driven by a small explicit build script                |
| Type checking          | TypeScript's `tsc --noEmit`, separately from bundling                         |
| Core unit tests        | Node.js's built-in test runner                                                |
| Formatting and linting | Biome                                                                         |
| Browser automation     | Playwright for Chromium extension tests, with latest stable Chrome validation |
| Browser integration    | Direct extension APIs and maintained Chrome/Firefox manifests                 |

The stack above is agreed. At initial setup, resolve the latest releases under this policy and record exact version pins and the npm lockfile. Use the npm version bundled with the selected Node.js release and record it. Review later upgrades explicitly so builds remain reproducible. Development-only type definitions will cover the browser and Node APIs we use. Keep Biome configuration small and shared across the repository.

Playwright provides Chromium extension automation using a persistent context. Validate the installed wallet on latest stable Chrome against the exact release artifact as well. For Firefox, current checks cover building and package contents; runtime testing and its harness are deferred. See [Playwright's extension documentation](https://playwright.dev/docs/chrome-extensions).

Node.js and esbuild are development tools; the installed extension runs ordinary JavaScript in Chrome and Firefox. Keep Node-specific APIs confined to tooling and tests. Browser manifests and build configuration will be maintained directly.

Viem will provide Ethereum RPC, account derivation, transaction encoding, and signing utilities. It is the initial direct runtime dependency and brings its own transitive dependencies, which must also be reviewed. The dependency policy is zero UI dependencies and a minimal, explicitly justified dependency set elsewhere.

## Architecture

Build a new implementation around a small set of responsibilities:

- **Vault:** encrypted secret storage, unlocking, locking, and recovery.
- **Accounts:** account derivation, import, selection, and hardware signers.
- **Networks and RPC:** network configuration and communication with EVM nodes.
- **Transactions and signing:** request validation, fee estimation, signing, submission, and status tracking.
- **Site permissions:** connection authorization, exposed accounts, and request approvals.
- **Interface:** onboarding, balances, activity, settings, and confirmations.

The security model should shape these boundaries from the beginning. Websites must not access secrets, and requests from websites must be validated and authorized before reaching signing operations. Design locking and background lifecycle behavior for both browser targets, and verify it in Chrome during the current phase. Firefox runtime behavior remains unverified until its testing resumes.

For Chrome, use a service-worker heartbeat: write a timestamp to `chrome.storage.session` immediately on startup and every 2,000 milliseconds. This follows MetaMask's keepalive approach and is intended to prevent routine idle suspension so an unlocked session can remain in worker memory. The heartbeat stores only a timestamp. Manual lock and auto-lock still clear unlocked secrets. A real worker termination or browser restart loses the in-memory session and requires unlocking again; the heartbeat does not guarantee uninterrupted execution. Verify these behaviors in the foundation prototype.

Use viem's established account and signing utilities for Ethereum operations. Prefer browser-native cryptographic operations where appropriate for vault encryption; the vault format, password derivation parameters, and secret lifecycle require their own design and review. Viem does not provide our encrypted vault or permission system. Any proposed third-party code requires explicit consideration of its provenance, license, and transitive dependencies. A smaller codebase can be easier to inspect, but size alone is not evidence of security.

Every dependency, background service, permission, and external request should have a clear purpose. Avoid speculative frameworks and features. Test recovery, signing, permissions, transaction handling, and browser lifecycle behavior as core requirements.

## Open source

Madagamask is licensed under the [MIT License](LICENSE), permitting use, modification, redistribution, and commercial use subject to its notice requirements.

The implementation will be original, with appropriately licensed dependencies and assets. It will not incorporate restricted MetaMask code or assets. Required dependency notices and attributions will be preserved.

## Comparison with MetaMask

MetaMask serves a broad range of wallet and financial-product use cases. Madagamask's intended distinction is a narrower scope and a codebase built specifically for that scope.

| Area                  | Madagamask's intended approach                                          | MetaMask comparison                                                   |
| --------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Product focus         | Everyday EVM wallet tasks and dapp access                               | A broader wallet with integrated products and services                |
| Trading and discovery | Use external dapps                                                      | Includes integrated trading and discovery experiences                 |
| Interface             | Accounts, networks, assets, activity, and clear confirmations           | Accommodates a wider feature set                                      |
| Architecture          | New implementation with few dependencies and explicit responsibilities  | Mature architecture supporting a much larger product scope            |
| Licensing             | OSI-approved license, with no commercial-use or user-count restrictions | Repository license imposes its defined Non-Commercial Use restriction |

MetaMask's repository license permits derivatives under a defined Non-Commercial Use restriction, which includes a provision for programs with no more than 10,000 monthly active users. It requires derivatives to retain that restriction. Those terms differ from the unrestricted commercial use required by the Open Source Definition. See the [MetaMask license](https://raw.githubusercontent.com/MetaMask/metamask-extension/main/LICENSE) and the [Open Source Definition](https://opensource.org/osd).

Madagamask does not aim for complete MetaMask feature parity. It aims to provide the core wallet capabilities needed for everyday EVM use, with simplicity maintained as the product grows.
