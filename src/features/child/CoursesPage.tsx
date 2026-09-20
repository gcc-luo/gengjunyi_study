import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { EmptyState } from '../../components/EmptyState';
import { ProgressBar } from '../../components/ProgressBar';
import { useAppStore } from '../../context/AppStore';
import { getCourseProgress } from '../../lib/domain';
import { CourseStatus } from '../../types/domain';
import { FREE_CHOICE_STORAGE_KEY } from './preferences';
import { apiRequest } from '../../lib/api-client';

export function CoursesPage() {
  const { childCourses: courses, currentChildId, favorites, subjects, childVideos: videos, snapshot, isRemote } = useAppStore();
  const settings = useQuery({ queryKey: ['family', 'settings'], queryFn: () => apiRequest<{ freeChoice: boolean }>('/api/settings'), enabled: isRemote });
  const [searchParams] = useSearchParams();
  const subjectId = searchParams.get('subject') ?? searchParams.get('subjectId') ?? '';
  const mineOnly = searchParams.get('mine') === '1';
  const favoriteOnly = searchParams.get('favorite') === '1';
  const freeChoice = isRemote ? settings.data?.freeChoice ?? true : window.localStorage.getItem(FREE_CHOICE_STORAGE_KEY) !== 'false';
  const publishedCourses = courses.filter((course) => {
    if (course.status !== CourseStatus.PUBLISHED) return false;
    if (subjectId && course.subjectId !== subjectId) return false;
    if ((!freeChoice || mineOnly) && !course.videoIds.some((videoId) => snapshot.watchProgress.some((item) => item.childId === currentChildId && item.videoId === videoId && item.totalWatchSeconds > 0))) return false;
    if (favoriteOnly && !favorites.some((favorite) => favorite.courseId === course.id || (favorite.videoId && course.videoIds.includes(favorite.videoId)))) return false;
    return true;
  });

  const emptyDescription = freeChoice ? '换个学科试试，或者请让家长添加学习内容。' : '当前孩子还没有已学习的课程，请先开始一段学习。';
  return <main className="child-page courses-page"><div className="child-page-heading"><p className="child-kicker">知识探险地图</p><h1>{subjectId ? subjects.find((subject) => subject.id === subjectId)?.name ?? '课程' : mineOnly ? '我的课程' : favoriteOnly ? '我的收藏' : '全部课程'}</h1><p>挑一门喜欢的课程，开始今天的探索。</p></div>{publishedCourses.length ? <div className="child-course-grid">{publishedCourses.map((course) => { const progress = currentChildId ? getCourseProgress(course, videos, snapshot.watchProgress, currentChildId) : 0; const subject = subjects.find((item) => item.id === course.subjectId); return <Link className="child-course-card" to={`/child/course/${course.id}`} key={course.id}><div className="large-course-cover" style={{ background: `linear-gradient(135deg, ${course.cover.colors.join(',')})` }}><span>{subject?.icon ?? '✦'}</span><small>{subject?.name ?? course.subjectId}</small></div><div className="child-course-card-body"><h2>{course.title}</h2><p>{course.ageRange || '适合所有小朋友'} · {course.videoIds.length} 集</p><ProgressBar value={progress} label={`${course.title}课程进度`} /></div></Link>; })}</div> : <EmptyState title="还没有找到课程" description={emptyDescription} action={<Link className="button primary" to="/child/courses">浏览全部课程</Link>} />}</main>;
}
