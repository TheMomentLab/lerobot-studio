import { useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { NavLink, Stack, Text, Badge, ScrollArea } from '@mantine/core'
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
      { id: 'status',       label: 'Status',      icon: '📊' },
      { id: 'device-setup', label: 'Mapping',      icon: '🔌' },
      { id: 'motor-setup',  label: 'Motor Setup',  icon: '⚙️' },
      { id: 'calibrate',    label: 'Calibration',  icon: '🎯' },
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
      { id: 'eval',  label: 'Eval',  icon: '📈' },
    ],
  },
]

const TAB_ORDER = TAB_GROUPS.flatMap((g) => g.tabs.map((t) => t.id))

function tabHealthState(
  tab: string,
  signals: ReturnType<typeof useLeStudioStore.getState>['sidebarSignals'],
): string {
  if (tab === 'device-setup') {
    if (signals.rulesNeedsRoot) return 'needs_root'
    if (signals.rulesNeedsInstall) return 'needs_udev'
    if (!signals.hasCameras || !signals.hasArms) return 'needs_device'
  }
  if (tab === 'dataset' && signals.datasetMissingDep) return 'missing_dep'
  if ((tab === 'train' || tab === 'eval') && signals.trainMissingDep) return 'missing_dep'
  return ''
}

function stateBadge(state: string): { label: string; color: string } | null {
  if (state === 'running')      return { label: 'Running',        color: 'green' }
  if (state === 'error')        return { label: 'Error',          color: 'red' }
  if (state === 'needs_root')   return { label: 'Needs Root',     color: 'yellow' }
  if (state === 'needs_udev')   return { label: 'Setup Needed',   color: 'blue' }
  if (state === 'missing_dep')  return { label: 'Install Needed', color: 'grape' }
  if (state === 'needs_device') return { label: 'No Device',      color: 'yellow' }
  return null
}

export function Sidebar() {
  const activeTab     = useLeStudioStore((s) => s.activeTab)
  const setActiveTab  = useLeStudioStore((s) => s.setActiveTab)
  const procStatus    = useLeStudioStore((s) => s.procStatus)
  const signals       = useLeStudioStore((s) => s.sidebarSignals)
  const setMobileSidebarOpen = useLeStudioStore((s) => s.setMobileSidebarOpen)
  const tabRefs = useRef<Record<string, HTMLElement | null>>({})

  const activateTab = (tabId: string) => {
    setActiveTab(tabId)
    setMobileSidebarOpen(false)
  }

  const focusTab = (tabId: string) => {
    tabRefs.current[tabId]?.focus()
  }

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLElement>, tabId: string) => {
    const idx = TAB_ORDER.indexOf(tabId)
    if (idx < 0) return

    const go = (nextIdx: number) => {
      const nextId = TAB_ORDER[nextIdx]
      activateTab(nextId)
      window.requestAnimationFrame(() => focusTab(nextId))
    }

    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); go((idx + 1) % TAB_ORDER.length); return }
    if (e.key === 'ArrowUp'   || e.key === 'ArrowLeft')  { e.preventDefault(); go((idx - 1 + TAB_ORDER.length) % TAB_ORDER.length); return }
    if (e.key === 'Home')  { e.preventDefault(); go(0); return }
    if (e.key === 'End')   { e.preventDefault(); go(TAB_ORDER.length - 1); return }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activateTab(tabId) }
  }

  return (
    <ScrollArea h="100%" type="scroll">
      <Stack gap={0} p="xs" pt="sm">
        {TAB_GROUPS.map((group) => (
          <Stack key={group.id} gap={2} mb="md">
            {/* Group label */}
            <Text
              size="xs"
              fw={600}
              c="dimmed"
              tt="uppercase"
              lts={0.8}
              px={8}
              mb={4}
              style={{ letterSpacing: '0.8px' }}
            >
              {group.title}
            </Text>

            {group.tabs.map((tab) => {
              const proc    = PROCESS_TABS[tab.id]
              const running = proc ? !!procStatus[proc] : false
              const health  = tabHealthState(tab.id, signals)
              const state   = running ? 'running' : health
              const badge   = stateBadge(state)
              const isActive = activeTab === tab.id

              return (
                <NavLink
                  key={tab.id}
                  component="a"
                  href="#"
                  role="tab"
                  id={`nav-tab-${tab.id}`}
                  aria-selected={isActive}
                  aria-controls={`tab-${tab.id}`}
                  tabIndex={isActive ? 0 : -1}
                  active={isActive}
                  label={tab.label}
                  leftSection={
                    <span style={{ fontSize: 14, lineHeight: 1 }}>{tab.icon}</span>
                  }
                  rightSection={
                    badge ? (
                      <Badge size="xs" color={badge.color} variant="light" style={{ fontSize: 9, letterSpacing: '0.3px' }}>
                        {badge.label}
                      </Badge>
                    ) : null
                  }
                  styles={{
                    root: {
                      borderRadius: 7,
                      fontSize: 13,
                      padding: '9px 10px',
                    },
                  }}
                  onClick={(e) => { e.preventDefault(); activateTab(tab.id) }}
                  onKeyDown={(e) => handleKeyDown(e, tab.id)}
                  ref={(el) => { tabRefs.current[tab.id] = el }}
                  data-tab={tab.id}
                />
              )
            })}
          </Stack>
        ))}
      </Stack>
    </ScrollArea>
  )
}
