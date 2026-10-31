# Madagamask

A small, MIT-licensed Ethereum wallet extension with a vanilla TypeScript interface. The testnet alpha includes encrypted recovery/account management, native and ERC20 transfers, site permissions, reviewed signatures, and local phishing protection.

**Use disposable test wallets only. This alpha is unaudited. Never import keys used for real assets.** Signing is restricted to Sepolia (11155111), Base Sepolia (84532), and local chains (31337 and 1337). Ethereum mainnet is view-only. A custom RPC claiming a permitted chain ID is still trusted infrastructure; chain IDs do not prove a network is safe.

See [PROGRESS.md](PROGRESS.md) for implementation status, [VERIFICATION.md](VERIFICATION.md) for measured evidence and gaps, [ROADMAP.md](ROADMAP.md) for acceptance criteria, [SECURITY.md](SECURITY.md) for trust boundaries, and [DESIGN.md](DESIGN.md) for interface rules. Hardware wallets and public release are later milestones.

## Build and install

Use [mise](https://mise.jdx.dev/) for the pinned Node 26.13.0 and Foundry 1.7.1 toolchains. Node supplies npm 11.20.0. Foundry is needed for local-chain tests, not to build the extension.

```sh
mise install
mise exec -- npm ci --ignore-scripts
mise exec -- npm run check
mise exec -- npm run package
```

Chrome: open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `dist/chrome`. Pin Madagamask to the toolbar. The ZIP in `artifacts` contains the same files; extract it before using Load unpacked. Keep the extension directory in the same location when updating, click Reload in Chrome's extension manager, and unlock again. Back up disposable recovery material before updates. Removing the extension deletes its local data.

Firefox: `artifacts/madagamask-0.1.0-firefox-untested.zip` is an unsigned, packaging-checked development artifact. Its runtime and interface are **untested**, and it is not a normal signed Firefox installation package. Developers can attempt temporary loading through `about:debugging` using `dist/firefox/manifest.json`; do not rely on it for funds or persistent storage.

Builds include local scripts, licenses, and a compressed phishing snapshot. No executable code is fetched remotely. ZIP files have sorted entries and fixed timestamps; checksums are written to `artifacts/SHA256SUMS`.

## Use a disposable wallet

Create a wallet and set an installation password of at least 12 characters. The account selector opens a dedicated Wallets screen, grouping child accounts under named wallets labeled **Mnemonic**, **Seed**, or **Private key** according to the material held. Use **Add wallet** to create another mnemonic wallet or import a mnemonic, hexadecimal seed, or private key. The screen has separate Rename actions for each wallet and account, plus wallet Backup; mnemonic and seed wallets also offer Add account. Renaming an account does not change the selected account. A private-key wallet contains one account. Backup requires your password and reveals only that wallet’s material. Newly generated mnemonics require confirmation before signing or sending. Settings also provides account renaming, password changes, and a 1–30 minute auto-lock interval (30 minutes by default). Lock is always available in the header.

Recovery accepts checksum-valid English BIP39 phrases or raw BIP32 seeds of 16–64 bytes in hexadecimal. Both derive `m/44'/60'/0'/0/index`. A mnemonic and its corresponding seed restore the same accounts; a seed does not recover the mnemonic. BIP39 passphrases and alternate paths are unsupported. Restore additional derived accounts by adding them again in order within their wallet. Each wallet has its own backup; a private key cannot restore sibling accounts. Wallet/account names are local labels and are not recovered from secrets. Existing vaults migrate while preserving account names, addresses, and selection. Password recovery is impossible without recovery material. Reset removes all wallets and requires the current password and the literal text `DELETE`.

Balances load automatically when opening the wallet or changing account/network; Refresh balance fetches them again. Receive shows the full address and a QR payload containing the selected chain ID. Send shows the sender, recipient, amount, maximum network fee, and total before approval. Reviews expire after two minutes. Tokens must be imported by contract address on each network; names and symbols are untrusted text. Token quantities use exact decimals.

Activity covers transactions initiated through this wallet, including dapp sends. It does not discover incoming transfers or an imported account's earlier history. A submitted transaction is not yet confirmed. If submission is uncertain, refresh its known hash before sending again. Speed-up and cancel use the same nonce with higher fees and are not guaranteed to win. Recent receipts are rechecked on refresh; there is no finality guarantee or deep-reorganization indexer. Reset removes the vault and site grants; public network, token, and activity records remain in this installation.

## Dapp support

The wallet exposes EIP-1193 `request`, `on`, and `removeListener`, EIP-6963 discovery, and `window.ethereum` when another provider has not already claimed it. It emits account/network changes. Reload a dapp after reloading the extension. Only top-level HTTPS pages and loopback HTTP pages can connect; iframe wallet access is disabled.

| Methods                                                                                                                                                                                                 | Behavior                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `eth_chainId`, `net_version`                                                                                                                                                                            | Selected network, without account permission                               |
| `eth_accounts`                                                                                                                                                                                          | Selected account only if connected and unlocked; otherwise an empty array  |
| `eth_requestAccounts`                                                                                                                                                                                   | Explicit per-origin connection approval                                    |
| `wallet_getPermissions`, `wallet_revokePermissions`                                                                                                                                                     | Inspect/revoke this site's account connection                              |
| `personal_sign`                                                                                                                                                                                         | Hex message then selected address; explicit review                         |
| `eth_signTypedData_v4`                                                                                                                                                                                  | Address then typed-data object/JSON; domain chain must match when present  |
| `eth_sendTransaction`                                                                                                                                                                                   | Review and submit `from`, `to`, optional `value`, `data`, `chainId`        |
| `wallet_switchEthereumChain`, `wallet_addEthereumChain`                                                                                                                                                 | Explicit approval; one RPC and 18-decimal native currency for added chains |
| `eth_blockNumber`, `eth_getBalance`, `eth_getTransactionCount`, `eth_getCode`, `eth_call`, `eth_estimateGas`, `eth_getTransactionReceipt`, `eth_getTransactionByHash`, `eth_gasPrice`, `eth_feeHistory` | Forwarded to the selected RPC only for connected sites                     |

Unsupported methods fail explicitly. This is not MetaMask API parity: contract creation, caller-supplied nonce/gas/fee fields, `eth_sign`, legacy typed signing, batch calls, wallet asset watching, WalletConnect, and proprietary APIs are unsupported. Many production dapps will need broader compatibility before they work. Connections can be removed in Settings; connection alone never authorizes signing.

Approvals show the browser-verified origin, account, network, exact message or typed data, and transaction details. ERC20 transfer/approval/transferFrom calls are decoded; unlimited allowances are flagged and standard approval amounts can be edited before a fresh review. Other calls show raw data and explicit uncertainty.

## Simulation, privacy, and permissions

Simulation is an `eth_call` execution check against current RPC state. It cannot predict all asset changes, MEV, later state, malicious RPC responses, or off-chain signature use. A successful call is not a safety verdict; failed/unavailable checks remain visibly uncertain. No external asset-delta simulation provider is integrated.

The `storage` permission stores an encrypted vault plus public network/token/activity/permission records. HTTPS host access enables custom RPCs and provider injection; loopback HTTP enables local test chains. The isolated bridge cannot access decrypted keys. There are no telemetry, advertising, pricing, or portfolio services.

Built-in RPC requests go to Thirdweb for Sepolia, Base for Base Sepolia, and reth.rs for mainnet. Custom networks use their configured endpoint. These providers receive IP addresses, queried accounts, and request contents, including transaction execution checks. Native balances load when the wallet opens or the selected account/network changes; manual refresh remains available. Token balances refresh on demand. Pending activity is checked at most once per 30 seconds, up to 20 recent entries per pass with a 20-second soft budget and 10-second per-request timeouts. Visible extension pages poll public wallet state every three seconds. Chrome also writes a heartbeat timestamp every two seconds. Both browsers retain a temporary vault-unlock key, salt, last activity, and expiry in `storage.session`, which is browser-session memory restricted to trusted extension contexts. The password and decrypted vault payload are not stored there. Background restarts restore the session only before its inactivity deadline; passive state/balance polling does not extend that deadline. Lock, expiry, browser restart, and extension reload/update clear the session. The `alarms` permission schedules expiry while the background is asleep; delayed alarms never bypass deadline checks before wallet access. This expands the temporary key lifetime beyond one background process. The disk vault remains password-encrypted. Legacy five-minute settings migrate to the new 30-minute default; other previous values are preserved, and Settings can explicitly select five minutes again.

Phishing checks use a bundled [PhishDestroy](https://github.com/phishdestroy/destroylist) domain list locally. Settings can fetch a replacement list from GitHub; visited domains are not sent. A list older than 24 hours is labeled stale, and known entries still block. Failed updates retain the old list. Missing data is explicitly unavailable. This feed can miss threats and produce false positives: the current snapshot blocks `metamask.github.io`, including its test dapp. There is no bypass or automatic safety guarantee.

## Validation and development

```sh
mise exec -- npm run test:lifecycle:firefox # installed Firefox, isolated temporary profile
mise exec -- npm run test:chain
mise exec -- npx playwright install chromium
mise exec -- npm run test:browser
MADAGAMASK_BROWSER=chrome mise exec -- npm run test:browser
mise exec -- npm run test:lifecycle
mise exec -- npm run dev:dapp
```

The local dapp runs at `http://127.0.0.1:4173`. Tests start isolated Anvil chains and use only disposable, publicly known test keys. `MADAGAMASK_PUBLIC_RPC=1` enables live Sepolia/Base balance checks; `MADAGAMASK_EXTERNAL_DAPP=1` enables the external reference-demo test. Set `MADAGAMASK_CHROME_PATH` to a browser executable to validate that exact build. The lifecycle harness uses raw browser-level CDP without attaching a debugger to the worker; Playwright worker attachment would invalidate an idle-lifetime claim. It creates and deletes its own profile and extension copy.

`npm run build:dev` includes source maps; production builds omit them. CI runs type/lint/unit/package checks, local-chain tests, Chromium browser tests, and packaging. Public services and installed stable Chrome are validated separately from CI. `tests/contracts` contains the original token fixture source; tests use its committed ABI/bytecode.

## Technology stack

TypeScript 7.0.2, viem 2.57.13, esbuild 0.28.2, Biome 2.6.4, and Playwright 1.64.1 are pinned in the npm lockfile. There are no UI libraries. Additional runtime dependencies are `@scure/bip39` 1.6.0 for explicit mnemonic generation/checksums and `qr` 0.7.2 for receive QR codes. Full runtime dependency notices accompany both packages; the phishing data has a separate MIT notice. Tooling uses Node APIs; extension runtime code uses browser APIs.

Core responsibilities are separated into vault/accounts, networks/RPC, transactions, token handling, phishing checks, and site permissions. Browser code authorizes senders and owns lifecycle integration; the interface renders public state and dedicated backup flows. Web Crypto provides AES-GCM/PBKDF2; viem and its noble/scure dependencies provide Ethereum signing and derivation. These choices still require independent security review.

## Product boundaries

Madagamask focuses on accounts, balances, transfers, recovery, and reviewed dapp access. It excludes advertising, rewards, subscriptions, integrated trading/bridging, fiat ramps, portfolio discovery, NFT galleries, and non-EVM networks. External dapps remain the route to other applications. Hardware wallets, broader compatibility, and a reviewed public release are future work.

Original implementation and assets are licensed under [MIT](LICENSE). Restricted MetaMask code and artwork are not incorporated.
