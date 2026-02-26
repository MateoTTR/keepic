# TASK-035 — End-to-end integration test + cleanup

## Goal

Final integration testing of the complete Picker API flow, cleanup of any remaining
references to the old Library API, and update of documentation and error messages.

## Deliverables

### Manual testing

1. Full flow test: connect → create session → select photos in browser → download → plan → review → execute → verify files in library
2. Cancellation test: cancel during download, cancel during selection wait
3. Error scenarios: network failure mid-download, expired token, no photos selected
4. Disconnect/reconnect: verify clean state transitions

### Code cleanup

5. Search codebase for any remaining references to `photoslibrary.readonly`, `mediaItems:search`,
   or old Library API types — remove or update
6. Verify no unused imports or dead code remain
7. Update any user-facing error messages that reference the old flow
   (e.g., "disconnect and reconnect to grant permissions")

### Documentation

8. Update `docs/specs/specifications.md` section 2.4.2 (Import from Google Photos) to
   describe the new Picker-based flow
9. Update `CLAUDE.md` if any open questions related to Google Photos are now resolved
10. Create session report

### Release

11. Version bump if releasing a new build
12. Verify CI passes (lint, tests, coverage 100%)
