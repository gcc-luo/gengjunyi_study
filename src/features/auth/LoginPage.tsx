import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthProvider';
import { apiRequest, ApiError } from '../../lib/api-client';

function safeNext(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/parent/overview';
}

export function LoginPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const next = safeNext(new URLSearchParams(location.search).get('next'));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await apiRequest('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      await auth.refreshSession();
      navigate(next, { replace: true });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : '登录失败，请检查服务状态后重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="login-heading">
        <Link className="auth-brand" to="/">✦ 小小学习星球</Link>
        <p className="eyebrow">家庭管理入口</p>
        <h1 id="login-heading">家长登录</h1>
        <p className="auth-subtitle">登录后管理课程、孩子和学习记录。</p>
        <form className="editor-form" onSubmit={(event) => void submit(event)}>
          <label>登录邮箱<input aria-label="登录邮箱" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label>登录密码<input aria-label="登录密码" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button primary" type="submit" disabled={submitting}>{submitting ? '登录中…' : '登录'}</button>
        </form>
        <Link className="auth-back-link" to="/">返回入口</Link>
      </section>
    </main>
  );
}
