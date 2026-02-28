import type { ReactNode } from 'react'
import {
  AppShell as MantineAppShell,
  Group,
  ActionIcon,
  Burger,
  UnstyledButton,
  Text,
  Badge,
  Tooltip,
  Indicator,
} from '@mantine/core'
import { useLeStudioStore } from '../../store'
import { Sidebar } from './Sidebar'
import { ProfileSelector } from '../shared/ProfileSelector'
import { ConsoleDrawer } from '../shared/ConsoleDrawer'

interface AppShellProps {
  children: ReactNode
  wsConnected: boolean
  theme: 'dark' | 'light'
  onToggleTheme: () => void
}

const DEFAULT_COLAB_NOTEBOOK_URL = 'https://colab.research.google.com/github/googlecolab/colabtools/blob/main/notebooks/colab-github-demo.ipynb'

const LeStudioLogo = () => (
  <svg
    style={{ width: 28, height: 28, color: 'var(--mantine-color-text)' }}
    viewBox="0 0 100 100"
    fill="none"
    stroke="currentColor"
    strokeWidth={4}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <defs>
      <mask id="planet-mask">
        <rect width="100" height="100" fill="white" />
        <path d="M 0,50 A 50,16 0 0,0 100,50" fill="none" stroke="black" strokeWidth={12} transform="rotate(-15 50 50)" />
      </mask>
    </defs>
    <circle cx="50" cy="50" r="34" mask="url(#planet-mask)" />
    <ellipse cx="50" cy="50" rx="48" ry="16" transform="rotate(-15 50 50)" />
  </svg>
)

export function AppShell({ children, wsConnected, theme, onToggleTheme }: AppShellProps) {
  const mobileSidebarOpen = useLeStudioStore((s) => s.mobileSidebarOpen)
  const setMobileSidebarOpen = useLeStudioStore((s) => s.setMobileSidebarOpen)
  const setActiveTab = useLeStudioStore((s) => s.setActiveTab)
  const addToast = useLeStudioStore((s) => s.addToast)
  const hfUsername = useLeStudioStore((s) => s.hfUsername)
  const apiHealth = useLeStudioStore((s) => s.apiHealth)
  const apiSupport = useLeStudioStore((s) => s.apiSupport)

  const degraded =
    wsConnected &&
    ((apiSupport.resources !== false && !apiHealth.resources) ||
      (apiSupport.history !== false && !apiHealth.history))

  const wsColor = !wsConnected ? 'red' : degraded ? 'yellow' : 'green'
  const wsLabel = !wsConnected ? 'Disconnected' : degraded ? 'Degraded' : 'Connected'

  const openHeaderColab = async () => {
    window.open(DEFAULT_COLAB_NOTEBOOK_URL, '_blank')
    addToast('Opened starter Colab notebook', 'info')
    setActiveTab('train')
  }

  return (
    <div id="app" style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <MantineAppShell
        header={{ height: 52 }}
        navbar={{
          width: 236,
          breakpoint: 'sm',
          collapsed: { mobile: !mobileSidebarOpen },
        }}
        padding="md"
        styles={{
          root: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' },
          main: { flex: 1, minHeight: 0, overflowY: 'auto' },
        }}
      >
        {/* ── Header ── */}
        <MantineAppShell.Header
          style={{
            borderBottom: '1px solid var(--mantine-color-default-border)',
            background: 'var(--mantine-color-body)',
          }}
        >
          <Group h="100%" px="md" justify="space-between">
            {/* Left: Burger + Logo */}
            <Group gap="sm">
              <Burger
                opened={mobileSidebarOpen}
                onClick={() => setMobileSidebarOpen(!mobileSidebarOpen)}
                hiddenFrom="sm"
                size="sm"
                aria-label="Open navigation"
              />
              <Tooltip label="Go to Status" position="bottom">
                <UnstyledButton
                  style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'transparent', padding: 0, border: 'none', cursor: 'pointer' }}
                  onClick={() => setActiveTab('status')}
                  aria-label="Go to Status tab"
                >
                  <LeStudioLogo />
                  <Text fw={600} size="sm" lh={1}>LeStudio</Text>
                  <Badge size="xs" color="yellow" variant="light" style={{ letterSpacing: '0.5px' }}>
                    BETA
                  </Badge>
                </UnstyledButton>
              </Tooltip>
            </Group>

            {/* Right: Actions */}
            <Group gap={6}>
              <ProfileSelector />

              {/* Theme toggle */}
              <Tooltip label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} position="bottom">
                <ActionIcon
                  id="theme-toggle-btn"
                  variant="subtle"
                  color="gray"
                  size="md"
                  onClick={onToggleTheme}
                  aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
                >
                  {theme === 'dark' ? '🌙' : '☀️'}
                </ActionIcon>
              </Tooltip>

              {/* HF auth link */}
              <Tooltip
                label={hfUsername ? `HuggingFace: ${hfUsername}` : 'HuggingFace not connected. Open Dataset tab to configure.'}
                position="bottom"
              >
                <Indicator
                  color={hfUsername ? 'green' : 'yellow'}
                  size={8}
                  offset={4}
                  processing={!hfUsername}
                >
                  <ActionIcon
                    id="hf-auth-link"
                    variant="subtle"
                    color={hfUsername ? 'green' : 'yellow'}
                    size="md"
                    onClick={() => setActiveTab('dataset')}
                    aria-label={hfUsername ? `Hugging Face connected as ${hfUsername}` : 'Hugging Face token is not set'}
                  >
                    <span style={{ fontSize: 16 }}>🤗</span>
                  </ActionIcon>
                </Indicator>
              </Tooltip>

              {/* Colab link */}
              <Tooltip label="Open starter Colab notebook" position="bottom">
                <ActionIcon
                  id="colab-quick-link"
                  variant="light"
                  color="blue"
                  size="md"
                  onClick={() => { void openHeaderColab() }}
                  aria-label="Open starter Colab notebook"
                >
                  <img src="/colab-logo.png" alt="" aria-hidden="true" style={{ width: 16, height: 16, objectFit: 'contain' }} />
                </ActionIcon>
              </Tooltip>

              {/* GitHub */}
              <Tooltip label="View on GitHub" position="bottom">
                <ActionIcon
                  component="a"
                  href="https://github.com/TheMomentLab/lerobot-studio"
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="subtle"
                  color="gray"
                  size="md"
                  aria-label="View on GitHub"
                >
                  <svg height={18} viewBox="0 0 16 16" width={18} aria-hidden="true">
                    <path
                      fill="currentColor"
                      fillRule="evenodd"
                      d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
                    />
                  </svg>
                </ActionIcon>
              </Tooltip>

              {/* WS status */}
              <Group gap={6} id="ws-status" aria-live="polite" aria-label={`Connection status: ${wsLabel}`}>
                <Indicator
                  color={wsColor}
                  size={9}
                  processing={wsConnected && !degraded}
                  style={{ display: 'flex', alignItems: 'center' }}
                >
                  <span style={{ width: 9, height: 9 }} />
                </Indicator>
                <Text size="xs" c="dimmed" visibleFrom="md">{wsLabel}</Text>
              </Group>
            </Group>
          </Group>
        </MantineAppShell.Header>

        {/* ── Sidebar / Navbar ── */}
        <MantineAppShell.Navbar
          style={{
            borderRight: '1px solid var(--mantine-color-default-border)',
            background: 'var(--mantine-color-body)',
            overflowY: 'auto',
          }}
        >
          <Sidebar />
        </MantineAppShell.Navbar>

        {/* ── Main content ── */}
        <MantineAppShell.Main>
          {children}
        </MantineAppShell.Main>
      </MantineAppShell>

      <ConsoleDrawer />
    </div>
  )
}
