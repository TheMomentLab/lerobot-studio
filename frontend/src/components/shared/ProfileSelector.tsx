import { useCallback, useEffect, useState } from 'react'
import { ActionIcon, Button, FileButton, Group, Menu, Select } from '@mantine/core'
import { apiDelete, apiGet, apiPost } from '../../lib/api'
import { useLeStudioStore } from '../../store'

interface ProfileListResponse {
  profiles: string[]
  active: string
}

interface ProfileGetResponse {
  ok: boolean
  config: import('../../lib/types').LeStudioConfig
}

export function ProfileSelector() {
  const config = useLeStudioStore((s) => s.config)
  const setConfig = useLeStudioStore((s) => s.setConfig)
  const addToast = useLeStudioStore((s) => s.addToast)

  const [profiles, setProfiles] = useState<string[]>(['default'])
  const [activeProfile, setActiveProfile] = useState('default')

  const refresh = useCallback(async () => {
    try {
      const res = await apiGet<ProfileListResponse>('/api/profiles')
      if (res.profiles) setProfiles(res.profiles)
      if (res.active) setActiveProfile(res.active)
    } catch {}
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const applySelected = async (name: string) => {
    try {
      const res = await apiGet<ProfileGetResponse>(`/api/profiles/${encodeURIComponent(name)}`)
      if (res?.ok && res.config) {
        setConfig(res.config)
        setActiveProfile(name)
        addToast(`Profile "${name}" applied`, 'success')
      }
    } catch {
      addToast('Failed to load profile', 'error')
    }
  }

  const saveCurrent = async () => {
    try {
      await apiPost(`/api/profiles/${encodeURIComponent(activeProfile)}`, config)
      addToast(`Profile "${activeProfile}" saved`, 'success')
    } catch {
      addToast('Failed to save profile', 'error')
    }
  }

  const saveAs = async () => {
    const name = prompt('Save profile as:')
    if (!name) return
    try {
      await apiPost(`/api/profiles/${encodeURIComponent(name)}`, config)
      setActiveProfile(name)
      await refresh()
      addToast(`Profile "${name}" created`, 'success')
    } catch {
      addToast('Failed to save profile', 'error')
    }
  }

  const exportCurrent = async () => {
    try {
      const res = await apiGet<ProfileGetResponse>(`/api/profiles/${encodeURIComponent(activeProfile)}`)
      if (!res?.ok || !res.config) throw new Error('invalid response')
      const blob = new Blob([JSON.stringify(res.config, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${activeProfile}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      addToast('Failed to export profile', 'error')
    }
  }

  const handleImportFile = async (file: File) => {
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      const name = (data.profile_name as string) || file.name.replace(/\.json$/, '')
      await apiPost('/api/profiles-import', { name, config: data })
      await refresh()
      addToast(`Profile "${name}" imported`, 'success')
    } catch {
      addToast('Failed to import profile', 'error')
    }
  }

  const deleteCurrent = async () => {
    if (activeProfile === 'default') {
      addToast('Cannot delete default profile', 'error')
      return
    }
    if (!confirm(`Delete profile "${activeProfile}"?`)) return
    try {
      await apiDelete(`/api/profiles/${encodeURIComponent(activeProfile)}`)
      setActiveProfile('default')
      await refresh()
      addToast(`Profile "${activeProfile}" deleted`, 'success')
    } catch {
      addToast('Failed to delete profile', 'error')
    }
  }

  return (
    <Group className="header-profile-controls" gap="xs" wrap="nowrap">
      <Select
        id="profile-select"
        aria-label="Profile selector"
        data={profiles.map((p) => ({ value: p, label: p }))}
        value={activeProfile}
        onChange={(value) => {
          if (value) void applySelected(value)
        }}
        w={180}
      />

      <Button size="xs" variant="light" onClick={saveCurrent}>
        Save
      </Button>

      <Menu shadow="md" width={180} position="bottom-end">
        <Menu.Target>
          <ActionIcon variant="light" size="md" aria-label="More profile actions">
            ⋮
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item onClick={() => void saveAs()}>Save As…</Menu.Item>
          <Menu.Item onClick={() => void exportCurrent()}>Export…</Menu.Item>
          <FileButton
            onChange={(file) => {
              if (file) void handleImportFile(file)
            }}
            accept="application/json"
          >
            {(props) => <Menu.Item {...props}>Import…</Menu.Item>}
          </FileButton>
          <Menu.Divider />
          <Menu.Item color="red" onClick={() => void deleteCurrent()}>
            Delete
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>

    </Group>
  )
}
