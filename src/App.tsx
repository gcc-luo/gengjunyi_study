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
import { RecordsPage as ChildRecordsPage } from './features/child/RecordsPage';
import { useAppStore } from './context/AppStore';

function LandingPage() {
  return (
    <main>
      <h1>小小学习星球</h1>
      <p>陪伴家庭一起快乐学习。</p>
      <nav aria-label="端入口">
        <Link to="/child/select">进入儿童端</Link>
        <Link to="/parent/overview">进入家长端</Link>
      </nav>
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

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
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
        <Route path="*" element={<LandingPage />} />
      </Routes>
    </BrowserRouter>
  );
}
