// Shared types between main process, workers, and renderer

export type DateSource = 'exif' | 'filename' | 'file_mtime' | 'import'
export type ImportSource = 'local' | 'google_photos' | 'sd_card' | 'whatsapp'
export type ImportStatus = 'running' | 'completed' | 'failed' | 'cancelled'

export interface Photo {
  id: number
  path: string
  filename: string
  phash: string | null
  dateTaken: string | null
  dateTakenSource: DateSource | null
  width: number | null
  height: number | null
  fileSize: number | null
  fileMtime: string | null
  source: ImportSource
  googleId: string | null
  importedAt: string
  createdAt: string
}

export interface ImportJob {
  id: number
  source: ImportSource
  startedAt: string
  finishedAt: string | null
  status: ImportStatus
  photosImported: number
  photosSkipped: number
  livePhotosDiscarded: number
  lastImportedDate: string | null
  lastPageToken: string | null
}

export interface AppConfig {
  libraryPath: string | null
  heicConversion: {
    enabled: boolean
    jpegQuality: number
  }
}

export interface SelectLibraryFolderResult {
  cancelled: boolean
  path?: string
  error?: string
}

export interface ImportProgress {
  total: number
  processed: number
  imported: number
  skipped: number
  duplicates: number
  livePhotosDiscarded: number
  currentFile: string | null
}
