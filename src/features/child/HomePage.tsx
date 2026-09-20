import { Link } from 'react-router-dom';
import { EmptyState } from '../../components/EmptyState';
import { Icon } from '../../components/Icon';
import { ProgressBar } from '../../components/ProgressBar';
import { useAppStore } from '../../context/AppStore';
import { getCourseProgress } from '../../lib/domain';
import englishCardPoster from '../../assets/subjects/english-card-poster.png';
import chineseCardPoster from '../../assets/subjects/chinese-card-poster.png';
import mathCardPoster from '../../assets/subjects/math-card-poster.png';
import scienceCardPoster from '../../assets/subjects/science-card-poster.png';
import { CourseStatus, VideoStatus, type Course, type SubjectId, type Video } from '../../types/domain';

const subjectBackgrounds: Record<SubjectId, string> = {
  english: englishCardPoster,
  chinese: chineseCardPoster,
  math: mathCardPoster,
  science: scienceCardPoster,
};

function durationText(seconds: number): string {
  return `${Math.max(1, Math.round(seconds / 60))} 分钟`;
}

function subjectName(subjectId: string, subjects: { id: string; name: string }[]): string {
  return subjects.find((subject) => subject.id === subjectId)?.name ?? subjectId;
}

function continueLearning(childId: string | null, courses: Course[], videos: Video[], progress: ReturnType<typeof useAppStore>['snapshot']['watchProgress']): Video | undefined {
  if (!childId) return undefined;
  const publishedIds = new Set(courses.filter((course) => course.status === CourseStatus.PUBLISHED).map((course) => course.id));
  const candidates = progress
    .filter((item) => item.childId === childId && !item.completed)
    .map((item) => ({ item, video: videos.find((video) => video.id === item.videoId) }))
    .filter((entry): entry is { item: typeof entry.item; video: Video } => Boolean(entry.video && entry.video.status === VideoStatus.READY && publishedIds.has(entry.video.courseId)))
    .sort((a, b) => b.item.updatedAt.localeCompare(a.item.updatedAt));
  return candidates[0]?.video;
}

export function HomePage() {
  const { currentChild, currentChildId, childCourses: courses, subjects, childVideos: videos, snapshot } = useAppStore();
  const publishedCourses = courses.filter((course) => course.status === CourseStatus.PUBLISHED);
  const nextVideo = continueLearning(currentChildId, courses, videos, snapshot.watchProgress);

  if (!currentChild || !currentChildId) {
    return <main className="child-page"><EmptyState title="先选择一个孩子" description="选择头像后，就能看到专属学习内容。" action={<Link className="button primary" to="/child/select">去选择孩子</Link>} /></main>;
  }

  return (
    <main className="child-page home-page">
      <section className="child-greeting">
        <div><p className="child-kicker">今天也要闪闪发光</p><h1>你好，{currentChild.name}</h1><p>准备好继续探索了吗？</p></div>
        <Link className="home-avatar" to="/child/me" aria-label="打开我的页面">{currentChild.avatar}</Link>
      </section>

      <section className="continue-card">
        <div className="continue-copy"><span className="continue-label">继续学习</span>{nextVideo ? <><h2>{nextVideo.title}</h2><p>{subjectName(courses.find((course) => course.id === nextVideo.courseId)?.subjectId ?? '', subjects)} · {durationText(nextVideo.durationSeconds)}</p><Link className="button primary" to={`/child/watch/${nextVideo.id}`}><Icon name="play" size={15} />继续观看</Link></> : <><h2>开启第一段学习</h2><p>从喜欢的课程开始，认识更多有趣的知识。</p><Link className="button primary" to="/child/courses">去选课程</Link></>}</div>
        <div className="continue-illustration" aria-hidden="true">✦<span>▶</span></div>
      </section>

      <section className="child-section"><div className="child-section-heading"><h2>探索学科</h2><Link to="/child/courses">全部课程</Link></div><div className="subject-grid">{subjects.map((subject) => <Link className={`subject-card subject-${subject.id}`} aria-label={subject.name} style={{ backgroundImage: `url(${subjectBackgrounds[subject.id]})` }} to={`/child/courses?subject=${subject.id}`} key={subject.id} />)}</div></section>

      <section className="child-section"><div className="child-section-heading"><h2>我的课程</h2><Link to="/child/courses?mine=1">查看全部</Link></div>{publishedCourses.length ? <div className="child-course-list">{publishedCourses.slice(0, 3).map((course) => { const courseProgress = getCourseProgress(course, videos, snapshot.watchProgress, currentChildId); return <Link className="child-course-row" to={`/child/course/${course.id}`} key={course.id}><span className="course-cover" style={{ background: `linear-gradient(135deg, ${course.cover.colors.join(',')})` }}>{subjectName(course.subjectId, subjects).slice(0, 1)}</span><span className="child-course-info"><strong>{course.title}</strong><small>{subjectName(course.subjectId, subjects)} · {course.videoIds.length} 集</small><span data-testid={`course-progress-${course.id}`}><ProgressBar value={courseProgress} label={`${course.title}课程进度`} /></span></span><span className="row-arrow" aria-hidden="true">›</span></Link>; })}</div> : <EmptyState title="还没有课程" description="请让家长添加学习内容。" />}</section>
    </main>
  );
}
