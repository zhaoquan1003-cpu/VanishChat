const BASE = import.meta.env.VITE_API_BASE || ''

export class ApiError extends Error {
  constructor(code, message, status) {
    super(message)
    this.code = code
    this.status = status
  }
}

async function request(path, { method = 'GET', body, headers, signal } = {}) {
  const isForm = body instanceof FormData
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: isForm ? headers : { 'Content-Type': 'application/json', ...headers },
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
    signal,
  })

  let payload = null
  const text = await res.text()
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = { message: text }
    }
  }

  if (!res.ok || payload?.ok === false) {
    throw new ApiError(
      payload?.code || `HTTP_${res.status}`,
      payload?.message || '请求失败，请稍后再试',
      res.status,
    )
  }
  return payload?.data ?? payload
}

export const api = {
  getConfig: () => request('/api/session/config'),
  createSession: (body) => request('/api/session/create', { method: 'POST', body }),
  verify: (token) => request(`/api/session/${encodeURIComponent(token)}/verify`),
  messages: (token, params = {}) => {
    const qs = new URLSearchParams(params).toString()
    return request(`/api/session/${encodeURIComponent(token)}/messages${qs ? `?${qs}` : ''}`)
  },
  destroy: (token, reason = 'manual') =>
    request(`/api/session/${encodeURIComponent(token)}/destroy`, { method: 'POST', body: { reason } }),
  deleteUpload: (token, fileId) =>
    request(`/api/upload/${encodeURIComponent(token)}/${encodeURIComponent(fileId)}`, { method: 'DELETE' }),
  health: () => request('/api/health'),
}

export default api
