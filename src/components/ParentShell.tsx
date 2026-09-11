import { Link, NavLink, Outlet } from 'react-router-dom';
import { Icon } from './Icon';

const nav = [['/parent/overview', '概览', 'home'], ['/parent/courses', '课程管理', 'book'], ['/parent/uploads', '视频上传', 'plus'], ['/parent/children', '孩子管理', 'child'], ['/parent/records', '学习记录', 'chart'], ['/parent/settings', '设置', 'settings']] as const;
export function ParentShell() {
 return <div className="parent-shell"><aside className="parent-sidebar"><Link to="/" className="brand"><span>✦</span> 小小学习星球</Link><p className="sidebar-label">管理工作台</p><nav>{nav.map(([to, label, icon]) => <NavLink key={to} to={to} className={({ isActive }) => isActive ? 'active' : ''}><Icon name={icon} />{label}</NavLink>)}</nav><Link to="/child/select" className="preview-link">↗ 预览儿童端</Link></aside><div className="parent-main"><header className="parent-topbar"><label className="search-box" aria-label="搜索"><Icon name="search" /><input aria-label="搜索课程、孩子或记录" placeholder="搜索课程、孩子或记录" /></label><Link className="button primary" to="/parent/courses?new=1"><Icon name="plus" size={17} />新增课程</Link><div className="account"><span className="avatar-small">家</span><span>家长账号<br /><small>管理者</small></span></div></header><main className="parent-content"><Outlet /></main></div></div>;
}
