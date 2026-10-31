# Security design and alpha boundaries

This is a testnet development wallet, not independently audited software. Do not import a recovery phrase or key used for real assets.

## Trust boundaries

Websites, token metadata, RPC responses, and content-script payloads are untrusted. Only the background owns decrypted secrets and signing. Extension pages receive public account state; dedicated reauthenticated backup flows may temporarily display recovery material. Never log secrets or place them in URLs, DOM attributes, shared app state, or storage outside the encrypted vault.

The browser supplies sender extension ID, URL, frame, and tab identity. These fields, never a payload's claimed origin, authorize requests. Extension UI and website requests have separate capabilities. Only top-level HTTP(S) documents may use the website bridge. Requests from other extensions, iframes, inactive documents, unsupported methods, malformed payloads, or unauthorized sites fail closed. A compromised content script has no more authority than its site.

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
