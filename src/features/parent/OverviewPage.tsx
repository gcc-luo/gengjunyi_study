import { Link } from 'react-router-dom';
import { EmptyState } from '../../components/EmptyState';
import { ProgressBar } from '../../components/ProgressBar';
import { useAppStore } from '../../context/AppStore';
import { getDailyWatchSeconds } from '../../lib/domain';

const dayLabel = (date: Date) => date.toLocaleDateString('zh-CN', { weekday: 'short', timeZone: 'UTC' }).replace('周', '周');
const dateKey = (date: Date) => date.toISOString().slice(0, 10);
const dateText = (iso: string) => new Date(iso).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });

export function OverviewPage() {
  const { snapshot, subjects } = useAppStore();
  const today = dateKey(new Date());
  const readyVideos = snapshot.videos.filter((video) => video.status === 'READY');
  const activeChildren = snapshot.children.filter((child) => child.status === 'ACTIVE');
  const todaySeconds = snapshot.watchEvents.filter((event) => event.occurredAt.slice(0, 10) === today).reduce((sum, event) => sum + event.effectiveWatchSeconds, 0);
  const recentCourses = [...snapshot.courses].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 4);
  const recentEvents = [...snapshot.watchEvents].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, 5);
  const days = Array.from({ length: 7 }, (_, index) => { const date = new Date(); date.setUTCDate(date.getUTCDate() - (6 - index)); return date; });
  const maxDaySeconds = Math.max(60, ...days.flatMap((date) => activeChildren.map((child) => getDailyWatchSeconds(snapshot.watchEvents, child.id, dateKey(date)))));
  const subjectName = (id: string) => subjects.find((subject) => subject.id === id)?.name ?? id;

  return <div className="parent-page">
    <div className="page-heading"><div><p className="eyebrow">家庭学习工作台</p><h1>概览</h1><p className="page-subtitle">把每一次观看，变成孩子看得见的成长。</p></div><Link className="button primary" to="/parent/courses?new=1">+ 新增课程</Link></div>
    <section className="metric-grid" aria-label="学习概览指标">
      <div className="metric-card" data-testid="metric-courses"><span className="metric-icon blue">◈</span><strong>{snapshot.courses.length}</strong><span>课程总数</span><small>{snapshot.courses.filter((course) => course.status === 'PUBLISHED').length} 门已发布</small></div>
      <div className="metric-card" data-testid="metric-videos"><span className="metric-icon green">▶</span><strong>{readyVideos.length}</strong><span>可播放视频</span><small>已就绪内容</small></div>
      <div className="metric-card" data-testid="metric-children"><span className="metric-icon purple">✦</span><strong>{activeChildren.length}</strong><span>启用孩子</span><small>可进入儿童端</small></div>
      <div className="metric-card" data-testid="metric-today"><span className="metric-icon yellow">◷</span><strong>{Math.round(todaySeconds / 60)}</strong><span>今日学习（分钟）</span><small>{todaySeconds ? '有效观看时长' : '今天还没有记录'}</small></div>
    </section>
    <section className="overview-columns">
      <div className="panel"><div className="panel-heading"><div><h2>最近上传课程</h2><p>按最近更新时间排列</p></div><Link to="/parent/courses">查看全部</Link></div>{recentCourses.length ? <div className="recent-course-list">{recentCourses.map((course) => <Link to={`/parent/courses/${course.id}`} className="recent-course" key={course.id}><span className="cover-mini" style={{ background: `linear-gradient(135deg, ${course.cover.colors.join(',')})` }}>{subjectName(course.subjectId).slice(0, 1)}</span><span><strong>{course.title}</strong><small>{subjectName(course.subjectId)} · {course.videoIds.length} 个视频</small></span><time>{dateText(course.updatedAt)}</time></Link>)}</div> : <EmptyState title="还没有课程，创建第一门课程" description="先添加课程，再上传第一段演示视频。" action={<Link className="button primary" to="/parent/courses?new=1">创建课程</Link>} />}</div>
      <div className="panel"><div className="panel-heading"><div><h2>近 7 天学习</h2><p>按孩子查看有效学习时长</p></div></div>{snapshot.watchEvents.length && activeChildren.length ? <div className="bar-chart">{days.map((date) => <div className="bar-group" key={dateKey(date)}><div className="bars">{activeChildren.map((child) => { const seconds = getDailyWatchSeconds(snapshot.watchEvents, child.id, dateKey(date)); return <span className="bar" title={`${child.name} ${Math.round(seconds / 60)} 分钟`} key={child.id} style={{ height: `${Math.max(4, seconds / maxDaySeconds * 100)}%`, background: child.id === activeChildren[0]?.id ? 'var(--blue)' : 'var(--purple)' }} />; })}</div><small>{dayLabel(date)}</small></div>)}</div> : <EmptyState title="还没有学习记录" description="孩子开始观看后，这里会显示近 7 天趋势。" />}</div>
    </section>
    <section className="panel activity-panel"><div className="panel-heading"><div><h2>最近学习动态</h2><p>来自所有启用孩子的观看记录</p></div><Link to="/parent/records">查看记录</Link></div>{recentEvents.length ? <div className="activity-list">{recentEvents.map((event) => { const child = snapshot.children.find((item) => item.id === event.childId); const video = snapshot.videos.find((item) => item.id === event.videoId); const course = snapshot.courses.find((item) => item.id === video?.courseId); return <div className="activity-item" key={event.id}><span className="avatar-chip">{child?.avatar ?? '✦'}</span><p><strong>{child?.name ?? '孩子'}</strong> 学习了 <b>{video?.title ?? '一段视频'}</b><small>{course?.title ?? '课程'} · {Math.round(event.effectiveWatchSeconds / 60)} 分钟</small></p><time>{dateText(event.occurredAt)}</time></div>; })}</div> : <EmptyState title="还没有学习记录" description="孩子开始观看视频后，学习动态会显示在这里。" />}</section>
  </div>;
}
