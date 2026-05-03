import { Button, Dialog, DialogContent, InlineAlert, Input } from '@firebase-desk/ui';
import { useEffect, useMemo, useState } from 'react';
import { CodeEditor } from '../../code-editor/CodeEditor.tsx';
import { messageFromError } from '../../shared/errors.ts';
import { confirmDiscardUnsavedChanges } from '../../shared/unsavedDialogGuard.ts';
import {
  classifyFieldValue,
  defaultValueForType,
  editableTypeForValue,
  type FieldEditTarget,
  fieldPathLabel,
  FIRESTORE_EDITABLE_TYPES,
  type FirestoreEditableType,
  normalizeEditableValue,
  parseJsonValue,
  validateFirestoreValue,
} from './fieldEditModel.ts';

export interface FieldEditModalProps {
  readonly open: boolean;
  readonly target: FieldEditTarget | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSaveField?: (
    target: FieldEditTarget,
    value: unknown,
  ) => Promise<boolean | void> | boolean | void;
}

const selectClassName =
  'h-[var(--density-control-height)] rounded-md border border-border bg-bg-panel px-2 text-sm text-text-primary disabled:cursor-not-allowed disabled:opacity-60';

export function FieldEditModal(
  { onOpenChange, onSaveField, open, target }: FieldEditModalProps,
) {
  const initialType = useMemo(
    () => target ? classifyFieldValue(target.value).type : 'string',
    [target],
  );
  const [type, setType] = useState<FirestoreEditableType>(initialType);
  const [source, setSource] = useState('null');
  const [baselineSource, setBaselineSource] = useState('null');
  const [baselineType, setBaselineType] = useState<FirestoreEditableType>(initialType);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!target) return;
    const nextType = classifyFieldValue(target.value).type;
    const nextSource = JSON.stringify(normalizeEditableValue(target.value), null, 2);
    setBaselineType(nextType);
    setBaselineSource(nextSource);
    setType(nextType);
    setSource(nextSource);
    setError(null);
    setIsSaving(false);
  }, [target]);

  function setTypedValue(value: unknown) {
    setSource(JSON.stringify(value, null, 2));
    setError(null);
  }

  function changeType(nextType: FirestoreEditableType) {
    setType(nextType);
    setTypedValue(defaultValueForType(nextType, target?.value));
  }

  const parsedValue = safeParse(source);
  const showJsonEditor = type === 'array' || type === 'map';
  const hasUnsavedChanges = type !== baselineType || source !== baselineSource;

  function requestOpenChange(nextOpen: boolean) {
    if (
      !nextOpen && hasUnsavedChanges && !isSaving
      && !confirmDiscardUnsavedChanges('Discard unsaved field changes?')
    ) return;
    onOpenChange(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={requestOpenChange}>
      <DialogContent
        className='w-[min(680px,calc(100vw-32px))]'
        description={target ? target.documentPath : null}
        title={target ? `Edit ${fieldPathLabel(target.fieldPath)}` : 'Edit field'}
      >
        <div className='grid gap-3'>
          <div className='grid grid-cols-[minmax(120px,0.35fr)_minmax(0,1fr)] items-center gap-2'>
            <label className='text-sm font-medium text-text-secondary' htmlFor='field-edit-type'>
              Type
            </label>
            <select
              className={selectClassName}
              id='field-edit-type'
              value={type}
              onChange={(event) => changeType(event.currentTarget.value as FirestoreEditableType)}
            >
              {FIRESTORE_EDITABLE_TYPES.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </div>
          <TypedValueControl
            type={type}
            value={parsedValue.ok ? parsedValue.value : defaultValueForType(type)}
            onChange={setTypedValue}
          />
          {showJsonEditor
            ? (
              <div className='grid gap-1'>
                <div className='text-xs font-semibold text-text-secondary'>JSON value</div>
                <div className='h-48 overflow-hidden rounded-md border border-border-subtle'>
                  <CodeEditor
                    ariaLabel='Field JSON value'
                    language='json'
                    value={source}
                    onChange={setSource}
                  />
                </div>
              </div>
            )
            : null}
          {type === 'timestamp'
            ? (
              <div className='text-xs text-text-muted'>
                Timezone: {localTimeZone()}
              </div>
            )
            : null}
          {error ? <InlineAlert variant='danger'>{error}</InlineAlert> : null}
        </div>
        <div className='flex justify-end gap-2'>
          <Button disabled={isSaving} variant='ghost' onClick={() => requestOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={isSaving}
            variant='primary'
            onClick={async () => {
              if (!target) return;
              setIsSaving(true);
              setError(null);
              try {
                const value = parseJsonValue(source);
                validateFirestoreValue(value, target.fieldPath);
                const saved = await onSaveField?.(target, value);
                if (saved !== false) onOpenChange(false);
              } catch (caught) {
                setError(messageFromError(caught, 'Could not save field.'));
              } finally {
                setIsSaving(false);
              }
            }}
          >
            {isSaving ? 'Saving' : 'Save'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TypedValueControl(
  {
    onChange,
    type,
    value,
  }: {
    readonly onChange: (value: unknown) => void;
    readonly type: FirestoreEditableType;
    readonly value: unknown;
  },
) {
  if (type === 'boolean') {
    return (
      <label className='inline-flex items-center gap-2 text-sm text-text-primary'>
        <input
          checked={value === true}
          type='checkbox'
          onChange={(event) => onChange(event.currentTarget.checked)}
        />
        true
      </label>
    );
  }
  if (type === 'number') {
    return (
      <Input
        aria-label='Field number value'
        className='font-mono'
        type='number'
        value={typeof value === 'number' ? value : 0}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    );
  }
  if (type === 'string') {
    return (
      <Input
        aria-label='Field string value'
        className='font-mono'
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    );
  }
  if (type === 'null') {
    return <div className='text-sm text-text-secondary'>Value will be null.</div>;
  }
  if (type === 'timestamp') {
    return (
      <Input
        aria-label='Timestamp value'
        className='font-mono'
        type='datetime-local'
        value={timestampToLocalInputValue(encodedField(value, 'value'))}
        onChange={(event) =>
          onChange({
            __type__: 'timestamp',
            value: localInputValueToTimestamp(event.currentTarget.value),
          })}
      />
    );
  }
  if (type === 'reference') {
    return (
      <Input
        aria-label='Reference path'
        className='font-mono'
        value={encodedField(value, 'path')}
        onChange={(event) => onChange({ __type__: 'reference', path: event.currentTarget.value })}
      />
    );
  }
  if (type === 'bytes') {
    return (
      <Input
        aria-label='Bytes base64'
        className='font-mono'
        value={encodedField(value, 'base64')}
        onChange={(event) => onChange({ __type__: 'bytes', base64: event.currentTarget.value })}
      />
    );
  }
  if (type === 'geoPoint') {
    const latitude = encodedNumber(value, 'latitude');
    const longitude = encodedNumber(value, 'longitude');
    return (
      <div className='grid grid-cols-2 gap-2'>
        <label className='grid gap-1 text-xs font-semibold text-text-secondary'>
          Latitude
          <Input
            aria-label='GeoPoint latitude'
            className='font-mono'
            type='number'
            value={latitude}
            onChange={(event) =>
              onChange({
                __type__: 'geoPoint',
                latitude: Number(event.currentTarget.value),
                longitude,
              })}
          />
        </label>
        <label className='grid gap-1 text-xs font-semibold text-text-secondary'>
          Longitude
          <Input
            aria-label='GeoPoint longitude'
            className='font-mono'
            type='number'
            value={longitude}
            onChange={(event) =>
              onChange({
                __type__: 'geoPoint',
                latitude,
                longitude: Number(event.currentTarget.value),
              })}
          />
        </label>
      </div>
    );
  }
  return (
    <div className='text-sm text-text-secondary'>
      Edit {editableTypeForValue(value)} in JSON.
    </div>
  );
}

function safeParse(source: string): { readonly ok: true; readonly value: unknown; } | {
  readonly ok: false;
} {
  try {
    return { ok: true, value: JSON.parse(source) as unknown };
  } catch {
    return { ok: false };
  }
}

function encodedField(value: unknown, key: string): string {
  return value && typeof value === 'object' && !Array.isArray(value)
      && typeof (value as Record<string, unknown>)[key] === 'string'
    ? String((value as Record<string, unknown>)[key])
    : '';
}

function encodedNumber(value: unknown, key: string): number {
  return value && typeof value === 'object' && !Array.isArray(value)
      && typeof (value as Record<string, unknown>)[key] === 'number'
    ? Number((value as Record<string, unknown>)[key])
    : 0;
}

function timestampToLocalInputValue(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return [
    date.getFullYear(),
    padDatePart(date.getMonth() + 1),
    padDatePart(date.getDate()),
  ].join('-')
    + `T${
      [
        padDatePart(date.getHours()),
        padDatePart(date.getMinutes()),
        padDatePart(date.getSeconds()),
      ].join(':')
    }`;
}

function localInputValueToTimestamp(value: string): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function padDatePart(value: number): string {
  return String(value).padStart(2, '0');
}

function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
}
