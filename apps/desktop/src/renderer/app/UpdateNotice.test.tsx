import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UpdateNotice } from './UpdateNotice.tsx';

describe('UpdateNotice', () => {
  it('opens and dismisses available updates', () => {
    const onDismiss = vi.fn();
    const onOpenRelease = vi.fn();

    render(
      <UpdateNotice
        message='Update 0.0.7 available'
        status='available'
        onDismiss={onDismiss}
        onOpenRelease={onOpenRelease}
        onRetry={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open release' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(onOpenRelease).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('retries failed checks', () => {
    const onRetry = vi.fn();

    render(
      <UpdateNotice
        message='Update check failed: network down'
        status='failed'
        onDismiss={vi.fn()}
        onOpenRelease={vi.fn()}
        onRetry={onRetry}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(screen.getByRole('alert').textContent).toContain('network down');
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
