import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock fetch for relative API calls in jsdom
globalThis.fetch = vi.fn(async () =>
  new Response('{}', {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
) as unknown as typeof fetch;
