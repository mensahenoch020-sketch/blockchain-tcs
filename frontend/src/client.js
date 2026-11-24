export async function request(path, { method = 'GET', body, signal } = {}) {
  const form = body instanceof FormData;
  const response = await fetch('/api' + path, {
    method, signal, credentials: 'same-origin',
    headers: body && !form ? { 'Content-Type': 'application/json' } : undefined,
    body: form ? body : body ? JSON.stringify(body) : undefined
  });
  if (response.status === 204) return null;
  const result = await response.json().catch(() => null);
  if (path === '/verify' && result?.status === 'unavailable') return result;
  if (!response.ok || !result) {
    const error = new Error(result?.error || 'The service did not respond. Try again shortly.');
    error.status = response.status;
    throw error;
  }
  return result;
}

export const dateTime = value => value ? new Date(value).toLocaleString() : '—';
