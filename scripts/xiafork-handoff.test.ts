import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// @ts-expect-error Repository development helpers are native ESM without declaration files.
import {
  formatHandoffSummary,
  normalizeStatusPath,
  readHandoffFile,
  refreshHandoffData,
  validateHandoff,
  validateHandoffFile,
} from './xiafork-handoff.mjs';

const temporaryDirectories: string[] = [];

function currentHandoff() {
  return readHandoffFile(path.resolve('.xiafork/handoff.json'));
}

function syntheticGitState(overrides = {}) {
  const handoff = currentHandoff();
  return {
    branch: handoff.git.refreshBranch,
    head: handoff.git.handoffCommit.baseCommit,
    originMaster: handoff.git.originMasterAtRefresh,
    upstreamMaster: handoff.git.upstreamMaster,
    workingTreeClean: false,
    workingTreePaths: ['.xiafork/'],
    ...overrides,
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('Xiafork structured handoff', () => {
  it('accepts the current handoff and repository state', () => {
    expect(validateHandoffFile()).toMatchObject({ ok: true });
    expect(normalizeStatusPath('M AGENTS.md')).toBe('AGENTS.md');
    expect(normalizeStatusPath('?? .xiafork/')).toBe('.xiafork/');
  });

  it('rejects malformed JSON', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'xiafork-handoff-'));
    temporaryDirectories.push(directory);
    const file = path.join(directory, 'handoff.json');
    writeFileSync(file, '{not valid JSON', 'utf8');

    expect(() => readHandoffFile(file)).toThrow(/Malformed handoff JSON/);
  });

  it('rejects a missing required section', () => {
    const handoff = currentHandoff();
    delete handoff.productRoadmap;

    expect(validateHandoff(handoff).errors).toContain('missing required section: productRoadmap');
  });

  it('rejects an invalid Git SHA', () => {
    const handoff = currentHandoff();
    handoff.git.headAtRefresh = 'not-a-sha';

    expect(validateHandoff(handoff).errors).toContain(
      'git.headAtRefresh must be a 40-character lowercase Git SHA',
    );
  });

  it('rejects obvious secret-shaped field names', () => {
    const handoff = currentHandoff();
    handoff.synthetic = { apiKey: 'synthetic-placeholder' };

    expect(validateHandoff(handoff).errors.join('\n')).toMatch(/secret-shaped field names are forbidden/);
  });

  it('detects a Git ancestry mismatch', () => {
    const handoff = currentHandoff();
    const gitState = syntheticGitState({ head: '1111111111111111111111111111111111111111' });
    const gitInspector = {
      isAncestor: () => false,
      commitsAhead: () => 0,
      subjects: () => [],
      changedPaths: () => [],
    };

    expect(validateHandoff(handoff, { gitState, gitInspector }).errors).toContain(
      'current HEAD is not a descendant of handoff baseCommit',
    );
  });

  it('refreshes Git-derived fields without destroying semantic state', () => {
    const handoff = currentHandoff();
    const before = JSON.stringify({
      productRoadmap: handoff.productRoadmap,
      workflowRoadmap: handoff.workflowRoadmap,
      nextAllowedWork: handoff.nextAllowedWork,
    });
    const gitState = syntheticGitState({
      branch: 'synthetic-refresh',
      head: '2222222222222222222222222222222222222222',
      originMaster: '3333333333333333333333333333333333333333',
    });
    const refreshed = refreshHandoffData(handoff, gitState, '2026-08-09T01:02:03.000Z');

    expect(JSON.stringify({
      productRoadmap: refreshed.productRoadmap,
      workflowRoadmap: refreshed.workflowRoadmap,
      nextAllowedWork: refreshed.nextAllowedWork,
    })).toBe(before);
    expect(refreshed.git.headAtRefresh).toBe(gitState.head);
    expect(refreshed.generatedAt).toBe('2026-08-09T01:02:03.000Z');
  });

  it('shows a concise human-readable summary', () => {
    const summary = formatHandoffSummary(currentHandoff(), '4444444444444444444444444444444444444444');

    expect(summary).toContain('Product: M4 complete');
    expect(summary).toContain('Workflow: W3 in_progress');
    expect(summary).toContain('Last work: M4');
    expect(summary).toContain('HEAD: 4444444444444444444444444444444444444444');
  });
});
