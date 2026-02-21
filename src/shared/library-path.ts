/**
 * Utilities for validating and computing paths according to the KeePic
 * library folder naming convention.
 *
 * Convention:
 *   <library_root>/YYYY/YYYY.MM/<filename>
 *
 * Only folders matching /^\d{4}$/ at the library root are scanned.
 */

/** Returns true if a root-level folder name should be scanned (e.g. "2025"). */
export function isYearFolder(name: string): boolean {
  return /^\d{4}$/.test(name)
}

/** Returns true if a second-level folder name is a valid monthly folder (e.g. "2025.01"). */
export function isMonthlyFolder(name: string): boolean {
  return /^\d{4}\.(0[1-9]|1[0-2])$/.test(name)
}

/**
 * Returns true if a second-level folder name is a valid event folder.
 * Accepted patterns (all start with YYYY.MM.DD):
 *   2025.04.15-19.Londres         (same-month range)
 *   2025.01.31-02.02.Center.Parcs (cross-month range)
 *   2025.06.21.Mariage            (single-day event)
 */
export function isEventFolder(name: string): boolean {
  return /^\d{4}\.(0[1-9]|1[0-2])\.\d{2}(-(\d{2}\.)?(\d{2}))?\..+$/.test(name)
}

/**
 * Computes the relative destination path for a photo given its capture date.
 * Returns: "YYYY/YYYY.MM/filename"
 */
export function getDestinationPath(dateTaken: Date, filename: string): string {
  const year = dateTaken.getFullYear()
  const month = String(dateTaken.getMonth() + 1).padStart(2, '0')
  const yearStr = String(year)
  const monthFolder = `${yearStr}.${month}`
  return `${yearStr}/${monthFolder}/${filename}`
}
