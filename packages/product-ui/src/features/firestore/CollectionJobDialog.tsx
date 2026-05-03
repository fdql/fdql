import type { ProjectSummary } from '@firebase-desk/repo-contracts';
import type {
  FirestoreCollectionJobRequest,
  FirestoreExportFormat,
  FirestoreJobCollisionPolicy,
  FirestoreJsonlExportEncoding,
} from '@firebase-desk/repo-contracts/jobs';
import { Button, Dialog, DialogContent, InlineAlert, Input } from '@firebase-desk/ui';
import { useEffect, useState } from 'react';

type CollectionJobKind = 'copy' | 'delete' | 'duplicate' | 'export' | 'import';

export interface CollectionJobDialogProps {
  readonly activeProject: ProjectSummary | null;
  readonly collectionPath: string;
  readonly initialKind?: CollectionJobKind | undefined;
  readonly onOpenChange: (open: boolean) => void;
  readonly onPickExportFile?:
    | ((format: FirestoreExportFormat) => Promise<string | null>)
    | undefined;
  readonly onPickImportFile?: (() => Promise<string | null>) | undefined;
  readonly onStartJob: (request: FirestoreCollectionJobRequest) => Promise<void> | void;
  readonly open: boolean;
  readonly projects: ReadonlyArray<ProjectSummary>;
}

export function CollectionJobDialog(
  {
    activeProject,
    collectionPath,
    initialKind = 'export',
    onOpenChange,
    onPickExportFile,
    onPickImportFile,
    onStartJob,
    open,
    projects,
  }: CollectionJobDialogProps,
) {
  const [kind, setKind] = useState<CollectionJobKind>(initialKind);
  const [targetConnectionId, setTargetConnectionId] = useState(activeProject?.id ?? '');
  const [targetCollectionPath, setTargetCollectionPath] = useState(
    initialKind === 'import' ? collectionPath : `${collectionPath}_copy`,
  );
  const [collisionPolicy, setCollisionPolicy] = useState<FirestoreJobCollisionPolicy>('skip');
  const [includeSubcollections, setIncludeSubcollections] = useState(false);
  const [format, setFormat] = useState<FirestoreExportFormat>('jsonl');
  const [encoding, setEncoding] = useState<FirestoreJsonlExportEncoding>('encoded');
  const [filePath, setFilePath] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setKind(initialKind);
    setTargetConnectionId(activeProject?.id ?? '');
    setTargetCollectionPath(initialKind === 'import' ? collectionPath : `${collectionPath}_copy`);
    setCollisionPolicy('skip');
    setIncludeSubcollections(false);
    setFormat('jsonl');
    setEncoding('encoded');
    setFilePath('');
    setErrorMessage(null);
    setSubmitting(false);
  }, [activeProject?.id, collectionPath, initialKind, open]);

  async function chooseExportFile() {
    try {
      setErrorMessage(null);
      const picked = await onPickExportFile?.(format);
      if (picked) {
        setFilePath(picked);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not choose export file.');
    }
  }

  async function chooseImportFile() {
    try {
      setErrorMessage(null);
      const picked = await onPickImportFile?.();
      if (picked) {
        setFilePath(picked);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not choose import file.');
    }
  }

  async function submit() {
    if (!activeProject) {
      setErrorMessage('Choose a project before starting a job.');
      return;
    }
    const request = buildRequest();
    if (!request) return;
    if ((request.type === 'firestore.deleteCollection' || collisionPolicy === 'overwrite')) {
      const confirmed = window.confirm(confirmMessage(request));
      if (!confirmed) return;
    }
    setSubmitting(true);
    try {
      await onStartJob(request);
      onOpenChange(false);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not start job.');
    } finally {
      setSubmitting(false);
    }
  }

  function buildRequest(): FirestoreCollectionJobRequest | null {
    if (!activeProject) return null;
    if (!collectionPath.trim()) {
      setErrorMessage('Collection path is required.');
      return null;
    }
    if (kind === 'delete') {
      return {
        collectionPath: collectionPath.trim(),
        connectionId: activeProject.id,
        includeSubcollections,
        type: 'firestore.deleteCollection',
      };
    }
    if (kind === 'export') {
      if (!filePath.trim()) {
        setErrorMessage('Choose an export file.');
        return null;
      }
      return {
        collectionPath: collectionPath.trim(),
        connectionId: activeProject.id,
        encoding: format === 'jsonl' ? encoding : undefined,
        filePath: filePath.trim(),
        format,
        includeSubcollections,
        type: 'firestore.exportCollection',
      };
    }
    if (kind === 'import') {
      if (!filePath.trim()) {
        setErrorMessage('Choose an import file.');
        return null;
      }
      if (!targetCollectionPath.trim()) {
        setErrorMessage('Target collection path is required.');
        return null;
      }
      return {
        collisionPolicy,
        connectionId: activeProject.id,
        filePath: filePath.trim(),
        targetCollectionPath: targetCollectionPath.trim(),
        type: 'firestore.importCollection',
      };
    }
    if (!targetCollectionPath.trim()) {
      setErrorMessage('Target collection path is required.');
      return null;
    }
    if (kind === 'copy') {
      if (!targetConnectionId) {
        setErrorMessage('Target project is required.');
        return null;
      }
      return {
        collisionPolicy,
        includeSubcollections,
        sourceCollectionPath: collectionPath.trim(),
        sourceConnectionId: activeProject.id,
        targetCollectionPath: targetCollectionPath.trim(),
        targetConnectionId,
        type: 'firestore.copyCollection',
      };
    }
    return {
      collectionPath: collectionPath.trim(),
      collisionPolicy,
      connectionId: activeProject.id,
      includeSubcollections,
      targetCollectionPath: targetCollectionPath.trim(),
      type: 'firestore.duplicateCollection',
    };
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title='Collection job' description={collectionPath}>
        <div className='grid gap-3'>
          {errorMessage ? <InlineAlert variant='danger'>{errorMessage}</InlineAlert> : null}
          <label className='grid gap-1 text-sm'>
            <span className='font-medium text-text-secondary'>Job</span>
            <select
              aria-label='Collection job type'
              className='h-9 rounded-md border border-border bg-bg-panel px-2 text-sm text-text-primary'
              value={kind}
              onChange={(event) => {
                const nextKind = event.currentTarget.value as CollectionJobKind;
                setKind(nextKind);
                setTargetCollectionPath(
                  nextKind === 'import' ? collectionPath : `${collectionPath}_copy`,
                );
              }}
            >
              <option value='copy'>Copy collection</option>
              <option value='duplicate'>Duplicate collection</option>
              <option value='export'>Export collection</option>
              <option value='import'>Import collection</option>
              <option value='delete'>Delete collection</option>
            </select>
          </label>
          {kind === 'copy'
            ? (
              <label className='grid gap-1 text-sm'>
                <span className='font-medium text-text-secondary'>Target project</span>
                <select
                  aria-label='Target project'
                  className='h-9 rounded-md border border-border bg-bg-panel px-2 text-sm text-text-primary'
                  value={targetConnectionId}
                  onChange={(event) => setTargetConnectionId(event.currentTarget.value)}
                >
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                  ))}
                </select>
              </label>
            )
            : null}
          {kind === 'copy' || kind === 'duplicate' || kind === 'import'
            ? (
              <label className='grid gap-1 text-sm'>
                <span className='font-medium text-text-secondary'>Target collection path</span>
                <Input
                  aria-label='Target collection path'
                  value={targetCollectionPath}
                  onChange={(event) => setTargetCollectionPath(event.currentTarget.value)}
                />
              </label>
            )
            : null}
          {kind === 'copy' || kind === 'duplicate' || kind === 'import'
            ? (
              <label className='grid gap-1 text-sm'>
                <span className='font-medium text-text-secondary'>Collision policy</span>
                <select
                  aria-label='Collision policy'
                  className='h-9 rounded-md border border-border bg-bg-panel px-2 text-sm text-text-primary'
                  value={collisionPolicy}
                  onChange={(event) =>
                    setCollisionPolicy(event.currentTarget.value as FirestoreJobCollisionPolicy)}
                >
                  <option value='skip'>Skip existing documents</option>
                  <option value='overwrite'>Overwrite existing documents</option>
                  <option value='fail'>Fail on existing document</option>
                </select>
              </label>
            )
            : null}
          {kind !== 'import'
            ? (
              <label className='flex items-center gap-2 text-sm text-text-secondary'>
                <input
                  checked={includeSubcollections}
                  type='checkbox'
                  onChange={(event) => setIncludeSubcollections(event.currentTarget.checked)}
                />
                Include subcollections
              </label>
            )
            : null}
          {kind === 'delete' && !includeSubcollections
            ? (
              <InlineAlert variant='warning'>
                Documents will be deleted from this collection only. Subcollections may remain.
              </InlineAlert>
            )
            : null}
          {kind === 'export'
            ? (
              <>
                <label className='grid gap-1 text-sm'>
                  <span className='font-medium text-text-secondary'>Format</span>
                  <select
                    aria-label='Export format'
                    className='h-9 rounded-md border border-border bg-bg-panel px-2 text-sm text-text-primary'
                    value={format}
                    onChange={(event) =>
                      setFormat(event.currentTarget.value as FirestoreExportFormat)}
                  >
                    <option value='jsonl'>JSONL</option>
                    <option value='csv'>CSV</option>
                  </select>
                </label>
                {format === 'jsonl'
                  ? (
                    <label className='grid gap-1 text-sm'>
                      <span className='font-medium text-text-secondary'>JSONL values</span>
                      <select
                        aria-label='JSONL encoding'
                        className='h-9 rounded-md border border-border bg-bg-panel px-2 text-sm text-text-primary'
                        value={encoding}
                        onChange={(event) =>
                          setEncoding(event.currentTarget.value as FirestoreJsonlExportEncoding)}
                      >
                        <option value='encoded'>Firebase Desk encoded values (importable)</option>
                        <option value='plain'>Plain JSON values (export only)</option>
                      </select>
                    </label>
                  )
                  : null}
                {format === 'jsonl' && encoding === 'plain'
                  ? (
                    <InlineAlert variant='warning'>
                      Plain JSONL is export-only. Use encoded JSONL when the file will be imported
                      back into Firebase Desk.
                    </InlineAlert>
                  )
                  : null}
              </>
            )
            : null}
          {kind === 'export' || kind === 'import'
            ? (
              <div className='flex items-end gap-2'>
                <label className='grid min-w-0 flex-1 gap-1 text-sm'>
                  <span className='font-medium text-text-secondary'>
                    {kind === 'export' ? 'Export file' : 'Import file'}
                  </span>
                  <Input
                    aria-label={kind === 'export' ? 'Export file path' : 'Import file path'}
                    readOnly
                    value={filePath}
                  />
                </label>
                <Button
                  type='button'
                  variant='secondary'
                  onClick={() => {
                    void (kind === 'export' ? chooseExportFile() : chooseImportFile());
                  }}
                >
                  Choose
                </Button>
              </div>
            )
            : null}
          <div className='flex justify-end gap-2 pt-2'>
            <Button variant='ghost' onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              disabled={submitting}
              variant={kind === 'delete' ? 'danger' : 'primary'}
              onClick={() => void submit()}
            >
              Start job
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function confirmMessage(request: FirestoreCollectionJobRequest): string {
  if (request.type === 'firestore.deleteCollection') {
    return `Delete collection ${request.collectionPath}${
      request.includeSubcollections ? ' including subcollections' : ''
    }?`;
  }
  return 'Overwrite existing target documents?';
}
