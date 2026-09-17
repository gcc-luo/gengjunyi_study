import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { EmptyState } from '../../components/EmptyState';
import { useAppStore } from '../../context/AppStore';
import { getLocalDateKey, getStreakDays, isWithinLocalWeek } from '../../lib/domain';
import { apiRequest } from '../../lib/api-client';
import { type WatchEvent } from '../../types/domain';

const keyOf = (date: Date) => getLocalDateKey(date);
const dayText = (date: Date) => date.toLocaleDateString('zh-CN', { weekday: 'short' });
const durationText = (seconds: number) => seconds > 0 && seconds < 60 ? `${Math.round(seconds)} 秒` : `${Math.round(seconds / 60)} 分钟`;

export function RecordsPage() {
  const { snapshot, subjects, isRemote } = useAppStore(); const params = new URLSearchParams(window.location.search);
  const [childId, setChildId] = useState(params.get('child') ?? ''); const [range, setRange] = useState('7'); const [subjectId, setSubjectId] = useState('');
  const now = new Date(); const today = keyOf(now); const rangeDays = range === 'today' ? 0 : range === '7' ? 6 : range === '30' ? 29 : undefined; const rangeStart = rangeDays === undefined ? undefined : new Date(now.getFullYear(), now.getMonth(), now.getDate() - rangeDays); const rangeStartKey = rangeStart ? keyOf(rangeStart) : '0000-00-00'; const rangeEnd = rangeDays === undefined ? undefined : new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const recordsQuery = useQuery({
    queryKey: ['parent', 'records', { childId, range, subjectId }],
    enabled: isRemote,
    queryFn: async () => {
      type Item = { id: string; childId: string; videoId: string; effectiveWatchSeconds: number; occurredAt: string; progress: { maxProgressPercent: number; positionMs: number; completed: boolean } | null };
      type Result = { total: number; items: Item[] };
      const params = new URLSearchParams({ limit: '500', offset: '0' });
      if (childId) params.set('childId', childId);
      if (subjectId) params.set('subjectId', subjectId);
      if (rangeStart) params.set('from', rangeStart.toISOString());
      if (rangeEnd) params.set('to', rangeEnd.toISOString());
      const first = await apiRequest<Result>(`/api/records?${params}`);
      const items = [...first.items];
      for (let offset = 500; offset < first.total; offset += 500) {
        params.set('offset', String(offset));
        const page = await apiRequest<Result>(`/api/records?${params}`);
        items.push(...page.items);
        if (!page.items.length) break;
      }
      return { total: first.total, items };
    },
  });
  const recordsSnapshot = useMemo(() => {
    if (!isRemote || !recordsQuery.data) return snapshot;
    const items = recordsQuery.data.items;
    return {
      ...snapshot,
      watchEvents: items.map((event) => ({ id: event.id, childId: event.childId, videoId: event.videoId, effectiveWatchSeconds: event.effectiveWatchSeconds, occurredAt: event.occurredAt })),
      watchProgress: items.flatMap((event) => event.progress ? [{ childId: event.childId, videoId: event.videoId, lastPositionSeconds: event.progress.positionMs / 1000, maxProgress: event.progress.maxProgressPercent / 100, completed: event.progress.completed, totalWatchSeconds: 0, updatedAt: event.occurredAt }] : []),
    };
  }, [snapshot, isRemote, recordsQuery.data]);
  const filtered = useMemo(() => recordsSnapshot.watchEvents.filter((event) => (!childId || event.childId === childId) && (!subjectId || recordsSnapshot.courses.some((course) => course.id === recordsSnapshot.videos.find((video) => video.id === event.videoId)?.courseId && course.subjectId === subjectId)) && keyOf(new Date(event.occurredAt)) >= rangeStartKey), [recordsSnapshot, childId, subjectId, rangeStartKey]);
  const todaySeconds = filtered.filter((event) => keyOf(new Date(event.occurredAt)) === today).reduce((sum, event) => sum + event.effectiveWatchSeconds, 0);
  const selectedChildIds = childId ? [childId] : snapshot.children.filter((child) => child.status === 'ACTIVE').map((child) => child.id);
  const weekCompleted = recordsSnapshot.watchProgress.filter((progress) => { const video = recordsSnapshot.videos.find((item) => item.id === progress.videoId); const course = recordsSnapshot.courses.find((item) => item.id === video?.courseId); return selectedChildIds.includes(progress.childId) && progress.completed && isWithinLocalWeek(progress.updatedAt, now) && (!subjectId || course?.subjectId === subjectId); }).length;
  const streak = childId ? getStreakDays(filtered, childId, now) : Math.max(0, ...selectedChildIds.map((id) => getStreakDays(filtered, id, now)));
  const days = Array.from({ length: 7 }, (_, index) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - (6 - index)));
  const maxSeconds = Math.max(60, ...days.map((date) => filtered.filter((event) => keyOf(new Date(event.occurredAt)) === keyOf(date)).reduce((sum, event) => sum + event.effectiveWatchSeconds, 0)));
  const eventInfo = (event: WatchEvent) => { const video = recordsSnapshot.videos.find((item) => item.id === event.videoId); const course = recordsSnapshot.courses.find((item) => item.id === video?.courseId); const child = recordsSnapshot.children.find((item) => item.id === event.childId); const progress = recordsSnapshot.watchProgress.find((item) => item.childId === event.childId && item.videoId === event.videoId); return { video, course, child, progress }; };
  return <div className="parent-page"><div className="page-heading"><div><p className="eyebrow">学习反馈</p><h1>学习记录</h1><p className="page-subtitle">用同一组筛选查看统计与每一条观看明细。</p></div></div>{recordsQuery.isFetching && isRemote && <p role="status">正在读取筛选后的学习记录…</p>}{recordsQuery.error && <p className="form-error" role="alert">读取学习记录失败：{recordsQuery.error instanceof Error ? recordsQuery.error.message : '请求失败'} <button type="button" onClick={() => void recordsQuery.refetch()}>重试</button></p>}<div className="filter-bar records-filters"><label>孩子<select aria-label="孩子筛选" value={childId} onChange={(event) => setChildId(event.target.value)}><option value="">全部孩子</option>{snapshot.children.map((child) => <option value={child.id} key={child.id}>{child.name}</option>)}</select></label><label>时间范围<select aria-label="时间范围" value={range} onChange={(event) => setRange(event.target.value)}><option value="today">今天</option><option value="7">近 7 天</option><option value="30">近 30 天</option><option value="all">全部时间</option></select></label><label>学科<select aria-label="学科筛选" value={subjectId} onChange={(event) => setSubjectId(event.target.value)}><option value="">全部学科</option>{subjects.map((subject) => <option value={subject.id} key={subject.id}>{subject.name}</option>)}</select></label></div><section className="metric-grid compact"><div className="metric-card" data-testid="records-today"><strong>{durationText(todaySeconds)}</strong><span>今日学习</span></div><div className="metric-card" data-testid="records-week-completed"><strong>{weekCompleted}</strong><span>本周完成视频</span></div><div className="metric-card" data-testid="records-streak"><strong>{streak}</strong><span>连续学习天数</span></div></section><section className="panel"><div className="panel-heading"><div><h2>近 7 天趋势</h2><p>有效学习时长</p></div></div>{filtered.length ? <div className="bar-chart records-chart">{days.map((date) => { const seconds = filtered.filter((event) => keyOf(new Date(event.occurredAt)) === keyOf(date)).reduce((sum, event) => sum + event.effectiveWatchSeconds, 0); return <div className="bar-group" key={keyOf(date)}><div className="bars"><span className="bar single" style={{ height: `${Math.max(4, seconds / maxSeconds * 100)}%` }} title={`${durationText(seconds)}`} /></div><small>{dayText(date)}</small></div>; })}</div> : <EmptyState title="还没有学习记录" description="调整筛选条件，或让孩子先观看一段视频。" />}</section><section className="panel"><div className="panel-heading"><div><h2>观看明细</h2><p>{filtered.length}{isRemote && recordsQuery.data && recordsQuery.data.total > filtered.length ? ` / ${recordsQuery.data.total}` : ''} 条记录</p></div></div>{filtered.length ? <div className="table-panel embedded"><table><thead><tr><th>孩子</th><th>课程 / 视频</th><th>学科</th><th>完成进度</th><th>状态</th><th>有效时长</th><th>观看时间</th></tr></thead><tbody>{[...filtered].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).map((event) => { const { child, course, video, progress } = eventInfo(event); return <tr key={event.id}><td>{child?.name ?? '未知孩子'}</td><td><strong>{video?.title ?? '视频'}</strong><small>{course?.title ?? '未知课程'}</small></td><td>{subjects.find((item) => item.id === course?.subjectId)?.name ?? '—'}</td><td>{progress ? `${Math.round(progress.maxProgress * 100)}%` : '—'}</td><td><span className={`record-state ${progress?.completed ? 'complete' : 'learning'}`}>{progress?.completed ? '已完成' : '学习中'}</span></td><td>{durationText(event.effectiveWatchSeconds)}</td><td>{new Date(event.occurredAt).toLocaleString('zh-CN')}</td></tr>; })}</tbody></table></div> : <EmptyState title="没有符合筛选条件的明细" description="换一个孩子、时间范围或学科试试。" />}</section></div>;
}
