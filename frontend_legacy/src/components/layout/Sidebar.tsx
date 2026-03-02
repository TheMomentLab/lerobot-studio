import { useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useLeStudioStore } from '../../store'

const PROCESS_TABS: Record<string, string> = {
  teleop: 'teleop',
  record: 'record',
  calibrate: 'calibrate',
  'motor-setup': 'motor_setup',
  train: 'train',
  eval: 'eval',
}

const TAB_GROUPS = [
  {
    id: 'setup',
    title: 'Setup',
    tabs: [
      { id: 'status', label: 'Status', icon: '📊' },
      { id: 'device-setup', label: 'Mapping', icon: '🔌' },
      { id: 'motor-setup', label: 'Motor Setup', icon: '⚙️' },
      { id: 'calibrate', label: 'Calibration', icon: '🎯' },
    ],
  },
  {
    id: 'operate',
    title: 'Operate',
    tabs: [
      { id: 'teleop', label: 'Teleop', icon: '🎮' },
      { id: 'record', label: 'Record', icon: '🔴' },
    ],
  },
  {
    id: 'data',
    title: 'Data',
    tabs: [{ id: 'dataset', label: 'Dataset', icon: '📁' }],
  },
  {
    id: 'ml',
    title: 'ML',
    tabs: [
      { id: 'train', label: 'Train', icon: '🧠' },
      { id: 'eval', label: 'Eval', icon: '📈' },
    ],
  },
]

const TAB_ORDER = TAB_GROUPS.flatMap((group) => group.tabs.map((tab) => tab.id))

function tabHealthState(tab: string, signals: ReturnType<typeof useLeStudioStore.getState>['sidebarSignals']): string {
  if (tab === 'device-setup') {
    if (signals.rulesNeedsRoot) return 'needs_root'
    if (signals.rulesNeedsInstall) return 'needs_udev'
    if (!signals.hasCameras || !signals.hasArms) return 'needs_device'
  }
  if (tab === 'dataset' && signals.datasetMissingDep) return 'missing_dep'
  if ((tab === 'train' || tab === 'eval') && signals.trainMissingDep) return 'missing_dep'
  return ''
}

function badgeLabel(state: string): string {
  if (state === 'running') return 'Running'
  if (state === 'error') return 'Error'
  if (state === 'needs_root') return 'Needs Root'
  if (state === 'needs_udev') return 'Setup Needed'
  if (state === 'missing_dep') return 'Install Needed'
  if (state === 'needs_device') return 'No Device'
  return ''
}


export function Sidebar() {
  const activeTab = useLeStudioStore((s) => s.activeTab)
  const setActiveTab = useLeStudioStore((s) => s.setActiveTab)
  const procStatus = useLeStudioStore((s) => s.procStatus)
  const signals = useLeStudioStore((s) => s.sidebarSignals)
  const setMobileSidebarOpen = useLeStudioStore((s) => s.setMobileSidebarOpen)
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  const activateTab = (tabId: string) => {
    setActiveTab(tabId)
    setMobileSidebarOpen(false)
  }

  const focusTab = (tabId: string) => {
    const next = tabRefs.current[tabId]
    if (next) next.focus()
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, tabId: string) => {
    const idx = TAB_ORDER.indexOf(tabId)
    if (idx < 0) return

    const focusAndActivate = (nextIdx: number) => {
      const nextTabId = TAB_ORDER[nextIdx]
      activateTab(nextTabId)
      window.requestAnimationFrame(() => focusTab(nextTabId))
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault()
      focusAndActivate((idx + 1) % TAB_ORDER.length)
      return
    }

    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault()
      focusAndActivate((idx - 1 + TAB_ORDER.length) % TAB_ORDER.length)
      return
    }

    if (event.key === 'Home') {
      event.preventDefault()
      focusAndActivate(0)
      return
    }

    if (event.key === 'End') {
      event.preventDefault()
      focusAndActivate(TAB_ORDER.length - 1)
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      activateTab(tabId)
    }
  }

  return (
    <aside id="sidebar-nav" aria-label="Workflow Navigation" role="tablist" aria-orientation="vertical">
      {TAB_GROUPS.map((group) => (
        <div key={group.id} id={`sidebar-group-${group.id}`} className="sidebar-group">
          <div className="sidebar-group-title">{group.title}</div>
          {group.tabs.map((tab) => {
            const proc = PROCESS_TABS[tab.id]
            const running = proc ? !!procStatus[proc] : false
            const health = tabHealthState(tab.id, signals)
            const state = running ? 'running' : health
            const isActive = activeTab === tab.id
            const panelId = `tab-${tab.id}`
            const stateLabel = badgeLabel(state)

            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`nav-tab-${tab.id}`}
                aria-selected={isActive}
                aria-controls={panelId}
                tabIndex={isActive ? 0 : -1}
                className={`tab-btn ${isActive ? 'active' : ''} ${state ? `has-${state.replace('_', '-')}` : ''}`}
                aria-label={stateLabel ? `${tab.label} (${stateLabel})` : tab.label}
                title={stateLabel ? `${tab.label} • ${stateLabel}` : tab.label}
                onClick={() => activateTab(tab.id)}
                onKeyDown={(event) => handleKeyDown(event, tab.id)}
                ref={(el) => {
                  tabRefs.current[tab.id] = el
                }}
                data-tab={tab.id}
                data-proc={proc ?? ''}
              >
                <span className="tab-icon">{tab.icon}</span><span className="tab-text">{tab.label}</span>
                {stateLabel ? (
                  <span className="tab-state-badge" aria-label={stateLabel}>
                    {stateLabel}
                  </span>
                ) : null}
                {stateLabel ? <span className="tab-state-dot" aria-hidden="true" /> : null}
              </button>
            )
          })}
        </div>
      ))}
    </aside>
  )
}
