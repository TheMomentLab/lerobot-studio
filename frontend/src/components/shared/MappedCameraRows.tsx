import { Badge, Paper, Table, Text } from '@mantine/core'

interface MappedCameraRowsProps {
  mappedCameras: Record<string, string>
}

export function MappedCameraRows({ mappedCameras }: MappedCameraRowsProps) {
  const entries = Object.entries(mappedCameras)
  if (!entries.length) {
    return (
      <Paper withBorder p="md" radius="md" className="no-cameras-empty">
        <Text size="sm" c="dimmed" className="no-cam-text">
          No mapped cameras found.
          <br />
          Set up camera mappings in the Mapping tab first.
        </Text>
      </Paper>
    )
  }

  return (
    <Paper withBorder p="xs" radius="md">
      <Table highlightOnHover withTableBorder withColumnBorders>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Role</Table.Th>
            <Table.Th>Path</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {entries.map(([role, path]) => (
            <Table.Tr key={role} className="mapped-cam-row">
              <Table.Td className="mapped-cam-role">
                <Badge variant="light" color="blue">{role}</Badge>
              </Table.Td>
              <Table.Td className="mapped-cam-path">
                <Text ff="monospace" size="sm">{path}</Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Paper>
  )
}
