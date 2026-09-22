import type { ReactNode } from 'react';
import type { SubjectId } from '../types/domain';

function EnglishSticker() {
  return <>
    <rect x="13" y="12" width="25" height="29" rx="6" fill="#fff" opacity=".92" transform="rotate(-8 25 27)" />
    <text x="19" y="32" fill="var(--sticker-main)" fontSize="18" fontWeight="800" fontFamily="Noto Sans SC, Microsoft YaHei, sans-serif">A</text>
    <path d="m37 38 12-20 4 4-12 20-6 2 2-6Z" fill="var(--sticker-accent)" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" />
    <path d="m47 22 4 4" stroke="#ff8a6f" strokeWidth="1.5" strokeLinecap="round" />
    <path d="m39 36 4 4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
  </>;
}

function ChineseSticker() {
  return <>
    <path d="M11 24c8-5 13-4 21 1v18c-8-4-13-4-21-1V24Z" fill="#fff" opacity=".94" />
    <path d="M53 12 43 22l-4-4L49 8l4 4Z" fill="var(--sticker-accent)" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" />
    <path d="m40 19-7 15" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
    <path d="M32 25c-6-3-11-3-17 0M32 29c-6-3-11-3-17 0M32 34c-6-3-11-3-17 0" stroke="var(--sticker-main)" strokeWidth="1.4" strokeLinecap="round" opacity=".75" />
    <text x="36" y="43" fill="#fff" fontSize="16" fontWeight="800" fontFamily="Noto Sans SC, Microsoft YaHei, sans-serif">文</text>
  </>;
}

function MathSticker() {
  return <>
    <rect x="13" y="28" width="13" height="15" rx="3" fill="#fff" opacity=".92" />
    <rect x="26" y="21" width="14" height="22" rx="3" fill="var(--sticker-accent)" stroke="#fff" strokeWidth="1.6" />
    <rect x="40" y="14" width="11" height="29" rx="3" fill="#fff" opacity=".94" />
    <text x="16" y="39" fill="var(--sticker-main)" fontSize="9" fontWeight="800" fontFamily="Noto Sans SC, Microsoft YaHei, sans-serif">1</text>
    <text x="29" y="36" fill="#fff" fontSize="11" fontWeight="800" fontFamily="Noto Sans SC, Microsoft YaHei, sans-serif">2</text>
    <text x="42" y="33" fill="var(--sticker-main)" fontSize="9" fontWeight="800" fontFamily="Noto Sans SC, Microsoft YaHei, sans-serif">3</text>
    <path d="M47 10v5M44.5 12.5h5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
  </>;
}

function ScienceSticker() {
  return <>
    <circle cx="45" cy="17" r="7" fill="var(--sticker-accent)" opacity=".9" />
    <path d="M25 13c5 1 12 7 14 13l-8 10-10-8c-2-5 0-11 4-15Z" fill="#fff" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" />
    <path d="m22 29-7 7 8-2 5-5" fill="var(--sticker-accent)" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" />
    <path d="m32 21 7-7" stroke="var(--sticker-main)" strokeWidth="2" strokeLinecap="round" />
    <circle cx="29" cy="25" r="3" fill="var(--sticker-main)" />
    <path d="m48 33 1.5 3.5L53 38l-3.5 1.5L48 43l-1.5-3.5L43 38l3.5-1.5L48 33Z" fill="#fff" />
  </>;
}

function FallbackSticker() {
  return <>
    <circle cx="32" cy="27" r="14" fill="#fff" opacity=".94" />
    <path d="m32 15 3.5 8.5L44 27l-8.5 3.5L32 39l-3.5-8.5L20 27l8.5-3.5L32 15Z" fill="var(--sticker-accent)" />
  </>;
}

const stickerArt: Record<SubjectId, ReactNode> = {
  english: <EnglishSticker />,
  chinese: <ChineseSticker />,
  math: <MathSticker />,
  science: <ScienceSticker />,
};

export function SubjectStickerIcon({ subjectId }: { subjectId: SubjectId }) {
  return <span className={`course-cover subject-sticker subject-sticker-${subjectId}`} data-testid={`subject-sticker-${subjectId}`} aria-hidden="true">
    <svg viewBox="0 0 64 58" width="56" height="52" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 6c5-5 12-3 17-4 6-1 13-3 18 2 5 5 12 7 13 14 1 7-3 12-4 18-1 7-8 12-15 13-7 1-13-3-20-2-7 1-14-3-16-9-3-7 2-13 1-19-1-5 2-10 6-13Z" fill="#fff" />
      <path d="M11 8c5-4 11-2 16-3 6-1 12-2 17 2 5 4 10 6 11 12 1 6-3 11-4 17-1 6-7 10-13 11-7 1-12-3-19-2-6 1-12-2-14-8-2-6 2-11 1-17-1-5 2-9 5-12Z" fill="var(--sticker-main)" stroke="#fff" strokeWidth="2.5" strokeLinejoin="round" />
      {stickerArt[subjectId] ?? <FallbackSticker />}
    </svg>
  </span>;
}
