import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EmptyState } from '../../components/EmptyState';
import { ProgressBar } from '../../components/ProgressBar';
import { useAppStore } from '../../context/AppStore';
import { getCourseProgress, naturalCompare } from '../../lib/domain';
import { CourseStatus, VideoStatus } from '../../types/domain';

function durationText(seconds: number): string {
  return `${Math.max(1, Math.round(seconds / 60))} 分钟`;
}

export function CoursePage() {
  const { courseId } = useParams();
  const { courses, currentChildId, subjects, videos, snapshot } = useAppStore();
  const [tab, setTab] = useState<'catalog' | 'intro'>('catalog');
  const course = courses.find((item) => item.id === courseId && item.status === CourseStatus.PUBLISHED);

  if (!course) return <main className="child-page"><EmptyState title="课程暂时找不到" description="这门课程可能已经下架，去看看其他课程吧。" action={<Link className="button primary" to="/child/courses">返回课程</Link>} /></main>;

  const subject = subjects.find((item) => item.id === course.subjectId);
  const orderedVideos = course.videoIds.map((id) => videos.find((video) => video.id === id)).filter((video): video is NonNullable<typeof video> => Boolean(video)).sort((a, b) => naturalCompare(a.title, b.title) || a.orderIndex - b.orderIndex);
  const progress = currentChildId ? getCourseProgress(course, videos, snapshot.watchProgress, currentChildId) : 0;
  const progressFor = (videoId: string) => snapshot.watchProgress.find((item) => item.childId === currentChildId && item.videoId === videoId);

  return <main className="child-page course-detail-page"><Link className="child-back-link" to="/child/courses">← 返回课程</Link><section className="course-detail-hero"><div className="large-course-cover detail-course-cover" style={{ background: `linear-gradient(135deg, ${course.cover.colors.join(',')})` }}><span>{subject?.icon ?? '✦'}</span><small>{subject?.name ?? course.subjectId}</small></div><div className="course-detail-copy"><p className="child-kicker">{subject?.name ?? course.subjectId} · {course.ageRange || '适合所有小朋友'}</p><h1>{course.title}</h1><p>{course.description || '跟着课程一起发现新知识。'}</p><div className="course-meta"><span>{orderedVideos.length} 集内容</span><span>已完成 {Math.round(progress * 100)}%</span></div><ProgressBar value={progress} label={`${course.title}课程完成度`} /></div></section><div className="course-tabs" role="tablist"><button id="course-catalog-tab" type="button" role="tab" aria-controls="course-catalog-panel" aria-selected={tab === 'catalog'} className={tab === 'catalog' ? 'active' : ''} onClick={() => setTab('catalog')}>课程目录</button><button id="course-intro-tab" type="button" role="tab" aria-controls="course-intro-panel" aria-selected={tab === 'intro'} className={tab === 'intro' ? 'active' : ''} onClick={() => setTab('intro')}>课程介绍</button></div>{tab === 'intro' ? <section id="course-intro-panel" className="course-intro panel" role="tabpanel" aria-labelledby="course-intro-tab"><h2>关于这门课</h2><p>{course.description || '这是一门为小朋友准备的趣味课程，按自己的节奏学习每一集内容吧。'}</p><div className="intro-note">适龄：{course.ageRange || '所有年龄'}<br />共 {orderedVideos.length} 集，每一集都可以自由选择。</div></section> : <section id="course-catalog-panel" className="catalog-list" role="tabpanel" aria-labelledby="course-catalog-tab">{orderedVideos.length ? orderedVideos.map((video, index) => { const item = progressFor(video.id); const completed = Boolean(item?.completed); const percent = item ? Math.round(item.maxProgress * 100) : 0; return <div className={`catalog-row ${completed ? 'is-complete' : ''}`} data-testid={`video-row-${video.id}`} key={video.id}><span className="catalog-number">{completed ? '✓' : index + 1}</span><span className="catalog-main"><strong>{video.title}</strong><small>{durationText(video.durationSeconds)}{completed ? ' · 已完成' : percent ? ` · 已学习 ${percent}%` : ''}</small></span>{video.status === VideoStatus.READY ? <Link className="catalog-play" to={`/child/watch/${video.id}`} aria-label={`播放 ${video.title}`}>{completed ? '再看一次' : item ? '继续学习' : '开始学习'} <span aria-hidden="true">→</span></Link> : <span className="catalog-unavailable">暂不可播放</span>}</div>; }) : <EmptyState title="课程还没有视频" description="请让家长为课程添加视频内容。" />}</section>}</main>;
}
