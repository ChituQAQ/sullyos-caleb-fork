
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from '../context/OSContext';
import { useMusic, musicApi, normalizeCookie, toHttps, Song } from '../context/MusicContext';
import { getProxyWorkerUrl } from '../utils/proxyWorker';
import { DB } from '../utils/db';
import { trackEvent } from '../utils/analytics';
import { Gear, User as UserIcon, Crosshair, Play as PlayIcon, Pause as PauseIcon, FolderOpen, UploadSimple, Trash } from '@phosphor-icons/react';
import {
  C, Sparkle, CrossStar, MizuHeader, SearchBar, SongRow, MiniPlayer,
  VinylDisc, GlassProgress, PlayControls, BokehBg,
  MetaChip, SubActions,
} from './music/MusicUI';
import NeteaseProfilePage from './music/NeteaseProfilePage';
import CharVisitPage from './music/CharVisitPage';
import { importLocalMediaHandles, localRecordToSong, stableFileFingerprint } from '../utils/localMusic/metadata';
import { listLocalMediaSourceRoots, listLocalTracks, removeLocalTrack, replaceLocalMediaDirectoryHandle, replaceLocalTrackWebHandle } from '../utils/localMusic/library';
import type { ImportSummary, LocalMediaRecord, LocalMediaSourceRoot } from '../utils/localMusic/types';
import { lyricSeekTargetSeconds } from '../utils/localMusic/lyrics';
import { pickWebLocalMediaDirectory, pickWebLocalMediaHandles, resolveFileFromDirectoryHandle } from '../utils/localMusic/sourceResolver';
import { importLocalMediaDirectory, type DirectoryImportProgress } from '../utils/localMusic/directoryImport';
import { beginLyricBrowsing, commitTimedLyricSeek, followActiveLyric, returnToLyricFollowing, type LyricFollowMode } from '../utils/localMusic/lyricScroll';

// ------------------------- 工具 -------------------------
const fmtTime = (s: number) => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${ss.toString().padStart(2, '0')}`;
};

type View = 'search' | 'local' | 'settings' | 'player' | 'profile' | 'visit_char';

// ========================= 主组件 =========================
const MusicApp: React.FC = () => {
  const { closeApp, addToast, characters, userProfile } = useOS();
  const {
    cfg, setCfg,
    current, playing, progress, duration, loadingSong,
    lyric, tlyric, activeLyricIdx, lyricsKind,
    profile, playSong, togglePlay, nextSong, prevSong, seek, seekSeconds,
    liked, toggleLike, setToastHandler,
    listeningTogetherWith, removeListeningPartner,
    addLocalSong, removeLocalSong, localAlbumSongs,
    playMode, setPlayMode,
    regeneratingId, regeneratingStatus,
  } = useMusic();
  const isCurrentRegenerating = !!current && current.id === regeneratingId;
  // 把对轴入口和单曲循环按钮移到 SubActions 里，避免散乱
  // 下载本地生成的歌曲到本地文件系统
  const downloadCurrentLocal = useCallback(async () => {
    if (!current?.local || !current.localAssetKey) return;
    try {
      const entry = await DB.getAssetRaw(current.localAssetKey).catch(() => null) as
        | { blob?: Blob; mimeType?: string }
        | Blob
        | null;
      const blob: Blob | null = entry instanceof Blob
        ? entry
        : (entry?.blob instanceof Blob ? entry.blob : null);
      if (!blob) { addToast('音频文件丢失', 'error'); return; }
      const mime = current.localMimeType || (entry && !(entry instanceof Blob) ? entry.mimeType : '') || blob.type || 'audio/mpeg';
      const ext = /wav/i.test(mime) ? 'wav' : /ogg/i.test(mime) ? 'ogg' : /flac/i.test(mime) ? 'flac' : /m4a|aac|mp4/i.test(mime) ? 'm4a' : 'mp3';
      const safe = (current.name || 'song').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${safe}.${ext}`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      addToast('已下载', 'success');
      trackEvent('下载生成的歌到本地文件');
    } catch {
      addToast('下载失败', 'error');
    }
  }, [current, addToast]);

  const cyclePlayMode = useCallback(() => {
    const order: ('loop' | 'single' | 'shuffle')[] = ['loop', 'single', 'shuffle'];
    const next = order[(order.indexOf(playMode) + 1) % order.length];
    setPlayMode(next);
    trackEvent('切换播放模式', { mode: next });
    addToast(next === 'loop' ? '列表循环' : next === 'single' ? '单曲循环' : '随机播放', 'info');
  }, [playMode, setPlayMode, addToast]);

  // 伴听 char 名单（用于 MiniPlayer / 播放页徽章）—— 带头像，给"小情侣"头像块用
  const companions = useMemo(() => {
    return listeningTogetherWith
      .map(id => characters.find(c => c.id === id))
      .filter((c): c is typeof characters[number] => !!c)
      .map(c => ({ id: c.id, name: c.name, avatar: c.avatar }));
  }, [listeningTogetherWith, characters]);

  // 当前歌在哪些 char 的歌单里（用于 MiniPlayer 的"也收藏"提示）
  const charsWithSong = useMemo(() => {
    if (!current) return [];
    return characters
      .map(c => {
        const pl = c.musicProfile?.playlists.find(p => p.songs.some(s => s.id === current.id));
        return pl ? { id: c.id, name: c.name, playlistTitle: pl.title } : null;
      })
      .filter((x): x is { id: string; name: string; playlistTitle: string } => !!x);
  }, [current, characters]);

  // 把 OS toast 注入到 Music Context（这样全局播放报错也能弹 toast）
  useEffect(() => { setToastHandler(addToast); }, [addToast, setToastHandler]);

  const [view, setView] = useState<View>('search');
  // ── 手动对轴 modal state ──
  const [showLyricSync, setShowLyricSync] = useState(false);
  const [syncDraft, setSyncDraft] = useState<number[]>([]);
  const [visitCharId, setVisitCharId] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<Song[]>([]);
  const [searching, setSearching] = useState(false);
  const lyricBoxRef = useRef<HTMLDivElement | null>(null);
  const [lyricFollowMode, setLyricFollowMode] = useState<LyricFollowMode>('following');
  const lyricFollowModeRef = useRef<LyricFollowMode>('following');
  const programmaticLyricScrollTargetRef = useRef<number | null>(null);
  const [localTracks, setLocalTracks] = useState<LocalMediaRecord[]>([]);
  const [localSourceRoots, setLocalSourceRoots] = useState<LocalMediaSourceRoot[]>([]);
  const [importingLocal, setImportingLocal] = useState(false);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [directoryProgress, setDirectoryProgress] = useState<DirectoryImportProgress | null>(null);

  const refreshLocalLibrary = useCallback(async () => {
    try {
      const [tracks, roots] = await Promise.all([listLocalTracks(), listLocalMediaSourceRoots()]);
      setLocalTracks(tracks);
      setLocalSourceRoots(roots);
    }
    catch (error: any) { addToast(`读取本地曲库失败：${error?.message || 'unknown error'}`, 'error'); }
  }, [addToast]);

  useEffect(() => { void refreshLocalLibrary(); }, [refreshLocalLibrary]);

  const resumeAutoFollow = useCallback(() => {
    const mode = returnToLyricFollowing();
    lyricFollowModeRef.current = mode;
    setLyricFollowMode(mode);
  }, []);

  useEffect(() => {
    lyricFollowModeRef.current = 'following';
    setLyricFollowMode('following');
  }, [current?.id]);

  const enterLyricBrowseMode = useCallback(() => {
    programmaticLyricScrollTargetRef.current = null;
    const mode = beginLyricBrowsing();
    lyricFollowModeRef.current = mode;
    setLyricFollowMode(mode);
  }, []);

  const commitLyricSeek = useCallback((index: number) => {
    const line = lyric[index];
    if (!line) return;
    const target = lyricSeekTargetSeconds({ text: line.text, timeMs: line.t === undefined ? undefined : line.t * 1000 });
    if (target === null) return;
    lyricFollowModeRef.current = commitTimedLyricSeek(target, seekSeconds);
    resumeAutoFollow();
  }, [lyric, resumeAutoFollow, seekSeconds]);

  // 歌词自动滚动：把 current line 对齐到滚动容器视觉中心
  // 注意 offsetTop 依赖 offsetParent，容器没 position:relative 时会跨到祖先节点、值偏大，
  // 导致 current line 被推到中心上方。改用 getBoundingClientRect 对齐，和 DOM 嵌套解耦。
  useEffect(() => {
    if (view !== 'player' || lyricFollowModeRef.current !== 'following' || lyricsKind !== 'synced') return;
    const box = lyricBoxRef.current; if (!box || activeLyricIdx < 0) return;
    const el = box.querySelector<HTMLDivElement>(`[data-lyric-idx="${activeLyricIdx}"]`);
    if (!el) return;
    programmaticLyricScrollTargetRef.current = followActiveLyric('following', box, el);
  }, [activeLyricIdx, view, lyricFollowMode, lyricsKind]);

  const handleLocalImport = useCallback(async () => {
    setImportingLocal(true);
    try {
      const handles = await pickWebLocalMediaHandles();
      if (!handles.length) return;
      const summary = await importLocalMediaHandles(handles);
      setImportSummary(summary);
      await refreshLocalLibrary();
      addToast(`${summary.imported} 首已导入 · ${summary.duplicates} 首重复 · ${summary.unsupported + summary.failed} 首未导入`, summary.failed ? 'error' : 'success');
    } catch (error: any) {
      if (error?.name === 'AbortError') return;
      addToast(`导入失败：${error?.message || 'unknown error'}`, 'error');
    } finally {
      setImportingLocal(false);
    }
  }, [addToast, refreshLocalLibrary]);

  const handleDirectoryImport = useCallback(async () => {
    setImportingLocal(true);
    setDirectoryProgress({ phase: 'scanning', discovered: 0, processed: 0 });
    try {
      const handle = await pickWebLocalMediaDirectory();
      const { summary } = await importLocalMediaDirectory(handle, { onProgress: setDirectoryProgress });
      setImportSummary(summary);
      await refreshLocalLibrary();
      addToast(`${summary.imported} 首已导入 · ${summary.duplicates} 首重复 · ${summary.failed} 首失败`, summary.failed ? 'error' : 'success');
    } catch (error: any) {
      if (error?.name === 'AbortError') return;
      addToast(`文件夹导入失败：${error?.message || 'unknown error'}`, 'error');
    } finally {
      setImportingLocal(false);
      setDirectoryProgress(null);
    }
  }, [addToast, refreshLocalLibrary]);

  const playLocalTrack = useCallback((record: LocalMediaRecord) => {
    const songs = localTracks.map(item => localRecordToSong(item) as Song);
    const index = localTracks.findIndex(item => item.id === record.id);
    if (index >= 0) {
      void playSong(songs[index], { replaceQueue: songs, startIdx: index });
      setView('player');
    }
  }, [localTracks, playSong]);

  const deleteLocalTrack = useCallback(async (record: LocalMediaRecord) => {
    try {
      await removeLocalTrack(record.id);
      await refreshLocalLibrary();
      addToast('已从 SullyOS 曲库移除；原始文件未修改', 'success');
    } catch (error: any) {
      addToast(`移除失败：${error?.message || 'unknown error'}`, 'error');
    }
  }, [addToast, refreshLocalLibrary]);

  const relinkLocalTrack = useCallback(async (record: LocalMediaRecord) => {
    if (record.schemaVersion !== 2) return;
    try {
      const [handle] = await pickWebLocalMediaHandles({ multiple: false });
      if (!handle) return;
      const file = await handle.getFile();
      if (await stableFileFingerprint(file) !== record.fingerprint) {
        addToast('所选文件与原曲目不一致，请选择同一个音频文件', 'error');
        return;
      }
      await replaceLocalTrackWebHandle(record.id, handle);
      await refreshLocalLibrary();
      addToast('原文件授权已更新', 'success');
    } catch (error: any) {
      if (error?.name === 'AbortError') return;
      addToast(`重新授权失败：${error?.message || 'unknown error'}`, 'error');
    }
  }, [addToast, refreshLocalLibrary]);

  const relinkDirectoryRoot = useCallback(async (root: LocalMediaSourceRoot) => {
    try {
      const handle = await pickWebLocalMediaDirectory();
      const sample = localTracks.find(record => record.schemaVersion === 2
        && record.source.kind === 'web-directory-relative' && record.source.rootId === root.id);
      if (sample?.schemaVersion === 2 && sample.source.kind === 'web-directory-relative') {
        const file = await resolveFileFromDirectoryHandle(handle, sample.source.relativePath);
        if (await stableFileFingerprint(file) !== sample.fingerprint) {
          addToast('所选文件夹与原音乐来源不一致', 'error');
          return;
        }
      }
      await replaceLocalMediaDirectoryHandle(root.id, handle);
      await refreshLocalLibrary();
      addToast(`已重新授权音乐文件夹：${root.name}`, 'success');
    } catch (error: any) {
      if (error?.name === 'AbortError') return;
      addToast(`文件夹重新授权失败：${error?.message || 'unknown error'}`, 'error');
    }
  }, [addToast, localTracks, refreshLocalLibrary]);

  // ── 搜索 ──
  const doSearch = useCallback(async () => {
    const kw = keyword.trim(); if (!kw) return;
    setSearching(true);
    trackEvent('搜索一首歌');
    try {
      const r = await musicApi.search(cfg, kw);
      const songs: Song[] = (r?.result?.songs || []).map((s: any) => ({
        id: s.id, name: s.name,
        artists: (s.ar || s.artists || []).map((a: any) => a.name).join(' / '),
        album: s.al?.name || s.album?.name || '',
        albumPic: toHttps(s.al?.picUrl || s.album?.picUrl || ''),
        duration: (s.dt || s.duration || 0) / 1000,
        fee: s.fee ?? 0,
      }));
      setResults(songs);
      if (!songs.length) {
        const hint = r?.msg || r?.message || (r?.code != null ? `code=${r.code}` : '') || '无数据';
        addToast(`没找到: ${hint}`, 'info');
      }
    } catch (e: any) {
      addToast(`搜索失败：${e.message}`, 'error');
    } finally {
      setSearching(false);
    }
  }, [keyword, cfg, addToast]);

  // ════════════════ 搜索页 ════════════════
  const renderSearch = () => (
    <div className="flex flex-col h-full relative"
      style={{ background: `linear-gradient(180deg, #ffffff 0%, ${C.bg} 50%, ${C.bgDeep} 100%)` }}>
      <BokehBg />
      <MizuHeader
        title="未来音楽"
        onClose={closeApp}
        right={
          <div className="flex items-center gap-1">
            <button
              onClick={() => setView('local')}
              className="p-1.5 rounded-full transition-all"
              style={{ color: C.primary }}
              title="本地音乐"
            >
              <FolderOpen size={16} weight="bold" />
            </button>
            <button
              onClick={() => setView('profile')}
              className="p-1.5 rounded-full transition-all"
              style={{ color: C.primary }}
              title="我的"
            >
              <UserIcon size={16} weight="bold" />
            </button>
            <button
              onClick={() => setView('settings')}
              className="p-1.5 rounded-full transition-all"
              style={{ color: C.primary }}
            >
              <Gear size={16} weight="bold" />
            </button>
          </div>
        }
      />
      <SearchBar value={keyword} onChange={setKeyword} onSearch={doSearch} searching={searching} />

      {/* 用户状态 — 玻璃标签 */}
      {profile && (
        <div className="px-5 -mt-1 mb-1.5 flex items-center gap-1.5 relative z-10">
          <button
            onClick={() => setView('profile')}
            className="inline-flex items-center gap-2 pl-0.5 pr-3 py-0.5 rounded-full text-[10px] shizuku-glass cursor-pointer"
            style={{ color: C.muted }}
          >
            {profile.avatarUrl ? (
              <img src={profile.avatarUrl} alt="" className="w-5 h-5 rounded-full object-cover" />
            ) : <Sparkle size={6} color={C.sakura} delay={0.3} />}
            {profile.nickname} · {cfg.quality}
          </button>
        </div>
      )}
      {!cfg.cookie && (
        <div className="px-5 -mt-1 mb-1.5 relative z-10">
          <button
            onClick={() => setView('profile')}
            className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] cursor-pointer"
            style={{ background: `${C.vip}18`, color: C.vip, border: `1px solid ${C.vip}30` }}
          >
            未登录 — 点击登录网易云
          </button>
        </div>
      )}

      {/* 歌曲列表 */}
      <div className="flex-1 overflow-y-auto px-2 pb-24 relative z-10 shizuku-scrollbar">
        {results.length === 0 && !searching && (
          <div className="text-center mt-16 space-y-4">
            <div className="relative inline-block">
              <Sparkle size={24} className="mx-auto" color={C.glow} delay={0} />
              <Sparkle size={12} className="absolute -top-1 -right-3" color={C.sakura} delay={0.8} />
              <Sparkle size={8} className="absolute -bottom-2 -left-2" color={C.lavender} delay={1.5} />
            </div>
            <div className="text-xs italic" style={{ color: C.faint, fontFamily: `'Georgia', serif` }}>
              搜一首想听的歌吧
            </div>
          </div>
        )}
        {results.map(s => (
          <SongRow
            key={s.id}
            name={s.name}
            artists={s.artists}
            album={s.album}
            albumPic={s.albumPic}
            duration={fmtTime(s.duration)}
            isVip={s.fee === 1}
            isActive={current?.id === s.id}
            onClick={() => { playSong(s); trackEvent('播放搜索结果里的一首歌'); }}
          />
        ))}
      </div>

      {current && (
        <MiniPlayer
          name={current.name}
          artists={current.artists}
          albumPic={current.albumPic}
          playing={playing}
          onTap={() => { setView('player'); trackEvent('打开播放页'); }}
          onPrev={() => { prevSong(); trackEvent('切歌（上一首/下一首）', { direction: 'prev' }); }}
          onToggle={togglePlay}
          onNext={() => { nextSong(); trackEvent('切歌（上一首/下一首）', { direction: 'next' }); }}
          userAvatar={userProfile?.avatar}
          userName={userProfile?.name}
          companions={companions}
          onKickCompanion={charId => { removeListeningPartner(charId); trackEvent('结束和角色的一起听'); }}
          charsWithSong={charsWithSong}
          regenStatus={isCurrentRegenerating ? regeneratingStatus : undefined}
        />
      )}
    </div>
  );

  const renderLocalLibrary = () => {
    const songs = localTracks.map(record => localRecordToSong(record) as Song);
    return (
      <div className="flex flex-col h-full relative" style={{ background: `linear-gradient(180deg, #ffffff 0%, ${C.bg} 55%, ${C.bgDeep} 100%)` }}>
        <BokehBg />
        <MizuHeader
          title="Local Music"
          onBack={() => setView('search')}
          right={<button onClick={() => void handleLocalImport()} disabled={importingLocal} className="p-1.5 rounded-full" style={{ color: C.primary }} title="导入音乐"><UploadSimple size={17} weight="bold" /></button>}
        />
        <div className="relative z-10 px-4 pt-3">
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => void handleDirectoryImport()} disabled={importingLocal}
              className="rounded-2xl py-3 text-xs text-white flex items-center justify-center gap-2 disabled:opacity-60"
              style={{ background: `linear-gradient(135deg, ${C.primary}, ${C.accent})`, boxShadow: `0 3px 18px ${C.glow}35` }}>
              <FolderOpen size={16} /> 导入音乐文件夹
            </button>
            <button onClick={() => void handleLocalImport()} disabled={importingLocal}
              className="rounded-2xl py-3 text-xs flex items-center justify-center gap-2 disabled:opacity-60 shizuku-glass"
              style={{ color: C.primary }}>
              <UploadSimple size={16} /> 导入单曲 / LRC
            </button>
          </div>
          <p className="text-[9px] mt-2 leading-relaxed" style={{ color: C.muted }}>
            文件夹模式只需重新授权一个来源，适合大型曲库；单曲句柄在浏览器重启后可能需要逐首重新授权。两种模式都不复制完整音频、不上传、不改写原文件。
          </p>
          {directoryProgress && (
            <div className="mt-2 text-[10px]" style={{ color: C.primary }}>
              {directoryProgress.phase === 'scanning'
                ? `正在扫描文件夹… 已发现 ${directoryProgress.discovered} 个音乐/歌词文件`
                : `正在解析曲库… ${directoryProgress.processed}/${directoryProgress.total || directoryProgress.discovered}`}
              {directoryProgress.current && <div className="truncate opacity-70">{directoryProgress.current}</div>}
            </div>
          )}
          {localSourceRoots.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {localSourceRoots.map(root => (
                <button key={root.id} onClick={() => void relinkDirectoryRoot(root)} disabled={importingLocal}
                  className="rounded-full px-2.5 py-1 text-[9px] shizuku-glass" style={{ color: C.muted }}>
                  重新授权音乐文件夹 · {root.name}
                </button>
              ))}
            </div>
          )}
          {importSummary && (
            <div className="mt-2 rounded-xl px-3 py-2 text-[10px] shizuku-glass" style={{ color: C.primary }}>
              {importSummary.imported} imported · {importSummary.duplicates} duplicate · {importSummary.unsupported} unsupported · {importSummary.failed} failed
              {importSummary.metadataFallback > 0 && <div className="mt-1" style={{ color: C.vip }}>{importSummary.metadataFallback} 首 metadata 解析失败，已安全使用文件名</div>}
              {importSummary.items.filter(item => item.status === 'unsupported' || item.status === 'failed').slice(0, 4).map(item => (
                <div key={item.filename} className="mt-1 truncate" style={{ color: C.danger }}>{item.filename}: {item.message}</div>
              ))}
            </div>
          )}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 pb-24 relative z-10 shizuku-scrollbar grid grid-cols-1 md:grid-cols-2 gap-2 content-start">
          {localTracks.length === 0 && !importingLocal && (
            <div className="md:col-span-2 text-center py-16 text-xs" style={{ color: C.faint }}>还没有本地音乐</div>
          )}
          {localTracks.map((record, index) => {
            const song = songs[index];
            const unsupported = record.playbackCapability === 'unsupported';
            return (
              <div key={record.id} className="rounded-2xl p-2.5 shizuku-glass flex items-center gap-3">
                <button className="flex-1 min-w-0 text-left" onClick={() => playLocalTrack(record)} disabled={unsupported}>
                  <div className="text-sm truncate" style={{ color: C.text }}>{song.name}</div>
                  <div className="text-[10px] truncate mt-0.5" style={{ color: C.muted }}>{song.artists}{song.album ? ` · ${song.album}` : ''}</div>
                  <div className="flex gap-1.5 mt-1 flex-wrap text-[8px] uppercase" style={{ color: unsupported ? C.danger : C.faint }}>
                    <span>{record.metadata.sourceFormat}</span>
                    <span>{fmtTime(song.duration)}</span>
                    <span>{record.lyrics.kind === 'synced' ? 'timed lyrics' : record.lyrics.kind === 'plain' ? 'plain lyrics' : 'no lyrics'}</span>
                    <span>{record.playbackCapability === 'supported' ? 'playable' : record.playbackCapability}</span>
                    {record.metadataStatus === 'fallback' && <span style={{ color: C.vip }}>filename metadata</span>}
                  </div>
                </button>
                {record.schemaVersion === 2 && record.source.kind === 'web-file-handle' && (
                  <button onClick={() => void relinkLocalTrack(record)} className="p-2 rounded-full" style={{ color: C.faint }} aria-label={`重新授权或定位 ${song.name}`} title="重新授权 / 重新定位原文件"><FolderOpen size={14} /></button>
                )}
                <button onClick={() => void deleteLocalTrack(record)} className="p-2 rounded-full" style={{ color: C.faint }} aria-label={`从曲库移除 ${song.name}`} title="仅移除曲库记录，不删除原文件"><Trash size={14} /></button>
              </div>
            );
          })}
        </div>
        {current && <MiniPlayer name={current.name} artists={current.artists} albumPic={current.albumPic} playing={playing}
          onTap={() => setView('player')} onPrev={prevSong} onToggle={togglePlay} onNext={nextSong}
          userAvatar={userProfile?.avatar} userName={userProfile?.name} companions={companions}
          onKickCompanion={removeListeningPartner} charsWithSong={charsWithSong} />}
      </div>
    );
  };

  // ════════════════ 播放页 ════════════════
  const bitrateMap: Record<string, string> = {
    standard: '128 kbps',
    higher:   '192 kbps',
    exhigh:   '320 kbps',
    lossless: '1411 kbps',
    hires:    '24bit · Hi-Res',
  };

  const renderPlayer = () => {
    if (!current) return null;
    return (
      <div className="flex flex-col h-full relative"
        style={{ background: `linear-gradient(180deg, #ffffff 0%, ${C.bg} 60%, ${C.bgDeep} 100%)` }}>
        <BokehBg />
        <MizuHeader title="Now Playing" onBack={() => setView(current.localLibraryTrackId ? 'local' : 'search')} />

        <div className="flex-1 min-h-0 flex flex-col items-center px-5 pt-4 pb-3 relative z-10 overflow-hidden">
          <div className="shrink-0 mt-1 relative">
            <VinylDisc albumPic={current.albumPic} playing={playing} size={150} bitrate={bitrateMap[cfg.quality]} fullArtwork={!!current.localLibraryTrackId} />
            {/* 重录中覆盖层 — 只在本地歌且 regeneratingId 匹配时显示 */}
            {isCurrentRegenerating && (
              <div className="absolute inset-0 rounded-full flex items-center justify-center pointer-events-none"
                style={{
                  background: `radial-gradient(circle, rgba(0,0,0,0.55) 30%, rgba(0,0,0,0.35) 70%)`,
                  backdropFilter: 'blur(6px)',
                  WebkitBackdropFilter: 'blur(6px)',
                  boxShadow: `0 0 30px ${C.glow}80`,
                  animation: 'shizuku-glow 2s ease-in-out infinite',
                }}
              >
                <div className="text-center space-y-1.5 px-3">
                  <div className="w-7 h-7 mx-auto border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <div className="text-[10px] tracking-[0.2em] text-white font-semibold" style={{ fontFamily: 'Georgia, serif' }}>
                    正在重录
                  </div>
                  <div className="text-[9px] text-white/80 truncate max-w-[120px]" style={{ fontFamily: 'monospace' }}>
                    {regeneratingStatus || '处理中…'}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 横幅形式的重录提示 — 进入播放页第一时间看到状态 */}
          {isCurrentRegenerating && (
            <div className="mt-3 px-3 py-1.5 rounded-full flex items-center gap-2 text-[10px] tracking-wider"
              style={{
                background: `linear-gradient(135deg, ${C.primary}15, ${C.lavender}25)`,
                border: `1px solid ${C.glow}60`,
                color: C.primary,
              }}
            >
              <Sparkle size={9} color={C.sakura} delay={0} />
              <span>新版本即将到来 · {regeneratingStatus || '处理中'}</span>
              <Sparkle size={9} color={C.lavender} delay={0.5} />
            </div>
          )}

          <section className="mt-5 text-center space-y-1.5 shrink-0 px-2">
            <h2 className="font-light tracking-tight leading-tight"
              style={{ color: C.primary, fontFamily: `'Noto Serif','Georgia',serif`, fontSize: '22px' }}>
              {current.name}
            </h2>
            <p className="text-[10px] uppercase opacity-70"
              style={{ color: C.muted, fontFamily: `'Space Grotesk','SF Mono',monospace`, letterSpacing: '0.2em' }}>
              {current.artists}
            </p>
            {current.album && <p className="text-[10px]" style={{ color: C.faint }}>{current.album}</p>}
            {current.localLibraryTrackId && (
              <p className="text-[8px] uppercase tracking-wider" style={{ color: C.faint }}>
                {[current.sourceFormat, current.codec || current.container].filter(Boolean).join(' · ')}
              </p>
            )}
          </section>

          {/* A positioned wrapper gives the native scroller a definite flex-constrained
              height. Keep scroll detection O(1): measuring every row during onScroll
              forced synchronous layout on every wheel/touch frame and made real
              long lyric documents effectively unscrollable. */}
          <div className="relative isolate flex-1 min-h-0 w-full my-3">
          <div
            ref={lyricBoxRef}
            onWheel={enterLyricBrowseMode}
            onTouchStart={enterLyricBrowseMode}
            onPointerDown={enterLyricBrowseMode}
            onScroll={() => {
              const target = programmaticLyricScrollTargetRef.current;
              if (target !== null && Math.abs(lyricBoxRef.current!.scrollTop - target) <= 1) {
                programmaticLyricScrollTargetRef.current = null;
                return;
              }
              if (lyricFollowModeRef.current !== 'browsing') enterLyricBrowseMode();
            }}
            className="absolute inset-0 overflow-y-scroll pointer-events-auto text-center shizuku-scrollbar px-2"
            style={{
              touchAction: 'pan-y',
              overscrollBehaviorY: 'contain',
              WebkitOverflowScrolling: 'touch',
            }}
          >
            {lyric.length === 0 ? (
              <div className="pt-6 flex flex-col items-center gap-2" style={{ color: C.faint }}>
                <Sparkle size={12} color={C.glow} />
                <span className="text-[11px] italic tracking-wider" style={{ fontFamily: `'Noto Serif','Georgia',serif` }}>
                  {loadingSong ? 'loading...' : '暂无歌词'}
                </span>
              </div>
            ) : (
              <div className="flex w-full flex-col items-center gap-4 py-[30vh]">
                {lyric.map((l, i) => {
                  const tr = tlyric.find(t => t.t !== undefined && l.t !== undefined && Math.abs(t.t - l.t) < 0.2);
                  const translationText = l.translationText || tr?.text;
                  const active = i === activeLyricIdx;
                  // 关键：字号 / 字重不随 active 变 —— 变了会触发重排换行。
                  //     只让外层盒子用 transform:scale 视觉放大，不动内部文字度量。
                  return (
                    <button key={i} data-lyric-idx={i}
                      type="button"
                      aria-disabled={lyricsKind !== 'synced' || l.t === undefined}
                      onClick={() => commitLyricSeek(i)}
                      className="block w-full max-w-2xl px-2 transition-transform duration-300 will-change-transform"
                      style={{
                        transform: active ? 'scale(1.05)' : 'scale(1)',
                        transformOrigin: 'center center',
                        opacity: active ? 1 : 0.45,
                      }}>
                      <div className="grid w-full grid-cols-[12px_minmax(0,1fr)_12px] items-center gap-2 px-3">
                        <CrossStar
                          size={12}
                          color={C.sakura}
                          delay={0}
                          solid={active}
                          className={active ? '' : 'opacity-0'}
                        />
                        <div
                          className="min-w-0 whitespace-normal text-center text-[16px] leading-[1.4]"
                          style={{
                            fontFamily: `'Noto Serif','Georgia',serif`,
                            fontWeight: 400,
                            maxWidth: '100%',
                            wordBreak: 'break-word',
                            color: active ? undefined : C.faint,
                            ...(active
                              ? {
                                  background: `linear-gradient(135deg, ${C.primary} 0%, ${C.accent} 50%, #9a6bc5 100%)`,
                                  WebkitBackgroundClip: 'text',
                                  WebkitTextFillColor: 'transparent',
                                  backgroundClip: 'text',
                                  filter: `drop-shadow(0 0 14px ${C.glow}a0) drop-shadow(0 0 4px ${C.sakura}80)`,
                                }
                              : {}),
                          }}
                        >
                          {l.text}
                        </div>
                        <CrossStar
                          size={12}
                          color={C.lavender}
                          delay={0.9}
                          solid={active}
                          className={active ? '' : 'opacity-0'}
                        />
                      </div>
                      {translationText && (
                        <div
                          className="mx-auto mt-1 max-w-xl whitespace-normal px-3 text-center text-[12px] leading-[1.4]"
                          style={{
                            fontWeight: 400,
                            maxWidth: '100%',
                            wordBreak: 'break-word',
                            opacity: active ? 0.78 : 0.4,
                            color: active ? C.accent : C.faint,
                          }}
                        >
                          {translationText}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          </div>
          {lyricFollowMode === 'browsing' && lyricsKind === 'synced' && (
            <div className="shrink-0 mb-2 flex items-center gap-2">
              <button onClick={resumeAutoFollow} className="px-3 py-1.5 rounded-full text-[10px] shizuku-glass" style={{ color: C.primary }}>
                回到当前歌词
              </button>
            </div>
          )}

          <div className="w-full shrink-0 max-w-sm">
            <div className="flex justify-between items-center mb-2 px-0.5">
              <MetaChip>{fmtTime(progress)}</MetaChip>
              <MetaChip>{fmtTime(duration)}</MetaChip>
            </div>
            <GlassProgress progress={progress} duration={duration} fmtTime={fmtTime} onSeek={seek} />
          </div>

          <div className="shrink-0 relative">
            <Sparkle size={9} className="absolute top-1 left-[30%]" color={C.sakura} delay={0} />
            <Sparkle size={7} className="absolute top-3 right-[28%]" color={C.lavender} delay={1.2} />
            <PlayControls
              playing={playing}
              loading={loadingSong}
              onPrev={() => { prevSong(); trackEvent('切歌（上一首/下一首）', { direction: 'prev' }); }}
              onToggle={togglePlay}
              onNext={() => { nextSong(); trackEvent('切歌（上一首/下一首）', { direction: 'next' }); }}
            />
          </div>

          <div className="shrink-0 mt-3 w-full">
            <SubActions
              liked={liked}
              onLike={() => { toggleLike(); trackEvent('收藏或取消收藏当前歌', { action: liked ? 'unlike' : 'like' }); }}
              showSync={!!(current.local && current.localLyrics && lyric.length > 0)}
              onSync={() => {
                setSyncDraft(lyric.map(l => l.t ?? 0));
                setShowLyricSync(true);
                trackEvent('打开歌词对轴面板');
              }}
              showDownload={!!(current.local && current.localAssetKey)}
              onDownload={downloadCurrentLocal}
              playMode={playMode}
              onCyclePlayMode={cyclePlayMode}
            />
          </div>
        </div>
      </div>
    );
  };

  // ════════════════ 设置页 ════════════════
  const renderSettings = () => {
    const setDraft = (updates: Partial<typeof cfg>) => setCfg({ ...cfg, ...updates });
    // 音乐的 worker 地址是独立持久化的，中心设置里的「恢复默认」管不到它——
    // 这里必须自己兜底：地址清空就保存 = 跟随中心 worker，立即生效（不然存进空串，
    // 请求会打相对路径直接挂，要等下次刷新 loadCfg 迁移才恢复）。
    const commit = () => {
      if (!cfg.workerUrl.trim()) setCfg({ ...cfg, workerUrl: getProxyWorkerUrl() });
      addToast('已保存', 'success');
      setView('search');
    };
    return (
      <div className="flex flex-col h-full relative"
        style={{ background: `linear-gradient(180deg, #ffffff 0%, ${C.bg} 50%, ${C.bgDeep} 100%)` }}>
        <BokehBg />
        <MizuHeader title="设置" onBack={() => setView('search')} />
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5 text-sm relative z-10 shizuku-scrollbar">
          <div className="rounded-2xl p-3.5 shizuku-glass" style={{ boxShadow: `0 2px 16px ${C.glow}08` }}>
            <div className="text-[10px] mb-2 tracking-wider flex items-center justify-between" style={{ color: C.muted }}>
              <span className="flex items-center gap-1.5"><Sparkle size={6} color={C.glow} delay={0} /> 服务地址</span>
              {cfg.workerUrl.trim() !== getProxyWorkerUrl() && (
                <button onClick={() => setDraft({ workerUrl: getProxyWorkerUrl() })}
                  className="text-[9px] underline" style={{ color: C.muted }}>恢复默认</button>
              )}
            </div>
            <input className="w-full rounded-xl px-3 py-2 outline-none text-xs shizuku-glass" value={cfg.workerUrl}
              onChange={e => setDraft({ workerUrl: e.target.value })} placeholder={getProxyWorkerUrl()}
              style={{ color: C.text }} />
            <div className="text-[9px] mt-1.5 italic" style={{ color: C.faint }}>
              留空保存 = 跟随「设置 → 自定义网络代理」的地址
            </div>
          </div>
          <div className="rounded-2xl p-3.5 shizuku-glass" style={{ boxShadow: `0 2px 16px ${C.glow}08` }}>
            <div className="text-[10px] mb-2 tracking-wider flex items-center gap-1.5" style={{ color: C.muted }}>
              <Sparkle size={6} color={C.sakura} delay={0.5} /> 会员 Cookie
            </div>
            <textarea className="w-full rounded-xl px-3 py-2 outline-none text-[10px] shizuku-glass" rows={3} value={cfg.cookie}
              onChange={e => setDraft({ cookie: e.target.value })} placeholder="MUSIC_U=xxx 或直接粘贴值..."
              style={{ color: C.text, fontFamily: 'monospace', resize: 'none' }} />
            <div className="text-[9px] mt-1.5 italic" style={{ color: C.faint }}>
              也可以在「我的」页面里扫码 / 手机号登录，自动填入 cookie
            </div>
          </div>
          <div className="rounded-2xl p-3.5 shizuku-glass" style={{ boxShadow: `0 2px 16px ${C.glow}08` }}>
            <div className="text-[10px] mb-2 tracking-wider flex items-center gap-1.5" style={{ color: C.muted }}>
              <Sparkle size={6} color={C.lavender} delay={1} /> 音质
            </div>
            <div className="grid grid-cols-5 gap-1.5">
              {(['standard', 'higher', 'exhigh', 'lossless', 'hires'] as const).map(q => (
                <button key={q} onClick={() => { setDraft({ quality: q }); trackEvent('切换音质档位', { quality: q }); }}
                  className="py-2 rounded-xl text-[10px] transition-all"
                  style={{
                    background: cfg.quality === q ? `linear-gradient(135deg, ${C.primary}, ${C.accent})` : C.glass,
                    color: cfg.quality === q ? 'white' : C.muted,
                    border: cfg.quality === q ? '1px solid transparent' : `1px solid rgba(255,255,255,0.3)`,
                    boxShadow: cfg.quality === q ? `0 2px 12px ${C.glow}30` : 'none',
                    backdropFilter: 'blur(8px)',
                  }}
                >{q}</button>
              ))}
            </div>
            <div className="text-[9px] mt-1.5 italic" style={{ color: C.faint }}>lossless / hires 需要黑胶 SVIP</div>
          </div>
          <div className="space-y-3 pt-1">
            <button
              onClick={async () => {
                trackEvent('运行音乐服务诊断');
                const lines: string[] = [];
                const ck = normalizeCookie(cfg.cookie);
                lines.push(`Worker: ${cfg.workerUrl}`);
                lines.push(`Cookie: ${ck ? ck.slice(0, 18) + '...(' + ck.length + 'c)' : '(未填)'}`);
                try {
                  const res = await fetch(`${cfg.workerUrl.replace(/\/+$/, '')}/netease/search`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json', ...(ck ? { 'X-Netease-Cookie': ck } : {}) },
                    body: JSON.stringify({ keyword: '晴天', limit: 3 }),
                  });
                  lines.push(`HTTP ${res.status}`);
                  const txt = await res.text(); lines.push(txt.slice(0, 800));
                  try { const j = JSON.parse(txt); lines.push(`---\ncode=${j.code}  songs=${j?.result?.songs?.length ?? 'N/A'}`); } catch {}
                } catch (e: any) { lines.push(`异常: ${e.message}`); }
                alert(lines.join('\n'));
              }}
              className="w-full py-2.5 rounded-2xl text-[10px] tracking-wider shizuku-glass transition-all"
              style={{ color: C.vip, border: `1px solid ${C.vip}30` }}
            >诊断（搜索晴天）</button>
            <button onClick={commit}
              className="w-full py-3 rounded-2xl text-xs text-white tracking-wider transition-all relative overflow-hidden"
              style={{ background: `linear-gradient(135deg, ${C.primary}, ${C.accent})`, boxShadow: `0 3px 18px ${C.glow}30` }}>
              <span className="relative z-10">保存</span>
              <div className="absolute inset-0 pointer-events-none" style={{
                background: `linear-gradient(90deg, transparent 30%, rgba(255,255,255,0.25) 50%, transparent 70%)`,
                backgroundSize: '200% 100%', animation: 'shizuku-shimmer 3s ease-in-out infinite',
              }} />
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="absolute inset-0 overflow-hidden">
      {view === 'search' && renderSearch()}
      {view === 'local' && renderLocalLibrary()}
      {view === 'player' && renderPlayer()}
      {view === 'settings' && renderSettings()}
      {view === 'profile' && (
        <NeteaseProfilePage
          onBack={() => setView('search')}
          onOpenPlayer={() => setView('player')}
          onOpenSearch={() => setView('search')}
          onOpenSettings={() => setView('settings')}
          onVisitChar={id => { setVisitCharId(id); setView('visit_char'); trackEvent('进入角色音乐角落'); }}
        />
      )}
      {/* 手动对轴 modal — 全屏覆盖，不开新 view */}
      {showLyricSync && current && current.local && (() => {
        const fmt = (s: number) => {
          if (!isFinite(s)) return '0:00.0';
          const m = Math.floor(s / 60);
          const sec = (s % 60).toFixed(1).padStart(4, '0');
          return `${m}:${sec}`;
        };
        const setLineTime = (idx: number, t: number) => {
          setSyncDraft(prev => {
            const next = [...prev];
            next[idx] = Math.max(0, t);
            return next;
          });
        };
        const tapCurrent = (idx: number) => setLineTime(idx, progress);
        const resetAuto = () => {
          if (!duration || duration <= 0) return;
          const intro = Math.min(2, duration * 0.05);
          const outro = Math.min(3, duration * 0.05);
          const usable = Math.max(duration - intro - outro, duration * 0.6);
          const step = usable / lyric.length;
          setSyncDraft(lyric.map((_, i) => intro + i * step));
        };
        const saveSync = () => {
          if (!current) return;
          // 把 draft 写到 song.lyricLineTimings 里 → addLocalSong 上行覆盖
          const updated: Song = { ...current, lyricLineTimings: syncDraft };
          addLocalSong(updated);
          // 重新 playSong 让 LyricLine 立即用新时间
          playSong(updated, { alsoSetQueue: false });
          setShowLyricSync(false);
          addToast('对轴已保存 ✦', 'success');
          trackEvent('保存歌词对轴');
        };

        return (
          <div className="absolute inset-0 z-50 flex flex-col"
            style={{ background: `linear-gradient(180deg, #ffffff 0%, ${C.bg} 60%, ${C.bgDeep} 100%)` }}>
            <BokehBg />
            {/* Header */}
            <div className="relative z-10 shizuku-glass-strong"
              style={{ borderBottom: `1px solid rgba(255,255,255,0.3)`, paddingTop: 'var(--safe-top)' }}>
              <div className="flex items-center justify-between h-12 px-4">
                <button onClick={() => setShowLyricSync(false)} className="text-[11px] px-2 py-1 rounded-full" style={{ color: C.muted }}>取消</button>
                <div className="flex items-center gap-1.5">
                  <Crosshair size={13} weight="duotone" color={C.primary} />
                  <span className="text-[12px] tracking-[0.25em]" style={{ color: C.primary, fontFamily: 'Georgia, serif' }}>歌词对轴</span>
                </div>
                <button onClick={saveSync} className="text-[11px] font-bold px-3 py-1 rounded-full"
                  style={{
                    background: `linear-gradient(135deg, ${C.primary}, ${C.accent})`,
                    color: 'white',
                    boxShadow: `0 2px 10px ${C.glow}50`,
                  }}>保存</button>
              </div>
            </div>

            {/* Live progress + transport */}
            <div className="relative z-10 px-4 pt-3 pb-2 shrink-0">
              <div className="flex items-center gap-2 mb-2">
                <button onClick={togglePlay}
                  className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 active:scale-95 transition-transform"
                  style={{
                    background: `linear-gradient(135deg, ${C.primary}, ${C.accent})`,
                    color: 'white',
                    boxShadow: `0 3px 12px ${C.glow}50`,
                  }}
                >
                  {playing ? <PauseIcon size={14} weight="fill" /> : <PlayIcon size={14} weight="fill" />}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between text-[10px] mb-1" style={{ color: C.muted, fontFamily: 'monospace' }}>
                    <span style={{ color: C.primary, fontWeight: 600 }}>{fmt(progress)}</span>
                    <span>{fmt(duration)}</span>
                  </div>
                  <div className="h-1 rounded-full shizuku-glass cursor-pointer relative"
                    onClick={(e) => {
                      const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                      seek((e.clientX - rect.left) / rect.width);
                    }}
                  >
                    <div className="absolute top-0 left-0 h-full rounded-full"
                      style={{
                        width: `${duration > 0 ? (progress / duration) * 100 : 0}%`,
                        background: `linear-gradient(90deg, ${C.primary}, ${C.glow})`,
                      }} />
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <button onClick={resetAuto} className="text-[10px] underline" style={{ color: C.muted }}>
                  重置为均匀分布
                </button>
                <p className="text-[10px] flex-1 text-right" style={{ color: C.muted }}>
                  播放时点 ⊙ 把当前时间设给那一句
                </p>
              </div>
            </div>

            {/* Lyric list with tap-to-set */}
            <div className="flex-1 overflow-y-auto px-3 pb-6 shizuku-scrollbar relative z-10 pt-1">
              {lyric.length === 0 ? (
                <div className="text-center text-[11px] py-12" style={{ color: C.faint }}>没有歌词可对轴</div>
              ) : (
                <div className="space-y-1.5">
                  {lyric.map((l, i) => {
                    const t = syncDraft[i] ?? l.t;
                    const isActive = i === activeLyricIdx;
                    return (
                      <div key={i}
                        className="flex items-center gap-2 rounded-xl px-2.5 py-2 transition-all"
                        style={{
                          background: isActive
                            ? `linear-gradient(135deg, ${C.glow}25, ${C.lavender}18)`
                            : 'rgba(255,255,255,0.5)',
                          border: `1px solid ${isActive ? C.glow + '60' : C.faint + '30'}`,
                          boxShadow: isActive ? `0 2px 12px ${C.glow}30` : 'none',
                        }}
                      >
                        <span className="text-[9px] tabular-nums w-5 text-center shrink-0" style={{ color: C.faint }}>{i + 1}</span>
                        <button
                          onClick={() => tapCurrent(i)}
                          className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 active:scale-90 transition-all"
                          style={{
                            background: `${C.primary}15`,
                            border: `1px solid ${C.primary}30`,
                            color: C.primary,
                          }}
                          title="把这一句设到当前播放时间"
                        >
                          ⊙
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="text-[12px] truncate" style={{ color: isActive ? C.primary : C.text, fontWeight: isActive ? 600 : 400 }}>
                            {l.text}
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[9px] tabular-nums" style={{ color: C.muted, fontFamily: 'monospace' }}>{fmt(t)}</span>
                            <button
                              onClick={() => setLineTime(i, t - 0.2)}
                              className="text-[9px] px-1 rounded"
                              style={{ color: C.faint }}
                            >−.2s</button>
                            <button
                              onClick={() => setLineTime(i, t + 0.2)}
                              className="text-[9px] px-1 rounded"
                              style={{ color: C.faint }}
                            >+.2s</button>
                            <button
                              onClick={() => seek(duration > 0 ? t / duration : 0)}
                              className="text-[9px] px-1 rounded ml-auto"
                              style={{ color: C.accent }}
                            >跳到此处</button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {view === 'visit_char' && visitCharId && (
        <CharVisitPage
          charId={visitCharId}
          onBack={() => { setView('profile'); setVisitCharId(null); }}
          onOpenPlayer={() => setView('player')}
        />
      )}
    </div>
  );
};

export default MusicApp;
