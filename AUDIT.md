# Audit remediation tracker

Last updated: 2026-11-01.

The [original review](AUDIT-2026-10-31.md) records findings against commit `78bf1b3` on 2026-10-31. Preserve that report as the review snapshot; record subsequent triage, decisions, fixes, and verification here. It is an internal code review, not an independent security audit.

Related documents: [security design and earlier review](SECURITY.md), [verification evidence](VERIFICATION.md), [implementation log](PROGRESS.md), and [product roadmap](ROADMAP.md).

## Workflow

Keep the original finding IDs. Severity below is the reviewer's assessment, pending triage against current code. Evidence describes what the original reviewer established; it is not a claim of fresh verification.

Use these statuses: **Needs triage**, **Confirmed**, **In progress**, **Fixed**, **Verified**, **Accepted risk**, or **Not applicable**. A fix needs a commit reference; verification needs a tested commit, environment, command or reproduction, and result. Accepted risks and findings judged inapplicable need a written rationale. Record any severity changes with their reason.

For each finding being worked on, add a remediation entry below with impact and prerequisites, reproduction/evidence, agreed acceptance criteria, implementation commit, verification result, and any remaining limitations. Link to detailed test evidence in VERIFICATION.md rather than duplicating it.

## Findings

All findings from the original report start at **Needs triage**. No fixes or fresh checks are claimed by this tracker.

| ID  | Finding                                                                   | Reported severity | Original evidence                                   | Status       | Fix / verification |
| --- | ------------------------------------------------------------------------- | ----------------- | --------------------------------------------------- | ------------ | ------------------ |
| M-1 | Dapp can rewrite built-in mainnet configuration                           | Medium            | Code review and core-module probe                   | Needs triage | —                  |
| M-2 | Malformed feed entry disables phishing list on load; no automatic refresh | Medium            | Code review                                         | Needs triage | —                  |
| L-1 | Multiple origins can exhaust global approval slots                        | Low               | Code review and attack scenario                     | Needs triage | —                  |
| L-2 | State reads repeatedly derive every account's private key                 | Low               | Code review and timed core-module probe             | Needs triage | —                  |
| L-3 | Approval window can replace the request under the cursor                  | Low               | Code review and timing scenario                     | Needs triage | —                  |
| L-4 | Dapp token-transfer summary obscures recipient and amount                 | Low               | Code review                                         | Needs triage | —                  |
| L-5 | Reset retains activity, tokens, networks, and phishing data               | Low               | Code review                                         | Needs triage | —                  |
| L-6 | Consider a memory-hard vault KDF                                          | Low               | Hardening recommendation; no exploit demonstrated   | Needs triage | —                  |
| L-7 | Mutable CI action tags and local dependency lifecycle scripts             | Low               | Configuration review                                | Needs triage | —                  |
| L-8 | Firefox provider-event document targeting is unverified                   | Low               | Compatibility hypothesis; runtime check outstanding | Needs triage | —                  |
| L-9 | Token metadata permits visually confusable names and symbols              | Low               | Code review                                         | Needs triage | —                  |
| I-1 | Network and wallet presence exposed before connection                     | Info              | Code review; expected provider behavior             | Needs triage | —                  |
| I-2 | Connected sites relay read-only RPC parameters                            | Info              | Code review                                         | Needs triage | —                  |
| I-3 | Missing minimum Chrome version and outdated manifest descriptions         | Info              | Manifest review                                     | Needs triage | —                  |
| I-4 | Prototype status path remains wired into message handling                 | Info              | Code review                                         | Needs triage | —                  |
| I-5 | Missing tests for wallet_addEthereumChain                                 | Info              | Test-source search at review baseline               | Needs triage | —                  |

See the [original report](AUDIT-2026-10-31.md#findings) for impact, code locations, scenarios, and recommendations. Recommendations remain proposals until triaged.

## Initial work order

This is a proposed sequence, separate from severity. Confirm the behavior and agree on acceptance criteria before implementing each fix.

1. **M-1 and I-5:** protect known network configuration from dapp replacement and cover the network-addition paths with regression tests.
2. **L-3 and L-4:** keep approval identity stable and make token-transfer recipient and amount clear in the primary summary.
3. **M-2 and L-2:** preserve phishing protection across malformed input and remove repeated key derivation from public state reads.
4. **L-8 and L-1:** verify Firefox event routing and assess approval-request abuse controls.
5. **L-5, L-6, L-7, L-9, and I-1–I-4:** decide and implement the remaining privacy, hardening, compatibility, and documentation work.

## Earlier security review

These findings originate in [SECURITY.md](SECURITY.md#mainnet-readiness-review--2026-10-31), not the dated report. Their dispositions below are carried forward from that document and have not been reverified while creating this tracker.

| ID   | Finding                                                        | Recorded disposition                    | Evidence / next action                                                                                                          |
| ---- | -------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| SR-1 | Firefox content scripts could access persistent wallet storage | Fixed, per earlier review               | IndexedDB isolation and browser probes described in SECURITY.md; attach fix and verification commits when reconciling evidence. |
| SR-2 | Transaction approval could expire during asynchronous work     | Fixed, per earlier review               | Fix `a3ab82f`; deadline regression checks described in SECURITY.md.                                                             |
| SR-3 | Chrome initialization did not await storage access restriction | Fixed, per earlier review               | Awaited session restriction described in SECURITY.md; attach fix and verification commits when reconciling evidence.            |
| SR-4 | Signing review comprehension and mainnet scope                 | Partially addressed, per earlier review | Supported review formats improved; define remaining scope and acceptance criteria before closure.                               |

## Remediation entries

No remediation work has been recorded here yet. Copy this template when starting a finding:

```text
### <ID>: <short title>
Status:
Impact and prerequisites:
Reproduction / evidence (commit and environment):
Decision and acceptance criteria:
Fix commit:
Verification (commit, environment, command or steps, result):
Remaining limitations / risk acceptance rationale:
```
