import { BrowserRouter, Link, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { ParentShell } from './components/ParentShell';
import { ChildShell } from './components/ChildShell';
import { OverviewPage } from './features/parent/OverviewPage';
import { CoursesPage } from './features/parent/CoursesPage';
import { CourseDetail } from './features/parent/CourseDetail';
import { UploadsPage } from './features/parent/UploadsPage';
import { ChildrenPage } from './features/parent/ChildrenPage';
import { RecordsPage } from './features/parent/RecordsPage';
import { SettingsPage } from './features/parent/SettingsPage';
import { SelectChildPage } from './features/child/SelectChildPage';
import { HomePage } from './features/child/HomePage';
import { CoursesPage as ChildCoursesPage } from './features/child/CoursesPage';
import { CoursePage as ChildCoursePage } from './features/child/CoursePage';
import { MePage } from './features/child/MePage';
import { WatchPage } from './features/child/WatchPage';
import { LoginPage } from './features/auth/LoginPage';
import { ParentUnlockPage } from './features/auth/ParentUnlockPage';
import { RecordsPage as ChildRecordsPage } from './features/child/RecordsPage';
import { useAppStore } from './context/AppStore';
import { useAuth } from './context/AuthProvider';

function RequireAuth() {
  const auth = useAuth();
  if (auth.status === 'loading') return <main className="auth-loading" role="status">正在检查登录状态…</main>;
  if (auth.status === 'error') return <main className="auth-loading" role="alert">{auth.error ?? '无法检查登录状态'} <button type="button" onClick={() => void auth.refreshSession()}>重试</button></main>;
  if (auth.status !== 'authenticated') {
    const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return <Outlet />;
}

function LandingPage() {
  return (
    <main className="landing-page">
      <div className="landing-shell">
        <header className="landing-topbar">
          <Link className="landing-brand" to="/" aria-label="小小学习星球首页">
            <span aria-hidden="true">✦</span>
            小小学习星球
          </Link>
          <span className="landing-top-note">一个家庭，两种空间</span>
        </header>

        <div className="landing-layout">
          <section className="landing-intro" aria-labelledby="landing-heading">
            <p className="landing-kicker">家庭学习空间</p>
            <h1 id="landing-heading">
              陪伴每一次
              <span>小小的进步</span>
            </h1>
            <p className="landing-lead">学习内容由家长准备，孩子自由探索。</p>
            <p className="landing-description">把优质学习视频整理成一个简单、安心的家庭学习书架。</p>
            <div className="landing-orbit-art" aria-hidden="true">
              <span className="landing-orbit-sun" />
              <span className="landing-orbit-ring" />
              <span className="landing-orbit-dot" />
              <span className="landing-orbit-star">✦</span>
            </div>
          </section>

          <nav className="landing-entries" aria-label="选择学习空间">
            <Link className="landing-entry-card landing-child-entry" to="/child/select">
              <span className="landing-entry-icon" aria-hidden="true">🚀</span>
              <span className="landing-entry-copy">
                <span className="landing-entry-kicker">给孩子的学习空间</span>
                <strong>儿童学习空间</strong>
                <span>选头像、找课程，接着上次继续学习。</span>
              </span>
              <span className="landing-entry-action">
                <span>进入儿童端</span>
                <span aria-hidden="true">→</span>
              </span>
            </Link>

            <Link className="landing-entry-card landing-parent-entry" to="/parent/overview">
              <span className="landing-entry-icon" aria-hidden="true">📚</span>
              <span className="landing-entry-copy">
                <span className="landing-entry-kicker">家庭内容管理</span>
                <strong>家长管理中心</strong>
                <span>管理课程、孩子与学习记录。</span>
              </span>
              <span className="landing-entry-action">
                <span>进入家长端</span>
                <span aria-hidden="true">→</span>
              </span>
            </Link>
            <p className="landing-entries-note">每个空间都为家庭学习而准备</p>
          </nav>
        </div>
      </div>
    </main>
  );
}

function RoutePlaceholder({ title }: { title: string }) {
  return (
    <main>
      <h1>{title}</h1>
      <Link to="/">返回首页</Link>
    </main>
  );
}

function RequireChildSelection() {
  const { currentChildId } = useAppStore();
  return currentChildId ? <Outlet /> : <Navigate to="/child/select" replace />;
}

function RequireParentAccess() {
  const auth = useAuth();
  return auth.parentUnlocked ? <Outlet /> : <ParentUnlockPage />;
}

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<RequireParentAccess />}>
          <Route path="/parent" element={<ParentShell />}>
            <Route index element={<OverviewPage />} />
            <Route path="overview" element={<OverviewPage />} />
            <Route path="courses" element={<CoursesPage />} />
            <Route path="courses/:courseId" element={<CourseDetail />} />
            <Route path="uploads" element={<UploadsPage />} />
            <Route path="children" element={<ChildrenPage />} />
            <Route path="records" element={<RecordsPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
          </Route>
          <Route path="/child" element={<ChildShell />}>
            <Route index element={<SelectChildPage />} />
            <Route path="select" element={<SelectChildPage />} />
            <Route element={<RequireChildSelection />}>
              <Route path="home" element={<HomePage />} />
              <Route path="courses" element={<ChildCoursesPage />} />
              <Route path="course/:courseId" element={<ChildCoursePage />} />
              <Route path="watch/:videoId" element={<WatchPage />} />
              <Route path="records" element={<ChildRecordsPage />} />
              <Route path="me" element={<MePage />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<LandingPage />} />
      </Routes>
    </BrowserRouter>
  );
}
