import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
export const DEFAULT_HANDOFF_PATH = path.join(REPO_ROOT, '.xiafork', 'handoff.json');

const SHA_RE = /^[0-9a-f]{40}$/;
const SECRET_KEY_RE = /(?:api[_-]?key|access[_-]?token|oauth[_-]?token|password|passphrase|private[_-]?key|client[_-]?secret|credentials?)/i;
const REQUIRED_TOP_LEVEL = [
  'schemaVersion',
  'project',
  'generatedAt',
  'git',
  'productRoadmap',
  'workflowRoadmap',
  'lastCompletedWork',
  'tests',
  'externalWork',
  'blockers',
  'nextAllowedWork',
  'hardStops',
  'notes',
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function git(repoRoot, args, allowFailure = false) {
  try {
    return execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    if (allowFailure) return '';
    const detail = error?.stderr?.toString().trim() || error?.message || String(error);
    throw new Error(`git ${args.join(' ')} failed: ${detail}`);
  }
}

export function normalizeStatusPath(line) {
  const pathOffset = line[1] === ' ' && line[2] !== ' ' ? 2 : 3;
  const raw = line.slice(pathOffset).trim();
  const renamed = raw.includes(' -> ') ? raw.split(' -> ').at(-1) : raw;
  return renamed.replace(/^"|"$/g, '').replaceAll('\\', '/');
}

export function readGitState(repoRoot = REPO_ROOT) {
  const statusLines = git(repoRoot, ['status', '--porcelain'])
    .split(/\r?\n/)
    .filter(Boolean);
  return {
    branch: git(repoRoot, ['branch', '--show-current']),
    head: git(repoRoot, ['rev-parse', 'HEAD']),
    originMaster: git(repoRoot, ['rev-parse', 'origin/master']),
    upstreamMaster: git(repoRoot, ['rev-parse', 'upstream/master']),
    workingTreeClean: statusLines.length === 0,
    workingTreePaths: statusLines.map(normalizeStatusPath),
  };
}

export function readHandoffFile(filePath = DEFAULT_HANDOFF_PATH) {
  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(`Cannot read handoff: ${error.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Malformed handoff JSON: ${error.message}`);
  }
}

export function refreshHandoffData(data, gitState, generatedAt = new Date().toISOString()) {
  const next = clone(data);
  next.generatedAt = generatedAt;
  next.git.refreshBranch = gitState.branch;
  next.git.headAtRefresh = gitState.head;
  next.git.originMasterAtRefresh = gitState.originMaster;
  next.git.upstreamMaster = gitState.upstreamMaster;
  next.git.workingTreeCleanAtRefresh = gitState.workingTreeClean;
  next.git.expectedCleanAfterCommit = true;
  next.git.handoffCommit.baseCommit = gitState.head;
  return next;
}

function pathAllowed(filePath, allowedPaths) {
  return allowedPaths.some(allowed => (
    allowed.endsWith('/') ? filePath.startsWith(allowed) : filePath === allowed
  ));
}

function collectSecretShapedKeys(value, prefix = '', found = []) {
  if (!value || typeof value !== 'object') return found;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectSecretShapedKeys(item, `${prefix}[${index}]`, found));
    return found;
  }
  for (const [key, child] of Object.entries(value)) {
    const location = prefix ? `${prefix}.${key}` : key;
    if (SECRET_KEY_RE.test(key)) found.push(location);
    collectSecretShapedKeys(child, location, found);
  }
  return found;
}

function validateMilestones(data, errors) {
  const product = data.productRoadmap;
  const workflow = data.workflowRoadmap;
  if (!product || typeof product !== 'object') return;
  if (!workflow || typeof workflow !== 'object') return;

  const validateList = (name, milestones) => {
    if (!Array.isArray(milestones)) {
      errors.push(`${name}.milestones must be an array`);
      return new Map();
    }
    const map = new Map();
    for (const item of milestones) {
      if (!item || typeof item.id !== 'string' || typeof item.status !== 'string') {
        errors.push(`${name}.milestones entries require id and status`);
        continue;
      }
      if (map.has(item.id)) errors.push(`${name}.milestones duplicates ${item.id}`);
      map.set(item.id, item.status);
    }
    return map;
  };

  const productMap = validateList('productRoadmap', product.milestones);
  const workflowMap = validateList('workflowRoadmap', workflow.milestones);

  if (productMap.get(product.currentMilestone) !== product.milestoneStatus) {
    errors.push('productRoadmap current milestone/status contradicts milestones');
  }
  for (const id of product.completed || []) {
    if (productMap.get(id) !== 'complete') errors.push(`productRoadmap completed ${id} is not complete`);
  }
  const preparedIds = new Set();
  for (const item of product.preparedAhead || []) {
    if (!item || typeof item.id !== 'string' || item.status !== 'preparation_complete') {
      errors.push('productRoadmap preparedAhead entries require id and preparation_complete status');
      continue;
    }
    if (preparedIds.has(item.id)) errors.push(`productRoadmap preparedAhead duplicates ${item.id}`);
    preparedIds.add(item.id);
    if (product.completed?.includes(item.id)) errors.push(`${item.id} cannot be both complete and preparedAhead`);
  }

  if (workflowMap.get(workflow.currentMilestone) !== workflow.milestoneStatus) {
    errors.push('workflowRoadmap current milestone/status contradicts milestones');
  }
  for (const id of workflow.completed || []) {
    if (workflowMap.get(id) !== 'complete') errors.push(`workflowRoadmap completed ${id} is not complete`);
  }
  if (!workflowMap.has(workflow.next)) errors.push('workflowRoadmap.next must name a declared milestone');
}

function realGitInspector(repoRoot) {
  return {
    isAncestor(base, head) {
      try {
        execFileSync('git', ['merge-base', '--is-ancestor', base, head], {
          cwd: repoRoot,
          stdio: 'ignore',
        });
        return true;
      } catch {
        return false;
      }
    },
    commitsAhead(base, head) {
      return Number(git(repoRoot, ['rev-list', '--count', `${base}..${head}`]));
    },
    subjects(base, head) {
      const output = git(repoRoot, ['log', '--format=%s', `${base}..${head}`]);
      return output ? output.split(/\r?\n/) : [];
    },
    changedPaths(base, head) {
      const output = git(repoRoot, ['diff', '--name-only', `${base}..${head}`]);
      return output ? output.split(/\r?\n/).map(item => item.replaceAll('\\', '/')) : [];
    },
  };
}

export function validateHandoff(data, options = {}) {
  const errors = [];
  const warnings = [];
  let phase = 'semantic-only';

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, errors: ['handoff must be a JSON object'], warnings, phase };
  }
  for (const key of REQUIRED_TOP_LEVEL) {
    if (!(key in data)) errors.push(`missing required section: ${key}`);
  }
  if (data.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (Number.isNaN(Date.parse(data.generatedAt))) errors.push('generatedAt must be an ISO date-time');

  const secretKeys = collectSecretShapedKeys(data);
  if (secretKeys.length) errors.push(`secret-shaped field names are forbidden: ${secretKeys.join(', ')}`);

  const requiredArrays = ['lastCompletedWork', 'tests', 'externalWork', 'blockers', 'nextAllowedWork', 'hardStops', 'notes'];
  for (const key of requiredArrays) {
    if (!Array.isArray(data[key])) errors.push(`${key} must be an array`);
  }
  if (Array.isArray(data.nextAllowedWork) && data.nextAllowedWork.length === 0) errors.push('nextAllowedWork must not be empty');
  if (Array.isArray(data.hardStops) && data.hardStops.length === 0) errors.push('hardStops must not be empty');

  validateMilestones(data, errors);

  const gitRecord = data.git;
  const commitRule = gitRecord?.handoffCommit;
  for (const [name, value] of [
    ['git.headAtRefresh', gitRecord?.headAtRefresh],
    ['git.originMasterAtRefresh', gitRecord?.originMasterAtRefresh],
    ['git.upstreamMaster', gitRecord?.upstreamMaster],
    ['git.handoffCommit.baseCommit', commitRule?.baseCommit],
  ]) {
    if (!SHA_RE.test(value || '')) errors.push(`${name} must be a 40-character lowercase Git SHA`);
  }
  if (gitRecord?.canonicalBranch !== 'master') errors.push('git.canonicalBranch must be master');
  if (commitRule?.resolution !== 'single-focused-descendant') {
    errors.push('git.handoffCommit.resolution must be single-focused-descendant');
  }
  if (commitRule?.commitsAhead !== 1) errors.push('git.handoffCommit.commitsAhead must be 1');
  if (!commitRule?.subject) errors.push('git.handoffCommit.subject is required');
  if (!Array.isArray(commitRule?.allowedPaths) || commitRule.allowedPaths.length === 0) {
    errors.push('git.handoffCommit.allowedPaths must not be empty');
  }

  if (options.gitState && commitRule && errors.length === 0) {
    const state = options.gitState;
    const inspector = options.gitInspector;
    const allowedBranches = new Set([gitRecord.canonicalBranch, gitRecord.refreshBranch]);
    if (!allowedBranches.has(state.branch)) {
      errors.push(`current branch ${state.branch} is not canonical or refresh branch`);
    }
    if (state.upstreamMaster !== gitRecord.upstreamMaster) {
      errors.push('current upstream/master does not match handoff');
    }

    if (state.head === commitRule.baseCommit) {
      phase = 'pre-commit';
      if (state.originMaster !== gitRecord.originMasterAtRefresh) {
        errors.push('origin/master changed since handoff refresh');
      }
      const unexpected = (state.workingTreePaths || []).filter(file => !pathAllowed(file, commitRule.allowedPaths));
      if (unexpected.length) errors.push(`pre-commit working tree has unexpected paths: ${unexpected.join(', ')}`);
    } else {
      phase = 'committed';
      if (!inspector) {
        errors.push('git inspector is required to validate committed handoff state');
      } else if (!inspector.isAncestor(commitRule.baseCommit, state.head)) {
        errors.push('current HEAD is not a descendant of handoff baseCommit');
      } else {
        const ahead = inspector.commitsAhead(commitRule.baseCommit, state.head);
        if (ahead !== commitRule.commitsAhead) errors.push(`handoff commit distance is ${ahead}, expected ${commitRule.commitsAhead}`);
        const subjects = inspector.subjects(commitRule.baseCommit, state.head);
        if (subjects.length !== 1 || subjects[0] !== commitRule.subject) {
          errors.push('handoff commit subject does not match the focused commit contract');
        }
        const unexpected = inspector.changedPaths(commitRule.baseCommit, state.head)
          .filter(file => !pathAllowed(file, commitRule.allowedPaths));
        if (unexpected.length) errors.push(`handoff commit changed unexpected paths: ${unexpected.join(', ')}`);
      }
      if (gitRecord.expectedCleanAfterCommit && !state.workingTreeClean) {
        errors.push('working tree must be clean after the handoff commit');
      }
      if (![gitRecord.originMasterAtRefresh, state.head].includes(state.originMaster)) {
        errors.push('origin/master is neither the recorded pre-integration SHA nor current handoff HEAD');
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings, phase };
}

export function validateHandoffFile({ repoRoot = REPO_ROOT, filePath = path.join(repoRoot, '.xiafork', 'handoff.json') } = {}) {
  const data = readHandoffFile(filePath);
  const gitState = readGitState(repoRoot);
  return validateHandoff(data, {
    gitState,
    gitInspector: realGitInspector(repoRoot),
  });
}

export function formatHandoffSummary(data, currentHead = data.git?.headAtRefresh || 'unknown') {
  const last = data.lastCompletedWork?.[0];
  return [
    `Product: ${data.productRoadmap.currentMilestone} ${data.productRoadmap.milestoneStatus}`,
    `Workflow: ${data.workflowRoadmap.currentMilestone} ${data.workflowRoadmap.milestoneStatus}`,
    `HEAD: ${currentHead}`,
    `Last work: ${last ? `${last.id} - ${last.summary}` : 'none'}`,
    `Next: ${data.nextAllowedWork?.[0] || 'none declared'}`,
    `Blockers: ${data.blockers?.length ? data.blockers.join(' | ') : 'none'}`,
  ].join('\n');
}

function printValidation(result) {
  if (result.ok) {
    console.log(`handoff valid (${result.phase})`);
    return;
  }
  console.error('handoff invalid:');
  for (const error of result.errors) console.error(`- ${error}`);
  process.exitCode = 1;
}

function main() {
  const command = process.argv[2];
  if (!['refresh', 'validate', 'show'].includes(command)) {
    console.error('Usage: node scripts/xiafork-handoff.mjs <refresh|validate|show>');
    process.exitCode = 1;
    return;
  }

  if (command === 'refresh') {
    const data = readHandoffFile();
    const refreshed = refreshHandoffData(data, readGitState());
    writeFileSync(DEFAULT_HANDOFF_PATH, `${JSON.stringify(refreshed, null, 2)}\n`, 'utf8');
    console.log(`refreshed ${path.relative(REPO_ROOT, DEFAULT_HANDOFF_PATH)}`);
    return;
  }

  const data = readHandoffFile();
  if (command === 'validate') {
    printValidation(validateHandoffFile());
    return;
  }
  const gitState = readGitState();
  console.log(formatHandoffSummary(data, gitState.head));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
