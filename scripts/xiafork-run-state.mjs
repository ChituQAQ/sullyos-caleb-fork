import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
export const DEFAULT_RUNTIME_DIR = path.join(REPO_ROOT, '.xiafork', 'runtime');
export const RUN_STATE_VERSION = 1;

const RUN_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const REQUIRED_FIELDS = [
  'runId', 'taskTitle', 'authorizedScope', 'forbiddenPaths', 'workspace', 'workerId',
  'currentPhase', 'lastCompletedPhase', 'lastToolOrCommand', 'lastToolStartedAt',
  'lastToolResultAt', 'lastObservableProgressAt', 'expectedChildProcess', 'childPid',
  'progressArtifacts', 'completedExpensiveSteps', 'knownFailures', 'retryCount',
  'hardStop', 'nextSafeAction', 'humanOnlyBoundary', 'leaseOwner', 'leaseUpdatedAt',
];

function isoNow(now = Date.now()) {
  return new Date(now).toISOString();
}

function assertRunId(runId) {
  if (!RUN_ID_RE.test(runId || '')) throw new Error('runId must use 1-128 safe filename characters');
}

function statePath(runtimeDir, runId) {
  assertRunId(runId);
  return path.join(runtimeDir, `${runId}.json`);
}

function leasePath(runtimeDir, runId) {
  assertRunId(runId);
  return path.join(runtimeDir, `${runId}.lease.json`);
}

function atomicWriteJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  try {
    renameSync(temporary, file);
  } catch (error) {
    if (existsSync(temporary)) unlinkSync(temporary);
    throw error;
  }
}

function readJson(file, description) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (error) {
    throw new Error(`Cannot read ${description}: ${error.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Malformed ${description}: ${error.message}`);
  }
}

export function validateRunState(state) {
  const errors = [];
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return { ok: false, errors: ['run state must be a JSON object'] };
  }
  if (state.schemaVersion !== RUN_STATE_VERSION) errors.push(`schemaVersion must be ${RUN_STATE_VERSION}`);
  for (const field of REQUIRED_FIELDS) {
    if (!(field in state)) errors.push(`missing required field: ${field}`);
  }
  if (!RUN_ID_RE.test(state.runId || '')) errors.push('runId is invalid');
  for (const field of ['taskTitle', 'workspace', 'currentPhase', 'nextSafeAction', 'leaseOwner']) {
    if (typeof state[field] !== 'string' || !state[field]) errors.push(`${field} must be a non-empty string`);
  }
  for (const field of ['authorizedScope', 'forbiddenPaths', 'progressArtifacts', 'completedExpensiveSteps', 'knownFailures']) {
    if (!Array.isArray(state[field]) || state[field].some(item => typeof item !== 'string')) {
      errors.push(`${field} must be an array of strings`);
    }
  }
  for (const field of ['workerId', 'lastCompletedPhase', 'lastToolOrCommand', 'lastToolStartedAt', 'lastToolResultAt', 'humanOnlyBoundary']) {
    if (state[field] !== null && typeof state[field] !== 'string') errors.push(`${field} must be a string or null`);
  }
  for (const field of ['lastObservableProgressAt', 'leaseUpdatedAt']) {
    if (Number.isNaN(Date.parse(state[field]))) errors.push(`${field} must be an ISO date-time`);
  }
  if (state.lastToolStartedAt !== null && Number.isNaN(Date.parse(state.lastToolStartedAt))) errors.push('lastToolStartedAt must be an ISO date-time or null');
  if (state.lastToolResultAt !== null && Number.isNaN(Date.parse(state.lastToolResultAt))) errors.push('lastToolResultAt must be an ISO date-time or null');
  if (typeof state.expectedChildProcess !== 'boolean') errors.push('expectedChildProcess must be boolean');
  if (state.childPid !== null && (!Number.isInteger(state.childPid) || state.childPid <= 0)) errors.push('childPid must be a positive integer or null');
  if (!state.expectedChildProcess && state.childPid !== null) errors.push('childPid requires expectedChildProcess=true');
  if (!Number.isInteger(state.retryCount) || state.retryCount < 0) errors.push('retryCount must be a non-negative integer');
  if (typeof state.hardStop !== 'boolean') errors.push('hardStop must be boolean');
  return { ok: errors.length === 0, errors };
}

export function readRunState(runId, { runtimeDir = DEFAULT_RUNTIME_DIR } = {}) {
  const state = readJson(statePath(runtimeDir, runId), `run state ${runId}`);
  const validation = validateRunState(state);
  if (!validation.ok) throw new Error(`Invalid run state: ${validation.errors.join('; ')}`);
  return state;
}

function readLease(runId, runtimeDir) {
  return readJson(leasePath(runtimeDir, runId), `lease ${runId}`);
}

export function assertLease(runId, owner, { runtimeDir = DEFAULT_RUNTIME_DIR } = {}) {
  const lease = readLease(runId, runtimeDir);
  if (!owner || lease.owner !== owner) {
    throw new Error(`Lease conflict for ${runId}: active owner is ${lease.owner || 'unknown'}`);
  }
  return lease;
}

export function initializeRunState(input, { runtimeDir = DEFAULT_RUNTIME_DIR, now = Date.now() } = {}) {
  assertRunId(input.runId);
  if (!input.leaseOwner) throw new Error('leaseOwner is required');
  mkdirSync(runtimeDir, { recursive: true });
  const leaseFile = leasePath(runtimeDir, input.runId);
  let descriptor;
  try {
    descriptor = openSync(leaseFile, 'wx');
    writeFileSync(descriptor, `${JSON.stringify({ runId: input.runId, owner: input.leaseOwner, updatedAt: isoNow(now) }, null, 2)}\n`, 'utf8');
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (error.code === 'EEXIST') {
      const lease = readLease(input.runId, runtimeDir);
      throw new Error(`Lease conflict for ${input.runId}: active owner is ${lease.owner || 'unknown'}`);
    }
    throw error;
  }
  if (descriptor !== undefined) closeSync(descriptor);

  const timestamp = isoNow(now);
  const state = {
    schemaVersion: RUN_STATE_VERSION,
    runId: input.runId,
    taskTitle: input.taskTitle,
    authorizedScope: input.authorizedScope || [],
    forbiddenPaths: input.forbiddenPaths || [],
    workspace: path.resolve(input.workspace || REPO_ROOT),
    workerId: input.workerId || null,
    currentPhase: input.currentPhase || 'initialized',
    lastCompletedPhase: null,
    lastToolOrCommand: null,
    lastToolStartedAt: null,
    lastToolResultAt: null,
    lastObservableProgressAt: timestamp,
    expectedChildProcess: false,
    childPid: null,
    progressArtifacts: [],
    completedExpensiveSteps: [],
    knownFailures: [],
    retryCount: 0,
    hardStop: false,
    nextSafeAction: input.nextSafeAction || 'Continue within authorized scope.',
    humanOnlyBoundary: input.humanOnlyBoundary || null,
    leaseOwner: input.leaseOwner,
    leaseUpdatedAt: timestamp,
  };
  const validation = validateRunState(state);
  if (!validation.ok) {
    unlinkSync(leaseFile);
    throw new Error(`Invalid initial run state: ${validation.errors.join('; ')}`);
  }
  atomicWriteJson(statePath(runtimeDir, input.runId), state);
  return state;
}

export function updateRunState(runId, owner, updater, { runtimeDir = DEFAULT_RUNTIME_DIR, now = Date.now() } = {}) {
  assertLease(runId, owner, { runtimeDir });
  const current = readRunState(runId, { runtimeDir });
  if (current.leaseOwner !== owner) throw new Error(`Run-state owner mismatch for ${runId}`);
  const timestamp = isoNow(now);
  const next = updater({ ...current }) || current;
  next.leaseOwner = owner;
  next.leaseUpdatedAt = timestamp;
  const validation = validateRunState(next);
  if (!validation.ok) throw new Error(`Invalid updated run state: ${validation.errors.join('; ')}`);
  atomicWriteJson(statePath(runtimeDir, runId), next);
  atomicWriteJson(leasePath(runtimeDir, runId), { runId, owner, updatedAt: timestamp });
  return next;
}

export function heartbeatRun(runId, owner, changes = {}, options = {}) {
  const now = options.now ?? Date.now();
  return updateRunState(runId, owner, state => {
    const timestamp = isoNow(now);
    state.lastObservableProgressAt = timestamp;
    if ('lastToolOrCommand' in changes) state.lastToolOrCommand = changes.lastToolOrCommand;
    if (changes.toolStarted) state.lastToolStartedAt = timestamp;
    if (changes.toolResult) state.lastToolResultAt = timestamp;
    if (changes.progressArtifact && !state.progressArtifacts.includes(changes.progressArtifact)) state.progressArtifacts.push(changes.progressArtifact);
    return state;
  }, { ...options, now });
}

export function setRunPhase(runId, owner, changes, options = {}) {
  return updateRunState(runId, owner, state => {
    if (changes.currentPhase) state.currentPhase = changes.currentPhase;
    if ('lastCompletedPhase' in changes) state.lastCompletedPhase = changes.lastCompletedPhase;
    if (changes.nextSafeAction) state.nextSafeAction = changes.nextSafeAction;
    if (changes.completedExpensiveStep && !state.completedExpensiveSteps.includes(changes.completedExpensiveStep)) {
      state.completedExpensiveSteps.push(changes.completedExpensiveStep);
    }
    state.lastObservableProgressAt = isoNow(options.now ?? Date.now());
    return state;
  }, options);
}

export function setRunChild(runId, owner, changes, options = {}) {
  return updateRunState(runId, owner, state => {
    if (changes.clear) {
      state.expectedChildProcess = false;
      state.childPid = null;
    } else {
      state.expectedChildProcess = true;
      state.childPid = changes.childPid || null;
    }
    if (changes.progressArtifact && !state.progressArtifacts.includes(changes.progressArtifact)) state.progressArtifacts.push(changes.progressArtifact);
    state.lastObservableProgressAt = isoNow(options.now ?? Date.now());
    return state;
  }, options);
}

function parseOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) throw new Error(`Unexpected argument: ${item}`);
    const key = item.slice(2);
    if (['clear', 'tool-started', 'tool-result'].includes(key)) options[key] = true;
    else {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
      options[key] = value;
      index += 1;
    }
  }
  return options;
}

function list(value) {
  return value ? value.split(',').map(item => item.trim()).filter(Boolean) : [];
}

function requireOption(options, name) {
  if (!options[name]) throw new Error(`--${name} is required`);
  return options[name];
}

function printUsage() {
  console.log('Usage: node scripts/xiafork-run-state.mjs <init|heartbeat|phase|child|complete|show|validate> --run-id <id> [options]');
}

export function runCli(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  if (!command) return printUsage();
  const options = parseOptions(rest);
  const runId = requireOption(options, 'run-id');
  const runtimeDir = options['runtime-dir'] ? path.resolve(options['runtime-dir']) : DEFAULT_RUNTIME_DIR;
  let state;
  if (command === 'init') {
    state = initializeRunState({
      runId,
      taskTitle: requireOption(options, 'task-title'),
      leaseOwner: requireOption(options, 'owner'),
      workerId: options['worker-id'],
      workspace: options.workspace,
      authorizedScope: list(options.scope),
      forbiddenPaths: list(options.forbid),
      currentPhase: options.phase,
      nextSafeAction: options.next,
      humanOnlyBoundary: options['human-only-boundary'],
    }, { runtimeDir });
  } else if (command === 'heartbeat') {
    state = heartbeatRun(runId, requireOption(options, 'owner'), {
      lastToolOrCommand: options.tool,
      toolStarted: options['tool-started'],
      toolResult: options['tool-result'],
      progressArtifact: options.artifact,
    }, { runtimeDir });
  } else if (command === 'phase') {
    state = setRunPhase(runId, requireOption(options, 'owner'), {
      currentPhase: options.current,
      lastCompletedPhase: options.completed,
      nextSafeAction: options.next,
      completedExpensiveStep: options.expensive,
    }, { runtimeDir });
  } else if (command === 'child') {
    state = setRunChild(runId, requireOption(options, 'owner'), {
      clear: options.clear,
      childPid: options.pid ? Number(options.pid) : null,
      progressArtifact: options.artifact,
    }, { runtimeDir });
  } else if (command === 'complete') {
    state = updateRunState(runId, requireOption(options, 'owner'), current => ({
      ...current,
      lastCompletedPhase: current.currentPhase,
      currentPhase: 'complete',
      expectedChildProcess: false,
      childPid: null,
      lastObservableProgressAt: isoNow(),
      nextSafeAction: options.next || 'No automatic action; report completion.',
    }), { runtimeDir });
  } else if (command === 'show' || command === 'validate') {
    state = readRunState(runId, { runtimeDir });
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
  if (command === 'validate') console.log(`run state valid (${runId})`);
  else console.log(JSON.stringify(state, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCli();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
