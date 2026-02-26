# REFACTOR-001 — Simplify HEIC pHash workflow

## Priority
P2 — Non-blocking, quality-of-life improvement

## Goal

Eliminate the temporary JPEG file that `buildImportPlan` currently creates on disk
solely to compute the pHash of a HEIC file. Replace it with direct pHash computation
from the raw RGBA pixels produced by `heic-decode`, without any disk I/O.

---

## Background: Current Flow

In `buildImportPlan` (`src/main/importer.ts`, lines ~179-195), when HEIC conversion is
enabled and the source file is `.heic`/`.heif`:

```
HEIC file
  → heic-decode (WASM/libde265) → raw RGBA pixels
  → sharp JPEG encoder → temp.jpg  ← written to tmpdir()
  → sharp JPEG decoder (from disk) → 32×32 grayscale pixels
  → dctHash → pHash string
  → unlinkSync(temp.jpg)
```

Problems with this approach:
1. **Redundant decode**: `heic-decode` decodes HEIC once to produce the JPEG, then
   the JPEG is re-decoded by sharp just to compute the pHash.
2. **Disk I/O**: a temp `.jpg` (potentially several MB) is written and immediately
   deleted during planning — unnecessary I/O, especially slow on HDD or NAS mounts.
3. **Error-prone**: the `finally` block that deletes the temp file is defensive
   boilerplate. If `os.tmpdir()` fills up, planning would fail.
4. **Complex test surface**: `PlannerOptions.convertHeic` exists solely to test this
   path without a real HEIC converter.

---

## Proposed Approach

### New function: `createHeicPhashComputer`

Add a function to `src/main/heic.ts` that returns a `PhashComputer` capable of
computing pHash directly from raw HEIC pixels, with no temp file:

```typescript
// src/main/heic.ts

export type HeicPhashComputer = PhashComputer  // same signature: (filePath) => Promise<PhashResult | null>

/**
 * Creates a PhashComputer for HEIC/HEIF files.
 * Decodes HEIC pixels via heic-decode (WASM), then computes pHash
 * from raw RGBA data using sharp — no temp file required.
 *
 * @param decodeHeic - Injectable pixel decoder (defaults to heic-decode).
 * @param readFile   - Injectable file reader (defaults to readFileSync).
 * @param computeHash - Injectable DCT hash function (defaults to dctHash from phash.ts).
 */
export function createHeicPhashComputer(
  decodeHeic: HeicPixelDecoder = decode,
  readFile: (path: string) => Buffer = readFileSync
): PhashComputer {
  return async (filePath: string): Promise<PhashResult | null> => {
    try {
      const buffer = readFile(filePath)
      const { data, width, height } = await decodeHeic({ buffer })
      const SAMPLE_SIZE = 32
      const { data: pixels } = await sharp(Buffer.from(data.buffer), {
        raw: { width, height, channels: 4 }
      })
        .resize(SAMPLE_SIZE, SAMPLE_SIZE, { fit: 'fill' })
        .greyscale()
        .raw()
        .toBuffer({ resolveWithObject: true })
      return {
        phash: dctHash(new Uint8Array(pixels), SAMPLE_SIZE),
        width,
        height
      }
    } catch {
      return null
    }
  }
}

/** Default HeicPhashComputer using heic-decode + sharp. */
export const defaultHeicPhashComputer: PhashComputer = createHeicPhashComputer()
```

### Changes to `PlannerOptions`

Add an optional `computeHeicPhash` dependency to `PlannerOptions`:

```typescript
export interface PlannerOptions {
  loadExif?: ExifLoader
  computePhash?: PhashComputer
  checkExists?: (path: string) => boolean
  convertHeic?: HeicConverter
  computeHeicPhash?: PhashComputer  // NEW
}
```

### Changes to `buildImportPlan`

Replace the temp-file approach with the new computer:

```typescript
// BEFORE (lines ~158-195):
const convertHeicFn = options.convertHeic ?? defaultHeicConverter

// ...
if (convertHeic) {
  const tempPath = join(tmpdir(), `keepic-plan-${randomUUID()}.jpg`)
  try {
    await convertHeicFn(srcPath, tempPath, config.heicConversion.jpegQuality)
    phashResult = await computePhash(tempPath)
  } catch {
    phashResult = null
  } finally {
    try { unlinkSync(tempPath) } catch { /* ignore */ }
  }
} else {
  phashResult = await computePhash(srcPath)
}

// AFTER:
const computeHeicPhash = options.computeHeicPhash ?? defaultHeicPhashComputer
const convertHeicFn = options.convertHeic ?? defaultHeicConverter  // still needed for executor

// ...
phashResult = convertHeic
  ? await computeHeicPhash(srcPath)
  : await computePhash(srcPath)
```

The `try/catch/finally` block for temp file management is eliminated entirely.

---

## pHash Stability Across JPEG Conversion

The pHash stored during import (computed from raw HEIC pixels) must equal the pHash
the indexer will compute when it later scans the library (which will contain a JPEG,
not a HEIC).

**Why this is safe at quality 90:**
- pHash works by downscaling to 32×32, applying DCT, and comparing coefficients to
  the mean. At this resolution, quality-90 JPEG compression introduces sub-pixel
  differences that do not change which side of the mean each DCT coefficient falls on.
- The `heic-decode` → quality-90 JPEG encode → sharp decode pipeline is
  perceptually transparent at 32×32.
- This is a fundamental property of pHash: it is designed to be robust to minor
  format conversions. This is precisely why pHash is preferred over cryptographic
  hashes for deduplication.

**Verdict**: the refactoring is safe. No correctness risk at quality 90.

**Recommended verification test** (nice-to-have, not a blocker):

Add a pHash stability test to `tests/main/heic.test.ts`:

```typescript
it('pHash of raw HEIC pixels matches pHash of its quality-90 JPEG conversion', async () => {
  const heicPhash = await defaultHeicPhashComputer('tests/fixtures/sample.heic')
  const jpegPath = join(tmpdir(), `heic-stability-${randomUUID()}.jpg`)
  await defaultHeicConverter('tests/fixtures/sample.heic', jpegPath, 90)
  const jpegPhash = await defaultPhashComputer(jpegPath)
  unlinkSync(jpegPath)

  expect(heicPhash?.phash).toBe(jpegPhash?.phash)
})
```

This test requires a real `.heic` fixture file. It can be generated once from any
iPhone photo and committed to `tests/fixtures/`. If generating a fixture is
inconvenient, this test can be deferred — the correctness is already well-established
by pHash's design properties and the high JPEG quality used.

---

## Deliverables

1. **`src/main/heic.ts`**: Add `createHeicPhashComputer` and `defaultHeicPhashComputer`
2. **`src/main/importer.ts`**: Update `PlannerOptions` + simplify `buildImportPlan`
   (remove temp file logic, use `computeHeicPhash`)
3. **Tests**:
   - Unit tests for `createHeicPhashComputer` (injectable deps, returns null on error, etc.)
   - pHash stability test (see above) — add a sample `.heic` fixture if needed
   - Update `buildImportPlan` tests: inject `computeHeicPhash` instead of `convertHeic`
     for the HEIC planning path
4. **Cleanup**: `PlannerOptions.convertHeic` is no longer used for pHash computation;
   it remains in `PlannerOptions` only if the executor still needs it (the executor
   receives `ExecutorOptions`, not `PlannerOptions`, so `PlannerOptions.convertHeic`
   can be removed)

---

## Scope Boundaries

**In scope:**
- `src/main/heic.ts` — new `createHeicPhashComputer`
- `src/main/importer.ts` — `buildImportPlan` simplification
- Tests for the above

**Out of scope:**
- The executor (`executeImportPlan`) — it correctly uses `HeicConverter` for the actual
  copy/convert step and does not compute pHash. No changes needed.
- The indexer (`runIndexer`) — it scans the library (which contains JPEGs) and calls
  `defaultPhashComputer` on them. No changes needed.
- `PlannerOptions.convertHeic` removal is optional; can be done if tests no longer need it.

---

## Test Coverage

All 100% coverage lines must remain green after this change. Key test scenarios:
- `createHeicPhashComputer`: returns correct PhashResult with injectable deps
- `createHeicPhashComputer`: returns null on decode error
- `createHeicPhashComputer`: returns null on sharp error
- `buildImportPlan` with HEIC + conversion enabled: calls `computeHeicPhash`, no temp file
- `buildImportPlan` with HEIC + conversion disabled: calls `computePhash` (unchanged)
- `buildImportPlan` with HEIC + conversion enabled + pHash error: stores null phash
- pHash stability: `defaultHeicPhashComputer(heic) == defaultPhashComputer(quality90jpeg)`
