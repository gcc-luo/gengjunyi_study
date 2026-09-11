import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';

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
        <Route path="/parent/overview" element={<RoutePlaceholder title="家长端" />} />
        <Route path="/child/select" element={<RoutePlaceholder title="儿童端" />} />
        <Route path="*" element={<LandingPage />} />
      </Routes>
    </BrowserRouter>
  );
}
