import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { EmptyState } from '../../components/EmptyState';
import { useAppStore } from '../../context/AppStore';
import { ChildStatus } from '../../types/domain';

export function SelectChildPage() {
  const { children, setCurrentChild } = useAppStore();
  const navigate = useNavigate();
  const [selectingChildId, setSelectingChildId] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState('');
  const activeChildren = children.filter((child) => child.status === ChildStatus.ACTIVE);
  const hasSingleChild = activeChildren.length === 1;

  const selectChild = async (id: string) => {
    setSelectingChildId(id);
    setSelectionError('');
    try {
      const result = setCurrentChild(id);
      if (result && typeof (result as Promise<void>).then === 'function') await result;
      navigate('/child/home');
    } catch (cause) {
      setSelectionError(cause instanceof Error ? cause.message : '暂时无法选择这个孩子，请重试。');
    } finally {
      setSelectingChildId(null);
    }
  };

  return (
    <main className="child-page select-page">
      <div className={`select-sky${hasSingleChild ? ' single' : ''}`} aria-hidden="true"><span className="cloud cloud-one" /><span className="cloud cloud-two" /><span className="hill hill-back" /><span className="hill hill-front" /></div>
      <div className="child-page-heading select-heading">
        <p className="child-kicker">小小学习星球</p>
        <h1>谁来学习？</h1>
        <p>选择你的头像，开始今天的学习吧</p>
      </div>
      {activeChildren.length ? (
        <div className={`select-child-grid${hasSingleChild ? ' single' : ''}`}>
          {activeChildren.map((child) => (
            <button className="select-child-card" type="button" key={child.id} onClick={() => void selectChild(child.id)} aria-label={`选择${child.name}`} disabled={selectingChildId !== null}>
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
      {selectionError && <p className="form-error" role="alert">{selectionError}</p>}
      <Link className="parent-entry" to="/parent/overview">家长入口 <span aria-hidden="true">→</span></Link>
    </main>
  );
}
