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

export interface IndexProgress {
  total: number
  processed: number
  indexed: number
  skipped: number
}

export interface IndexResult {
  indexed: number
  skipped: number
  deleted: number
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

export type ImportEntryStatus = 'ready' | 'duplicate' | 'collision' | 'error'

export interface ImportPlanEntry {
  sourcePath: string
  destinationRelativePath: string
  dateTaken: string
  dateTakenSource: DateSource
  phash: string | null
  width: number | null
  height: number | null
  fileSize: number
  status: ImportEntryStatus
  duplicateOf?: string
  originalDestination?: string
  errorMessage?: string
  /** Absolute path to a pre-staged JPEG (set by the planner for HEIC files). */
  stagedPath?: string
}

export interface ImportPlan {
  entries: ImportPlanEntry[]
  livePhotosDiscarded: number
  sourceFolder: string
}

export interface PlanProgress {
  total: number
  processed: number
  currentFile: string | null
}

export interface ImportResult {
  imported: number
  skipped: number
  livePhotosDiscarded: number
  errors: Array<{ sourcePath: string; error: string }>
  status: ImportStatus
}

export interface GoogleAuthStatus {
  authenticated: boolean
  email?: string
}

export interface GoogleDownloadProgress {
  total: number
  downloaded: number
  currentFile: string | null
}

export interface GoogleDownloadResult {
  status: ImportStatus
  downloaded: number
  errors: Array<{ filename: string; error: string }>
  downloadDir: string // absolute path to the staging folder
}

export interface PickerMediaItem {
  id: string
  baseUrl: string
  mimeType: string
  filename: string
  mediaMetadata: {
    creationTime: string
    width: string
    height: string
  }
}

export interface PickerSession {
  id: string
  pickerUri: string
  mediaItemsSet: boolean
}

export interface DuplicatePhoto {
  path: string
  filename: string
  fileSize: number | null
  dateTaken: string | null
  importedAt: string
}

export interface DuplicateGroup {
  phash: string
  photos: DuplicatePhoto[] // always 2+ items, sorted by importedAt ASC
}

export interface LibraryStats {
  totalPhotos: number
  totalSizeBytes: number
  oldestDate: string | null // ISO date string (YYYY-MM-DD) or null if empty
  newestDate: string | null // ISO date string (YYYY-MM-DD) or null if empty
  photosByYear: Array<{ year: string; count: number }> // sorted ascending
  recentImports: Array<{
    // last 5 completed import_jobs, newest first
    source: ImportSource
    finishedAt: string // ISO 8601
    photosImported: number
    photosSkipped: number
  }>
}
