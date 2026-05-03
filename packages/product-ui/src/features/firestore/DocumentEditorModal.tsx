import type { FirestoreDocumentResult } from '@firebase-desk/repo-contracts';
import { Button, Dialog, DialogContent, InlineAlert } from '@firebase-desk/ui';
import { useEffect, useState } from 'react';
import { CodeEditor } from '../../code-editor/CodeEditor.tsx';
import { messageFromError } from '../../shared/errors.ts';
import { confirmDiscardUnsavedChanges } from '../../shared/unsavedDialogGuard.ts';
import { parseDocumentJson, validateFirestoreDocumentData } from './fieldEditModel.ts';

export interface DocumentEditorModalProps {
  readonly document: FirestoreDocumentResult | null;
  readonly onSaveDocument?:
    | ((
      documentPath: string,
      data: Record<string, unknown>,
    ) => Promise<boolean | void> | boolean | void)
    | undefined;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
}

export function DocumentEditorModal(
  { document, onSaveDocument, onOpenChange, open }: DocumentEditorModalProps,
) {
  const [source, setSource] = useState('{}');
  const [baselineSource, setBaselineSource] = useState('{}');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (document) {
      const nextSource = JSON.stringify(document.data, null, 2);
      setBaselineSource(nextSource);
      setSource(nextSource);
      setError(null);
      setIsSaving(false);
    }
  }, [document]);

  const hasUnsavedChanges = source !== baselineSource;

  function requestOpenChange(nextOpen: boolean) {
    if (
      !nextOpen && hasUnsavedChanges && !isSaving
      && !confirmDiscardUnsavedChanges('Discard unsaved document changes?')
    ) return;
    onOpenChange(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={requestOpenChange}>
      <DialogContent
        className='w-[min(760px,calc(100vw-32px))]'
        description={document?.path ?? null}
        title='Edit document JSON'
      >
        <div className='grid max-h-[68vh] min-h-0 grid-rows-[minmax(280px,1fr)] gap-2'>
          <div className='overflow-hidden rounded-md border border-border-subtle'>
            <CodeEditor
              ariaLabel='Document JSON'
              language='json'
              value={source}
              onChange={setSource}
            />
          </div>
        </div>
        {error ? <InlineAlert variant='danger'>{error}</InlineAlert> : null}
        <div className='flex justify-end gap-2'>
          <Button disabled={isSaving} variant='ghost' onClick={() => requestOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={isSaving}
            variant='primary'
            onClick={async () => {
              if (!document) return;
              setIsSaving(true);
              setError(null);
              try {
                const data = parseDocumentJson(source);
                validateFirestoreDocumentData(data);
                const saved = await onSaveDocument?.(document.path, data);
                if (saved !== false) onOpenChange(false);
              } catch (caught) {
                setError(messageFromError(caught, 'Could not save document.'));
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
