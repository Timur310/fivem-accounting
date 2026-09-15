'use client';

import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { backupApi, blobErrorMessage, apiErrorMessage } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/empty-state';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/providers/i18n-provider';
import { formatDateTime } from '@/lib/format';
import { Database, Download, Upload, TriangleAlert, ShieldCheck } from 'lucide-react';

/** 1.4 GB, 812 MB, 40 kB — the unit people read sizes in. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['kB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/**
 * The superadmin's copy of everything.
 *
 * Deliberately two panels and no list: nothing is kept on the server, so there
 * is nothing to list. What the screen owes the operator instead is the state
 * of the things that decide whether a backup is possible at all — are the
 * tools installed, is the connection the poolable one, when did somebody last
 * actually take a copy.
 */
export function AdminBackupView() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [downloading, setDownloading] = useState(false);
  const [downloadedBytes, setDownloadedBytes] = useState(0);

  const [file, setFile] = useState<File | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [uploadFraction, setUploadFraction] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  const statusQuery = useQuery({
    queryKey: ['backup-status'],
    queryFn: () => backupApi.status(),
  });
  const status = statusQuery.data;

  const handleDownload = async () => {
    setDownloading(true);
    setDownloadedBytes(0);
    try {
      const { blob, filename } = await backupApi.download(setDownloadedBytes);
      // The browser saves it; the bytes never touch anything else.
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      toast({ title: t('backup.downloaded', { filename }) });
      void queryClient.invalidateQueries({ queryKey: ['backup-status'] });
    } catch (err) {
      toast({
        title: t('backup.downloadFailed', { message: await blobErrorMessage(err) }),
        variant: 'destructive',
      });
    } finally {
      setDownloading(false);
    }
  };

  const handleRestore = async () => {
    if (!file) return;
    setRestoring(true);
    setUploadFraction(0);
    try {
      const result = await backupApi.restore(file, setUploadFraction);
      toast({ title: t('backup.restored', { path: result.safetyBackup }) });
      if (result.warnings.length > 0) {
        console.warn('[restore]', t('backup.restoreWarnings'), result.warnings);
      }
      setFile(null);
      setConfirmText('');
      if (fileInput.current) fileInput.current.value = '';
      // Everything on screen came from the database that was just replaced.
      queryClient.clear();
    } catch (err) {
      toast({
        title: t('backup.restoreFailed', { message: apiErrorMessage(err) }),
        variant: 'destructive',
      });
    } finally {
      setRestoring(false);
    }
  };

  const busy = downloading || restoring;
  const tooBig = !!(file && status && file.size > status.maxUploadBytes);
  const canRestore =
    !!file
    && !tooBig
    && confirmText.trim().toUpperCase() === t('backup.confirmWord')
    && !!status?.available
    && !busy;

  if (statusQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (statusQuery.isError || !status) {
    return <ErrorState error={statusQuery.error} onRetry={() => void statusQuery.refetch()} />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Database className="h-6 w-6" /> {t('backup.title')}
        </h1>
        <p className="text-sm text-zinc-400 mt-1 max-w-3xl">{t('backup.intro')}</p>
      </div>

      {/* The two states in which no button on this page can work. Said at the
          top, because the alternative is finding out by clicking. */}
      {!status.available && (
        <div className="flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
          <TriangleAlert className="h-5 w-5 shrink-0" />
          <p>{t('backup.toolsMissing')}</p>
        </div>
      )}
      {status.available && status.pooledConnection && (
        <div className="flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
          <TriangleAlert className="h-5 w-5 shrink-0" />
          <p>{t('backup.pooledWarning')}</p>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('backup.status')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <Field label={t('backup.target')} value={status.target} />
          <Field
            label={t('backup.size')}
            value={status.databaseSizeBytes === null ? '—' : formatBytes(status.databaseSizeBytes)}
          />
          <Field label={t('backup.server')} value={status.serverVersion ?? '—'} />
          <Field
            label={t('backup.lastBackup')}
            value={status.lastBackupAt ? formatDateTime(status.lastBackupAt) : t('backup.never')}
          />
          <Field label={t('backup.tools')} value={status.pgDumpVersion ?? '—'} />
        </CardContent>
      </Card>

      {/* ── Download ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Download className="h-4 w-4" /> {t('backup.download')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-zinc-400 max-w-3xl">{t('backup.downloadHint')}</p>
          <div className="flex gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-sm text-emerald-200">
            <ShieldCheck className="h-5 w-5 shrink-0" />
            <p>{t('backup.keepItSomewhere')}</p>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={() => void handleDownload()} disabled={!status.available || busy}>
              <Download className="mr-2 h-4 w-4" />
              {downloading ? t('backup.downloading') : t('backup.download')}
            </Button>
            {/* pg_dump streams, so the total is unknown until it ends — the
                honest progress indicator is how much has arrived. */}
            {downloading && downloadedBytes > 0 && (
              <span className="text-sm text-zinc-400 tabular-nums">
                {formatBytes(downloadedBytes)}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Restore ── */}
      <Card className="border-red-500/30">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2 text-red-300">
            <Upload className="h-4 w-4" /> {t('backup.restoreTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            <TriangleAlert className="h-5 w-5 shrink-0" />
            <div className="space-y-1">
              <p>{t('backup.restoreHint')}</p>
              <p>{t('backup.restoreSignOut')}</p>
            </div>
          </div>

          <div className="space-y-2 max-w-md">
            <Label htmlFor="backup-file">{t('backup.chooseFile')}</Label>
            <Input
              id="backup-file"
              type="file"
              accept=".dump"
              ref={fileInput}
              disabled={!status.available || busy}
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setConfirmText('');
              }}
            />
            {file && (
              <p className={`text-sm ${tooBig ? 'text-red-300' : 'text-zinc-400'}`}>
                {tooBig
                  ? t('backup.tooBig', { limit: formatBytes(status.maxUploadBytes) })
                  : t('backup.selectedFile', { name: file.name, size: formatBytes(file.size) })}
              </p>
            )}
          </div>

          {/* The typed word. A restore is one click away from discarding every
              faction's books, so it is deliberately not one click. */}
          <div className="space-y-2 max-w-md">
            <Label htmlFor="backup-confirm">{t('backup.confirmPrompt')}</Label>
            <Input
              id="backup-confirm"
              value={confirmText}
              disabled={!file || tooBig || busy}
              autoComplete="off"
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={t('backup.confirmWord')}
            />
          </div>

          <div className="flex items-center gap-3">
            <Button variant="destructive" disabled={!canRestore} onClick={() => void handleRestore()}>
              <Upload className="mr-2 h-4 w-4" />
              {restoring ? t('backup.restoring') : t('backup.restoreStart')}
            </Button>
            {restoring && uploadFraction > 0 && (
              <span className="text-sm text-zinc-400 tabular-nums">
                {Math.round(uploadFraction * 100)}%
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 break-all">{value}</p>
    </div>
  );
}
