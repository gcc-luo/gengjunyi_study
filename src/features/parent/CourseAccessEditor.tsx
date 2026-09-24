import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../../components/Modal';
import { apiRequest } from '../../lib/api-client';
import type { Child, Course } from '../../types/domain';

type Props = { open: boolean; child?: Child; courses: Course[]; onClose: () => void; onSaved: () => void };
type CourseAccess = { childId: string; courseIds: string[] };

export function CourseAccessEditor({ open, child, courses, onClose, onSaved }: Props) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const access = useQuery({
    queryKey: ['parent', 'child-course-access', child?.id],
    queryFn: () => apiRequest<CourseAccess>(`/api/children/${encodeURIComponent(child!.id)}/course-access`),
    enabled: open && Boolean(child),
  });

  useEffect(() => {
    if (access.data) setSelected(access.data.courseIds);
    if (!open) { setSelected([]); setError(''); }
  }, [access.data, open]);

  const toggle = (courseId: string) => setSelected((current) => current.includes(courseId) ? current.filter((id) => id !== courseId) : [...current, courseId]);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!child) return;
    setSaving(true);
    setError('');
    try {
      const saved = await apiRequest<CourseAccess>(`/api/children/${encodeURIComponent(child.id)}/course-access`, { method: 'PUT', body: JSON.stringify({ courseIds: selected }) });
      queryClient.setQueryData(['parent', 'child-course-access', child.id], saved);
      await queryClient.invalidateQueries({ queryKey: ['child'] });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存课程分配失败，请重试');
    } finally { setSaving(false); }
  };

  return <Modal open={open} title={`为${child?.name ?? ''}分配课程`} onClose={onClose}>
    <form className="editor-form" onSubmit={(event) => void save(event)}>
      <p className="muted-copy">关闭自由选课后，儿童端只会显示这里勾选的已发布课程。</p>
      {access.isLoading ? <p role="status">正在读取课程分配…</p> : courses.length ? <fieldset className="course-access-list"><legend>可学习课程</legend>{courses.map((course) => <label key={course.id}><input type="checkbox" checked={selected.includes(course.id)} onChange={() => toggle(course.id)} />{course.title}</label>)}</fieldset> : <p className="muted-copy">暂时没有已发布课程，请先发布课程。</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions"><button className="button" type="button" onClick={onClose} disabled={saving}>取消</button><button className="button primary" type="submit" disabled={saving || access.isLoading}>{saving ? '保存中…' : '保存分配'}</button></div>
    </form>
  </Modal>;
}
