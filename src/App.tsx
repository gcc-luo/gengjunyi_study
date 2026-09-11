import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { ParentShell } from './components/ParentShell';
import { ChildShell } from './components/ChildShell';

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
          <Route index element={<RoutePlaceholder title="家长端概览" />} />
          <Route path="overview" element={<RoutePlaceholder title="家长端概览" />} />
          <Route path="courses" element={<RoutePlaceholder title="课程管理" />} />
          <Route path="uploads" element={<RoutePlaceholder title="视频上传" />} />
          <Route path="children" element={<RoutePlaceholder title="孩子管理" />} />
          <Route path="records" element={<RoutePlaceholder title="学习记录" />} />
          <Route path="settings" element={<RoutePlaceholder title="设置" />} />
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
