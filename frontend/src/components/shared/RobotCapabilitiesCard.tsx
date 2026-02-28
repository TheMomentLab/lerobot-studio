import { Badge, Card, Group, Stack, Text } from '@mantine/core'
import type { RobotCapabilities } from '../../lib/types'

interface RobotCapabilitiesCardProps {
  capabilities: RobotCapabilities | null
  compatibleTeleops: string[]
}

function CapBadge({ label, active }: { label: string; active: boolean }) {
  return (
    <Badge
      className="cap-badge"
      variant={active ? 'light' : 'outline'}
      color={active ? 'blue' : 'gray'}
      leftSection={<span style={{ fontSize: 10 }}>{active ? '✓' : '✗'}</span>}
    >
      {label}
    </Badge>
  )
}

export function RobotCapabilitiesCard({ capabilities, compatibleTeleops }: RobotCapabilitiesCardProps) {
  if (!capabilities) return null

  return (
    <Card withBorder radius="md" p="sm" mt={8} mb={4}>
      <Stack gap="xs">
        <Text size="xs" fw={600} c="dimmed">
        {capabilities.display_name || 'Robot Info'}
        </Text>
      {capabilities.description && (
          <Text size="xs" c="dimmed" lh={1.4}>
          {capabilities.description}
          </Text>
      )}
        <Group gap={4}>
        {capabilities.has_arm && <CapBadge label={`Arm${capabilities.arm_count > 1 ? ` ×${capabilities.arm_count}` : ''}`} active={true} />}
        {capabilities.has_mobile_base && <CapBadge label="Mobile Base" active={true} />}
        {capabilities.has_cameras && <CapBadge label="Cameras" active={true} />}
        {capabilities.is_remote && <CapBadge label="Remote" active={true} />}
        {capabilities.has_keyboard_teleop && <CapBadge label="Keyboard" active={true} />}
        <CapBadge label={capabilities.connection_type.toUpperCase()} active={true} />
        </Group>
      {compatibleTeleops.length > 0 && (
          <Text size="xs" c="dimmed">
            <Text span fw={500}>Compatible teleops:</Text>{' '}
          {compatibleTeleops.join(', ')}
          </Text>
      )}
      </Stack>
    </Card>
  )
}
