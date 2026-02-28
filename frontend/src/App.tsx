import { useEffect, useState } from 'react'
import { AppShell } from './components/layout/AppShell'
import { ToastLayer } from './components/shared/Toast'
import { useConfig } from './hooks/useConfig'
import { useMappedCameras } from './hooks/useMappedCameras'
import { useWebSocket } from './hooks/useWebSocket'
import { StatusTab } from './tabs/StatusTab'
import { TeleopTab } from './tabs/TeleopTab'
import { RecordTab } from './tabs/RecordTab'
import { CalibrateTab } from './tabs/CalibrateTab'
import { MotorSetupTab } from './tabs/MotorSetupTab'
import { DeviceSetupTab } from './tabs/DeviceSetupTab'
import { DatasetTab } from './tabs/DatasetTab'
import { TrainTab } from './tabs/TrainTab'
import { EvalTab } from './tabs/EvalTab'
import { apiGet, apiPost } from './lib/api'
import { logError, swallow } from './lib/errors'
import { useLeStudioStore } from './store'

type ThemeMode = 'dark' | 'light'
const DEFAULT_CTA_STYLE = 'default'

function App() {
  const activeTab = useLeStudioStore((s) => s.activeTab)
  const wsReady = useLeStudioStore((s) => s.wsReady)
  const procStatus = useLeStudioStore((s) => s.procStatus)

  const setSidebarSignals = useLeStudioStore((s) => s.setSidebarSignals)
  const setHfUsername = useLeStudioStore((s) => s.setHfUsername)
  const updateConfig = useLeStudioStore((s) => s.updateConfig)
  const { loadConfig } = useConfig()
  const { refreshDevices } = useMappedCameras()
  const [theme, setTheme] = useState<ThemeMode>('dark')

  useWebSocket()

  useEffect(() => {
    const savedTheme = (localStorage.getItem('lestudio-theme') as ThemeMode | null) ?? 'dark'
    const safeTheme = savedTheme === 'light' ? 'light' : 'dark'
    setTheme(safeTheme)
    document.documentElement.setAttribute('data-theme', safeTheme)
    document.documentElement.setAttribute('data-cta-style', DEFAULT_CTA_STYLE)
    loadConfig()
    refreshDevices()
    apiGet<{ huggingface_cli?: boolean }>('/api/deps/status')
      .then(() => setSidebarSignals({ datasetMissingDep: false }))
      .catch(swallow)
    apiGet<{ ok: boolean }>('/api/train/preflight?device=cuda')
      .then((res) => setSidebarSignals({ trainMissingDep: !res.ok }))
      .catch((err) => {
        logError('App.trainPreflight')(err)
        setSidebarSignals({ trainMissingDep: true })
      })
    apiGet<{ ok: boolean; username: string | null }>('/api/hf/whoami')
      .then((res) => {
        if (res.ok && res.username) {
          setHfUsername(res.username)
          /* Prefill repo_id fields that still have the generic default */
          const cfg = useLeStudioStore.getState().config
          const prefill: Record<string, string> = {}
          const defaultPattern = /^user\//
          if (defaultPattern.test((cfg.record_repo_id as string) ?? 'user/my-dataset')) {
            prefill.record_repo_id = ((cfg.record_repo_id as string) ?? 'user/my-dataset').replace('user/', `${res.username}/`)
          }
          if (defaultPattern.test((cfg.train_repo_id as string) ?? 'user/my-dataset')) {
            prefill.train_repo_id = ((cfg.train_repo_id as string) ?? 'user/my-dataset').replace('user/', `${res.username}/`)
          }
          if (Object.keys(prefill).length > 0) {
            updateConfig(prefill)
            apiPost('/api/config', { ...cfg, ...prefill }).catch(swallow)
          }
        }
      })
      .catch(swallow)
  }, [loadConfig, refreshDevices, setSidebarSignals, setHfUsername, updateConfig])

  /* keyboard shortcuts */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const tag = (target?.tagName ?? '').toUpperCase()
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
        return
      }



      if (e.code === 'Space') {
        if (activeTab === 'teleop') {
          e.preventDefault()
          ;(document.querySelector('#tab-teleop .btn-row button') as HTMLButtonElement | null)?.click()
          return
        }
        if (activeTab === 'record') {
          e.preventDefault()
          ;(document.querySelector('#tab-record #record-ep-controls button') as HTMLButtonElement | null)?.click()
          return
        }
      }

      if (activeTab === 'record' && procStatus.record) {
        if (e.code === 'ArrowRight') {
          e.preventDefault()
          ;(document.querySelector('#tab-record .record-ep-action') as HTMLButtonElement | null)?.click()
          return
        }
        if (e.code === 'ArrowLeft') {
          e.preventDefault()
          ;(document.querySelector('#tab-record .record-ep-discard') as HTMLButtonElement | null)?.click()
          return
        }
        if (e.code === 'Escape') {
          e.preventDefault()
          ;(document.querySelector('#tab-record .record-ep-end') as HTMLButtonElement | null)?.click()
          return
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activeTab, procStatus.record])

  const toggleTheme = () => {
    const next: ThemeMode = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.setAttribute('data-theme', next)
    localStorage.setItem('lestudio-theme', next)
  }

  const renderTabs = (
    <>
      <StatusTab active={activeTab === 'status'} />
      <TeleopTab active={activeTab === 'teleop'} />
      <RecordTab active={activeTab === 'record'} />
      <CalibrateTab active={activeTab === 'calibrate'} />
      <MotorSetupTab active={activeTab === 'motor-setup'} />
      <DeviceSetupTab active={activeTab === 'device-setup'} />
      <DatasetTab active={activeTab === 'dataset'} />
      <TrainTab active={activeTab === 'train'} />
      <EvalTab active={activeTab === 'eval'} />
    </>
  )

  return (
    <>
      <AppShell wsConnected={wsReady} theme={theme} onToggleTheme={toggleTheme}>
        {renderTabs}
      </AppShell>
      <ToastLayer />
    </>
  )
}

export default App
