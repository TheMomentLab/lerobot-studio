import { createTheme, type MantineColorsTuple } from '@mantine/core';

// LeStudio accent blue — maps to GitHub-style blue
const leBlue: MantineColorsTuple = [
  '#e8f0fe',
  '#cfe0fc',
  '#9dbff9',
  '#679bf5',
  '#3d7ef2',
  '#2168f0',
  '#0f5de8',
  '#0050d0',
  '#0046ba',
  '#003ba3',
];

export const theme = createTheme({
  primaryColor: 'leBlue',
  colors: {
    leBlue,
  },

  // Typography
  fontFamily:
    "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  fontFamilyMonospace:
    "'SFMono-Regular', 'Cascadia Code', 'JetBrains Mono', Consolas, monospace",
  fontSizes: {
    xs: '11px',
    sm: '12px',
    md: '13px',
    lg: '14px',
    xl: '16px',
  },
  lineHeights: {
    xs: '1.4',
    sm: '1.45',
    md: '1.5',
    lg: '1.6',
    xl: '1.65',
  },

  // Shape
  radius: {
    xs: '4px',
    sm: '6px',
    md: '8px',
    lg: '10px',
    xl: '12px',
  },
  defaultRadius: 'md',

  // Spacing
  spacing: {
    xs: '4px',
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '24px',
  },

  // Component defaults
  components: {
    Button: {
      defaultProps: {
        size: 'sm',
      },
    },
    TextInput: {
      defaultProps: {
        size: 'sm',
      },
    },
    Select: {
      defaultProps: {
        size: 'sm',
      },
    },
    NumberInput: {
      defaultProps: {
        size: 'sm',
      },
    },
    Card: {
      defaultProps: {
        radius: 'md',
        withBorder: true,
      },
    },
    Badge: {
      defaultProps: {
        radius: 'sm',
      },
    },
    Paper: {
      defaultProps: {
        radius: 'md',
      },
    },
    Modal: {
      defaultProps: {
        radius: 'md',
      },
    },
    Notification: {
      defaultProps: {
        radius: 'md',
      },
    },
    Code: {
      defaultProps: {
        block: false,
      },
    },
  },
});
