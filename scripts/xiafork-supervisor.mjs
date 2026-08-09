import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { DEFAULT_RUNTIME_DIR, REPO_ROOT, readRunState } from './xiafork-run-state.mjs';

export const DEFAULT_INTERVAL_MS = 60_000;
export const DEFAULT_STALL_MS = 15 * 60_000;
export const DEFAULT_RECHECK_MS = 3 * 60_000;
export const WATCHDOG_ACTIVE = 'WATCHDOG=ACTIVE';
export const WATCHDOG_AGENT_STALL = 'WATCHDOG=AGENT_STALL';
export const WATCHDOG_PROCESS_STALL = 'WATCHDOG=PROCESS_STALL';

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function safeStat(file) {
  try {
    const stat = statSync(file);
    return { size: stat.size, mtimeMs: stat.mtimeMs };
  } catch {
    return null;
  }
}

export function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

export function readCpuTimeMs(pid) {
  if (!isPidAlive(pid)) return null;
  try {
    if (process.platform === 'win32') {
      const result = spawnSync('powershell', [
        '-NoProfile', '-NonInteractive', '-Command',
        `(Get-Process -Id ${pid} -ErrorAction Stop).CPU`,
      ], { encoding: 'utf8', timeout: 5_000, windowsHide: true });
      const seconds = Number(result.stdout?.trim());
      return Number.isFinite(seconds) ? seconds * 1_000 : null;
    }
    const result = spawnSync('ps', ['-o', 'time=', '-p', String(pid)], { encoding: 'utf8', timeout: 5_000 });
    const parts = result.stdout?.trim().split(/[:.]/).map(Number) || [];
    if (parts.some(Number.isNaN) || parts.length < 2) return null;
    const seconds = parts.reduce((total, part) => total * 60 + part, 0);
    return seconds * 1_000;
  } catch {
    return null;
  }
}

export function hasGpuActivity(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    const result = spawnSync('nvidia-smi', ['pmon', '-c', '1', '-s', 'u'], {
      encoding: 'utf8', timeout: 5_000, windowsHide: true,
    });
    if (result.status !== 0) return false;
    return result.stdout.split(/\r?\n/).some(line => {
      if (!line.trim() || line.trim().startsWith('#')) return false;
      const columns = line.trim().split(/\s+/);
      if (Number(columns[1]) !== pid) return false;
      return columns.slice(3, 9).some(value => Number.isFinite(Number(value)) && Number(value) > 0);
    });
  } catch {
    return false;
  }
}

function artifactPath(workspace, artifact) {
  return path.isAbsolute(artifact) ? artifact : path.resolve(workspace, artifact);
}

export function captureObservation(state, options = {}) {
  const now = options.now ?? Date.now();
  const pidAlive = options.pidAlive ?? isPidAlive(state.childPid);
  const cpuTimeMs = options.cpuTimeMs ?? (pidAlive ? readCpuTimeMs(state.childPid) : null);
  const gpuActive = options.gpuActive ?? (pidAlive ? hasGpuActivity(state.childPid) : false);
  const artifacts = {};
  for (const artifact of state.progressArtifacts) {
    artifacts[artifact] = options.artifactStats?.[artifact] ?? safeStat(artifactPath(state.workspace, artifact));
  }
  return {
    capturedAt: new Date(now).toISOString(),
    checkpointProgressAt: state.lastObservableProgressAt,
    lastToolResultAt: state.lastToolResultAt,
    expectedChildProcess: state.expectedChildProcess,
    childPid: state.childPid,
    pidAlive,
    cpuTimeMs,
    gpuActive,
    artifacts,
  };
}

export function observationsShowProgress(first, second) {
  if (!first || !second) return false;
  if (Date.parse(second.checkpointProgressAt) > Date.parse(first.checkpointProgressAt)) return true;
  if (second.cpuTimeMs !== null && first.cpuTimeMs !== null && second.cpuTimeMs > first.cpuTimeMs) return true;
  if (second.gpuActive) return true;
  for (const artifact of Object.keys(second.artifacts || {})) {
    const before = first.artifacts?.[artifact];
    const after = second.artifacts[artifact];
    if (after && (!before || after.size > before.size || after.mtimeMs > before.mtimeMs)) return true;
  }
  return false;
}

export function classifyRunState(state, { now = Date.now(), stallMs = DEFAULT_STALL_MS, firstObservation, secondObservation } = {}) {
  const latestProgress = Math.max(
    Date.parse(state.lastObservableProgressAt),
    state.lastToolResultAt ? Date.parse(state.lastToolResultAt) : 0,
  );
  const ageMs = now - latestProgress;
  if (ageMs < stallMs) return { classification: WATCHDOG_ACTIVE, reason: 'recent observable progress', ageMs };

  if (!state.expectedChildProcess || !firstObservation?.pidAlive) {
    return { classification: WATCHDOG_AGENT_STALL, reason: 'stale worker checkpoint with no useful child process', ageMs };
  }
  if (!secondObservation) {
    return { classification: 'WATCHDOG=RECHECK_REQUIRED', reason: 'stale checkpoint with a live expected child process', ageMs };
  }
  if (observationsShowProgress(firstObservation, secondObservation)) {
    return { classification: WATCHDOG_ACTIVE, reason: 'child process, GPU, checkpoint, or artifact progress observed', ageMs };
  }
  return { classification: WATCHDOG_PROCESS_STALL, reason: 'live expected child process showed no progress across both samples', ageMs };
}

function evidenceJson(observation) {
  return JSON.stringify(observation, null, 2);
}

export function createRecoveryBundle(state, diagnosis, observations, { runtimeDir = DEFAULT_RUNTIME_DIR, now = Date.now() } = {}) {
  mkdirSync(runtimeDir, { recursive: true });
  const file = path.join(runtimeDir, `${state.runId}-recovery.md`);
  const content = `# Xiafork W3-P0 Recovery Bundle\n\n` +
    `Generated: ${new Date(now).toISOString()}\n\n` +
    `Classification: ${diagnosis.classification}\n\n` +
    `Reason: ${diagnosis.reason}\n\n` +
    `## Last safe boundary\n\n${state.lastCompletedPhase || 'No completed phase recorded.'}\n\n` +
    `## Authorized recovery context\n\n` +
    `- Run: ${state.runId} — ${state.taskTitle}\n` +
    `- Current phase: ${state.currentPhase}\n` +
    `- Next safe action: ${state.nextSafeAction}\n` +
    `- Hard stop: ${state.hardStop}\n` +
    `- Human-only boundary: ${state.humanOnlyBoundary || 'none recorded'}\n` +
    `- Authorized scope: ${state.authorizedScope.join('; ') || 'none recorded'}\n` +
    `- Forbidden paths: ${state.forbiddenPaths.join('; ') || 'none recorded'}\n` +
    `- Completed expensive steps: ${state.completedExpensiveSteps.join('; ') || 'none'}\n` +
    `- Known failures: ${state.knownFailures.join('; ') || 'none'}\n\n` +
    `## Observable evidence\n\n\`\`\`json\n${evidenceJson(observations)}\n\`\`\`\n\n` +
    `No process was killed, no lease was stolen, and no replacement Agent was authorized to write the worktree.\n`;
  writeFileSync(file, content, 'utf8');
  return file;
}

export function invokeSupervisorCodex(state, recoveryFile, options = {}) {
  const outputFile = path.join(options.runtimeDir || DEFAULT_RUNTIME_DIR, `${state.runId}-supervisor.md`);
  const prompt = [
    'You are Xiafork W3-P0 Supervisor Codex B. Operate read-only.',
    `Read .xiafork/runtime/${state.runId}.json, .xiafork/handoff.json, and .xiafork/runtime/${state.runId}-recovery.md.`,
    'Inspect git status read-only if useful.',
    'Return a concise Markdown assessment with: classification, last safe completed boundary, suspected cause, next safe action, and whether a replacement would be safe.',
    'Do not edit files, commit, push, kill processes, take a lease, broaden authority, or start replacement work.',
  ].join(' ');
  let executable = options.codexCommand || process.env.XIAFORK_CODEX_COMMAND || 'codex';
  let prefixArgs = [];
  if (!options.codexCommand && !process.env.XIAFORK_CODEX_COMMAND && process.platform === 'win32') {
    const discovery = spawnSync('powershell', [
      '-NoProfile', '-NonInteractive', '-Command', '(Get-Command codex -ErrorAction Stop).Source',
    ], { encoding: 'utf8', timeout: 5_000, windowsHide: true });
    const script = discovery.status === 0 ? discovery.stdout.trim() : '';
    if (script.toLowerCase().endsWith('.ps1')) {
      executable = 'powershell';
      prefixArgs = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script];
    }
  }
  const args = [...prefixArgs,
    '--ask-for-approval', 'never', 'exec', '--ephemeral', '--sandbox', 'read-only',
    '--cd', state.workspace, '--output-last-message', outputFile, prompt,
  ];
  const result = (options.spawn || spawnSync)(executable, args, {
    cwd: state.workspace,
    encoding: 'utf8',
    timeout: options.timeoutMs || 5 * 60_000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message || result.stderr?.trim() || `exit ${result.status}`;
    appendFileSync(recoveryFile, `\n## Supervisor Codex invocation\n\nBLOCKED_OR_FAILED: ${detail}\n`, 'utf8');
    return { status: 'BLOCKED_OR_FAILED', detail, outputFile };
  }
  let assessment = '';
  try {
    assessment = readFileSync(outputFile, 'utf8').trim();
  } catch {
    assessment = result.stdout?.trim() || '';
  }
  appendFileSync(recoveryFile, `\n## Supervisor Codex assessment\n\n${assessment || 'No assessment returned.'}\n`, 'utf8');
  return { status: 'PASS', outputFile, assessment };
}

export async function diagnoseRun(runId, options = {}) {
  const runtimeDir = options.runtimeDir || DEFAULT_RUNTIME_DIR;
  let state = readRunState(runId, { runtimeDir });
  const now = options.now ?? Date.now();
  const first = options.firstObservation || captureObservation(state, { now });
  let diagnosis = classifyRunState(state, { now, stallMs: options.stallMs, firstObservation: first });
  let second = options.secondObservation;

  if (diagnosis.classification === 'WATCHDOG=RECHECK_REQUIRED') {
    if (!second) {
      await (options.sleep || sleep)(options.recheckMs ?? DEFAULT_RECHECK_MS);
      state = readRunState(runId, { runtimeDir });
      second = captureObservation(state);
    }
    diagnosis = classifyRunState(state, {
      now: options.secondNow ?? Date.now(),
      stallMs: options.stallMs,
      firstObservation: first,
      secondObservation: second,
    });
  }

  let recoveryFile = null;
  let supervisor = null;
  if ([WATCHDOG_AGENT_STALL, WATCHDOG_PROCESS_STALL].includes(diagnosis.classification)) {
    recoveryFile = createRecoveryBundle(state, diagnosis, { first, second }, { runtimeDir });
  }
  if (diagnosis.classification === WATCHDOG_AGENT_STALL && options.invokeSupervisor !== false) {
    supervisor = (options.supervisorInvoker || invokeSupervisorCodex)(state, recoveryFile, { runtimeDir });
  }
  return { ...diagnosis, recoveryFile, supervisor, observations: { first, second } };
}

function parseOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) throw new Error(`Unexpected argument: ${item}`);
    const key = item.slice(2);
    if (['no-supervisor'].includes(key)) options[key] = true;
    else {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
      options[key] = value;
      index += 1;
    }
  }
  return options;
}

function numberOption(options, name, fallback) {
  if (!(name in options)) return fallback;
  const value = Number(options[name]);
  if (!Number.isFinite(value) || value < 0) throw new Error(`--${name} must be a non-negative number`);
  return value;
}

export async function runCli(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  if (!['once', 'watch'].includes(command)) {
    console.log('Usage: node scripts/xiafork-supervisor.mjs <once|watch> --run-id <id> [--stall-ms N] [--recheck-ms N] [--interval-ms N] [--no-supervisor]');
    return;
  }
  const options = parseOptions(rest);
  if (!options['run-id']) throw new Error('--run-id is required');
  const runtimeDir = options['runtime-dir'] ? path.resolve(options['runtime-dir']) : DEFAULT_RUNTIME_DIR;
  const diagnosisOptions = {
    runtimeDir,
    stallMs: numberOption(options, 'stall-ms', DEFAULT_STALL_MS),
    recheckMs: numberOption(options, 'recheck-ms', DEFAULT_RECHECK_MS),
    invokeSupervisor: !options['no-supervisor'],
  };
  do {
    const result = await diagnoseRun(options['run-id'], diagnosisOptions);
    console.log(JSON.stringify(result, null, 2));
    if (command === 'once' || result.classification !== WATCHDOG_ACTIVE) break;
    await sleep(numberOption(options, 'interval-ms', DEFAULT_INTERVAL_MS));
  } while (true);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
