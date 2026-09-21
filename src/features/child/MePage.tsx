import { Link } from 'react-router-dom';
import { EmptyState } from '../../components/EmptyState';
import { useAppStore } from '../../context/AppStore';
import { getStreakDays } from '../../lib/domain';
import { CourseStatus } from '../../types/domain';
import { APP_VERSION, readEyeCarePreference, writeEyeCarePreference } from './preferences';
import { useState } from 'react';

export function MePage() {
  const { currentChild, currentChildId, childCourses: courses, snapshot } = useAppStore();
  const [eyeCare, setEyeCare] = useState(readEyeCarePreference);

  if (!currentChild || !currentChildId) return <main className="child-page"><EmptyState title="还没有选择孩子" description="先选择一个孩子，再查看学习成长。" action={<Link className="button primary" to="/child/select">去选择孩子</Link>} /></main>;

  const publishedCourses = courses.filter((course) => course.status === CourseStatus.PUBLISHED);
  const learnedCourseCount = publishedCourses.filter((course) => course.videoIds.some((videoId) => snapshot.watchProgress.some((item) => item.childId === currentChildId && item.videoId === videoId && item.totalWatchSeconds > 0))).length;
  const completedVideos = snapshot.watchProgress.filter((item) => item.childId === currentChildId && item.completed).length;
  const studyDays = getStreakDays(snapshot.watchEvents, currentChildId);
  const toggleEyeCare = (enabled: boolean) => { setEyeCare(enabled); writeEyeCarePreference(enabled); };

  return <main className="child-page me-page"><section className="me-profile"><span className="me-avatar">{currentChild.avatar}</span><div><p className="child-kicker">我的学习星球</p><h1>{currentChild.name}</h1><p>{currentChild.grade}</p></div><Link className="profile-edit-link" to="/child/select" aria-label="切换孩子">切换</Link></section><section className="me-stats"><div><strong>{learnedCourseCount}</strong><span>已学课程</span></div><div><strong>{completedVideos}</strong><span>完成视频</span></div><div><strong>{studyDays}</strong><span>学习天数</span></div></section><section className="me-links panel"><Link to="/child/courses?mine=1"><span className="me-link-icon blue">▣</span><span><strong>我的课程</strong><small>继续完成喜欢的课程</small></span><span>›</span></Link><Link to="/child/records"><span className="me-link-icon green">◷</span><span><strong>学习记录</strong><small>看看每天的学习足迹</small></span><span>›</span></Link><Link to="/child/courses?favorite=1"><span className="me-link-icon yellow">♡</span><span><strong>我的收藏</strong><small>收藏的课程和视频</small></span><span>›</span></Link><Link to="/child/select"><span className="me-link-icon purple">↔</span><span><strong>切换孩子</strong><small>换一个小伙伴学习</small></span><span>›</span></Link></section><section className="me-preferences panel"><div className="setting-toggle"><span><strong>护眼模式</strong><small>降低页面对比度，学习更舒适</small></span><input type="checkbox" aria-label="护眼模式" checked={eyeCare} onChange={(event) => toggleEyeCare(event.target.checked)} /></div></section><p className="child-version">版本 {APP_VERSION}</p></main>;
}
