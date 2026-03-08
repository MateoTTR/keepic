<script lang="ts">
  import { onMount } from 'svelte'
  import type { AppConfig, GoogleAuthStatus, GoogleDownloadResult, ImportPlanEntry, ImportProgress, ImportResult, PlanProgress, SkippedFile } from '../../shared/types'
  import TabBar from './components/ui/TabBar.svelte'
  import LibraryTab from './screens/LibraryTab.svelte'
  import ImportTab from './screens/ImportTab.svelte'
  import SettingsTab from './screens/SettingsTab.svelte'
  import GoogleDownloadScreen from './screens/GoogleDownloadScreen.svelte'
  import PlanningScreen from './screens/PlanningScreen.svelte'
  import ReviewScreen from './screens/ReviewScreen.svelte'
  import ExecutionScreen from './screens/ExecutionScreen.svelte'
  import ResultScreen from './screens/ResultScreen.svelte'
  import DeduplicationScreen from './screens/DeduplicationScreen.svelte'
  import ReindexScreen from './screens/ReindexScreen.svelte'
  import Button from './components/ui/Button.svelte'

  type Tab = 'library' | 'import' | 'settings'
  type LibraryScreen = 'main' | 'reindex' | 'dedup-scan'
  type ImportScreen = 'main' | 'google-download' | 'planning' | 'review' | 'executing' | 'result'

  const tabs = [
    { id: 'library', label: 'Library' },
    { id: 'import', label: 'Import' },
    { id: 'settings', label: 'Settings' }
  ]

  let activeTab: Tab = $state('library')
  let libraryScreen: LibraryScreen = $state('main')
  let importScreen: ImportScreen = $state('main')

  let sourceFolder: string = $state('')
  let googleDownloadDir: string = $state('')
  let config: AppConfig | null = $state(null)
  let planProgress: PlanProgress | null = $state(null)
  let plan: ImportPlanEntry[] = $state([])
  let livePhotosDiscarded: number = $state(0)
  let skippedFiles: SkippedFile[] = $state([])
  let execProgress: ImportProgress | null = $state(null)
  let importResult: ImportResult | null = $state(null)
  let googleAuthStatus: GoogleAuthStatus | null = $state(null)
  let planStartTime: number = $state(0)
  let analysisElapsedMs: number = $state(0)
  let execStartTime: number = $state(0)
  let execElapsedMs: number = $state(0)

  let libraryTabRef: LibraryTab | undefined = $state(undefined)

  // Tabs are disabled during long-running operations
  const tabsDisabled = $derived(
    libraryScreen !== 'main' || importScreen !== 'main'
  )

  onMount(async () => {
    config = await window.keepic.config.get()
    googleAuthStatus = await window.keepic.google.getAuthStatus()
  })

  function handleTabChange(tabId: string): void {
    const tab = tabId as Tab
    // Switching tabs resets sub-screens (only if not in an operation)
    if (tab === activeTab) return
    activeTab = tab
    // Refresh stats when switching to library tab
    if (tab === 'library' && libraryTabRef) {
      libraryTabRef.refreshStats()
    }
  }

  // --- Import tab handlers ---
  function handleSourceFolder(folder: string): void {
    sourceFolder = folder
  }

  function handleGoogleImport(): void {
    importScreen = 'google-download'
  }

  function handleDownloadComplete(result: GoogleDownloadResult): void {
    googleDownloadDir = result.downloadDir
    sourceFolder = result.downloadDir
    planProgress = null
    planStartTime = Date.now()
    importScreen = 'planning'
  }

  function handleAnalyse(): void {
    planProgress = null
    planStartTime = Date.now()
    importScreen = 'planning'
  }

  function handlePlanProgress(p: PlanProgress): void {
    planProgress = p
  }

  function handlePlanSuccess(result: { entries: ImportPlanEntry[]; livePhotosDiscarded: number; skippedFiles: SkippedFile[] }): void {
    analysisElapsedMs = Date.now() - planStartTime
    plan = result.entries
    livePhotosDiscarded = result.livePhotosDiscarded
    skippedFiles = result.skippedFiles
    importScreen = 'review'
  }

  function handlePlanError(): void {
    importScreen = 'main'
  }

  function handleImport(modifiedPlan: ImportPlanEntry[]): void {
    plan = modifiedPlan
    execProgress = null
    execStartTime = Date.now()
    importScreen = 'executing'
  }

  function handleExecProgress(p: ImportProgress): void {
    execProgress = p
  }

  function handleExecComplete(result: ImportResult): void {
    execElapsedMs = Date.now() - execStartTime
    importResult = result
    importScreen = 'result'
  }

  function handleImportReset(): void {
    if (googleDownloadDir) {
      void window.keepic.google.cleanupDownloadDir(googleDownloadDir)
      googleDownloadDir = ''
    }
    sourceFolder = ''
    planProgress = null
    plan = []
    livePhotosDiscarded = 0
    skippedFiles = []
    execProgress = null
    importResult = null
    importScreen = 'main'
  }

  // --- Library tab handlers ---
  function handleLibraryPathChange(path: string): void {
    if (config) config = { ...config, libraryPath: path }
  }

  function handleDedupScan(): void {
    libraryScreen = 'dedup-scan'
  }

  function handleReindex(): void {
    libraryScreen = 'reindex'
  }

  function handleLibraryBack(): void {
    libraryScreen = 'main'
    // Refresh stats after reindex or dedup scan
    if (libraryTabRef) {
      libraryTabRef.refreshStats()
    }
  }

  // --- Settings tab handlers ---
  function handleGoogleAuthChange(status: GoogleAuthStatus): void {
    googleAuthStatus = status
  }

  function handleHeicModeChange(mode: AppConfig['heic']['mode']): void {
    if (config) config = { ...config, heic: { ...config.heic, mode } }
  }
</script>

{#if config && !config.libraryPath}
  <!-- First-launch: library setup prompt -->
  <div class="min-h-screen bg-gray-50 flex items-center justify-center">
    <div class="w-full max-w-md mx-auto p-6">
      <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-8 space-y-6 text-center">
        <h1 class="text-2xl font-bold text-gray-900">Welcome to KeePic</h1>
        <p class="text-gray-500">Select a library folder to get started. This is where your photos and videos will be stored.</p>
        <Button onclick={async () => {
          const result = await window.keepic.config.selectLibraryFolder()
          if (!result.cancelled && result.path) {
            handleLibraryPathChange(result.path)
          }
        }}>Configure library folder…</Button>
      </div>
    </div>
  </div>
{:else}
  <!-- Main tabbed layout -->
  <div class="min-h-screen bg-gray-50 flex flex-col">
    <TabBar {tabs} {activeTab} disabled={tabsDisabled} onTabChange={handleTabChange} />

    <div class="flex-1 flex items-start justify-center">
      <div class="w-full max-w-3xl mx-auto p-6">
        {#if activeTab === 'library'}
          {#if libraryScreen === 'main'}
            <LibraryTab
              bind:this={libraryTabRef}
              libraryPath={config?.libraryPath ?? null}
              onLibraryPathChange={handleLibraryPathChange}
              onDedupScan={handleDedupScan}
              onReindex={handleReindex}
            />
          {:else if libraryScreen === 'reindex'}
            <ReindexScreen onBack={handleLibraryBack} />
          {:else if libraryScreen === 'dedup-scan'}
            <DeduplicationScreen onBack={handleLibraryBack} />
          {/if}

        {:else if activeTab === 'import'}
          {#if importScreen === 'main'}
            <ImportTab
              {sourceFolder}
              {googleAuthStatus}
              onSourceFolder={handleSourceFolder}
              onAnalyse={handleAnalyse}
              onGoogleImport={handleGoogleImport}
              onGoogleAuthChange={handleGoogleAuthChange}
            />
          {:else if importScreen === 'google-download'}
            <GoogleDownloadScreen
              onDownloadComplete={handleDownloadComplete}
              onBack={handleImportReset}
            />
          {:else if importScreen === 'planning'}
            <PlanningScreen
              {sourceFolder}
              onProgress={handlePlanProgress}
              onSuccess={handlePlanSuccess}
              onError={handlePlanError}
            />
          {:else if importScreen === 'review'}
            <ReviewScreen
              {plan}
              {livePhotosDiscarded}
              {analysisElapsedMs}
              onImport={handleImport}
              onCancel={handleImportReset}
            />
          {:else if importScreen === 'executing'}
            <ExecutionScreen
              plan={{ entries: plan, livePhotosDiscarded, sourceFolder, skippedFiles }}
              onProgress={handleExecProgress}
              onComplete={handleExecComplete}
            />
          {:else if importScreen === 'result'}
            <ResultScreen
              result={importResult}
              elapsedMs={execElapsedMs}
              onImportMore={handleImportReset}
              onDone={handleImportReset}
            />
          {/if}

        {:else if activeTab === 'settings'}
          <SettingsTab
            heicMode={config?.heic.mode ?? 'keep'}
            onHeicModeChange={handleHeicModeChange}
          />
        {/if}
      </div>
    </div>
  </div>
{/if}
