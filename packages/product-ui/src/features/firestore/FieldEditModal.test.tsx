import { FirestoreTimestamp } from '@firebase-desk/data-format';
import { MockSettingsRepository } from '@firebase-desk/repo-mocks';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppearanceProvider } from '../../appearance/AppearanceProvider.tsx';
import { FieldEditModal } from './FieldEditModal.tsx';
import type { FieldEditTarget } from './fieldEditModel.ts';

vi.mock('../../code-editor/CodeEditor.tsx', () => ({
  CodeEditor: (
    { onChange, value }: {
      readonly onChange?: (value: string) => void;
      readonly value: string;
    },
  ) => (
    <textarea
      aria-label='JSON value'
      value={value}
      onChange={(event) => onChange?.(event.currentTarget.value)}
    />
  ),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FieldEditModal', () => {
  it('changes a boolean field to a number', async () => {
    const onSaveField = vi.fn<(target: FieldEditTarget, value: unknown) => void>();
    renderModal(onSaveField);

    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'number' } });
    fireEvent.change(screen.getByLabelText('Field number value'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(onSaveField).toHaveBeenCalledWith(
        expect.objectContaining({ fieldPath: ['active'] }),
        1,
      )
    );
  });

  it('does not show raw JSON for primitive fields', () => {
    const onSaveField = vi.fn<(target: FieldEditTarget, value: unknown) => void>();
    renderModal(onSaveField);

    expect(screen.queryByLabelText('JSON value')).toBeNull();
  });

  it('shows JSON validation errors without closing', async () => {
    const onSaveField = vi.fn<(target: FieldEditTarget, value: unknown) => void>();
    const onOpenChange = vi.fn();
    render(
      <AppearanceProvider settings={new MockSettingsRepository()}>
        <FieldEditModal
          open
          target={{ documentPath: 'orders/ord_1', fieldPath: ['meta'], value: { count: 1 } }}
          onOpenChange={onOpenChange}
          onSaveField={onSaveField}
        />
      </AppearanceProvider>,
    );

    fireEvent.change(screen.getByLabelText('JSON value'), { target: { value: '{' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/Expected property name|JSON/);
    expect(onSaveField).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('guards dirty field edits before closing', () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    const onOpenChange = vi.fn();
    render(
      <AppearanceProvider settings={new MockSettingsRepository()}>
        <FieldEditModal
          open
          target={{ documentPath: 'orders/ord_1', fieldPath: ['active'], value: true }}
          onOpenChange={onOpenChange}
          onSaveField={() => {}}
        />
      </AppearanceProvider>,
    );

    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'number' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(confirm).toHaveBeenCalledWith('Discard unsaved field changes?');
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('edits timestamps with a local date time input', async () => {
    const onSaveField = vi.fn<(target: FieldEditTarget, value: unknown) => void>();
    render(
      <AppearanceProvider settings={new MockSettingsRepository()}>
        <FieldEditModal
          open
          target={{
            documentPath: 'orders/ord_1',
            fieldPath: ['createdAt'],
            value: { __type__: 'timestamp', value: '2024-01-01T00:00:00.000Z' },
          }}
          onOpenChange={() => {}}
          onSaveField={onSaveField}
        />
      </AppearanceProvider>,
    );

    const input = screen.getByLabelText('Timestamp value') as HTMLInputElement;
    expect(input.type).toBe('datetime-local');
    fireEvent.change(input, { target: { value: '2024-01-02T03:04' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(onSaveField).toHaveBeenCalledWith(
        expect.objectContaining({ fieldPath: ['createdAt'] }),
        { __type__: 'timestamp', value: new Date('2024-01-02T03:04').toISOString() },
      )
    );
  });

  it('edits native timestamp values with the timestamp control', () => {
    const onSaveField = vi.fn<(target: FieldEditTarget, value: unknown) => void>();
    render(
      <AppearanceProvider settings={new MockSettingsRepository()}>
        <FieldEditModal
          open
          target={{
            documentPath: 'orders/ord_1',
            fieldPath: ['createdAt'],
            value: new FirestoreTimestamp('2024-01-01T00:00:00.000Z'),
          }}
          onOpenChange={() => {}}
          onSaveField={onSaveField}
        />
      </AppearanceProvider>,
    );

    expect((screen.getByLabelText('Type') as HTMLSelectElement).value).toBe('timestamp');
    expect(screen.getByLabelText('Timestamp value')).toBeTruthy();
    expect(screen.queryByLabelText('JSON value')).toBeNull();
  });

  it('labels geoPoint inputs', () => {
    const onSaveField = vi.fn<(target: FieldEditTarget, value: unknown) => void>();
    render(
      <AppearanceProvider settings={new MockSettingsRepository()}>
        <FieldEditModal
          open
          target={{
            documentPath: 'orders/ord_1',
            fieldPath: ['location'],
            value: { __type__: 'geoPoint', latitude: -37.81, longitude: 144.96 },
          }}
          onOpenChange={() => {}}
          onSaveField={onSaveField}
        />
      </AppearanceProvider>,
    );

    expect(screen.getByText('Latitude')).toBeTruthy();
    expect(screen.getByText('Longitude')).toBeTruthy();
  });
});

function renderModal(onSaveField: (target: FieldEditTarget, value: unknown) => void) {
  render(
    <AppearanceProvider settings={new MockSettingsRepository()}>
      <FieldEditModal
        open
        target={{ documentPath: 'orders/ord_1', fieldPath: ['active'], value: true }}
        onOpenChange={() => {}}
        onSaveField={onSaveField}
      />
    </AppearanceProvider>,
  );
}
