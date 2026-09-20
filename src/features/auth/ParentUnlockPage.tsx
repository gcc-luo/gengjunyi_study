import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../../lib/api-client';
import { useAuth } from '../../context/AuthProvider';

export function ParentUnlockPage() {
  const { unlockParent } = useAuth();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await unlockParent(password);
      setPassword('');
    } catch (cause) {
      setError(cause instanceof ApiError && cause.status === 401 ? '验证失败，请输入家长登录密码。' : cause instanceof Error ? cause.message : '验证失败，请重试。');
    } finally {
      setSubmitting(false);
    }
  };

  return <main className="auth-page"><section className="auth-card" aria-labelledby="parent-unlock-heading">
    <Link className="auth-brand" to="/child/select">✦ 小小学习星球</Link>
    <p className="eyebrow">家长验证</p>
    <h1 id="parent-unlock-heading">进入家长管理</h1>
    <p className="auth-subtitle">儿童模式已锁定管理功能，请输入家长登录密码。</p>
    <form className="editor-form" onSubmit={(event) => void submit(event)}>
      <label>家长登录密码<input aria-label="家长登录密码" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus required /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button primary" type="submit" disabled={submitting}>{submitting ? '验证中…' : '验证并进入'}</button>
    </form>
    <Link className="auth-back-link" to="/child/select">返回儿童端</Link>
  </section></main>;
}
