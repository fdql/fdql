import { Button, Dialog, DialogContent, InlineAlert, Input } from '@firebase-desk/ui';
import { useEffect, useRef, useState } from 'react';
import { CodeEditor } from '../../code-editor/CodeEditor.tsx';
import { messageFromError } from '../../shared/errors.ts';
import { confirmDiscardUnsavedChanges } from '../../shared/unsavedDialogGuard.ts';
import { parseDocumentJson, validateFirestoreDocumentData } from './fieldEditModel.ts';

export interface CreateDocumentModalProps {
  readonly collectionPath: string | null;
  readonly collectionPathEditable?: boolean | undefined;
  readonly hint?: string | null | undefined;
  readonly onCreateDocument: (
    collectionPath: string,
    documentId: string,
    data: Record<string, unknown>,
  ) => Promise<void> | void;
  readonly onGenerateDocumentId: (collectionPath: string) => Promise<string> | string;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
  readonly title?: string | undefined;
}

export function CreateDocumentModal(
  {
    collectionPath,
    collectionPathEditable = false,
    hint = null,
    onCreateDocument,
    onGenerateDocumentId,
    onOpenChange,
    open,
    title = 'New document',
  }: CreateDocumentModalProps,
) {
  const [draftCollectionPath, setDraftCollectionPath] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [source, setSource] = useState('{}');
  const [error, setError] = useState<string | null>(null);
  const [isGeneratingId, setIsGeneratingId] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const idTouched = useRef(false);

  useEffect(() => {
    if (!open) return;
    setDraftCollectionPath(collectionPath ?? '');
    idTouched.current = false;
    setDocumentId('');
    setSource('{}');
    setError(null);
    setIsSaving(false);
    setIsGeneratingId(false);
  }, [collectionPath, open]);

  useEffect(() => {
    if (!open) return;
    const normalizedCollectionPath = normalizePath(draftCollectionPath);
    if (!isValidCollectionPath(normalizedCollectionPath)) {
      setIsGeneratingId(false);
      return;
    }
    let cancelled = false;
    setIsGeneratingId(true);
    Promise.resolve(onGenerateDocumentId(normalizedCollectionPath))
      .then((generatedId) => {
        if (!cancelled && !idTouched.current) setDocumentId(generatedId);
      })
      .catch((caught) => {
        if (!cancelled) setError(messageFromError(caught, 'Could not generate document ID.'));
      })
      .finally(() => {
        if (!cancelled) setIsGeneratingId(false);
      });
    return () => {
      cancelled = true;
    };
  }, [draftCollectionPath, onGenerateDocumentId, open]);

  const hasUnsavedChanges = source !== '{}'
    || idTouched.current
    || (
      collectionPathEditable
      && normalizePath(draftCollectionPath) !== normalizePath(collectionPath ?? '')
    );

  function requestOpenChange(nextOpen: boolean) {
    if (
      !nextOpen && hasUnsavedChanges && !isSaving
      && !confirmDiscardUnsavedChanges('Discard the new document draft?')
    ) return;
    onOpenChange(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={requestOpenChange}>
      <DialogContent
        className='w-[min(760px,calc(100vw-32px))]'
        description={collectionPathEditable ? 'Create the first document' : collectionPath}
        title={title}
      >
        <div className='grid gap-3'>
          {hint ? <InlineAlert variant='warning'>{hint}</InlineAlert> : null}
          {collectionPathEditable
            ? (
              <label className='grid gap-1 text-sm font-medium text-text-secondary'>
                Collection path
                <Input
                  aria-label='Collection path'
                  className='font-mono'
                  disabled={isSaving}
                  placeholder='collection or collection/doc/subcollection'
                  value={draftCollectionPath}
                  onChange={(event) => {
                    setDraftCollectionPath(event.currentTarget.value);
                    setError(null);
                  }}
                />
              </label>
            )
            : null}
          <label className='grid gap-1 text-sm font-medium text-text-secondary'>
            Document ID
            <Input
              aria-label='Document ID'
              className='font-mono'
              disabled={isSaving}
              placeholder={isGeneratingId ? 'Generating' : 'document ID'}
              value={documentId}
              onChange={(event) => {
                idTouched.current = true;
                setDocumentId(event.currentTarget.value);
                setError(null);
              }}
            />
          </label>
          <div className='grid gap-1'>
            <div className='text-xs font-semibold text-text-secondary'>Document JSON</div>
            <div className='h-64 overflow-hidden rounded-md border border-border-subtle'>
              <CodeEditor
                ariaLabel='New document JSON'
                language='json'
                value={source}
                onChange={setSource}
              />
            </div>
          </div>
          {error ? <InlineAlert variant='danger'>{error}</InlineAlert> : null}
        </div>
        <div className='flex justify-end gap-2'>
          <Button disabled={isSaving} variant='ghost' onClick={() => requestOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={isSaving || isGeneratingId}
            variant='primary'
            onClick={async () => {
              setIsSaving(true);
              setError(null);
              try {
                const normalizedCollectionPath = normalizePath(draftCollectionPath);
                validateCollectionPath(normalizedCollectionPath);
                const trimmedId = documentId.trim();
                validateDocumentId(trimmedId);
                const data = parseDocumentJson(source);
                validateFirestoreDocumentData(data);
                await onCreateDocument(normalizedCollectionPath, trimmedId, data);
                onOpenChange(false);
              } catch (caught) {
                setError(messageFromError(caught, 'Could not create document.'));
              } finally {
                setIsSaving(false);
              }
            }}
          >
            {isSaving ? 'Creating' : 'Create'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function normalizePath(path: string): string {
  return path.trim().split('/').filter(Boolean).join('/');
}

function validateCollectionPath(collectionPath: string): void {
  if (!collectionPath) throw new Error('Collection path is required.');
  if (!isValidCollectionPath(collectionPath)) {
    throw new Error('Collection path must point to a collection.');
  }
}

function isValidCollectionPath(collectionPath: string): boolean {
  const parts = collectionPath.split('/').filter(Boolean);
  return parts.length > 0 && parts.length % 2 === 1;
}

function validateDocumentId(documentId: string): void {
  if (!documentId) throw new Error('Document ID is required.');
  if (documentId.includes('/')) throw new Error('Document ID cannot contain /.');
}
