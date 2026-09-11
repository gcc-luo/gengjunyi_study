import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { ParentShell } from './components/ParentShell';
import { ChildShell } from './components/ChildShell';
import { OverviewPage } from './features/parent/OverviewPage';
import { CoursesPage } from './features/parent/CoursesPage';
import { CourseDetail } from './features/parent/CourseDetail';
import { UploadsPage } from './features/parent/UploadsPage';
import { ChildrenPage } from './features/parent/ChildrenPage';
import { RecordsPage } from './features/parent/RecordsPage';
import { SettingsPage } from './features/parent/SettingsPage';

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
          <Route index element={<RoutePlaceholder title="选择孩子" />} />
          <Route path="select" element={<RoutePlaceholder title="选择孩子" />} />
          <Route path="home" element={<RoutePlaceholder title="儿童首页" />} />
          <Route path="courses" element={<RoutePlaceholder title="课程" />} />
          <Route path="course/:courseId" element={<RoutePlaceholder title="课程详情" />} />
          <Route path="watch/:videoId" element={<RoutePlaceholder title="视频播放" />} />
          <Route path="records" element={<RoutePlaceholder title="学习记录" />} />
          <Route path="me" element={<RoutePlaceholder title="我的" />} />
        </Route>
        <Route path="*" element={<LandingPage />} />
      </Routes>
    </BrowserRouter>
  );
}
