<script lang="ts">
  import { onMount } from 'svelte'
  import type { AppConfig, GoogleAuthStatus, GoogleDownloadResult, ImportPlanEntry, ImportProgress, ImportResult, PlanProgress, SkippedFile } from '../../shared/types'
  import HomeScreen from './screens/HomeScreen.svelte'
  import GoogleDownloadScreen from './screens/GoogleDownloadScreen.svelte'
  import PlanningScreen from './screens/PlanningScreen.svelte'
  import ReviewScreen from './screens/ReviewScreen.svelte'
  import ExecutionScreen from './screens/ExecutionScreen.svelte'
  import ResultScreen from './screens/ResultScreen.svelte'
  import DeduplicationScreen from './screens/DeduplicationScreen.svelte'
  import ReindexScreen from './screens/ReindexScreen.svelte'

  type Screen = 'home' | 'google-download' | 'planning' | 'review' | 'executing' | 'result' | 'dedup-scan' | 'reindex'

  let currentScreen: Screen = $state('home')
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

  onMount(async () => {
    config = await window.keepic.config.get()
    googleAuthStatus = await window.keepic.google.getAuthStatus()
  })

  function handleSourceFolder(folder: string): void {
    sourceFolder = folder
  }

  function handleGoogleImport(): void {
    currentScreen = 'google-download'
  }

  function handleDownloadComplete(result: GoogleDownloadResult): void {
    googleDownloadDir = result.downloadDir
    sourceFolder = result.downloadDir
    planProgress = null
    planStartTime = Date.now()
    currentScreen = 'planning'
  }

  function handleAnalyse(): void {
    planProgress = null
    planStartTime = Date.now()
    currentScreen = 'planning'
  }

  function handlePlanProgress(p: PlanProgress): void {
    planProgress = p
  }

  function handlePlanSuccess(result: { entries: ImportPlanEntry[]; livePhotosDiscarded: number; skippedFiles: SkippedFile[] }): void {
    analysisElapsedMs = Date.now() - planStartTime
    plan = result.entries
    livePhotosDiscarded = result.livePhotosDiscarded
    skippedFiles = result.skippedFiles
    currentScreen = 'review'
  }

  function handlePlanError(): void {
    currentScreen = 'home'
  }

  function handleImport(modifiedPlan: ImportPlanEntry[]): void {
    plan = modifiedPlan
    execProgress = null
    execStartTime = Date.now()
    currentScreen = 'executing'
  }

  function handleExecProgress(p: ImportProgress): void {
    execProgress = p
  }

  function handleExecComplete(result: ImportResult): void {
    execElapsedMs = Date.now() - execStartTime
    importResult = result
    currentScreen = 'result'
  }

  function handleReset(): void {
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
    currentScreen = 'home'
  }

  function handleLibraryPathChange(path: string): void {
    if (config) config = { ...config, libraryPath: path }
  }

  function handleGoogleAuthChange(status: GoogleAuthStatus): void {
    googleAuthStatus = status
  }

  function handleDedupScan(): void {
    currentScreen = 'dedup-scan'
  }

  function handleReindex(): void {
    currentScreen = 'reindex'
  }

  function handleHeicModeChange(mode: AppConfig['heic']['mode']): void {
    if (config) config = { ...config, heic: { ...config.heic, mode } }
  }
</script>

<div class="min-h-screen bg-gray-50 flex items-center justify-center">
  <div class="w-full max-w-3xl mx-auto p-6">
    {#if currentScreen === 'home'}
      <HomeScreen
        libraryPath={config?.libraryPath ?? null}
        heicMode={config?.heic.mode ?? 'keep'}
        {sourceFolder}
        {googleAuthStatus}
        onLibraryPathChange={handleLibraryPathChange}
        onHeicModeChange={handleHeicModeChange}
        onSourceFolder={handleSourceFolder}
        onAnalyse={handleAnalyse}
        onGoogleImport={handleGoogleImport}
        onGoogleAuthChange={handleGoogleAuthChange}
        onDedupScan={handleDedupScan}
        onReindex={handleReindex}
      />
    {:else if currentScreen === 'google-download'}
      <GoogleDownloadScreen
        onDownloadComplete={handleDownloadComplete}
        onBack={handleReset}
      />
    {:else if currentScreen === 'planning'}
      <PlanningScreen
        {sourceFolder}
        onProgress={handlePlanProgress}
        onSuccess={handlePlanSuccess}
        onError={handlePlanError}
      />
    {:else if currentScreen === 'review'}
      <ReviewScreen
        {plan}
        {livePhotosDiscarded}
        {analysisElapsedMs}
        onImport={handleImport}
        onCancel={handleReset}
      />
    {:else if currentScreen === 'executing'}
      <ExecutionScreen
        plan={{ entries: plan, livePhotosDiscarded, sourceFolder, skippedFiles }}
        onProgress={handleExecProgress}
        onComplete={handleExecComplete}
      />
    {:else if currentScreen === 'result'}
      <ResultScreen
        result={importResult}
        elapsedMs={execElapsedMs}
        onImportMore={handleReset}
        onDone={handleReset}
      />
    {:else if currentScreen === 'dedup-scan'}
      <DeduplicationScreen onBack={handleReset} />
    {:else if currentScreen === 'reindex'}
      <ReindexScreen onBack={handleReset} />
    {/if}
  </div>
</div>
