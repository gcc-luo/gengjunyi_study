import { useEffect, useState } from 'react';
import { Modal } from '../../components/Modal';
import { useAppStore } from '../../context/AppStore';
import { type Course, type SubjectId } from '../../types/domain';

export function CourseEditor({ open, course, onClose, onSaved }: { open: boolean; course?: Course; onClose: () => void; onSaved: (course: Course) => void }) {
  const { subjects, createCourse, updateCourse } = useAppStore();
  const [title, setTitle] = useState('');
  const [subjectId, setSubjectId] = useState<SubjectId | ''>('');
  const [ageRange, setAgeRange] = useState('');
  const [description, setDescription] = useState('');
  const [coverStyle, setCoverStyle] = useState('sunrise');
  const [error, setError] = useState('');
  useEffect(() => { if (!open) return; setTitle(course?.title ?? ''); setSubjectId(course?.subjectId ?? ''); setAgeRange(course?.ageRange ?? ''); setDescription(course?.description ?? ''); setCoverStyle(course?.cover.style ?? 'sunrise'); setError(''); }, [open, course]);
  const submit = (event: React.FormEvent) => { event.preventDefault(); if (!title.trim()) { setError('请填写课程名称'); return; } if (!subjectId) { setError('请选择课程学科'); return; } const colors: Record<string, string[]> = { sunrise: ['#2D86F5', '#9ED8FF'], mountain: ['#37A7E8', '#B5ECFF'], planet: ['#7F6CF4', '#C4BFFF'], rainbow: ['#FF6C66', '#FFD5D2'] }; const saved = course ? updateCourse(course.id, { title: title.trim(), subjectId, ageRange: ageRange.trim(), description: description.trim(), cover: { style: coverStyle, colors: colors[coverStyle] ?? colors.sunrise } }) : createCourse({ title: title.trim(), subjectId, ageRange: ageRange.trim(), description: description.trim(), cover: { style: coverStyle, colors: colors[coverStyle] ?? colors.sunrise } }); if (saved) onSaved(saved); };
  return <Modal open={open} title={course ? '编辑课程' : '新建课程'} onClose={onClose}><form className="editor-form" onSubmit={submit}><label>课程名称<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} aria-label="课程名称" placeholder="例如：小小科学家" /></label><label>课程学科<select value={subjectId} onChange={(event) => setSubjectId(event.target.value as SubjectId)} aria-label="课程学科"><option value="">请选择学科</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label><label>适龄范围<input value={ageRange} onChange={(event) => setAgeRange(event.target.value)} aria-label="适龄范围" placeholder="例如：6-8岁" /></label><label>课程简介<textarea value={description} onChange={(event) => setDescription(event.target.value)} aria-label="课程简介" rows={3} placeholder="告诉家长这门课程会带来什么。" /></label><fieldset><legend>封面样式</legend><div className="cover-picker">{['sunrise', 'mountain', 'planet', 'rainbow'].map((style) => <button type="button" className={coverStyle === style ? 'cover-option selected' : 'cover-option'} onClick={() => setCoverStyle(style)} key={style}>{style === 'sunrise' ? '晴空' : style === 'mountain' ? '山丘' : style === 'planet' ? '星球' : '彩虹'}</button>)}</div></fieldset>{error && <p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="button" onClick={onClose}>取消</button><button type="submit" className="button primary">保存课程</button></div></form></Modal>;
}
