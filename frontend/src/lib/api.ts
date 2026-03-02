const JSON_HEADERS = { 'Content-Type': 'application/json' } as const

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${init?.method ?? 'GET'} ${url} failed: ${res.status}${text ? ` ${text}` : ''}`)
  }
  return res.json() as Promise<T>
}

export function apiGet<T>(url: string): Promise<T> {
  return request<T>(url, { method: 'GET' })
}

export function apiPost<T>(url: string, data?: unknown): Promise<T> {
  return request<T>(url, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: data === undefined ? undefined : JSON.stringify(data),
  })
}

export function apiDelete<T>(url: string): Promise<T> {
  return request<T>(url, { method: 'DELETE' })
}
