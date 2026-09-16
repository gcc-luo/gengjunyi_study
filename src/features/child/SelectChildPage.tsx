import { Link, useNavigate } from 'react-router-dom';
import { EmptyState } from '../../components/EmptyState';
import { useAppStore } from '../../context/AppStore';
import { ChildStatus } from '../../types/domain';

export function SelectChildPage() {
  const { children, setCurrentChild } = useAppStore();
  const navigate = useNavigate();
  const activeChildren = children.filter((child) => child.status === ChildStatus.ACTIVE);

  const selectChild = (id: string) => {
    setCurrentChild(id);
    navigate('/child/home');
  };

  return (
    <main className="child-page select-page">
      <div className="select-sky" aria-hidden="true"><span className="cloud cloud-one" /><span className="cloud cloud-two" /><span className="hill hill-back" /><span className="hill hill-front" /></div>
      <div className="child-page-heading select-heading">
        <p className="child-kicker">小小学习星球</p>
        <h1>谁来学习？</h1>
        <p>选择你的头像，开始今天的学习吧</p>
      </div>
      {activeChildren.length ? (
        <div className="select-child-grid">
          {activeChildren.map((child) => (
            <button className="select-child-card" type="button" key={child.id} onClick={() => selectChild(child.id)} aria-label={`选择${child.name}`}>
              <span className="select-avatar">{child.avatar}</span>
              <strong>{child.name}</strong>
              <span>{child.grade}</span>
              <span className="select-card-arrow">进入学习 <span aria-hidden="true">→</span></span>
            </button>
          ))}
        </div>
      ) : (
        <EmptyState title="还没有可选择的孩子" description="请让家长先创建一个孩子档案，再来开始学习。" />
      )}
      <Link className="parent-entry" to="/parent/overview">家长入口 <span aria-hidden="true">→</span></Link>
    </main>
  );
}
