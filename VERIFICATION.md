# Testnet alpha verification

For audit finding status and remediation decisions, see [AUDIT.md](AUDIT.md). Add dated remediation verification here with the tested commit, environment, commands or reproduction steps, results, and relevant finding IDs.

This report records the original alpha baseline. Later changes and their checks are recorded in [PROGRESS.md](PROGRESS.md); current package hashes are in `artifacts/SHA256SUMS`.

Recorded 2026-10-30 on macOS ARM64. Runtime source: `70613a0`; deterministic packaging fix: `70c06ea`. Later documentation commits do not change the artifacts. This is implementation/testing evidence, not independent security review or public-release approval.

## Results

| Check                                     | Result                                                                 |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| Biome and strict TypeScript               | Pass                                                                   |
| Core unit tests                           | 24 pass                                                                |
| Anvil local-chain tests                   | 9 pass                                                                 |
| Chrome 156.0.8078.80                      | 9 browser tests pass, including both optional external checks          |
| Playwright Chromium 156.0.8078.4          | 7 pass; live public-RPC and external-dapp checks intentionally skipped |
| Chrome and Firefox package checks         | 2 pass                                                                 |
| Raw-CDP Chrome lifecycle                  | Pass; no worker debugger attached                                      |
| Clean checkout, locked install, both ZIPs | Byte-identical checksums                                               |
| `npm audit --omit=dev`                    | Zero known vulnerabilities reported at verification time               |
| Firefox runtime                           | Untested, explicitly labeled in archive and package                    |
| Funded public-testnet transfer            | Not performed; milestone 4 acceptance remains open                     |

Chrome 156.0.8078.80 came from Google's fresh official stable macOS installer and passed signature verification. The installed user browser (156.0.8078.73) was not changed. Google's [active stable releases](https://versionhistory.googleapis.com/v1/chrome/platforms/mac_arm64/channels/stable/versions/all/releases?filter=endtime%3Dnone&order_by=version%20desc&page_size=5) reported 156.0.8078.80 as pinnable, fully served stable, and 157.0.8103.26 as a 0.5% rollout. The early 157 rollout was not tested. Tests use isolated headless Chrome profiles and real unpacked extensions; ordinary interactive toolbar installation is documented, not represented as a separate manual test.

## Observed coverage

The production UI tests create a fresh wallet, reveal and confirm its backup, ensure plaintext recovery material is absent from persistent storage, lock/unlock, restart the browser, and recover the same address. Another flow imports a known disposable phrase, adds a verified local RPC, displays its native balance, sends ETH, confirms activity, deploys an original token fixture, imports it, and transfers an exact six-decimal amount.

A real injected local dapp connects and signs a message only after approval. Its account visibility disappears on locking. The token flow also sends an ERC20 approval through the website bridge: the UI warns about an unlimited allowance, edits it to seven base units, and the receipt and contract allowance confirm seven. Unit tests recover personal and typed-data signatures, verify origin/account/chain binding, reject changed or hostile requests, and exercise cancellation during approval processing.

The external [EIP-6963 reference demo](https://eip6963.org/) discovers Madagamask and connects through its own Connect button, followed by an approved-account read. This uncovered and fixed detached provider method calls. It does not establish broad production-dapp compatibility. MetaMask's GitHub test dapp was discovered but blocked because `metamask.github.io` appears in the upstream phishing snapshot. No allowlist or bypass was added; that compatibility limitation is documented.

Live Chrome requests read balances on Sepolia and Base Sepolia and render receiving addresses/QR codes with each chain's ID. They do not establish that a funded public transfer succeeded. All transaction receipt evidence comes from disposable Anvil chains. No real assets, user wallet keys, or existing browser profiles were used.

Core/chain failure tests include wrong passwords, altered ciphertext, unsupported storage versions, interrupted vault writes, invalid phrases, imported-key backup rules, lock during unlock, stale queued operations, nonce/duplicate approval handling, insufficient funds, pending cancellation, failed pre-broadcast persistence, lost submission response without resending, receipt rollback, and dapp dismissal before broadcast. Invalid/future vault versions remain intact. Version 1 is the first storage format; there is no older supported production format to migrate.

The lifecycle harness closes every extension page for 45 seconds and observes the same unlocked worker afterward. It forcibly terminates the worker and observes a fresh locked worker, then verifies a one-minute auto-lock with pages closed for 65 seconds despite continued heartbeat activity. In an isolated extension copy it upgrades manifest 0.1.0 to 0.1.1 using Chrome's developer reload; the vault survives and requires unlock. A full browser restart also requires unlock and restores the same address. Store-delivered updates are not covered. Developer mode must be enabled in the test profile; without it Chrome disables the unpacked extension on reload.

Screenshots were inspected for onboarding, wallet home, and transaction review. Browser checks exercise 320/380/800-pixel viewports, enlarged text, keyboard focus, and wrapping. Further accessibility and everyday polish remain milestone 8 work.

## Performance baseline and budgets

| Measurement                        | Baseline                                      | Budget                                           |
| ---------------------------------- | --------------------------------------------- | ------------------------------------------------ |
| Chrome background JS               | 614,698 bytes                                 | 700,000 bytes                                    |
| Popup JS                           | 29,090 bytes                                  | 40,000 bytes                                     |
| Content bridge / injected provider | 1,309 / 2,406 bytes                           | 5,000 bytes each                                 |
| Chrome package, unpacked           | 2,227,321 bytes                               | 3,000,000 bytes                                  |
| Firefox package, unpacked          | 2,227,388 bytes                               | 3,000,000 bytes                                  |
| Chrome / Firefox ZIP               | 1,760,386 / 1,760,537 bytes                   | 2,000,000 bytes each, manual release check       |
| Chrome popup ready                 | 193–300 ms, median 282 ms, nine samples       | Median <1 second; max <2 seconds on this machine |
| Chromium popup ready               | 145–272 ms, median 174 ms, nine setup samples | Same local budget                                |

Startup measures navigation to ready onboarding in a fresh profile **after the extension worker is loaded**; it excludes browser startup and is not a cold-worker or unlock benchmark. Chromium setup also ran for the two subsequently skipped external tests. Size budgets are enforced by package tests. Timing budgets are release baselines, not CI thresholds on shared runners.

During the debugger-free 45-second idle window, the three surviving renderer processes collectively accumulated 0.2144 CPU seconds (about 0.48% of one core). Browser-process CPU increased by 2.7016 seconds; GPU by 0.1970; network service by 0.3709. These are whole isolated-browser observations, not precise per-extension attribution or memory measurements. A local regression investigation threshold is 1 renderer CPU second per 45 idle seconds. Raw process observations are in `artifacts/lifecycle.json`.

Polling budgets are explicit: a session timestamp every two seconds, one-second lock expiry checks, visible UI state every three seconds, unresolved activity every 30 seconds with no overlapping pass, and no native/token balance polling. Activity checks visit at most the 20 most recent entries per pass; a soft 20-second pass budget can be exceeded by its final bounded request. Older entries and deep reorganizations require separate inspection. No background phishing update loop runs.

## Reproducible artifacts

A source archive of the committed checkout was extracted into a fresh temporary directory. `npm ci --ignore-scripts` installed the lockfile dependencies; production packaging there produced matching SHA-256 sums. The initial comparison exposed differing file permissions despite identical contents; the packager now fixes permissions to 0644, timestamp to 1980-01-01, and entry order, with ZIP extra attributes disabled. This proves repeatability on the tested platform/toolchain, not across every ZIP implementation or OS.

```text
9d954f7aa4286122b601445d6c52bd7888b3f866518880b88bdc72ac39f78ad1  madagamask-0.1.0-chrome.zip
630a30b651d5ea42e6400b59e145b7f7814b2c2e2074ed9e425a99534415e633  madagamask-0.1.0-firefox-untested.zip
```

Build outputs are intentionally Git-ignored. Source, fixtures, lockfile, bundled phishing snapshot/licenses, and build/test tooling are committed. CI is configured but a remote CI run was not triggered; local equivalents passed.

## Remaining acceptance work

- Complete a native transfer on a public testnet through the Chrome production UI using a separately funded disposable wallet. Record chain, transaction hash, receipt, and restart tracking. No funded disposable public-testnet account was available in this run.
- Treat this as an alpha candidate until that milestone 4 dependency is satisfied. Implemented milestone 7 packaging and validation do not erase the unmet transfer criterion.
- Firefox runtime, store update/delivery, broad dapp compatibility, hardware devices, deep reorganization handling, and independent security review are outside the demonstrated coverage. Do not use real funds.

## Session persistence follow-up — 2026-10-31

The original baseline above predates session restoration. Current MV3 builds keep a temporary unlock key and expiry in trusted-context-only `storage.session`; passwords and decrypted vault payloads remain absent from that storage. Default inactivity timeout is 30 minutes, including migration of the former five-minute setting. Other legacy intervals and newly selected 1–30 minute intervals are preserved.

Chrome 156.0.8078.76 lifecycle checks now demonstrate restoration after forced worker termination, while manual/automatic locking, developer reload/update, and browser restart remain session boundaries. Firefox 159 demonstrates actual background unloading after 40 seconds with every wallet page closed, successful restoration in a new background instance, expiry and session removal after a one-minute timeout, and session removal on extension reload. Firefox unlock focus and removal of the creation-only password hint are also checked. No background debugger is attached in either lifecycle harness. The 30-minute boundary is checked with the unit-test clock; actual browser expiry uses a one-minute setting and a 65-second wait.

32 unit tests, nine chain tests, and eight local Chrome browser flows have passing coverage; two optional external-service flows were skipped for this change. The Chrome dapp flow additionally confirms that the actual extension content-script world cannot read the unlock session and that its key is absent from persistent local storage. Firefox coverage remains targeted lifecycle/UI validation, not full Firefox transaction-suite validation. See `artifacts/lifecycle.json`, `artifacts/firefox-lifecycle.json`, and `PROGRESS.md` for current evidence.
