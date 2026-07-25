import {
  FirestoreBytes,
  FirestoreGeoPoint,
  FirestoreReference,
  FirestoreTimestamp,
} from '@firebase-desk/data-format';
import { type ReactNode } from 'react';
import {
  firestoreValueType as registryFirestoreValueType,
  isPlainObject,
} from './firestoreTypeRegistry.ts';

interface TypedValueSummary {
  readonly label?: string | undefined;
  readonly title?: string;
  readonly value: string;
}

export function FirestoreValueCell({ value }: { readonly value: unknown; }): ReactNode {
  const typed = typedValueSummary(value);
  if (!typed) {
    const plain = plainValueSummary(value);
    if (!plain) return formatFirestoreValue(value);
    return (
      <span className='select-text font-mono text-xs text-text-primary' title={plain.title}>
        {plain.value}
      </span>
    );
  }
  return (
    <span
      className={`inline-flex max-w-full select-text items-center overflow-hidden align-middle ${
        typed.label ? 'gap-1.5' : ''
      }`}
      title={typed.title ?? typed.value}
    >
      {typed.label
        ? (
          <span className='shrink-0 rounded border border-border-subtle bg-bg-subtle px-1 py-0.5 font-mono text-[10px] leading-none text-text-muted'>
            {typed.label}
          </span>
        )
        : null}
      <span className='min-w-0 truncate font-mono text-xs text-text-primary'>
        {truncateFieldDisplayValue(typed.value)}
      </span>
    </span>
  );
}

function plainValueSummary(
  value: unknown,
): { readonly title: string; readonly value: string; } | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value) && typeof value !== 'object') return null;
  const title = safeJson(value);
  if (!title) return null;
  return { title, value: compactJsonPreview(value) };
}

export function formatFirestoreValue(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  const typed = typedValueSummary(value);
  if (typed) return truncateFieldDisplayValue(typed.value);
  if (Array.isArray(value) || typeof value === 'object') return compactJsonPreview(value);
  return truncateFieldDisplayValue(String(value));
}

export function firestoreValueType(value: unknown): string {
  return registryFirestoreValueType(value);
}

export function isFirestoreTypedValue(value: unknown): boolean {
  return typedValueSummary(value) !== null;
}

function typedValueSummary(value: unknown): TypedValueSummary | null {
  if (value instanceof FirestoreTimestamp) {
    return timestampSummary({ value: value.isoString });
  }
  if (value instanceof FirestoreGeoPoint) {
    return geoPointSummary({ latitude: value.latitude, longitude: value.longitude });
  }
  if (value instanceof FirestoreReference) {
    return referenceSummary({ path: value.path });
  }
  if (value instanceof FirestoreBytes) {
    return bytesSummary({ base64: value.base64 });
  }
  if (!isPlainObject(value)) return null;
  const fdqlType = value['__fdqlType'];
  if (typeof fdqlType === 'string') return fdqlTypedValueSummary(fdqlType, value);
  const type = value['__type__'];
  if (typeof type !== 'string') return null;
  switch (type) {
    case 'timestamp':
      return timestampSummary(value);
    case 'geoPoint':
      return geoPointSummary(value);
    case 'reference':
      return referenceSummary(value);
    case 'bytes':
      return bytesSummary(value);
    case 'array':
      return encodedArraySummary(value);
    case 'map':
      return encodedMapSummary(value);
    case 'truncated':
      return truncatedSummary(value);
    default: {
      const title = safeJson(value);
      return {
        label: shortLabel(type),
        ...(title ? { title } : {}),
        value: `Object(${Math.max(Object.keys(value).length - 1, 0)})`,
      };
    }
  }
}

function fdqlTypedValueSummary(type: string, value: Record<string, unknown>): TypedValueSummary {
  switch (type) {
    case 'timestamp':
      return timestampSummary(value);
    case 'geoPoint':
      return geoPointSummary(value);
    case 'bytes':
      return bytesSummary(value);
    case 'providerValue':
      return providerValueSummary(value);
    default: {
      const title = safeJson(value);
      return {
        label: shortLabel(type),
        ...(title ? { title } : {}),
        value: `Object(${Math.max(Object.keys(value).length - 1, 0)})`,
      };
    }
  }
}

function timestampSummary(value: Record<string, unknown>): TypedValueSummary {
  const raw = typeof value['value'] === 'string' ? value['value'] : '';
  return {
    ...(raw ? { title: raw } : {}),
    value: formatUserTimestamp(raw),
  };
}

function geoPointSummary(value: Record<string, unknown>): TypedValueSummary {
  const latitude = value['latitude'];
  const longitude = value['longitude'];
  return {
    label: 'geo',
    value: typeof latitude === 'number' && typeof longitude === 'number'
      ? `${formatCoordinate(latitude)}, ${formatCoordinate(longitude)}`
      : 'Invalid location',
  };
}

function referenceSummary(value: Record<string, unknown>): TypedValueSummary {
  const path = typeof value['path'] === 'string' ? value['path'] : '';
  return {
    label: 'ref',
    ...(path ? { title: path } : {}),
    value: path || 'Invalid reference',
  };
}

function bytesSummary(value: Record<string, unknown>): TypedValueSummary {
  const base64 = typeof value['base64'] === 'string' ? value['base64'] : '';
  return {
    label: 'bytes',
    ...(base64 ? { title: base64 } : {}),
    value: `${base64ByteCount(base64)} bytes`,
  };
}

function providerValueSummary(value: Record<string, unknown>): TypedValueSummary {
  const display = typeof value['display'] === 'string' ? value['display'] : '';
  const provider = typeof value['provider'] === 'string' ? value['provider'] : 'provider';
  const valueType = typeof value['valueType'] === 'string' ? value['valueType'] : 'value';
  const title = safeJson(value);
  return {
    label: shortLabel(provider),
    ...(title ? { title } : {}),
    value: display || `${provider}.${valueType}`,
  };
}

function encodedArraySummary(value: Record<string, unknown>): TypedValueSummary {
  const entries = value['value'];
  const title = safeJson(entries);
  return {
    label: 'array',
    ...(title ? { title } : {}),
    value: Array.isArray(entries) ? compactJsonPreview(entries) : 'Invalid array',
  };
}

function encodedMapSummary(value: Record<string, unknown>): TypedValueSummary {
  const entries = value['value'];
  const title = safeJson(entries);
  return {
    label: 'map',
    ...(title ? { title } : {}),
    value: isPlainObject(entries) ? compactJsonPreview(entries) : 'Invalid map',
  };
}

function truncatedSummary(value: Record<string, unknown>): TypedValueSummary {
  const sizeBytes = typeof value['sizeBytes'] === 'number' ? value['sizeBytes'] : 0;
  const valueType = typeof value['valueType'] === 'string' ? value['valueType'] : 'value';
  const formatted = formatBytes(sizeBytes);
  return {
    label: 'trunc',
    title: `${valueType} value omitted (${formatted}). Reload the document to view it.`,
    value: `… ${valueType} ${formatted}`,
  };
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

function formatUserTimestamp(value: string): string {
  if (!value) return 'Invalid timestamp';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
    + `T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
    + formatTimezoneOffset(date);
}

function formatTimezoneOffset(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absoluteMinutes = Math.abs(offsetMinutes);
  return `${sign}${pad2(Math.floor(absoluteMinutes / 60))}:${pad2(absoluteMinutes % 60)}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function formatCoordinate(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  return String(Number(value.toFixed(6)));
}

function base64ByteCount(value: string): number {
  const normalized = value.replace(/\s/g, '');
  if (!normalized) return 0;
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor(normalized.length * 3 / 4) - padding);
}

function shortLabel(value: string): string {
  return value.length > 8 ? `${value.slice(0, 8)}...` : value;
}

const FIELD_VALUE_PREVIEW_LIMIT = 255;
const TITLE_LIMIT = 4096;

const previewCache = new WeakMap<object, string>();
const titleCache = new WeakMap<object, string>();

function safeJson(value: unknown): string | undefined {
  if (typeof value === 'object' && value !== null) {
    const cached = titleCache.get(value);
    if (cached !== undefined) return cached;
    const { text } = boundedStringify(value, TITLE_LIMIT);
    titleCache.set(value, text);
    return text;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function compactJsonPreview(value: unknown): string {
  if (typeof value === 'object' && value !== null) {
    const cached = previewCache.get(value);
    if (cached !== undefined) return cached;
    const { text, truncated } = boundedStringify(value, FIELD_VALUE_PREVIEW_LIMIT);
    const result = truncated || text.length > FIELD_VALUE_PREVIEW_LIMIT
      ? `${text.slice(0, FIELD_VALUE_PREVIEW_LIMIT - 3)}...`
      : text;
    previewCache.set(value, result);
    return result;
  }
  const json = safeJson(value);
  if (!json) return String(value);
  return truncateFieldDisplayValue(json);
}

function truncateFieldDisplayValue(value: string): string {
  return value.length > FIELD_VALUE_PREVIEW_LIMIT
    ? `${value.slice(0, FIELD_VALUE_PREVIEW_LIMIT - 3)}...`
    : value;
}

// Serializes a value to JSON with an early-stop budget. Returns the partial text plus a
// `truncated` flag indicating whether the budget was hit and walking stopped early.
function boundedStringify(
  value: unknown,
  limit: number,
): { text: string; truncated: boolean; } {
  let out = '';
  let truncated = false;
  const seen = new WeakSet<object>();
  function append(chunk: string): boolean {
    if (out.length >= limit) {
      truncated = true;
      return false;
    }
    out += chunk;
    if (out.length >= limit) {
      truncated = true;
      return false;
    }
    return true;
  }
  function write(node: unknown): boolean {
    if (out.length >= limit) {
      truncated = true;
      return false;
    }
    if (node === null || node === undefined) return append('null');
    const t = typeof node;
    if (t === 'string') return append(JSON.stringify(node as string));
    if (t === 'number' || t === 'boolean') return append(String(node));
    if (Array.isArray(node)) {
      if (seen.has(node)) return append('null');
      seen.add(node);
      if (!append('[')) return false;
      for (let i = 0; i < node.length; i += 1) {
        if (i > 0 && !append(',')) return false;
        if (!write(node[i])) return false;
      }
      return append(']');
    }
    if (t === 'object') {
      const obj = node as Record<string, unknown>;
      if (seen.has(obj)) return append('{}');
      seen.add(obj);
      if (!append('{')) return false;
      let first = true;
      for (const key in obj) {
        if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
        if (!first && !append(',')) return false;
        first = false;
        if (!append(JSON.stringify(key))) return false;
        if (!append(':')) return false;
        if (!write(obj[key])) return false;
      }
      return append('}');
    }
    try {
      return append(JSON.stringify(node));
    } catch {
      return append('null');
    }
  }
  write(value);
  return { text: out, truncated };
}
