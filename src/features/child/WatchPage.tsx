import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { EmptyState } from '../../components/EmptyState';
import { Icon } from '../../components/Icon';
import { useAppStore } from '../../context/AppStore';
import { naturalCompare } from '../../lib/domain';
import { apiRequest } from '../../lib/api-client';
import { CourseStatus, VideoStatus, type Video } from '../../types/domain';

const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2];
const MAX_PLAYBACK_RENEWAL_LEAD_MS = 5 * 60 * 1000;

function playbackRenewalDelayMs(expiresInSeconds: number): number {
  const lifetimeMs = Math.max(0, expiresInSeconds * 1000);
  const leadMs = Math.min(MAX_PLAYBACK_RENEWAL_LEAD_MS, Math.max(1_000, lifetimeMs * 0.1));
  return Math.max(1_000, lifetimeMs - leadMs);
}

function clampPosition(value: number, duration: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(0, value), Math.max(0, duration));
}

function formatTime(value: number): string {
  const seconds = Math.max(0, Math.floor(value));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function orderVideos(courseVideoIds: string[], videos: Video[]): Video[] {
  return courseVideoIds
    .map((id) => videos.find((video) => video.id === id))
    .filter((video): video is Video => Boolean(video && video.status === VideoStatus.READY))
    .sort((a, b) => a.orderIndex - b.orderIndex || naturalCompare(a.title, b.title));
}

type FullscreenElement = HTMLDivElement & { webkitRequestFullscreen?: () => void | Promise<void> };
type FullscreenDocument = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void | Promise<void> };
type PendingProgressSave = {
  childId: string;
  videoId: string;
  lastPositionSeconds: number;
  progress: number;
  deltaWatchSeconds: number;
  isPlaying: boolean;
  eventType?: 'PROGRESS' | 'PLAY' | 'PAUSE' | 'SEEK' | 'ENDED';
  updatedAt: string;
};
type SyncState = 'idle' | 'saving' | 'synced' | 'error';

export function WatchPage() {
  const { videoId } = useParams();
  const navigate = useNavigate();
  const { currentChildId, childCourses: courses, childVideos: videos, snapshot, saveWatchProgress, favorites, toggleFavorite, isRemote } = useAppStore();
  const video = videos.find((item) => item.id === videoId);
  const course = video ? courses.find((item) => item.id === video.courseId) : undefined;
  const orderedVideos = useMemo(() => course ? orderVideos(course.videoIds, videos) : [], [course, videos]);
  const currentIndex = video ? orderedVideos.findIndex((item) => item.id === video.id) : -1;
  const duration = video?.durationSeconds ?? 0;
  const initialProgress = snapshot.watchProgress.find((item) => item.childId === currentChildId && item.videoId === videoId);
  const playbackQuery = useQuery({
    queryKey: ['child', currentChildId, 'playback', videoId],
    queryFn: () => apiRequest<{ url: string; expiresInSeconds: number }>(`/api/videos/${encodeURIComponent(videoId!)}/playback`, { method: 'POST' }),
    enabled: isRemote && Boolean(currentChildId && video && course?.status === CourseStatus.PUBLISHED && video.status === VideoStatus.READY),
    staleTime: 90 * 60 * 1000,
    retry: false,
  });

  const [isPlaying, setIsPlaying] = useState(false);
  const [positionSeconds, setPositionSeconds] = useState(() => clampPosition(initialProgress?.lastPositionSeconds ?? 0, duration));
  const [playbackRate, setPlaybackRate] = useState(1);
  const [lastHeartbeatAt, setLastHeartbeatAt] = useState(() => initialProgress ? Date.parse(initialProgress.updatedAt) || 0 : 0);
  const [syncState, setSyncState] = useState<SyncState>(initialProgress ? 'synced' : 'idle');
  const [syncError, setSyncError] = useState('');
  const [fullscreenMessage, setFullscreenMessage] = useState('');
  const [mediaFailed, setMediaFailed] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [bufferingPosition, setBufferingPosition] = useState<number | null>(null);
  const [showCompletion, setShowCompletion] = useState(false);

  const isMountedRef = useRef(false);
  const isPlayingRef = useRef(isPlaying);
  const positionRef = useRef(positionSeconds);
  const playbackRateRef = useRef(playbackRate);
  const pendingWatchSecondsRef = useRef(0);
  const dirtyRef = useRef(false);
  const playerScreenRef = useRef<FullscreenElement>(null);
  const videoElementRef = useRef<HTMLVideoElement>(null);
  const playbackResumeRef = useRef<{ position: number; wasPlaying: boolean } | null>(null);
  const pendingSeekPositionRef = useRef<number | null>(null);
  const seekWasPlayingRef = useRef<boolean | null>(null);
  const renewedPlaybackRef = useRef(false);
  const videoIdRef = useRef(videoId ?? '');
  const childIdRef = useRef(currentChildId);
  const durationRef = useRef(duration);
  const saveWatchProgressRef = useRef(saveWatchProgress);
  const syncQueueRef = useRef<PendingProgressSave[]>([]);
  const syncingRef = useRef(false);
  const initializedRouteRef = useRef(`${currentChildId ?? ''}:${videoId ?? ''}`);
  const [isFullscreen, setIsFullscreen] = useState(false);

  isPlayingRef.current = isPlaying;
  positionRef.current = positionSeconds;
  playbackRateRef.current = playbackRate;
  saveWatchProgressRef.current = saveWatchProgress;

  const drainSyncQueue = useCallback(async () => {
    if (syncingRef.current || syncQueueRef.current.length === 0) return;
    syncingRef.current = true;
    if (isMountedRef.current) { setSyncState('saving'); setSyncError(''); }
    while (syncQueueRef.current.length > 0) {
      const pending = syncQueueRef.current[0];
      try {
        const saveResult = saveWatchProgressRef.current(pending);
        if (saveResult && typeof (saveResult as Promise<unknown>).then === 'function') await saveResult;
        syncQueueRef.current.shift();
        if (isMountedRef.current) {
          setLastHeartbeatAt(Date.now());
          setSyncState(syncQueueRef.current.length > 0 ? 'saving' : 'synced');
          setSyncError('');
        }
      } catch (cause) {
        if (isMountedRef.current) {
          setSyncState('error');
          setSyncError(cause instanceof Error ? cause.message : '进度保存失败，请重试');
        }
        break;
      }
    }
    syncingRef.current = false;
  }, []);

  const persistProgress = useCallback((position: number, deltaWatchSeconds: number, playing: boolean, force = false, eventType?: 'PROGRESS' | 'PLAY' | 'PAUSE' | 'SEEK' | 'ENDED') => {
    const childId = childIdRef.current;
    const currentVideoId = videoIdRef.current;
    const currentDuration = durationRef.current;
    if (!childId || !currentVideoId || currentDuration <= 0 || (!force && !dirtyRef.current && deltaWatchSeconds <= 0)) return false;
    const safePosition = clampPosition(position, currentDuration);
    syncQueueRef.current.push({
      childId,
      videoId: currentVideoId,
      lastPositionSeconds: safePosition,
      progress: safePosition / currentDuration,
      deltaWatchSeconds: Math.max(0, deltaWatchSeconds),
      isPlaying: playing,
      eventType,
      updatedAt: new Date().toISOString(),
    });
    dirtyRef.current = false;
    void drainSyncQueue();
    return true;
  }, [drainSyncQueue]);

  const handleMediaTimeUpdate = (media: HTMLVideoElement) => {
    const safePosition = clampPosition(media.currentTime, durationRef.current);
    positionRef.current = safePosition;
    setPositionSeconds(safePosition);
    dirtyRef.current = true;
  };

  const handleMediaSeeking = (media: HTMLVideoElement) => {
    const target = clampPosition(media.currentTime, durationRef.current);
    pendingSeekPositionRef.current = target;
    seekWasPlayingRef.current = isPlayingRef.current;
    positionRef.current = target;
    setPositionSeconds(target);
    setIsBuffering(true);
    setBufferingPosition(target);
    dirtyRef.current = true;
  };

  const handleMediaSeeked = (media: HTMLVideoElement) => {
    const shouldResume = seekWasPlayingRef.current === true && !media.ended;
    persistProgress(positionRef.current, 0, shouldResume, true, 'SEEK');
    pendingSeekPositionRef.current = null;
    seekWasPlayingRef.current = null;
    if (media.readyState >= 3) {
      setIsBuffering(false);
      setBufferingPosition(null);
    }
    if (shouldResume && media.paused) {
      void media.play().catch(() => setFullscreenMessage(`已定位到 ${formatTime(positionRef.current)}，请点击视频继续播放。`));
    }
  };

  const handleMediaPlay = () => {
    setShowCompletion(false);
    setIsBuffering(false);
    setBufferingPosition(null);
    isPlayingRef.current = true;
    setIsPlaying(true);
    persistProgress(positionRef.current, 0, true, true, 'PLAY');
  };

  const handleMediaPause = () => {
    if (isPlayingRef.current) flushProgress(false, 'PAUSE');
    isPlayingRef.current = false;
    setIsPlaying(false);
  };

  const handleMediaEnded = () => {
    const media = videoElementRef.current;
    if (!media) return;
    const endPosition = clampPosition(media.duration, durationRef.current);
    positionRef.current = endPosition;
    setPositionSeconds(endPosition);
    persistProgress(endPosition, pendingWatchSecondsRef.current, false, true, 'ENDED');
    pendingWatchSecondsRef.current = 0;
    isPlayingRef.current = false;
    setIsPlaying(false);
    setShowCompletion(true);
  };

  const handleMediaWaiting = (media: HTMLVideoElement) => {
    setIsBuffering(true);
    setBufferingPosition(clampPosition(media.currentTime, durationRef.current));
  };

  const handleMediaCanPlay = () => {
    setIsBuffering(false);
    setBufferingPosition(null);
  };

  const renewPlaybackUrl = (manual = false) => {
    if (manual) renewedPlaybackRef.current = false;
    if (renewedPlaybackRef.current) {
      setMediaFailed(true);
      setFullscreenMessage('视频连接仍未恢复，请检查网络后重试。');
      return;
    }
    const media = videoElementRef.current;
    const mediaPosition = media?.currentTime;
    const resumePosition = pendingSeekPositionRef.current ?? (mediaPosition && mediaPosition > 0 ? mediaPosition : positionRef.current);
    playbackResumeRef.current = {
      position: clampPosition(resumePosition, durationRef.current),
      wasPlaying: (seekWasPlayingRef.current ?? isPlayingRef.current) && !media?.ended,
    };
    renewedPlaybackRef.current = true;
    setMediaFailed(false);
    setIsBuffering(true);
    setBufferingPosition(resumePosition);
    setFullscreenMessage(`正在加载 ${formatTime(resumePosition)}，稍候将从该位置继续…`);
    const previousUrl = playbackQuery.data?.url;
    void playbackQuery.refetch().then(({ data, error }) => {
      if (error || !data?.url || data.url === previousUrl) {
        setMediaFailed(true);
        setFullscreenMessage('未能建立新的视频连接，请检查网络后重试。');
      }
    });
  };

  useEffect(() => {
    const playback = playbackQuery.data;
    if (!isRemote || !playback?.url || !Number.isFinite(playback.expiresInSeconds) || playback.expiresInSeconds <= 0) return;
    const timer = window.setTimeout(() => renewPlaybackUrl(), playbackRenewalDelayMs(playback.expiresInSeconds));
    return () => window.clearTimeout(timer);
  }, [isRemote, playbackQuery.data?.expiresInSeconds, playbackQuery.data?.url, playbackQuery.dataUpdatedAt]);

  const flushProgress = useCallback((playing = isPlayingRef.current, eventType?: 'PROGRESS' | 'PLAY' | 'PAUSE' | 'SEEK' | 'ENDED') => {
    const pending = pendingWatchSecondsRef.current;
    persistProgress(positionRef.current, pending, playing, false, eventType);
    pendingWatchSecondsRef.current = 0;
  }, [persistProgress]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      flushProgress(isPlayingRef.current);
    };
  }, [flushProgress]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) return;
      if (isPlayingRef.current) {
        flushProgress(true);
        videoElementRef.current?.pause();
        isPlayingRef.current = false;
        setIsPlaying(false);
      } else {
        flushProgress(false);
      }
    };
    const flushOnPageExit = () => flushProgress(isPlayingRef.current);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', flushOnPageExit);
    window.addEventListener('beforeunload', flushOnPageExit);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', flushOnPageExit);
      window.removeEventListener('beforeunload', flushOnPageExit);
    };
  }, [flushProgress]);

  useEffect(() => {
    const syncFullscreenState = () => {
      const fullscreenDocument = document as FullscreenDocument;
      setIsFullscreen(fullscreenDocument.fullscreenElement === playerScreenRef.current || fullscreenDocument.webkitFullscreenElement === playerScreenRef.current);
    };
    document.addEventListener('fullscreenchange', syncFullscreenState);
    document.addEventListener('webkitfullscreenchange', syncFullscreenState);
    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreenState);
      document.removeEventListener('webkitfullscreenchange', syncFullscreenState);
    };
  }, []);

  useEffect(() => {
    const routeKey = `${currentChildId ?? ''}:${videoId ?? ''}`;
    if (routeKey === initializedRouteRef.current) return;
    videoElementRef.current?.pause();
    playbackResumeRef.current = null;
    pendingSeekPositionRef.current = null;
    seekWasPlayingRef.current = null;
    renewedPlaybackRef.current = false;
    setMediaFailed(false);
    setShowCompletion(false);
    if (childIdRef.current === currentChildId) flushProgress(isPlayingRef.current);
    else {
      pendingWatchSecondsRef.current = 0;
      dirtyRef.current = false;
    }
    isPlayingRef.current = false;
    setIsPlaying(false);
    videoIdRef.current = videoId ?? '';
    childIdRef.current = currentChildId;
    const nextVideo = videos.find((item) => item.id === videoId);
    const nextDuration = nextVideo?.durationSeconds ?? 0;
    const nextProgress = snapshot.watchProgress.find((item) => item.childId === currentChildId && item.videoId === videoId);
    const nextPosition = clampPosition(nextProgress?.lastPositionSeconds ?? 0, nextDuration);
    durationRef.current = nextDuration;
    positionRef.current = nextPosition;
    pendingWatchSecondsRef.current = 0;
    dirtyRef.current = false;
    setPositionSeconds(nextPosition);
    setLastHeartbeatAt(nextProgress ? Date.parse(nextProgress.updatedAt) || 0 : 0);
    setSyncState(nextProgress ? 'synced' : 'idle');
    setSyncError('');
    initializedRouteRef.current = routeKey;
  }, [currentChildId, flushProgress, snapshot.watchProgress, videoId, videos]);

  useEffect(() => {
    durationRef.current = duration;
    const safePosition = clampPosition(positionRef.current, duration);
    if (safePosition !== positionRef.current) {
      positionRef.current = safePosition;
      setPositionSeconds(safePosition);
      dirtyRef.current = true;
    }
  }, [duration, videoId]);

  useEffect(() => {
    if (!isPlaying || !video) return;
    const timer = window.setInterval(() => {
      if (!isPlayingRef.current || durationRef.current <= 0) return;
      if (isRemote) {
        const media = videoElementRef.current;
        if (!media || media.paused) return;
        const livePosition = clampPosition(media.currentTime, durationRef.current);
        positionRef.current = livePosition;
        setPositionSeconds(livePosition);
        pendingWatchSecondsRef.current += 1;
        dirtyRef.current = true;
        if (pendingWatchSecondsRef.current >= 10) {
          pendingWatchSecondsRef.current -= 10;
          persistProgress(livePosition, 10, true, true);
        }
        return;
      }
      const nextPosition = clampPosition(positionRef.current + playbackRateRef.current, durationRef.current);
      positionRef.current = nextPosition;
      setPositionSeconds(nextPosition);
      dirtyRef.current = true;
      pendingWatchSecondsRef.current += 1;

      const completed = nextPosition >= durationRef.current || nextPosition / durationRef.current >= 0.9;
      if (completed) {
        flushProgress(true);
        isPlayingRef.current = false;
        setIsPlaying(false);
        setShowCompletion(true);
      } else if (pendingWatchSecondsRef.current >= 10) {
        pendingWatchSecondsRef.current -= 10;
        persistProgress(nextPosition, 10, true, true);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isPlaying, isRemote, persistProgress, videoId]);

  const seekTo = (nextPosition: number) => {
    const safePosition = clampPosition(nextPosition, duration);
    const completes = duration > 0 && (safePosition >= duration || safePosition / duration >= 0.9);
    positionRef.current = safePosition;
    setPositionSeconds(safePosition);
    dirtyRef.current = true;
    if (!completes) setShowCompletion(false);
    if (isRemote && videoElementRef.current) videoElementRef.current.currentTime = safePosition;
    if (completes) {
      persistProgress(safePosition, pendingWatchSecondsRef.current, isPlayingRef.current, true);
      pendingWatchSecondsRef.current = 0;
      isPlayingRef.current = false;
      setIsPlaying(false);
    }
  };

  const togglePlay = () => {
    if (!video || duration <= 0) return;
    if (isRemote) {
      const media = videoElementRef.current;
      if (!media) return;
      if (media.paused) void media.play().catch(() => setFullscreenMessage('播放失败，请确认视频格式与网络连接'));
      else media.pause();
      return;
    }
    if (isPlayingRef.current) {
      isPlayingRef.current = false;
      flushProgress(false, 'PAUSE');
      setIsPlaying(false);
    } else {
      isPlayingRef.current = true;
      setIsPlaying(true);
    }
  };

  const navigateToVideo = (nextVideo: Video | undefined) => {
    if (!nextVideo) return;
    flushProgress(isPlayingRef.current);
    isPlayingRef.current = false;
    setIsPlaying(false);
    navigate(`/child/watch/${nextVideo.id}`);
  };

  const replayVideo = () => {
    setShowCompletion(false);
    pendingWatchSecondsRef.current = 0;
    positionRef.current = 0;
    setPositionSeconds(0);
    dirtyRef.current = true;
    const media = videoElementRef.current;
    if (isRemote && media) {
      media.currentTime = 0;
      void media.play().catch(() => setFullscreenMessage('已回到开头，请点击视频继续播放。'));
      return;
    }
    isPlayingRef.current = true;
    setIsPlaying(true);
  };

  const handleBack = () => {
    flushProgress(isPlayingRef.current);
    navigate(course ? `/child/course/${course.id}` : '/child/courses');
  };

  const requestFullscreen = () => {
    const playerScreen = playerScreenRef.current;
    const fullscreenDocument = document as FullscreenDocument;
    if (isFullscreen) {
      const exitFullscreen = fullscreenDocument.exitFullscreen ?? fullscreenDocument.webkitExitFullscreen;
      if (!exitFullscreen) {
        setIsFullscreen(false);
        return;
      }
      try {
        const result = exitFullscreen.call(fullscreenDocument);
        if (result && typeof (result as Promise<void>).then === 'function') {
          void (result as Promise<void>).then(() => setIsFullscreen(false), () => setFullscreenMessage('退出全屏暂时不可用'));
        } else {
          setIsFullscreen(false);
        }
      } catch {
        setFullscreenMessage('退出全屏暂时不可用');
      }
      return;
    }
    const enterFullscreen = playerScreen?.requestFullscreen ?? playerScreen?.webkitRequestFullscreen;
    if (!playerScreen || !enterFullscreen) {
      setFullscreenMessage('当前环境不支持全屏播放');
      return;
    }
    setFullscreenMessage('');
    try {
      const result = enterFullscreen.call(playerScreen);
      if (result && typeof (result as Promise<void>).then === 'function') {
        void (result as Promise<void>).then(() => setIsFullscreen(true), () => setFullscreenMessage('全屏播放暂时不可用'));
      } else {
        setIsFullscreen(true);
      }
    } catch {
      setFullscreenMessage('全屏播放暂时不可用');
    }
  };

  if (!currentChildId) {
    return <main className="child-page"><EmptyState title="先选择一个孩子" description="选择头像后，就能保存专属学习进度。" action={<Link className="button primary" to="/child/select">去选择孩子</Link>} /></main>;
  }
  if (!video) {
    return <main className="child-page"><EmptyState title="视频不存在" description="这个视频可能已被移除，去课程中心看看其他内容吧。" action={<Link className="button primary" to="/child/courses">返回课程</Link>} /></main>;
  }
  if (!course) {
    return <main className="child-page"><EmptyState title="所属课程不存在" description="暂时无法找到这个视频所属的课程。" action={<Link className="button primary" to="/child/courses">返回课程</Link>} /></main>;
  }
  if (course.status !== CourseStatus.PUBLISHED) {
    return <main className="child-page"><EmptyState title="课程已下架" description="这门课程暂时不可观看，但历史学习记录仍会保留。" action={<Link className="button primary" to="/child/courses">返回课程</Link>} /></main>;
  }
  if (video.status !== VideoStatus.READY) {
    return <main className="child-page"><EmptyState title="暂不可播放" description="视频还没有准备好，请稍后再试或返回课程目录。" action={<Link className="button primary" to={`/child/course/${course.id}`}>返回课程目录</Link>} /></main>;
  }

  const previousVideo = currentIndex > 0 ? orderedVideos[currentIndex - 1] : undefined;
  const nextVideo = currentIndex >= 0 ? orderedVideos[currentIndex + 1] : undefined;
  const isFavorite = favorites.some((item) => item.videoId === video.id);
  const percent = duration > 0 ? Math.round(positionSeconds / duration * 100) : 0;
  const syncText = syncState === 'saving'
    ? '正在保存…'
    : syncState === 'error'
      ? `未同步：${syncError}`
      : lastHeartbeatAt
        ? `已同步 ${new Date(lastHeartbeatAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
        : '尚未同步';
  const completionGuide = showCompletion ? <div className="watch-completion" role="dialog" aria-label="本集完成" aria-modal="false">
    <span aria-hidden="true">★</span>
    <strong>本集完成</strong>
    <p>很棒！休息一下，再决定接下来做什么。</p>
    <div><button type="button" onClick={replayVideo}>重看本集</button>{nextVideo ? <button type="button" className="primary" onClick={() => navigateToVideo(nextVideo)}>播放下一集</button> : <button type="button" className="primary" onClick={handleBack}>返回课程</button>}</div>
  </div> : null;

  return <main className="child-page watch-page">
    <div className="watch-topline"><button className="watch-back" type="button" onClick={handleBack}>← 返回课程</button><span className="watch-course-label">{course.title} · 第 {Math.max(1, currentIndex + 1)} 集</span><button className={`watch-favorite${isFavorite ? ' active' : ''}`} type="button" aria-pressed={isFavorite} onClick={() => toggleFavorite({ videoId: video.id })}>{isFavorite ? '★ 已收藏' : '☆ 收藏'}</button></div>
    <section className="watch-player" aria-label={isRemote ? '视频播放器' : '演示播放器'}>
      {isRemote ? <div ref={playerScreenRef} className="watch-screen watch-screen-live" data-testid="watch-screen">
        {playbackQuery.isLoading && <p role="status">正在获取安全播放地址…</p>}
        {playbackQuery.error && <div className="watch-media-error"><p role="alert">{playbackQuery.error instanceof Error ? playbackQuery.error.message : '暂时无法获取视频，请检查网络后重试。'}</p><button type="button" onClick={() => void playbackQuery.refetch()}>重试</button></div>}
        {playbackQuery.data?.url && <video key={video.id} ref={videoElementRef} className="watch-video" aria-label="视频播放器" src={playbackQuery.data.url} controls playsInline preload="metadata" onLoadedMetadata={(event) => {
          const media = event.currentTarget;
          if (Number.isFinite(media.duration) && media.duration > 0) durationRef.current = media.duration;
          const renewedPlayback = playbackResumeRef.current;
          const resumeAt = clampPosition(renewedPlayback?.position ?? pendingSeekPositionRef.current ?? initialProgress?.lastPositionSeconds ?? positionRef.current, media.duration || durationRef.current);
          media.currentTime = resumeAt;
          positionRef.current = resumeAt;
          setPositionSeconds(resumeAt);
          media.playbackRate = playbackRateRef.current;
          if (renewedPlayback) {
            playbackResumeRef.current = null;
            pendingSeekPositionRef.current = null;
            seekWasPlayingRef.current = null;
            renewedPlaybackRef.current = false;
            setMediaFailed(false);
            setFullscreenMessage('');
            if (renewedPlayback.wasPlaying) void media.play().catch(() => setFullscreenMessage('已恢复播放位置，请点击视频继续播放。'));
          }
        }} onSeeking={(event) => handleMediaSeeking(event.currentTarget)} onSeeked={(event) => handleMediaSeeked(event.currentTarget)} onWaiting={(event) => handleMediaWaiting(event.currentTarget)} onCanPlay={handleMediaCanPlay} onTimeUpdate={(event) => handleMediaTimeUpdate(event.currentTarget)} onPlay={handleMediaPlay} onPause={handleMediaPause} onEnded={handleMediaEnded} onError={() => renewPlaybackUrl()} />}
        {(isBuffering || playbackQuery.isLoading) && <div className="watch-buffering" data-testid="watch-buffering" role="status"><span className="watch-buffering-spinner" aria-hidden="true" />正在加载 {formatTime(bufferingPosition ?? positionSeconds)}…</div>}
        {mediaFailed && <button className="watch-media-retry" type="button" onClick={() => renewPlaybackUrl(true)}>重新连接视频</button>}
        <button className="watch-fullscreen" type="button" aria-label={isFullscreen ? '退出全屏' : '全屏'} onClick={requestFullscreen}>⛶</button>
        {fullscreenMessage && <span className="watch-fullscreen-message" role="status">{fullscreenMessage}</span>}
        {completionGuide}
      </div> : <>
        <div ref={playerScreenRef} className="watch-screen" data-testid="watch-screen"><div className="watch-screen-orbit">✦</div><div className="watch-screen-play" data-testid="watch-screen-play">{isPlaying ? 'Ⅱ' : '▶'}</div><span className="watch-demo-badge">演示播放</span><button className="watch-fullscreen" type="button" aria-label={isFullscreen ? '退出全屏' : '全屏'} onClick={requestFullscreen}>⛶</button>{fullscreenMessage && <span className="watch-fullscreen-message" role="status">{fullscreenMessage}</span>}{completionGuide}<p>没有真实媒体地址 · 使用学习时钟体验</p></div>
        <div className="watch-controls">
        <div className="watch-time-row"><span data-testid="watch-position">{formatTime(positionSeconds)}</span><input aria-label="播放进度" type="range" min="0" max={duration} step="0.1" value={positionSeconds} onChange={(event) => seekTo(Number(event.target.value))} /><span>{formatTime(duration)}</span></div>
        <div className="watch-main-controls"><button className="watch-skip" type="button" onClick={() => seekTo(positionSeconds - 10)} aria-label="快退10秒">↶ <span>10</span></button><button className="watch-play-button" type="button" onClick={togglePlay} aria-label={isPlaying ? '暂停' : '播放'}>{isPlaying ? 'Ⅱ' : <Icon name="play" size={22} />}</button><button className="watch-skip" type="button" onClick={() => seekTo(positionSeconds + 10)} aria-label="快进10秒">↷ <span>10</span></button><label className="watch-rate">倍速<select aria-label="播放倍速" value={playbackRate} onChange={(event) => { const rate = Number(event.target.value); setPlaybackRate(rate); if (videoElementRef.current) videoElementRef.current.playbackRate = rate; }}>{PLAYBACK_RATES.map((rate) => <option value={rate} key={rate}>{rate.toFixed(rate === 1 ? 1 : 2)}x</option>)}</select></label></div>
        </div>
      </>}
    </section>
    <section className="watch-info"><div><p className="child-kicker">正在学习 · {percent}%</p><h1>{video.title}</h1><p className={`watch-sync${syncState === 'error' ? ' error' : ''}`} role={syncState === 'error' ? 'alert' : 'status'}>进度会自动保存 · {syncText}{syncState === 'error' && <button type="button" onClick={() => void drainSyncQueue()}>重试同步</button>}</p></div><div className="watch-progress-pill"><strong>{percent}%</strong><span>本集进度</span></div></section>
    <div className="watch-navigation"><button type="button" onClick={() => navigateToVideo(previousVideo)} disabled={!previousVideo}>← 上一集</button><span>{Math.max(1, currentIndex + 1)} / {orderedVideos.length}</span><button type="button" onClick={() => navigateToVideo(nextVideo)} disabled={!nextVideo}>下一集 →</button></div>
    <p className="watch-tip">看完 90% 就算完成，随时可以拖动时间轴回看。</p>
  </main>;
}
