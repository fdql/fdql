import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { JsonPreview } from './JsonPreview.tsx';

describe('JsonPreview', () => {
  it('renders formatted json lazily', async () => {
    render(<JsonPreview value={{ ok: true }} />);

    expect(screen.getByText('Formatting JSON...')).toBeTruthy();
    expect(await screen.findByText(/"ok": true/)).toBeTruthy();
  });

  it('does not stringify while inactive', () => {
    const toJSON = vi.fn(() => ({ ok: true }));

    render(<JsonPreview active={false} value={{ toJSON }} />);

    expect(toJSON).not.toHaveBeenCalled();
  });

  it('renders textarea previews as a fill element', async () => {
    render(<JsonPreview mode='textarea' value={{ ok: true }} />);

    const preview = await screen.findByLabelText('JSON preview');
    expect(preview.className).toContain('h-full');
    expect(preview.className).toContain('min-h-0');
  });

  it('restores scroll after lazy formatting remounts the preview', async () => {
    const value = { ok: true, rows: Array.from({ length: 50 }, (_, index) => index) };
    const { rerender } = render(
      <JsonPreview scrollRestorationKey='query-json' value={value} />,
    );
    const preview = await renderedPre();
    preview.scrollLeft = 7;
    preview.scrollTop = 42;
    fireEvent.scroll(preview);

    rerender(<JsonPreview active={false} scrollRestorationKey='query-json' value={value} />);
    rerender(<JsonPreview scrollRestorationKey='query-json' value={value} />);

    const restored = await renderedPre();
    await waitFor(() => {
      expect(restored.scrollLeft).toBe(7);
      expect(restored.scrollTop).toBe(42);
    });
  });
});

async function renderedPre(): Promise<HTMLPreElement> {
  const text = await screen.findByText(/"ok": true/);
  const pre = text.closest('pre');
  if (!(pre instanceof HTMLPreElement)) throw new Error('JSON preview pre missing');
  return pre;
}
