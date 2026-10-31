# Security design and alpha boundaries

This is a testnet development wallet, not independently audited software. Do not import a recovery phrase or key used for real assets.

## Trust boundaries

Websites, token metadata, RPC responses, and content-script payloads are untrusted. Only the background owns decrypted secrets and signing. Extension pages receive public account state; dedicated reauthenticated backup flows may temporarily display recovery material. Never log secrets or place them in URLs, DOM attributes, shared app state, or storage outside the encrypted vault.

The browser supplies sender extension ID, URL, frame, and tab identity. These fields, never a payload's claimed origin, authorize requests. Extension UI and website requests have separate capabilities. Only top-level HTTP(S) documents may use the website bridge. Requests from other extensions, iframes, inactive documents, unsupported methods, malformed payloads, or unauthorized sites fail closed. The intended boundary gives a compromised content script no more authority than its site. Chrome enforces trusted-context storage access before wallet storage operations. Firefox currently falls short of this boundary for local storage; see the open finding below.

An approval must be tied to a fixed payload, site, account, and chain. A changed account/network, lock, closing requester, or dismissed approval invalidates it. Connection permission does not authorize signatures. Queue lengths, payload sizes, deadlines, and RPC timeouts are bounded.

## Persistence and lifecycle

Only ciphertext and public metadata persist on disk. Trusted extension contexts store a temporary vault-unlock key, salt, activity time, and expiry in browser session storage to restore the encrypted vault after background suspension. Content scripts cannot access this storage. Passwords and decrypted wallet secrets are not stored there. Manual lock, expiry, browser startup, and extension install/update clear the session. Chrome’s two-second heartbeat writes a timestamp to session storage; it cannot guarantee execution. JavaScript does not guarantee physical memory erasure; zeroing byte buffers and dropping references reduces exposure, not a claim of complete erasure.

Vault mutations are serialized and committed as one versioned storage value. Failed writes preserve the previous committed state. Invalid or future versions are rejected without overwriting them. Transaction activity is persisted before submission to handle ambiguous RPC results without sending twice.

## Packaging and dependencies

No remote executable code, inline scripts, eval, UI dependencies, telemetry, or third-party analytics. CSP permits bundled code/styles only. Every runtime dependency's full license is included in packages. Source code must remain original; restricted MetaMask source/assets are not incorporated.

Viem provides derivation, encoding, and signing, with its pinned noble/scure cryptography dependencies. Web Crypto provides vault encryption. Dependency review and tests do not replace independent security review.

## Out of scope for this alpha

Compromised operating systems/browsers, malicious extension updates, hardware wallets, real-money use, and guaranteed detection of phishing or malicious contract behavior. RPC providers can observe addresses and requests, lie, fail, or censor. Simulations never prove safety.

## Vault envelope v1 and payload v2

AES-256-GCM uses a fresh random 96-bit IV for every write, a random 256-bit salt on creation/password change, and authenticated additional data `madagamask:vault:1`. PBKDF2-HMAC-SHA-256 uses exactly 600,000 iterations; unsupported parameters/formats fail closed. With browser session restoration enabled, the encryption key is extractable for trusted session storage; decrypted wallet payloads remain in background memory apart from reauthenticated backup display. The design follows the [OWASP PBKDF2 guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html); this is a design choice for native Web Crypto, not an independent review.

Payload v2 holds named wallets with their source type and secret, plus accounts linked by wallet ID. Legacy v1 payloads migrate in memory and are rewritten only on a successful mutation. Invalid account ownership is rejected.

Recovery supports English BIP39 phrases with checksum validation, raw BIP32 seeds (16–64 bytes), and path `m/44'/60'/0'/0/index`. BIP39 passphrases and alternate paths are not supported. Each wallet is backed up separately. A private-key wallet contains one account; mnemonic and seed wallets derive children independently. Passwords require 12–256 characters. Freshly generated wallets must confirm their phrase before signing. Backup reveal and reset require password reauthentication. Reset needs the literal confirmation DELETE.

## Mainnet-readiness review — 2026-10-31

**Decision: keep mainnet signing disabled. This review does not approve real-fund custody.** This is an implementation review with targeted adversarial tests, performed on the same development codebase, not an independent audit. Scope: vault encryption/session storage, recovery/export/derivation, browser authorization, message and transaction signing, transaction submission/recovery, package configuration, and current runtime dependency advisories. Baseline: `0af6c53`, with the fixes described below. Only disposable public test keys and local-chain transactions were used.

### Findings and disposition

| ID   | Impact / scope                                                    | Finding                                                                                                                                                                | Disposition                                                                                                                    |
| ---- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| SR-1 | High, conditional on compromised Firefox content-script execution | Local extension storage remains readable/writable by content scripts, including encrypted vault data, site grants, networks, and activity.                             | Open; blocks a Firefox real-fund release.                                                                                      |
| SR-2 | Medium, transaction approval lifetime                             | Native review expiry was checked only at approval entry; RPC checks or storage could cross the deadline and still broadcast.                                           | Fixed in `a3ab82f`; checks run before signing, after signing, and before broadcast.                                            |
| SR-3 | Medium, Chrome initialization failure                             | Local-storage access restriction was started without awaiting or handling failure; wallet initialization could proceed without confirmation of isolation.              | Fixed: all wallet storage operations await access restriction and fail closed when required isolation is unavailable or fails. |
| SR-4 | Release blocker, approval comprehension                           | Typed-data meaning is largely left inside collapsed raw request details; decoded contract intent and a single-provider execution check cannot establish asset effects. | Open; define and test a narrower mainnet signing scope or improve typed-data/contract review before enabling those methods.    |

SR-1 was reproduced on Firefox 159.0 using an isolated temporary copy of the extension. A probe appended to its content script accessed public sentinel values on a local test page: local read and write succeeded; session access was denied. Both storage areas lack `setAccessLevel` in that runtime. This assumes execution inside our content-script world. It exposes encrypted vault material for offline password attacks and permits tampering with public security state; it does not demonstrate extraction of the session unlock key. Before release, move Firefox's security-sensitive local state behind an extension-origin storage boundary unavailable to content scripts, with migration and hostile-content regression tests. Chrome's production content-script world is now tested to reject both reads and writes for local and session storage.

SR-2 was reproduced with failing tests at both asynchronous boundaries, including the exact expiry timestamp. Both tests now reject approval with zero broadcast attempts. A deadline crossed during persistence can leave a conservative `submitting` activity record even though no broadcast occurred; it must be reconciled through Activity, rather than silently permitting another send.

### Key storage assessment

The reviewed encryption path uses authenticated AES-GCM, fresh IVs, random salts, and a fixed PBKDF2 work factor. Existing tests cover ciphertext tampering, wrong passwords, failed writes, password rotation, migrations, lock races, and session expiration. The PBKDF2 iteration count matches the SHA-256 figure in [OWASP's guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html); this does not establish the strength of a particular user's password or substitute for cryptographic review.

The exported AES key in `storage.session` can decrypt the entire vault without the password. That is the deliberate cost of restoring an unlocked session after worker suspension. Trusted extension pages can access it; compromise of trusted extension code or a malicious update remains a key-compromise threat. [Chrome documents session storage as in-memory and inaccessible to content scripts by default](https://developer.chrome.com/docs/extensions/reference/api/storage). Browser memory, OS swap/crash dumps, and physical erasure were not forensically tested. The 30-minute default is an exposure window, not an additional encryption boundary.

### Recovery assessment

Backup exports for mnemonic, raw seed, and single-private-key wallets restore expected addresses under a fresh password in an empty vault. The first three accounts from the public Anvil mnemonic and the single-key fixture were independently cross-checked with Foundry `cast wallet address`; these are fixed expected values in regression tests, rather than comparisons solely against another call into the same derivation library.

The supported path and source formats remain deliberately limited. Restoring a mnemonic/seed initially restores account index zero; additional children must be added in order, up to the current 100-account limit. Wallet names, account labels, additional independent wallet secrets, and imported private keys are not recovered from another wallet's mnemonic. Passphrase-protected BIP39 wallets, alternate paths, hardware wallets, and automatic account discovery remain unsupported. These limitations need explicit recovery-flow treatment before a broad release. [BIP39](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki) defines the optional passphrase used to derive a seed; [BIP32](https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki) defines hierarchical derivation. The installation password is not a BIP39 passphrase.

### Signing and transaction assessment

New policy tests reject UI native sends, dapp transactions, `personal_sign`, and typed-data signing on chain 1. Raw signing and raw submission methods remain unsupported. Existing tests cover sender authorization, site grants, immutable message payloads, selected account/chain changes, revocation/dismissal, consumed reviews, and lock interruptions. A local-chain test mutates the public transaction preview and approval parameters, then verifies the transaction actually accepted by Anvil still matches the original account, chain, recipient, value, calldata, nonce, and maximum fee.

The testnet allowlist is not protection for keys that also hold real assets. A `personal_sign` signature has no automatic chain binding in its [ERC-191 prefix](https://eips.ethereum.org/EIPS/eip-191). Typed data checks a supplied domain chain ID, but permits domains without one; [EIP-712 explicitly does not supply replay protection](https://eips.ethereum.org/EIPS/eip-712). Applications and contracts determine how signatures are accepted. Keep real-asset keys out of the alpha even while mainnet transaction signing is blocked.

Transaction chain IDs are included in the signed draft, consistent with transaction replay protection described in [EIP-155](https://eips.ethereum.org/EIPS/eip-155). RPC chain-ID verification still trusts the endpoint's answers. Fees, nonce information, balances, execution checks, and receipts are not independently verified against multiple providers. Uncertain broadcast hashes persist before submission, block fresh sends, and remain tracked across restart and delayed appearance; fee-bumped replacement deliberately reuses the nonce. These controls do not resolve malicious RPC responses or guarantee replacement/mining.

### Validation and remaining release work

- Runtime `npm audit --omit=dev` reported zero known advisories on the review date. This does not inspect unknown vulnerabilities, malicious package updates, CI compromise, or the correctness of cryptographic dependencies.
- Unit, local-chain, and targeted production-Chrome tests cover the fixes and boundaries above. Firefox storage isolation was probed separately in a disposable profile. Counts and final verification results are recorded in `PROGRESS.md`.
- Mainnet transaction signing remains disabled. There has been no enabled chain-1 signing acceptance run, mainnet-fork release matrix, or real-fund test. Before any enablement, define the permitted signing methods, test serialized chain-1 transactions without broadcasting, cover mainnet fee/nonce/replacement and contract behavior, and obtain independent review of the release candidate.
- Resolve SR-1 for Firefox, SR-4 for any enabled mainnet dapp signing, and the recovery-flow limitations. Review release/update provenance and reproduce the exact packaged build. The existing passing test suites are regression evidence, not a mainnet safety certificate.
