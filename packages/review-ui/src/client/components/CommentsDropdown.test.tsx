import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { CommentsDropdown } from './CommentsDropdown';

describe('CommentsDropdown', () => {
  it('should show "View All Comments" option when dropdown is open', () => {
    const onDeleteAll = vi.fn();
    const onViewAll = vi.fn();

    render(<CommentsDropdown commentsCount={3} onDeleteAll={onDeleteAll} onViewAll={onViewAll} />);

    fireEvent.click(screen.getByTitle('코멘트 액션'));

    expect(screen.getByText('전체 코멘트 보기')).toBeInTheDocument();
  });

  it('should call onViewAll when "View All Comments" is clicked', () => {
    const onDeleteAll = vi.fn();
    const onViewAll = vi.fn();

    render(<CommentsDropdown commentsCount={3} onDeleteAll={onDeleteAll} onViewAll={onViewAll} />);

    fireEvent.click(screen.getByTitle('코멘트 액션'));
    fireEvent.click(screen.getByText('전체 코멘트 보기'));

    expect(onViewAll).toHaveBeenCalledTimes(1);
  });

  it('should disable "View All Comments" when no comments', () => {
    const onDeleteAll = vi.fn();
    const onViewAll = vi.fn();

    render(<CommentsDropdown commentsCount={0} onDeleteAll={onDeleteAll} onViewAll={onViewAll} />);

    fireEvent.click(screen.getByTitle('코멘트 액션'));

    expect(screen.getByText('전체 코멘트 보기')).toHaveAttribute('disabled');
  });
});
