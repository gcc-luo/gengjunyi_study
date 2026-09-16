import { useEffect, useState } from 'react';
import { Modal } from '../../components/Modal';
import { useAppStore } from '../../context/AppStore';
import { type Child } from '../../types/domain';

export function ChildEditor({ open, child, onClose, onSaved }: { open: boolean; child?: Child; onClose: () => void; onSaved: (child: Child) => void }) {
  const { createChild, updateChild } = useAppStore(); const [name, setName] = useState(''); const [avatar, setAvatar] = useState('🌟'); const [grade, setGrade] = useState(''); const [error, setError] = useState('');
  useEffect(() => { if (!open) return; setName(child?.name ?? ''); setAvatar(child?.avatar ?? '🌟'); setGrade(child?.grade ?? ''); setError(''); }, [open, child]);
  const submit = (event: React.FormEvent) => { event.preventDefault(); if (!name.trim()) { setError('请填写孩子昵称'); return; } const saved = child ? updateChild(child.id, { name: name.trim(), avatar, grade: grade.trim() || '未设置年级' }) : createChild({ name: name.trim(), avatar, grade: grade.trim() || '未设置年级' }); if (saved) onSaved(saved); };
  return <Modal open={open} title={child ? '编辑孩子' : '新增孩子'} onClose={onClose}><form className="editor-form" onSubmit={submit}><label>孩子昵称<input autoFocus aria-label="孩子昵称" value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：小星" /></label><label>年级<input aria-label="年级" value={grade} onChange={(event) => setGrade(event.target.value)} placeholder="例如：小学一年级" /></label><fieldset><legend>头像</legend><div className="avatar-picker">{['🌟', '🚀', '🌈', '🐳', '🌙', '🦊'].map((item) => <button type="button" className={avatar === item ? 'avatar-option selected' : 'avatar-option'} onClick={() => setAvatar(item)} key={item}>{item}</button>)}</div></fieldset>{error && <p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button className="button" type="button" onClick={onClose}>取消</button><button className="button primary" type="submit">保存孩子</button></div></form></Modal>;
}
