import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
} from "react";
import {
  ArrowUp,
  Copy,
  Download,
  FileIcon,
  Folder,
  FolderOpen,
  FolderPlus,
  RefreshCw,
  Trash2,
  Unlink,
  Upload,
} from "lucide-react";
import { Badge } from "@nous-research/ui/ui/components/badge";
import { Button } from "@nous-research/ui/ui/components/button";
import { Card, CardContent } from "@nous-research/ui/ui/components/card";
import { Input } from "@nous-research/ui/ui/components/input";
import { Spinner } from "@nous-research/ui/ui/components/spinner";
import { Toast } from "@nous-research/ui/ui/components/toast";
import { useToast } from "@nous-research/ui/hooks/use-toast";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { Modal } from "@/components/Modal";
import { FilePreviewDialog } from "@/components/FilePreviewDialog";
import { usePageHeader } from "@/contexts/usePageHeader";
import { useI18n } from "@/i18n/context";
import { api } from "@/lib/api";
import type { ManagedFileEntry, ManagedFilesResponse } from "@/lib/api";
import { PluginSlot } from "@/plugins";
import { errorMessage } from "@/lib/api-error";
import { copyTextToClipboard } from "@/lib/clipboard";

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function joinPath(base: string, name: string): string {
  const cleanName = name.trim().replace(/^[\\/]+/, "");
  if (!cleanName) return base;
  const separator = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  if (!base || base.endsWith("/") || base.endsWith("\\")) return `${base}${cleanName}`;
  return `${base}${separator}${cleanName}`;
}

function formatBytes(size: number | null): string {
  if (size === null) return "-";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function downloadDataUrl(dataUrl: string, name: string) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = name || "download";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function displayPath(path: string | null | undefined): string {
  return path?.trim() || "Files";
}

function transferHasFiles(event: ReactDragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}

export default function FilesPage() {
  const { t } = useI18n();
  const { toast, showToast } = useToast();
  const { setAfterTitle, setEnd } = usePageHeader();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);
  const [currentPath, setCurrentPath] = useState<string | undefined>(undefined);
  const [pathInput, setPathInput] = useState("");
  const [listing, setListing] = useState<ManagedFilesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [pendingDelete, setPendingDelete] = useState<ManagedFileEntry | null>(null);
  const [previewEntry, setPreviewEntry] = useState<ManagedFileEntry | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activePath = listing?.path ?? currentPath ?? "";
  const canChangePath = listing?.can_change_path ?? false;
  const canUpload = Boolean(activePath) && !uploading;
  const headerPath = displayPath(listing?.locked_root ?? listing?.path ?? currentPath);

  const load = useCallback(
    async (path = currentPath) => {
      setLoading(true);
      setError(null);
      try {
        const result = await api.listFiles(path);
        setListing(result);
        setCurrentPath(result.path);
        setPathInput(result.path);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setLoading(false);
      }
    },
    [currentPath],
  );

  useEffect(() => {
    // Existing dashboard data pages fetch from effects; keep this local and explicit
    // until the shared lint profile is updated for async page loaders.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(currentPath);
  }, [currentPath]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setAfterTitle(
      <Badge tone="outline" className="max-w-[22rem] truncate text-xs" title={headerPath}>
        {headerPath}
      </Badge>,
    );
    setEnd(
      <div className="flex items-center gap-2">
        <Button
          ghost
          size="icon"
          type="button"
          onClick={() => void load()}
          disabled={loading}
          aria-label={t.files.refreshFiles}
        >
          {loading ? <Spinner /> : <RefreshCw />}
        </Button>
      </div>,
    );
    return () => {
      setAfterTitle(null);
      setEnd(null);
    };
  }, [headerPath, load, loading, setAfterTitle, setEnd]);

  const openDirectory = (entry: ManagedFileEntry) => {
    if (entry.is_directory) {
      setCurrentPath(entry.path);
    }
  };

  const goToPath = async () => {
    const nextPath = pathInput.trim();
    if (!nextPath) {
      showToast(t.files.pathRequired, "error");
      return;
    }
    await load(nextPath);
  };

  const createDirectory = async () => {
    const name = folderName.trim();
    if (!activePath) {
      showToast(t.files.directoryUnavailable, "error");
      return;
    }
    if (!name) {
      showToast(t.files.folderNameRequired, "error");
      return;
    }
    setCreating(true);
    try {
      await api.createDirectory(joinPath(activePath, name));
      setFolderName("");
      setCreateDialogOpen(false);
      showToast(t.files.folderCreated, "success");
      await load();
    } catch (e) {
      showToast(`Create failed: ${errorMessage(e)}`, "error");
    } finally {
      setCreating(false);
    }
  };

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        await api.uploadFile(joinPath(activePath, file.name), file, true);
      }
      showToast(`${files.length} file${files.length === 1 ? "" : "s"} uploaded`, "success");
      await load();
    } catch (e) {
      showToast(`Upload failed: ${errorMessage(e)}`, "error");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDragEnter = (event: ReactDragEvent<HTMLElement>) => {
    if (!canUpload || !transferHasFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setDraggingFiles(true);
  };

  const handleDragOver = (event: ReactDragEvent<HTMLElement>) => {
    if (!canUpload || !transferHasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleDragLeave = (event: ReactDragEvent<HTMLElement>) => {
    if (!canUpload || !transferHasFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setDraggingFiles(false);
    }
  };

  const handleDrop = (event: ReactDragEvent<HTMLElement>) => {
    if (!canUpload) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setDraggingFiles(false);
    void uploadFiles(event.dataTransfer.files);
  };

  const downloadFile = async (entry: ManagedFileEntry) => {
    if (entry.is_directory || entry.broken_link) return;
    try {
      const file = await api.readFile(entry.path);
      downloadDataUrl(file.data_url, file.name);
    } catch (e) {
      showToast(`Download failed: ${errorMessage(e)}`, "error");
    }
  };

  const copyPath = async (entry: ManagedFileEntry) => {
    const copied = await copyTextToClipboard(entry.path);
    showToast(
      copied ? t.profiles.commandCopied : t.profiles.copyFailed,
      copied ? "success" : "error",
    );
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api.deleteFile(pendingDelete.path, pendingDelete.is_directory);
      showToast(t.files.deleted, "success");
      setPendingDelete(null);
      await load();
    } catch (e) {
      showToast(`Delete failed: ${errorMessage(e)}`, "error");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex min-w-0 max-w-full flex-col gap-4">
      <Toast toast={toast} />
      <PluginSlot name="files:top" />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => void uploadFiles(event.currentTarget.files)}
      />

      <div className="flex min-w-0 flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        {canChangePath ? (
          <form
            className="flex min-w-0 flex-1 items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void goToPath();
            }}
          >
            <Input
              value={pathInput}
              onChange={(event) => setPathInput(event.target.value)}
              aria-label="Path"
              placeholder="Path"
              className="custom-border-radius h-9 min-w-0 flex-1 font-mono"
            />
            <Button type="submit" size="sm" outlined className="custom-border-radius uppercase">
              Go
            </Button>
          </form>
        ) : (
          <div className="min-w-0 truncate font-mono text-sm text-text-secondary" title={activePath}>
            {activePath}
          </div>
        )}
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!canUpload}
            size="sm"
            outlined
            className="custom-border-radius uppercase"
            prefix={uploading ? <Spinner /> : <Upload />}
          >
            Upload
          </Button>
          <Button
            type="button"
            onClick={() => setCreateDialogOpen(true)}
            disabled={!activePath}
            size="sm"
            outlined
            className="custom-border-radius uppercase"
            prefix={<FolderPlus />}
          >
            Create
          </Button>
        </div>
      </div>

      <button
        type="button"
        onClick={() => canUpload && fileInputRef.current?.click()}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        disabled={!canUpload}
        aria-label={t.files.uploadFiles}
        className={`custom-border-radius flex min-h-20 w-full min-w-0 items-center justify-between gap-4 border border-dashed px-4 py-3 text-left transition ${
          draggingFiles
            ? "border-primary bg-primary/10 text-foreground"
            : "border-border bg-background/20 text-text-secondary hover:border-text-tertiary hover:bg-background/35"
        } disabled:cursor-not-allowed disabled:opacity-60`}
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="custom-border-radius flex h-9 w-9 shrink-0 items-center justify-center border border-border bg-background/45 text-text-tertiary">
            {uploading ? <Spinner /> : <Upload className="h-4 w-4" />}
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold uppercase tracking-[0.08em] text-foreground">
              {uploading ? t.files.uploading : draggingFiles ? t.files.releaseToUpload : t.files.dropFilesHere}
            </span>
            <span className="block truncate font-mono text-xs text-text-secondary" title={activePath}>
              {activePath || "Loading"}
            </span>
          </span>
        </span>
        <span className="hidden shrink-0 text-xs font-semibold uppercase tracking-[0.08em] text-text-tertiary sm:block">
          {t.files.chooseFiles}
        </span>
      </button>

      <Card className="custom-border-radius min-w-0 max-w-full overflow-hidden">
        <CardContent className="overflow-x-auto p-0">
          {error && (
            <div className="border-b border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="grid min-w-[42rem] grid-cols-[minmax(12rem,1fr)_7rem_10rem_8rem] items-center gap-3 border-b border-border px-4 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">
            <span>{t.files.colName}</span>
            <span>{t.files.colSize}</span>
            <span>{t.files.colModified}</span>
            <span className="text-right">{t.files.colActions}</span>
          </div>

          {listing?.parent && (
            <button
              type="button"
              onClick={() => setCurrentPath(listing.parent ?? undefined)}
              className="grid w-full min-w-[42rem] grid-cols-[minmax(12rem,1fr)_7rem_10rem_8rem] items-center gap-3 rounded-none border-0 border-b border-border/60 bg-transparent px-4 py-2 text-left text-sm transition hover:bg-background/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-midground"
            >
              <span className="flex min-w-0 items-center gap-2 font-mono text-text-secondary">
                <ArrowUp className="h-4 w-4 shrink-0 text-text-tertiary" />
                ..
              </span>
              <span />
              <span />
              <span />
            </button>
          )}

          {loading && !listing ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Spinner />
              {t.files.loadingFiles}
            </div>
          ) : listing && listing.entries.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">{t.files.noFiles}</div>
          ) : (
            listing?.entries.map((entry) => (
              <div
                key={entry.path}
                className="grid min-w-[42rem] grid-cols-[minmax(12rem,1fr)_7rem_10rem_8rem] items-center gap-3 border-b border-border/60 px-4 py-2 text-sm last:border-b-0 hover:bg-background/35"
              >
                {entry.is_directory ? (
                  <button
                    type="button"
                    onClick={() => openDirectory(entry)}
                    disabled={entry.broken_link}
                    title={entry.broken_link ? "Broken symbolic link" : undefined}
                    className="flex min-w-0 items-center gap-2 rounded-none border-0 bg-transparent text-left font-mono text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-midground"
                  >
                    <Folder className="h-4 w-4 shrink-0 text-warning" />
                    <span className="truncate" title={entry.name}>{entry.name}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setPreviewEntry(entry)}
                    disabled={entry.broken_link}
                    title={entry.broken_link ? "Broken symbolic link" : undefined}
                    className="flex min-w-0 select-text items-center gap-2 rounded-none border-0 bg-transparent text-left font-mono text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-midground"
                    aria-label={`${t.files.preview ?? "Preview"}: ${entry.name}`}
                  >
                    {entry.broken_link
                      ? <Unlink className="h-4 w-4 shrink-0 text-destructive" />
                      : <FileIcon className="h-4 w-4 shrink-0 text-text-tertiary" />}
                    <span className="truncate" title={entry.name}>{entry.name}</span>
                    {entry.broken_link && <Badge tone="destructive" className="shrink-0 text-xs">Broken link</Badge>}
                  </button>
                )}
                <span className="text-xs tabular-nums text-text-secondary">{formatBytes(entry.size)}</span>
                <span className="truncate text-xs text-text-secondary">
                  {entry.mtime !== null && Number.isFinite(entry.mtime)
                    ? DATE_FORMAT.format(entry.mtime * 1000)
                    : "-"}
                </span>
                <span className="flex justify-end gap-1">
                  <Button
                    ghost
                    size="icon"
                    type="button"
                    onClick={() => void copyPath(entry)}
                    aria-label={`${t.webhooks.copy}: ${entry.path}`}
                    title={`${t.webhooks.copy}: ${entry.path}`}
                  >
                    <Copy />
                  </Button>
                  {entry.is_directory ? (
                    <Button
                      ghost
                      size="icon"
                      type="button"
                      onClick={() => openDirectory(entry)}
                      aria-label={`Open ${entry.name}`}
                    >
                      <FolderOpen />
                    </Button>
                  ) : (
                    <Button
                      ghost
                      size="icon"
                      type="button"
                      onClick={() => void downloadFile(entry)}
                      disabled={entry.broken_link}
                      aria-label={`Download ${entry.name}`}
                    >
                      <Download />
                    </Button>
                  )}
                  <Button
                    ghost
                    size="icon"
                    type="button"
                    onClick={() => setPendingDelete(entry)}
                    aria-label={`Delete ${entry.name}`}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 />
                  </Button>
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <PluginSlot name="files:bottom" />

      {previewEntry && (
        <FilePreviewDialog
          key={previewEntry.path}
          entry={previewEntry}
          onClose={() => setPreviewEntry(null)}
        />
      )}

      <Modal
        open={createDialogOpen}
        onClose={() => {
          if (creating) return;
          setCreateDialogOpen(false);
          setFolderName("");
        }}
        size="sm"
        title="Create folder"
        subtitle={`Target: ${activePath || "Loading"}`}
        footer={
          <div className="flex items-center justify-end gap-2.5 w-full">
            <Button
              type="button"
              outlined
              size="sm"
              onClick={() => {
                setCreateDialogOpen(false);
                setFolderName("");
              }}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void createDirectory()}
              disabled={creating}
              prefix={creating ? <Spinner /> : <FolderPlus />}
            >
              Create
            </Button>
          </div>
        }
      >
        <div className="space-y-1.5">
          <Input
            autoFocus
            value={folderName}
            onChange={(event) => setFolderName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void createDirectory();
            }}
            placeholder="Folder name"
            disabled={creating}
          />
        </div>
      </Modal>

      <DeleteConfirmDialog
        open={Boolean(pendingDelete)}
        loading={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
        title={pendingDelete ? `Delete ${pendingDelete.name}?` : "Delete item?"}
        description={
          pendingDelete?.is_directory
            ? "This removes the folder and everything inside it."
            : "This removes the file."
        }
      />
    </div>
  );
}
