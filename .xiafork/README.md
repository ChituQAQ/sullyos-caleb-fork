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
