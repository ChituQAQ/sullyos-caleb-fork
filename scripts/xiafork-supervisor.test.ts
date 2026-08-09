import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// @ts-expect-error Repository workflow helpers are native ESM without declaration files.
import {
  heartbeatRun,
  initializeRunState,
  readRunState,
  setRunChild,
  setRunPhase,
} from './xiafork-run-state.mjs';
// @ts-expect-error Repository workflow helpers are native ESM without declaration files.
import {
  WATCHDOG_ACTIVE,
  WATCHDOG_AGENT_STALL,
  WATCHDOG_PROCESS_STALL,
  classifyRunState,
  createRecoveryBundle,
  diagnoseRun,
  invokeSupervisorCodex,
  isPidAlive,
} from './xiafork-supervisor.mjs';

const temporaryDirectories: string[] = [];

function runtimeDirectory() {
  const directory = mkdtempSync(path.join(tmpdir(), 'xiafork-supervisor-'));
  temporaryDirectories.push(directory);
  return directory;
}

function createRun(runtimeDir: string, now = Date.now(), runId = 'fixture-run') {
  return initializeRunState({
    runId,
    taskTitle: 'Supervisor fixture',
    leaseOwner: 'worker-a',
    workerId: 'fixture-worker',
    workspace: process.cwd(),
    authorizedScope: ['workflow fixture only'],
    forbiddenPaths: ['production runtime'],
    currentPhase: 'testing',
    nextSafeAction: 'Report classification only.',
    humanOnlyBoundary: 'No replacement worktree writes.',
  }, { runtimeDir, now });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('Xiafork W3-P0 external stall supervisor', () => {
  it('classifies a recent heartbeat as ACTIVE without an alarm', () => {
    const now = Date.now();
    const state = createRun(runtimeDirectory(), now - 1_000);
    const result = classifyRunState(state, { now, stallMs: 60_000 });

    expect(result.classification).toBe(WATCHDOG_ACTIVE);
  });

  it('classifies a stale heartbeat without a child as AGENT_STALL', () => {
    const now = Date.now();
    const state = createRun(runtimeDirectory(), now - 120_000);
    const result = classifyRunState(state, {
      now,
      stallMs: 60_000,
      firstObservation: { pidAlive: false },
    });

    expect(result.classification).toBe(WATCHDOG_AGENT_STALL);
  });

  it('keeps a stale run ACTIVE when its child artifact progresses', () => {
    const now = Date.now();
    const state = {
      ...createRun(runtimeDirectory(), now - 120_000),
      expectedChildProcess: true,
      childPid: 1234,
      progressArtifacts: ['fixture.log'],
    };
    const first = {
      pidAlive: true,
      checkpointProgressAt: state.lastObservableProgressAt,
      cpuTimeMs: 10,
      gpuActive: false,
      artifacts: { 'fixture.log': { size: 10, mtimeMs: 10 } },
    };
    const second = {
      ...first,
      artifacts: { 'fixture.log': { size: 20, mtimeMs: 20 } },
    };

    expect(classifyRunState(state, {
      now,
      stallMs: 60_000,
      firstObservation: first,
      secondObservation: second,
    }).classification).toBe(WATCHDOG_ACTIVE);
  });

  it('classifies a live but frozen child as PROCESS_STALL after a second sample', () => {
    const now = Date.now();
    const state = {
      ...createRun(runtimeDirectory(), now - 120_000),
      expectedChildProcess: true,
      childPid: 1234,
    };
    const observation = {
      pidAlive: true,
      checkpointProgressAt: state.lastObservableProgressAt,
      cpuTimeMs: 10,
      gpuActive: false,
      artifacts: {},
    };

    expect(classifyRunState(state, {
      now,
      stallMs: 60_000,
      firstObservation: observation,
      secondObservation: { ...observation },
    }).classification).toBe(WATCHDOG_PROCESS_STALL);
  });

  it('rejects a second lease owner instead of silently overwriting the first', () => {
    const runtimeDir = runtimeDirectory();
    createRun(runtimeDir);

    expect(() => initializeRunState({
      runId: 'fixture-run',
      taskTitle: 'Conflicting fixture',
      leaseOwner: 'worker-b',
      workspace: process.cwd(),
    }, { runtimeDir })).toThrow(/Lease conflict.*worker-a/);
    expect(readRunState('fixture-run', { runtimeDir }).leaseOwner).toBe('worker-a');
  });

  it('generates a durable recovery bundle with the safe boundary and authority', () => {
    const runtimeDir = runtimeDirectory();
    const state = { ...createRun(runtimeDir), lastCompletedPhase: 'tests-passed' };
    const file = createRecoveryBundle(state, {
      classification: WATCHDOG_AGENT_STALL,
      reason: 'fixture stall',
    }, { first: { pidAlive: false }, second: null }, { runtimeDir });
    const content = readFileSync(file, 'utf8');

    expect(content).toContain('WATCHDOG=AGENT_STALL');
    expect(content).toContain('tests-passed');
    expect(content).toContain('workflow fixture only');
    expect(content).toContain('No process was killed');
  });

  it('rejects malformed or incomplete run state', () => {
    const runtimeDir = runtimeDirectory();
    writeFileSync(path.join(runtimeDir, 'broken.json'), '{"runId":"broken"}\n', 'utf8');

    expect(() => readRunState('broken', { runtimeDir })).toThrow(/Invalid run state/);
  });

  it('updates meaningful progress, phases, and child expectations durably', () => {
    const runtimeDir = runtimeDirectory();
    createRun(runtimeDir, Date.now() - 10_000);
    heartbeatRun('fixture-run', 'worker-a', {
      lastToolOrCommand: 'fixture command', toolStarted: true, toolResult: true,
    }, { runtimeDir });
    setRunPhase('fixture-run', 'worker-a', {
      currentPhase: 'benchmark', lastCompletedPhase: 'download', completedExpensiveStep: 'model download',
    }, { runtimeDir });
    setRunChild('fixture-run', 'worker-a', { childPid: process.pid, progressArtifact: 'fixture.log' }, { runtimeDir });
    const state = readRunState('fixture-run', { runtimeDir });

    expect(state.lastToolOrCommand).toBe('fixture command');
    expect(state.lastCompletedPhase).toBe('download');
    expect(state.completedExpensiveSteps).toContain('model download');
    expect(state.expectedChildProcess).toBe(true);
    expect(state.childPid).toBe(process.pid);
  });

  it('diagnoses and invokes only the read-only supervisor hook without destructive action', async () => {
    const runtimeDir = runtimeDirectory();
    const now = Date.now();
    createRun(runtimeDir, now - 120_000);
    const invoker = vi.fn(() => ({ status: 'PASS', assessment: 'fixture only' }));
    const result = await diagnoseRun('fixture-run', {
      runtimeDir,
      now,
      stallMs: 60_000,
      firstObservation: { pidAlive: false },
      supervisorInvoker: invoker,
    });

    expect(result.classification).toBe(WATCHDOG_AGENT_STALL);
    expect(invoker).toHaveBeenCalledOnce();
    expect(existsSync(result.recoveryFile)).toBe(true);
    expect(readRunState('fixture-run', { runtimeDir }).leaseOwner).toBe('worker-a');
    expect(isPidAlive(process.pid)).toBe(true);
  });

  it('builds the Supervisor Codex invocation with enforced read-only arguments', () => {
    const runtimeDir = runtimeDirectory();
    const state = createRun(runtimeDir);
    const recoveryFile = createRecoveryBundle(state, {
      classification: WATCHDOG_AGENT_STALL,
      reason: 'fixture stall',
    }, { first: { pidAlive: false } }, { runtimeDir });
    const spawn = vi.fn((_command: string, args: string[]) => {
      const outputIndex = args.indexOf('--output-last-message');
      writeFileSync(args[outputIndex + 1], 'Read-only fixture assessment.\n', 'utf8');
      return { status: 0, stdout: '', stderr: '' };
    });

    const result = invokeSupervisorCodex(state, recoveryFile, {
      runtimeDir, codexCommand: 'fixture-codex', spawn,
    });
    const args = spawn.mock.calls[0][1];

    expect(result.status).toBe('PASS');
    expect(args.slice(0, 5)).toEqual(['--ask-for-approval', 'never', 'exec', '--ephemeral', '--sandbox']);
    expect(args).toContain('read-only');
    expect(args).not.toContain('workspace-write');
    expect(args).not.toContain('danger-full-access');
  });
});
