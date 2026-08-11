import { importLocalMediaFiles } from './metadata';
import { putLocalMediaSourceRoot } from './library';
import { extensionOf } from './metadata';
import { LOCAL_AUDIO_EXTENSIONS } from './types';
import type {
  ImportItemResult,
  ImportSummary,
  LocalAudioExtension,
  WebFileSystemDirectoryHandle,
  WebFileSystemFileHandle,
} from './types';

export interface DirectoryImportProgress {
  phase: 'scanning' | 'importing';
  discovered: number;
  processed: number;
  total?: number;
  current?: string;
}

export interface ScannedDirectoryFile {
  handle: WebFileSystemFileHandle;
  relativePath: string[];
}

const isImportCandidate = (name: string): boolean => {
  const extension = extensionOf(name);
  return extension === 'lrc' || LOCAL_AUDIO_EXTENSIONS.includes(extension as LocalAudioExtension);
};

export async function scanLocalMusicDirectory(
  root: WebFileSystemDirectoryHandle,
  onProgress?: (progress: DirectoryImportProgress) => void,
): Promise<ScannedDirectoryFile[]> {
  const found: ScannedDirectoryFile[] = [];
  const visit = async (directory: WebFileSystemDirectoryHandle, prefix: string[]): Promise<void> => {
    for await (const [name, handle] of directory.entries()) {
      if (handle.kind === 'directory') {
        await visit(handle, [...prefix, name]);
      } else if (isImportCandidate(name)) {
        found.push({ handle, relativePath: [...prefix, name] });
        onProgress?.({ phase: 'scanning', discovered: found.length, processed: 0, current: found.at(-1)!.relativePath.join('/') });
      }
    }
  };
  await visit(root, []);
  return found;
}

const emptySummary = (): ImportSummary => ({
  imported: 0, duplicates: 0, unsupported: 0, failed: 0,
  metadataFallback: 0, destructiveChanges: 0, items: [],
});

const mergeSummary = (target: ImportSummary, next: ImportSummary): void => {
  target.imported += next.imported;
  target.duplicates += next.duplicates;
  target.unsupported += next.unsupported;
  target.failed += next.failed;
  target.metadataFallback += next.metadataFallback;
  target.items.push(...next.items);
};

export async function importLocalMediaDirectory(
  handle: WebFileSystemDirectoryHandle,
  options: {
    onProgress?: (progress: DirectoryImportProgress) => void;
    parse?: NonNullable<Parameters<typeof importLocalMediaFiles>[1]>['parse'];
    audio?: NonNullable<Parameters<typeof importLocalMediaFiles>[1]>['audio'];
    now?: () => number;
    rootId?: string;
  } = {},
): Promise<{ rootId: string; summary: ImportSummary }> {
  const scanned = await scanLocalMusicDirectory(handle, options.onProgress);
  const rootId = options.rootId || `root_${crypto.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
  await putLocalMediaSourceRoot({ id: rootId, kind: 'web-directory-handle', name: handle.name, importedAt: (options.now || Date.now)(), handle });

  const byDirectory = new Map<string, ScannedDirectoryFile[]>();
  for (const item of scanned) {
    const key = item.relativePath.slice(0, -1).join('/');
    const group = byDirectory.get(key) || [];
    group.push(item);
    byDirectory.set(key, group);
  }

  const aggregate = emptySummary();
  let processed = 0;
  for (const group of byDirectory.values()) {
    const files: File[] = [];
    const sourceByFile = new Map<File, ScannedDirectoryFile>();
    const inaccessible: ImportItemResult[] = [];
    // Deliberately sequential: metadata parsers may read large media windows and a library
    // import must not hold several complete File views/parser buffers concurrently.
    for (const item of group) {
      try {
        const file = await item.handle.getFile();
        files.push(file);
        sourceByFile.set(file, item);
      } catch {
        inaccessible.push({ filename: item.relativePath.join('/'), status: 'failed', message: '原文件不可访问，需要重新授权音乐文件夹' });
      }
    }
    const summary = await importLocalMediaFiles(files, {
      parse: options.parse,
      audio: options.audio,
      now: options.now,
      sourceForFile: file => {
        const item = sourceByFile.get(file);
        return item ? { kind: 'web-directory-relative', rootId, relativePath: item.relativePath } : undefined;
      },
    });
    summary.failed += inaccessible.length;
    summary.items.push(...inaccessible);
    mergeSummary(aggregate, summary);
    processed += group.length;
    options.onProgress?.({ phase: 'importing', discovered: scanned.length, processed, total: scanned.length, current: group.at(-1)?.relativePath.join('/') });
  }
  return { rootId, summary: aggregate };
}
