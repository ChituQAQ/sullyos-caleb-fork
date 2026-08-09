# Xiafork Structured Agent Handoff

`.xiafork/handoff.json` is machine-readable navigation for coding agents. Git status and commit history remain the final source of truth. If the handoff and Git disagree, Git wins and the agent must hard-stop; it must not reset or rewrite history to make the JSON appear correct.

## Agent Start Protocol

1. Read `AGENTS.md`.
2. Read `.xiafork/handoff.json`.
3. Run `git status`.
4. Run `node scripts/xiafork-handoff.mjs validate`.
5. Compare the current Git state with the handoff.
6. Continue only from `nextAllowedWork` and within the granted task authority.

## Agent End Protocol

At an authorized autonomous queue's safe boundary:

1. Update the semantic milestone, blocker, test, and next-work fields explicitly.
2. Run `node scripts/xiafork-handoff.mjs refresh` to refresh Git-derived fields.
3. Run `node scripts/xiafork-handoff.mjs validate`.
4. Include the handoff update in one focused Git handoff commit.
5. Validate again after the commit and finish with a clean working tree.

`refresh` never infers product decisions. In particular, it cannot select a TTS winner or declare a product milestone complete.

## Commit and Clean-Tree Semantics

A commit cannot contain its own SHA, so `handoff.json` records a verifiable commit rule rather than a circular literal SHA. `git.handoffCommit` identifies the refresh base and requires exactly one focused descendant with the declared subject and allowed paths.

Before that commit, validation accepts only declared W2 paths as working-tree changes. After it, validation requires a clean tree and verifies the descendant commit. `canonicalBranch` is distinct from `refreshBranch`, so the same artifact remains valid after a verified fast-forward from the feature branch to `master`. `workingTreeCleanAtRefresh` describes the refresh instant; `expectedCleanAfterCommit` describes the required final state.

## Commands

```text
node scripts/xiafork-handoff.mjs refresh
node scripts/xiafork-handoff.mjs validate
node scripts/xiafork-handoff.mjs show
```

The JSON Schema documents the formal data contract. The helper uses a small Node-standard-library validator so W2 adds no runtime or development dependency.

## W3-P0 External Stall Supervisor

W2 describes durable repository/project state. W3-P0 adds finer-grained local execution state for an active AUTOPILOT run:

```text
node scripts/xiafork-run-state.mjs init --run-id <id> --task-title <title> --owner <owner> --scope <comma-list> --forbid <comma-list>
node scripts/xiafork-run-state.mjs heartbeat --run-id <id> --owner <owner> --tool <description> --tool-result
node scripts/xiafork-run-state.mjs phase --run-id <id> --owner <owner> --current <phase> --completed <phase>
node scripts/xiafork-run-state.mjs child --run-id <id> --owner <owner> --pid <pid> --artifact <path>
node scripts/xiafork-run-state.mjs child --run-id <id> --owner <owner> --clear
node scripts/xiafork-run-state.mjs complete --run-id <id> --owner <owner>
node scripts/xiafork-run-state.mjs show --run-id <id>
node scripts/xiafork-run-state.mjs validate --run-id <id>
```

The deterministic watcher is independent of the worker Agent's decision loop:

```text
node scripts/xiafork-supervisor.mjs watch --run-id <id>
node scripts/xiafork-supervisor.mjs once --run-id <id> --no-supervisor
```

Defaults are a 60-second watch interval, a 15-minute stale-progress threshold, and a 3-minute child-process recheck. `--stall-ms`, `--recheck-ms`, and `--interval-ms` are explicit debug/test overrides; they are not production timeout policy. A recent heartbeat or observed child/artifact progress remains `WATCHDOG=ACTIVE`.

Run state, lease files, evidence, and recovery reports live under `.xiafork/runtime/`, which is Git-ignored. Do not record chat transcripts, secrets, credentials, or tokens there. A run ID has one lease owner; P0 rejects conflicts and never steals a lease.

On `WATCHDOG=AGENT_STALL`, the watcher writes `<runId>-recovery.md` and invokes the installed `codex exec` in an ephemeral read-only sandbox for semantic assessment. The deterministic watcher—not Supervisor Codex—owns timing and classification evidence. On `WATCHDOG=PROCESS_STALL`, it reports after the second sample and does not kill anything.

W3-P0 provides detection, evidence, and read-only assessment only. W3-P1 automatic replacement/takeover remains future work and requires separate authorization.
