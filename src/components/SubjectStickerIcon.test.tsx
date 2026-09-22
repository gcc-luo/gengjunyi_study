import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SubjectStickerIcon } from './SubjectStickerIcon';

afterEach(cleanup);

describe('SubjectStickerIcon', () => {
  it('renders one soft 3D badge for each subject type', () => {
    (['english', 'chinese', 'math', 'science'] as const).forEach((subjectId) => {
      const { unmount } = render(<SubjectStickerIcon subjectId={subjectId} />);
      const badge = screen.getByTestId(`subject-sticker-${subjectId}`);

      expect(badge).toHaveClass('subject-sticker', `subject-sticker-${subjectId}`);
      expect(badge.querySelector('svg')).toBeInTheDocument();
      unmount();
    });
  });
});
