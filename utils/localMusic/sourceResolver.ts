import type {
  LocalMediaRecord,
  LocalMediaSource,
  LocalMediaSourceRoot,
  ReferenceLocalMediaRecord,
  WebFileSystemDirectoryHandle,
  WebFileSystemFileHandle,
} from './types';

export type LocalMediaSourceErrorCode = 'permission-required' | 'unavailable' | 'unsupported';

export class LocalMediaSourceAccessError extends Error {
  constructor(readonly code: LocalMediaSourceErrorCode, message: string) {
    super(message);
    this.name = 'LocalMediaSourceAccessError';
  }
}

export const supportsPersistentWebFileHandles = (scope: unknown = globalThis): boolean =>
  typeof (scope as { showOpenFilePicker?: unknown })?.showOpenFilePicker === 'function';

export const supportsPersistentWebDirectoryHandles = (scope: unknown = globalThis): boolean =>
  typeof (scope as { showDirectoryPicker?: unknown })?.showDirectoryPicker === 'function';

export async function pickWebLocalMediaHandles(options: { multiple?: boolean } = {}): Promise<WebFileSystemFileHandle[]> {
  const picker = (globalThis as typeof globalThis & {
    showOpenFilePicker?: (options: unknown) => Promise<WebFileSystemFileHandle[]>;
  }).showOpenFilePicker;
  if (!picker) {
    throw new LocalMediaSourceAccessError('unsupported', '当前浏览器无法持久保存原文件授权，因此未导入音频。请使用支持 File System Access API 的 Chromium 浏览器。');
  }
  return picker.call(globalThis, {
    multiple: options.multiple !== false,
    excludeAcceptAllOption: false,
    types: [{
      description: '本地音乐与 LRC 歌词',
      accept: {
        'audio/*': ['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg'],
        'video/mp4': ['.mp4'],
        'text/plain': ['.lrc'],
      },
    }],
  });
}

export async function pickWebLocalMediaDirectory(): Promise<WebFileSystemDirectoryHandle> {
  const picker = (globalThis as typeof globalThis & {
    showDirectoryPicker?: (options: unknown) => Promise<WebFileSystemDirectoryHandle>;
  }).showDirectoryPicker;
  if (!picker) {
    throw new LocalMediaSourceAccessError('unsupported', '当前浏览器不支持持久音乐文件夹授权，请使用支持 File System Access API 的 Chromium 浏览器。');
  }
  return picker.call(globalThis, { mode: 'read' });
}

async function resolveWebFileHandle(
  handle: WebFileSystemFileHandle,
  requestPermission: boolean,
): Promise<File> {
  let permission: 'granted' | 'denied' | 'prompt' = 'prompt';
  try {
    permission = handle.queryPermission ? await handle.queryPermission({ mode: 'read' }) : 'granted';
  } catch {
    permission = 'prompt';
  }
  if (permission !== 'granted' && requestPermission && handle.requestPermission) {
    permission = await handle.requestPermission({ mode: 'read' });
  }
  if (permission !== 'granted') {
    throw new LocalMediaSourceAccessError('permission-required', '原文件不可访问，需要重新授权/重新定位');
  }
  try {
    return await handle.getFile();
  } catch {
    throw new LocalMediaSourceAccessError('unavailable', '原文件不可访问，需要重新授权/重新定位');
  }
}

async function ensureDirectoryReadPermission(handle: WebFileSystemDirectoryHandle, requestPermission: boolean): Promise<void> {
  let permission: 'granted' | 'denied' | 'prompt' = 'prompt';
  try { permission = handle.queryPermission ? await handle.queryPermission({ mode: 'read' }) : 'granted'; }
  catch { permission = 'prompt'; }
  if (permission !== 'granted' && requestPermission && handle.requestPermission) {
    permission = await handle.requestPermission({ mode: 'read' });
  }
  if (permission !== 'granted') {
    throw new LocalMediaSourceAccessError('permission-required', '音乐文件夹不可访问，需要重新授权音乐文件夹');
  }
}

export async function resolveFileFromDirectoryHandle(
  root: WebFileSystemDirectoryHandle,
  relativePath: string[],
): Promise<File> {
  if (!relativePath.length) throw new LocalMediaSourceAccessError('unavailable', '本地媒体相对路径无效');
  try {
    let directory = root;
    for (const segment of relativePath.slice(0, -1)) directory = await directory.getDirectoryHandle(segment);
    return await (await directory.getFileHandle(relativePath.at(-1)!)).getFile();
  } catch {
    throw new LocalMediaSourceAccessError('unavailable', '原文件不可访问，需要重新授权/重新定位');
  }
}

export async function resolveLocalMediaSource(
  source: LocalMediaSource,
  options: {
    requestPermission?: boolean;
    getDirectoryRoot?: (id: string) => Promise<LocalMediaSourceRoot | null>;
  } = {},
): Promise<File> {
  switch (source.kind) {
    case 'web-file-handle':
      return resolveWebFileHandle(source.handle, options.requestPermission === true);
    case 'web-directory-relative': {
      const root = await options.getDirectoryRoot?.(source.rootId);
      if (!root) throw new LocalMediaSourceAccessError('unavailable', '音乐文件夹来源已丢失，需要重新导入');
      await ensureDirectoryReadPermission(root.handle, options.requestPermission === true);
      return resolveFileFromDirectoryHandle(root.handle, source.relativePath);
    }
    case 'android-content-uri':
    case 'ios-security-scoped':
      throw new LocalMediaSourceAccessError('unsupported', '此平台的本地媒体授权适配器尚未启用');
  }
}

export async function resolveLocalMediaRecord(
  record: LocalMediaRecord,
  options: Parameters<typeof resolveLocalMediaSource>[1] = {},
): Promise<Blob> {
  if (record.schemaVersion === 1) return record.audioBlob;
  return resolveLocalMediaSource((record as ReferenceLocalMediaRecord).source, options);
}
