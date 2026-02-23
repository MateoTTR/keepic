<script lang="ts">
  import { onMount } from 'svelte'
  import type { AppConfig, GoogleAuthStatus, GoogleDownloadResult, ImportPlanEntry, ImportProgress, ImportResult, PlanProgress } from '../../shared/types'
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
  let execProgress: ImportProgress | null = $state(null)
  let importResult: ImportResult | null = $state(null)
  let googleAuthStatus: GoogleAuthStatus | null = $state(null)

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
    currentScreen = 'planning'
  }

  function handleAnalyse(): void {
    planProgress = null
    currentScreen = 'planning'
  }

  function handlePlanProgress(p: PlanProgress): void {
    planProgress = p
  }

  function handlePlanSuccess(result: { entries: ImportPlanEntry[]; livePhotosDiscarded: number }): void {
    plan = result.entries
    livePhotosDiscarded = result.livePhotosDiscarded
    currentScreen = 'review'
  }

  function handlePlanError(): void {
    currentScreen = 'home'
  }

  function handleImport(modifiedPlan: ImportPlanEntry[]): void {
    plan = modifiedPlan
    execProgress = null
    currentScreen = 'executing'
  }

  function handleExecProgress(p: ImportProgress): void {
    execProgress = p
  }

  function handleExecComplete(result: ImportResult): void {
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
</script>

<div class="min-h-screen bg-gray-50 flex items-center justify-center">
  <div class="w-full max-w-3xl mx-auto p-6">
    {#if currentScreen === 'home'}
      <HomeScreen
        libraryPath={config?.libraryPath ?? null}
        {sourceFolder}
        {googleAuthStatus}
        onLibraryPathChange={handleLibraryPathChange}
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
        onImport={handleImport}
        onCancel={handleReset}
      />
    {:else if currentScreen === 'executing'}
      <ExecutionScreen
        plan={{ entries: plan, livePhotosDiscarded, sourceFolder }}
        onProgress={handleExecProgress}
        onComplete={handleExecComplete}
      />
    {:else if currentScreen === 'result'}
      <ResultScreen
        result={importResult}
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
