import { useEffect, useState } from 'react';
import { NavLink, Outlet, Link } from 'react-router-dom';
import { Icon } from './Icon';
import { EYE_CARE_EVENT, readEyeCarePreference } from '../features/child/preferences';
import { useAppStore } from '../context/AppStore';

export function ChildShell() {
  const { currentChildId } = useAppStore();
  const [eyeCare, setEyeCare] = useState(readEyeCarePreference);

  useEffect(() => {
    const syncPreference = () => setEyeCare(readEyeCarePreference());
    window.addEventListener(EYE_CARE_EVENT, syncPreference);
    return () => window.removeEventListener(EYE_CARE_EVENT, syncPreference);
  }, []);

  return <div className="child-stage"><div className={`child-shell${eyeCare ? ' eye-care' : ''}`} data-testid="child-shell"><header className="child-topbar"><Link to="/child/select" aria-label="切换孩子">小小学习星球</Link><span aria-hidden="true">☼</span></header><main className="child-content"><Outlet /></main>{currentChildId && <nav className="child-bottom-nav"><NavLink to="/child/home"><Icon name="home" size={21} />首页</NavLink><NavLink to="/child/courses"><Icon name="book" size={21} />课程</NavLink><NavLink to="/child/me"><Icon name="child" size={21} />我的</NavLink></nav>}</div></div>;
}
