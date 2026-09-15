import { useMemo, useState } from 'react';
import { EmptyState } from '../../components/EmptyState';
import { useAppStore } from '../../context/AppStore';
import { getDailyWatchSeconds, getStreakDays } from '../../lib/domain';

type RecordsTab = 'stats' | 'history';
type HistoryEntry = { id: string; videoId: string; effectiveWatchSeconds: number; occurredAt: string };

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfCurrentWeek(date: Date): Date {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const mondayOffset = start.getUTCDay() === 0 ? 6 : start.getUTCDay() - 1;
  start.setUTCDate(start.getUTCDate() - mondayOffset);
  return start;
}

function durationText(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes} 分钟${remainder ? ` ${remainder} 秒` : ''}` : `${remainder} 秒`;
}

function dateText(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function RecordsPage() {
  const { currentChild, currentChildId, snapshot, subjects } = useAppStore();
  const [tab, setTab] = useState<RecordsTab>('stats');
  const now = new Date();
  const today = dateKey(now);
  const weekStart = startOfCurrentWeek(now);

  const childEvents = useMemo(
    () => (currentChildId ? snapshot.watchEvents.filter((event) => event.childId === currentChildId) : []),
    [currentChildId, snapshot.watchEvents],
  );
  const childProgress = useMemo(
    () => (currentChildId ? snapshot.watchProgress.filter((item) => item.childId === currentChildId) : []),
    [currentChildId, snapshot.watchProgress],
  );
  const todaySeconds = currentChildId ? getDailyWatchSeconds(childEvents, currentChildId, today) : 0;
  const completedThisWeek = childProgress.filter((item) => item.completed && Date.parse(item.updatedAt) >= weekStart.getTime() && Date.parse(item.updatedAt) <= now.getTime()).length;
  const streakDays = currentChildId ? getStreakDays(childEvents, currentChildId, now) : 0;
  const trend = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (6 - index)));
    return { date: dateKey(date), seconds: currentChildId ? getDailyWatchSeconds(childEvents, currentChildId, dateKey(date)) : 0 };
  });
  const maxTrendSeconds = Math.max(60, ...trend.map((item) => item.seconds));
  const history = useMemo<HistoryEntry[]>(() => {
    const eventHistory: HistoryEntry[] = childEvents.map((event) => ({ id: event.id, videoId: event.videoId, effectiveWatchSeconds: event.effectiveWatchSeconds, occurredAt: event.occurredAt }));
    const eventVideoIds = new Set(eventHistory.map((item) => item.videoId));
    const progressHistory: HistoryEntry[] = childProgress
      .filter((item) => (item.totalWatchSeconds > 0 || item.lastPositionSeconds > 0) && !eventVideoIds.has(item.videoId))
      .map((item) => ({ id: `progress:${item.childId}:${item.videoId}`, videoId: item.videoId, effectiveWatchSeconds: Math.max(item.totalWatchSeconds, item.lastPositionSeconds), occurredAt: item.updatedAt }));
    return [...eventHistory, ...progressHistory].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  }, [childEvents, childProgress]);

  if (!currentChild || !currentChildId) {
    return <main className="child-page"><EmptyState title="还没有选择孩子" description="先选择一个孩子，再查看学习记录。" /></main>;
  }

  return (
    <main className="child-page records-page">
      <div className="child-page-heading records-heading"><p className="child-kicker">{currentChild.name} 的成长足迹</p><h1>学习记录</h1><p>每一次认真学习，都值得被记住。</p></div>
      <div className="records-tabs" role="tablist" aria-label="学习记录视图">
        <button type="button" role="tab" aria-selected={tab === 'stats'} className={tab === 'stats' ? 'active' : ''} onClick={() => setTab('stats')}>学习统计</button>
        <button type="button" role="tab" aria-selected={tab === 'history'} className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>学习历史</button>
      </div>

      {tab === 'stats' ? (
        <div className="records-stats-panel">
          <section className="records-stat-grid" aria-label="学习统计概览">
            <article className="records-stat-card blue" data-testid="child-records-today"><span>今日学习</span><strong>{Math.round(todaySeconds / 60)} 分钟</strong><small>保持专注，慢慢进步</small></article>
            <article className="records-stat-card green" data-testid="child-records-week"><span>本周完成</span><strong>{completedThisWeek} 个视频</strong><small>完成一段就很棒</small></article>
            <article className="records-stat-card purple" data-testid="child-records-streak"><span>连续学习</span><strong>{streakDays} 天</strong><small>{streakDays ? '学习习惯正在发芽' : '今天开始第一天'}</small></article>
          </section>
          <section className="records-trend-card panel"><div className="records-section-title"><div><h2>近 7 天学习趋势</h2><p>每天累计观看时长</p></div><span className="trend-legend">分钟</span></div><div className="records-trend" data-testid="records-trend" role="img" aria-label="近7天学习趋势">{trend.map((item) => <div className="trend-column" key={item.date}><div className="trend-bar-track"><span className="trend-bar" style={{ height: `${Math.max(item.seconds ? 8 : 2, (item.seconds / maxTrendSeconds) * 100)}%` }} /></div><strong>{Math.round(item.seconds / 60)}</strong><small>{item.date.slice(5).replace('-', '/')}</small></div>)}</div></section>
        </div>
      ) : (
        <section className="records-history panel" data-testid="records-history" aria-label="学习历史列表">
          <div className="records-section-title"><div><h2>学习动态</h2><p>按最近学习时间排列</p></div><span>{history.length} 条</span></div>
          {history.length ? <div className="records-history-list">{history.map((event) => { const video = snapshot.videos.find((item) => item.id === event.videoId); const course = snapshot.courses.find((item) => item.id === video?.courseId); const subject = subjects.find((item) => item.id === course?.subjectId); return <article className="records-history-item" key={event.id}><span className="history-icon">{subject?.icon ?? '✦'}</span><div><strong>{video?.title ?? '一段学习内容'}</strong><small>{course?.title ?? '课程已下架'} · {durationText(event.effectiveWatchSeconds)}</small></div><time dateTime={event.occurredAt}>{dateText(event.occurredAt)}</time></article>; })}</div> : <EmptyState title="今天从喜欢的课程开始吧" description="完成一小段学习后，你的足迹会出现在这里。" />}
        </section>
      )}
    </main>
  );
}
