import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Modal } from '../../components/Modal';
import { StatusBadge } from '../../components/StatusBadge';
import { useAppStore } from '../../context/AppStore';
import { CourseStatus } from '../../types/domain';

export function CourseDetail() {
  const { courseId } = useParams();
  const navigate = useNavigate();
  const { courses, videos, subjects, updateVideo, updateCourse, publishCourse, offlineCourse, removeVideo } = useAppStore();
  const course = courses.find((item) => item.id === courseId);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [offlineOpen, setOfflineOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<typeof videos[number]>();
  const [editingVideo, setEditingVideo] = useState<typeof videos[number]>();
  const [videoTitle, setVideoTitle] = useState('');
  const closeVideoEditor = useCallback(() => setEditingVideo(undefined), []);
  const orderedVideos = useMemo(() => videos.filter((video) => video.courseId === courseId).sort((a, b) => a.orderIndex - b.orderIndex || a.fileName.localeCompare(b.fileName, 'zh-Hans', { numeric: true })), [videos, courseId]);

  if (!course) return <div className="parent-page"><div className="panel"><h1>找不到这门课程</h1><Link to="/parent/courses">返回课程管理</Link></div></div>;
  const subjectName = subjects.find((item) => item.id === course.subjectId)?.name ?? course.subjectId;
  const move = async (index: number, direction: -1 | 1) => {
    const other = orderedVideos[index + direction];
    const current = orderedVideos[index];
    if (!other || !current) return;
    const videoIds = orderedVideos.map((video, itemIndex) => itemIndex === index ? other.id : itemIndex === index + direction ? current.id : video.id);
    setBusy(true);
    try { await updateCourse(course.id, { videoIds }); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '调整顺序失败，请重试'); }
    finally { setBusy(false); }
  };
  const publish = async () => {
    setBusy(true);
    try { const result = await publishCourse(course.id); setError(result.ok ? '' : result.reason); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '发布失败，请重试'); }
    finally { setBusy(false); }
  };
  const takeOffline = async () => {
    setBusy(true);
    try { await offlineCourse(course.id); setOfflineOpen(false); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '下架失败，请重试'); }
    finally { setBusy(false); }
  };
  const saveVideoTitle = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingVideo || !videoTitle.trim()) { setError('视频标题不能为空'); return; }
    setBusy(true);
    try { await updateVideo(editingVideo.id, { title: videoTitle.trim() }); setEditingVideo(undefined); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '保存视频失败，请重试'); }
    finally { setBusy(false); }
  };
  const deleteVideo = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try { await removeVideo(deleteTarget.id); setDeleteTarget(undefined); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '删除视频失败，请重试'); }
    finally { setBusy(false); }
  };

  return <div className="parent-page">
    <div className="detail-back"><button type="button" onClick={() => navigate('/parent/courses')}>← 返回课程管理</button></div>
    <section className="detail-hero"><span className="detail-cover" style={{ background: `linear-gradient(135deg, ${course.cover.colors.join(',')})` }}>{subjectName.slice(0, 1)}</span><div><p className="eyebrow">{subjectName} · {course.ageRange || '未设置适龄范围'}</p><h1>{course.title}</h1><p>{course.description || '还没有课程简介。'}</p><StatusBadge status={course.status} /></div><div className="detail-actions">{course.status === CourseStatus.PUBLISHED ? <button className="button" type="button" onClick={() => setOfflineOpen(true)}>下架</button> : <button className="button primary" type="button" disabled={busy} onClick={() => void publish()}>{busy ? '处理中…' : '发布'}</button>}<Link className="button" to={`/parent/uploads?course=${course.id}`}>添加视频</Link></div></section>
    {error && <p className="form-error" role="alert">{error}</p>}
    <section className="panel video-panel"><div className="panel-heading"><div><h2>视频目录</h2><p>{orderedVideos.length} 个视频 · 按播放顺序排列</p></div><Link className="text-link" to={`/parent/uploads?course=${course.id}`}>跳转上传入口</Link></div>{orderedVideos.length ? <ol className="video-list" data-testid="video-list">{orderedVideos.map((video, index) => <li key={video.id}><span className="video-number">{index + 1}</span><span className="video-main"><strong>{video.title}</strong><small>{video.fileName} · {Math.floor(video.durationSeconds / 60)} 分钟</small></span><StatusBadge status={video.status} /><div className="video-actions"><button type="button" aria-label={`编辑视频 ${video.title}`} onClick={() => { setEditingVideo(video); setVideoTitle(video.title); }}>编辑</button><button type="button" aria-label={`上移 ${video.title}`} onClick={() => void move(index, -1)} disabled={index === 0 || busy}>↑ 上移</button><button type="button" aria-label="下移" onClick={() => void move(index, 1)} disabled={index === orderedVideos.length - 1 || busy}>↓ 下移</button><button type="button" aria-label={`删除视频 ${video.title}`} onClick={() => setDeleteTarget(video)} disabled={busy || course.status === CourseStatus.PUBLISHED} title={course.status === CourseStatus.PUBLISHED ? '请先下架课程，再删除视频' : undefined}>删除</button></div></li>)}</ol> : <p className="muted-copy">还没有视频，去上传区添加第一个演示视频。</p>}</section>
    <Modal open={offlineOpen} title="确认下架课程" onClose={() => setOfflineOpen(false)}><p>下架后儿童端将隐藏这门课程，但历史学习记录会保留。</p><div className="form-actions"><button type="button" className="button" disabled={busy} onClick={() => setOfflineOpen(false)}>取消</button><button type="button" className="button danger" disabled={busy} onClick={() => void takeOffline()}>{busy ? '处理中…' : '确认下架'}</button></div></Modal>
    <Modal open={Boolean(deleteTarget)} title="确认删除视频" onClose={() => setDeleteTarget(undefined)}><p>删除“{deleteTarget?.title}”会同时清除该视频的所有学习进度、收藏与观看记录，且无法恢复。</p><div className="form-actions"><button type="button" className="button" disabled={busy} onClick={() => setDeleteTarget(undefined)}>取消</button><button type="button" className="button danger" disabled={busy} onClick={() => void deleteVideo()}>{busy ? '删除中…' : '删除视频和记录'}</button></div></Modal>
    <Modal open={Boolean(editingVideo)} title="编辑视频标题" onClose={closeVideoEditor}><form onSubmit={(event) => void saveVideoTitle(event)}><label>视频标题<input aria-label="视频标题" value={videoTitle} onChange={(event) => setVideoTitle(event.target.value)} /></label><div className="form-actions"><button type="button" className="button" disabled={busy} onClick={closeVideoEditor}>取消</button><button type="submit" className="button primary" disabled={busy}>{busy ? '保存中…' : '保存视频'}</button></div></form></Modal>
  </div>;
}
