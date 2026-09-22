import type { ReactNode } from 'react';
import type { SubjectId } from '../types/domain';

function EnglishArt() {
  return <>
    <rect x="15" y="15" width="23" height="27" rx="5" fill="#fff" opacity=".96" transform="rotate(-7 27 28)" />
    <text x="21" y="34" fill="var(--sticker-main)" fontSize="17" fontWeight="800" fontFamily="Noto Sans SC, Microsoft YaHei, sans-serif">A</text>
    <path d="m38 39 10-18 5 5-11 18-6 2 2-7Z" fill="var(--sticker-accent)" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" />
    <path d="m47 23 5 5" stroke="#f47e83" strokeWidth="1.5" strokeLinecap="round" />
  </>;
}

function ChineseArt() {
  return <>
    <path d="M12 25c7-4 12-3 20 1v17c-8-3-13-3-20-1V25ZM52 25c-7-4-12-3-20 1v17c8-3 13-3 20-1V25Z" fill="#fff" opacity=".96" />
    <path d="M32 26v17" stroke="#bebaff" strokeWidth="1.5" />
    <path d="m42 13 9 9-12 12-4-4 7-17Z" fill="var(--sticker-accent)" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" />
    <path d="m39 18-6 15" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
  </>;
}

function MathArt() {
  return <>
    <rect x="12" y="29" width="12" height="13" rx="3" fill="#fff" opacity=".96" />
    <rect x="26" y="22" width="13" height="20" rx="3" fill="#fff" opacity=".82" />
    <rect x="41" y="14" width="11" height="28" rx="3" fill="#fff" opacity=".96" />
    <path d="M18 24v-7M14.5 20.5h7" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
    <circle cx="47" cy="21" r="2" fill="var(--sticker-accent)" />
  </>;
}

function ScienceArt() {
  return <>
    <circle cx="33" cy="28" r="11" fill="#9b98ff" stroke="#fff" strokeWidth="1.8" />
    <path d="M25 23c3-3 7-5 12-5 2 2 4 4 5 7-4 2-10 3-17 1v-3Z" fill="#c9c7ff" opacity=".85" />
    <circle cx="29" cy="29" r="2" fill="#7774e8" opacity=".7" />
    <circle cx="38" cy="34" r="1.7" fill="#7774e8" opacity=".7" />
    <ellipse cx="33" cy="28" rx="19" ry="7" transform="rotate(-18 33 28)" stroke="var(--sticker-accent)" strokeWidth="2.5" />
    <path d="m49 11 1.5 4L55 17l-4.5 1.5L49 23l-1.5-4.5L43 17l4.5-2L49 11Z" fill="#fff" />
  </>;
}

function FallbackArt() {
  return <path d="m32 14 4 9 9 4-9 4-4 9-4-9-9-4 9-4 4-9Z" fill="#fff" opacity=".96" />;
}

const stickerArt: Record<SubjectId, ReactNode> = {
  english: <EnglishArt />,
  chinese: <ChineseArt />,
  math: <MathArt />,
  science: <ScienceArt />,
};

export function SubjectStickerIcon({ subjectId }: { subjectId: SubjectId }) {
  return <span className={`course-cover subject-sticker subject-sticker-${subjectId}`} data-testid={`subject-sticker-${subjectId}`} aria-hidden="true">
    <svg viewBox="0 0 64 58" width="48" height="48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="6" y="4" width="52" height="50" rx="15" fill="var(--sticker-main)" />
      <path d="M13 10c6-5 14-3 20-4 8-2 16 2 18 8" stroke="#fff" strokeWidth="4" strokeLinecap="round" opacity=".24" />
      <path d="M9 39c8 6 18 7 28 4 8-3 15-7 21-15v11c-6 10-18 14-30 14-8 0-15-3-19-8V39Z" fill="#1f3b99" opacity=".13" />
      {stickerArt[subjectId] ?? <FallbackArt />}
    </svg>
  </span>;
}
