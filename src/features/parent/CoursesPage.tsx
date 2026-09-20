import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Modal } from '../../components/Modal';
import { StatusBadge } from '../../components/StatusBadge';
import { useAppStore } from '../../context/AppStore';
import { CourseStatus, type Course } from '../../types/domain';
import { CourseEditor } from './CourseEditor';

export function CoursesPage() {
  const { courses, videos, subjects, publishCourse, offlineCourse } = useAppStore();
  const location = useLocation();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [subject, setSubject] = useState('');
  const [age, setAge] = useState('');
  const [status, setStatus] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Course>();
  const [publishError, setPublishError] = useState<{ id: string; reason: string }>();
  const [offlineTarget, setOfflineTarget] = useState<Course>();
  const [busyId, setBusyId] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    setSearch(params.get('search') ?? '');
    if (params.get('new') === '1') {
      setEditing(undefined);
      setEditorOpen(true);
    }
  }, [location.search]);

  const subjectName = (id: string) => subjects.find((item) => item.id === id)?.name ?? id;
  const filtered = useMemo(() => courses.filter((course) => {
    const query = search.trim().toLowerCase();
    const courseVideos = videos.filter((video) => video.courseId === course.id);
    const matchesText = !query || course.title.toLowerCase().includes(query) || courseVideos.some((video) => `${video.title} ${video.fileName}`.toLowerCase().includes(query));
    return matchesText && (!subject || course.subjectId === subject) && (!age || course.ageRange.includes(age)) && (!status || course.status === status);
  }), [courses, videos, search, subject, age, status]);

  const openEditor = (course?: Course) => { setEditing(course); setEditorOpen(true); setPublishError(undefined); };
  const publish = async (course: Course) => {
    setBusyId(course.id);
    try {
      const result = await publishCourse(course.id);
      setPublishError(result.ok ? undefined : { id: course.id, reason: result.reason });
    } catch (cause) {
      setPublishError({ id: course.id, reason: cause instanceof Error ? cause.message : '发布失败，请重试' });
    } finally { setBusyId(''); }
  };
  const takeOffline = async () => {
    if (!offlineTarget) return;
    const target = offlineTarget;
    setBusyId(target.id);
    try {
      await offlineCourse(target.id);
      setOfflineTarget(undefined);
      setPublishError(undefined);
    } catch (cause) {
      setPublishError({ id: target.id, reason: cause instanceof Error ? cause.message : '下架失败，请重试' });
    } finally { setBusyId(''); }
  };
  const saved = () => { setEditorOpen(false); navigate('/parent/courses', { replace: true }); };

  return <div className="parent-page">
    <div className="page-heading"><div><p className="eyebrow">内容库</p><h1>课程管理</h1><p className="page-subtitle">整理课程、视频和孩子的学习入口。</p></div><button className="button primary" type="button" onClick={() => openEditor()}>+ 新建课程</button></div>
    <div className="filter-bar">
      <label>搜索课程<input aria-label="课程搜索" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索课程或视频名称" /></label>
      <label>学科<select aria-label="学科筛选" value={subject} onChange={(event) => setSubject(event.target.value)}><option value="">全部学科</option>{subjects.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
      <label>适龄/年级<input aria-label="适龄筛选" value={age} onChange={(event) => setAge(event.target.value)} placeholder="如：6-8岁" /></label>
      <label>状态<select aria-label="状态筛选" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option><option value="DRAFT">草稿</option><option value="PUBLISHED">已发布</option><option value="OFFLINE">已下架</option></select></label>
    </div>
    <div className="table-panel"><table><thead><tr><th>封面</th><th>课程名称</th><th>学科</th><th>适龄 / 年级</th><th>视频数</th><th>更新时间</th><th>状态</th><th>操作</th></tr></thead><tbody>
      {filtered.length ? filtered.map((course) => {
        const matchedVideo = search.trim() ? videos.find((video) => video.courseId === course.id && `${video.title} ${video.fileName}`.toLowerCase().includes(search.trim().toLowerCase())) : undefined;
        return <tr key={course.id}>
          <td><span className="cover-mini" style={{ background: `linear-gradient(135deg, ${course.cover.colors.join(',')})` }}>{subjectName(course.subjectId).slice(0, 1)}</span></td>
          <td><strong>{course.title}</strong>{matchedVideo && <small>匹配视频：<span>{matchedVideo.title}</span></small>}</td>
          <td>{subjectName(course.subjectId)}</td><td>{course.ageRange || '未设置'}</td><td>{videos.filter((video) => video.courseId === course.id).length}</td>
          <td>{new Date(course.updatedAt).toLocaleDateString('zh-CN')}</td>
          <td><StatusBadge status={course.status} />{publishError?.id === course.id && <p className="inline-error" role="alert">{publishError.reason}</p>}</td>
          <td><div className="table-actions"><button type="button" onClick={() => openEditor(course)}>编辑</button><button type="button" onClick={() => navigate(`/parent/courses/${course.id}`)} aria-label={`查看详情 ${course.title}`}>查看详情</button>{course.status === CourseStatus.PUBLISHED ? <button type="button" disabled={busyId === course.id} onClick={() => setOfflineTarget(course)}>下架</button> : <button type="button" disabled={busyId === course.id} onClick={() => void publish(course)}>发布</button>}</div></td>
        </tr>;
      }) : <tr><td colSpan={8}><div className="table-empty">没有符合条件的课程。</div></td></tr>}
    </tbody></table></div>
    <CourseEditor open={editorOpen} course={editing} onClose={() => { setEditorOpen(false); if (location.search) navigate('/parent/courses', { replace: true }); }} onSaved={saved} />
    <Modal open={Boolean(offlineTarget)} title="确认下架课程" onClose={() => setOfflineTarget(undefined)}><p>下架后儿童端会隐藏“{offlineTarget?.title}”，但已经产生的学习记录会保留。</p><div className="form-actions"><button type="button" className="button" disabled={Boolean(busyId)} onClick={() => setOfflineTarget(undefined)}>取消</button><button type="button" className="button danger" disabled={Boolean(busyId)} onClick={() => void takeOffline()}>{busyId ? '处理中…' : '确认下架'}</button></div></Modal>
  </div>;
}
