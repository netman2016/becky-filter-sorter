// File System Access API のうち、TypeScript の DOM 型定義に無い部分（Chromium 系のみ実装）
export {};

type FsPermissionMode = 'read' | 'readwrite';

declare global {
  interface FilePickerAcceptType {
    description?: string;
    accept: Record<string, string[]>;
  }

  interface Window {
    showOpenFilePicker?: (options?: {
      id?: string;
      multiple?: boolean;
      excludeAcceptAllOption?: boolean;
      types?: FilePickerAcceptType[];
    }) => Promise<FileSystemFileHandle[]>;
    showDirectoryPicker?: (options?: {
      id?: string;
      mode?: FsPermissionMode;
      startIn?: FileSystemHandle;
    }) => Promise<FileSystemDirectoryHandle>;
  }

  interface FileSystemHandle {
    queryPermission?: (descriptor: { mode: FsPermissionMode }) => Promise<PermissionState>;
    requestPermission?: (descriptor: { mode: FsPermissionMode }) => Promise<PermissionState>;
  }
}
