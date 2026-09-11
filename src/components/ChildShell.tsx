import { NavLink, Outlet, Link } from 'react-router-dom';
import { Icon } from './Icon';

export function ChildShell() {
  return <div className="child-stage"><div className="child-shell"><header className="child-topbar"><Link to="/child/select" aria-label="切换孩子">小小学习星球</Link><span>☼</span></header><main className="child-content"><Outlet /></main><nav className="child-bottom-nav"><NavLink to="/child/home"><Icon name="home" size={21} />首页</NavLink><NavLink to="/child/courses"><Icon name="book" size={21} />课程</NavLink><NavLink to="/child/me"><Icon name="child" size={21} />我的</NavLink></nav></div></div>;
}
