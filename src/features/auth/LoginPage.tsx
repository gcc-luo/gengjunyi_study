import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError } from '../../lib/api-client';
import { useAuth } from '../../context/AuthProvider';

export function safeReturnPath(candidate: string | null, origin = window.location.origin) {
  const fallback = '/parent/overview';
  if (!candidate || !candidate.startsWith('/') || candidate.startsWith('//')) return fallback;
  try {
    const target = new URL(candidate, origin);
    if (target.origin !== origin || !(/^\/parent(?:\/|$)/u.test(target.pathname) || /^\/child(?:\/|$)/u.test(target.pathname))) return fallback;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
}

export function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const returnPath = safeReturnPath(searchParams.get('next'));

  useEffect(() => {
    if (auth.status === 'authenticated') navigate(returnPath, { replace: true });
  }, [auth.status, navigate, returnPath]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await auth.login(email, password);
      navigate(returnPath, { replace: true });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : '登录失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  return <main className="login-page">
    <section className="login-card" aria-labelledby="login-heading">
      <Link className="login-brand" to="/" aria-label="返回小小学习星球首页"><span aria-hidden="true">✦</span> 小小学习星球</Link>
      <p className="login-kicker">家庭私有学习空间</p>
      <h1 id="login-heading">家长登录</h1>
      <p className="login-description">请使用家庭管理员账号登录，管理孩子与学习内容。</p>
      <form className="login-form" onSubmit={submit}>
        <label htmlFor="login-email">邮箱</label>
        <input id="login-email" autoComplete="username" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
        <label htmlFor="login-password">密码</label>
        <input id="login-password" autoComplete="current-password" type="password" required value={password} onChange={(event) => setPassword(event.target.value)} />
        {error && <p className="login-error" role="alert">{error}</p>}
        {auth.status === 'error' && <div className="login-error" role="alert"><p>{auth.error}</p><button type="button" onClick={() => void auth.refreshSession()}>重试连接</button></div>}
        <button className="button primary login-submit" type="submit" disabled={submitting || auth.status === 'loading' || auth.status === 'error'}>
          {submitting ? '正在登录…' : auth.status === 'loading' ? '正在连接…' : '登录'}
        </button>
      </form>
      <Link className="login-home-link" to="/">返回首页</Link>
      <p className="login-private-note">本产品不开放注册。忘记密码请在服务器上联系家庭管理员。</p>
    </section>
  </main>;
}
