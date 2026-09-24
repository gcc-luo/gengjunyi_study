import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueries, useQuery } from '@tanstack/react-query';
import { EmptyState } from '../../components/EmptyState';
import { Modal } from '../../components/Modal';
import { useAppStore } from '../../context/AppStore';
import { apiRequest } from '../../lib/api-client';
import { ChildStatus, type Child } from '../../types/domain';
import { ChildEditor } from './ChildEditor';
import { CourseAccessEditor } from './CourseAccessEditor';

type FamilySettings = { freeChoice: boolean };
type CourseAccess = { childId: string; courseIds: string[] };

export function ChildrenPage() {
  const { snapshot, updateChild, deactivateChild, isRemote } = useAppStore();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Child>();
  const [deactivateTarget, setDeactivateTarget] = useState<Child>();
  const [courseAccessTarget, setCourseAccessTarget] = useState<Child>();
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const feedbackTimerRef = useRef<number | undefined>(undefined);
  const active = snapshot.children.filter((child) => child.status === ChildStatus.ACTIVE);
  const inactive = snapshot.children.filter((child) => child.status === ChildStatus.INACTIVE);
  const publishedCourses = snapshot.courses.filter((course) => course.status === 'PUBLISHED');
  const publishedCourseIds = new Set(publishedCourses.map((course) => course.id));
  const familySettings = useQuery({
    queryKey: ['family', 'settings'],
    queryFn: () => apiRequest<FamilySettings>('/api/settings'),
    enabled: isRemote,
  });
  const courseAccess = useQueries({
    queries: active.map((child) => ({
      queryKey: ['parent', 'child-course-access', child.id],
      queryFn: () => apiRequest<CourseAccess>(`/api/children/${encodeURIComponent(child.id)}/course-access`),
      enabled: isRemote && familySettings.data?.freeChoice === false,
    })),
  });
  const visibleCourseCount = (childId: string): string => {
    if (!isRemote) return `${publishedCourses.length} 门`;
    if (familySettings.isLoading) return '读取中…';
    if (familySettings.error || !familySettings.data) return '暂不可用';
    if (familySettings.data.freeChoice) return `${publishedCourses.length} 门`;
    const childIndex = active.findIndex((child) => child.id === childId);
    const access = courseAccess[childIndex];
    if (!access || access.isLoading) return '读取中…';
    if (access.error || !access.data) return '暂不可用';
    return `${access.data.courseIds.filter((courseId) => publishedCourseIds.has(courseId)).length} 门`;
  };
  const lastLearned = useMemo(() => (childId: string) => [...snapshot.watchEvents].filter((event) => event.childId === childId).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0]?.occurredAt, [snapshot.watchEvents]);

  useEffect(() => () => { if (feedbackTimerRef.current !== undefined) window.clearTimeout(feedbackTimerRef.current); }, []);
  const saved = () => {
    setEditorOpen(false);
    setFeedback('孩子档案已保存');
    if (feedbackTimerRef.current !== undefined) window.clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = window.setTimeout(() => { setFeedback(''); feedbackTimerRef.current = undefined; }, 2400);
  };
  const reactivate = async (child: Child) => {
    setBusy(true); setError('');
    try { await updateChild(child.id, { status: ChildStatus.ACTIVE }); setFeedback('孩子已重新启用'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '重新启用失败，请重试'); }
    finally { setBusy(false); }
  };
  const deactivate = async () => {
    if (!deactivateTarget) return;
    setBusy(true); setError('');
    try { await deactivateChild(deactivateTarget.id); setDeactivateTarget(undefined); setFeedback('孩子已停用'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '停用失败，请重试'); }
    finally { setBusy(false); }
  };

  return <div className="parent-page">
    <div className="page-heading"><div><p className="eyebrow">家庭成员</p><h1>孩子管理</h1><p className="page-subtitle">管理每个孩子的学习入口，历史记录会一直保留。</p></div><button type="button" className="button primary" onClick={() => { setEditing(undefined); setEditorOpen(true); }}>+ 新增孩子</button></div>
    {feedback && <p className="success-message" role="status">{feedback}</p>}{error && <p className="form-error" role="alert">{error}</p>}
    {active.length ? <div className="children-grid">{active.map((child) => <article className="child-card" key={child.id}><div className="child-card-head"><span className="child-avatar">{child.avatar}</span><div><h2>{child.name}</h2><p>{child.grade}</p></div><span className="active-dot">启用中</span></div><dl><div><dt>可见课程</dt><dd>{visibleCourseCount(child.id)}</dd></div><div><dt>最近学习</dt><dd>{lastLearned(child.id) ? new Date(lastLearned(child.id)!).toLocaleDateString('zh-CN') : '还没有记录'}</dd></div></dl><div className="card-actions"><Link to={`/parent/records?child=${child.id}`}>学习记录</Link>{isRemote && <button type="button" onClick={() => setCourseAccessTarget(child)}>分配课程</button>}<button type="button" onClick={() => { setEditing(child); setEditorOpen(true); }}>编辑</button><button type="button" onClick={() => setDeactivateTarget(child)} aria-label={`停用 ${child.name}`}>停用</button></div></article>)}</div> : <EmptyState title="还没有孩子档案" description="创建孩子后，就可以为他们准备专属学习空间。" action={<button type="button" className="button primary" onClick={() => { setEditing(undefined); setEditorOpen(true); }}>新增孩子</button>} />}
    {inactive.length > 0 && <section className="panel inactive-section"><div className="panel-heading"><div><h2>已停用</h2><p>停用后儿童端隐藏，但历史学习记录保留。</p></div></div>{inactive.map((child) => <div className="inactive-row" key={child.id}><span className="child-avatar small">{child.avatar}</span><strong>{child.name}</strong><span>{child.grade}</span><button type="button" disabled={busy} onClick={() => void reactivate(child)}>重新启用</button></div>)}</section>}
    <ChildEditor open={editorOpen} child={editing} onClose={() => setEditorOpen(false)} onSaved={saved} />
    {courseAccessTarget && <CourseAccessEditor open child={courseAccessTarget} courses={snapshot.courses.filter((course) => course.status === 'PUBLISHED')} onClose={() => setCourseAccessTarget(undefined)} onSaved={() => { setCourseAccessTarget(undefined); setFeedback('课程分配已保存'); }} />}
    <Modal open={Boolean(deactivateTarget)} title="确认停用孩子" onClose={() => setDeactivateTarget(undefined)}><p>停用后儿童端将隐藏该孩子，但历史记录会保留。</p><div className="form-actions"><button type="button" className="button" disabled={busy} onClick={() => setDeactivateTarget(undefined)}>取消</button><button type="button" className="button danger" disabled={busy} onClick={() => void deactivate()}>{busy ? '处理中…' : '确认停用'}</button></div></Modal>
  </div>;
}
