/* Shared /api/v1 transport with automatic CSRF for owner mutations. */

const API_ROOT = '/api/v1';
let csrfToken = '';
let csrfPromise = null;

export class ApiError extends Error {
  constructor(method, path, status, detail) {
    super(`${method} ${path} returned ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail || '';
  }
}

function isAdminMutation(method, path) {
  return method !== 'GET' && method !== 'HEAD' && path.startsWith('/admin/') &&
    path !== '/admin/login' && path !== '/admin/setup';
}

async function readCsrf() {
  if (csrfToken) return csrfToken;
  if (!csrfPromise) {
    csrfPromise = fetch(`${API_ROOT}/admin/csrf`, {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    }).then(async response => {
      if (!response.ok) return '';
      const data = await response.json();
      csrfToken = data.csrf_token || '';
      return csrfToken;
    }).finally(() => { csrfPromise = null; });
  }
  return csrfPromise;
}

export function clearCsrf() {
  csrfToken = '';
  csrfPromise = null;
}

export async function request(method, path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('accept', 'application/json');
  const init = {
    method,
    headers,
    credentials: 'same-origin',
    signal: options.signal,
  };

  if (isAdminMutation(method, path)) {
    const token = await readCsrf();
    if (token) headers.set('X-CSRF-Token', token);
  }

  if (options.form) {
    init.body = options.form;
  } else if (options.body !== undefined) {
    headers.set('content-type', 'application/json');
    init.body = JSON.stringify(options.body);
  }

  const response = await fetch(API_ROOT + path, init);
  if (!response.ok) {
    let detail = '';
    try {
      const data = await response.json();
      detail = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail || data);
    } catch {
      detail = response.statusText;
    }
    if (response.status === 403 && isAdminMutation(method, path)) clearCsrf();
    throw new ApiError(method, path, response.status, detail);
  }
  if (response.status === 204) return null;
  const type = response.headers.get('content-type') || '';
  return type.includes('application/json') ? response.json() : response.text();
}

export const v1 = {
  get: (path, options) => request('GET', path, options),
  post: (path, body, options = {}) => request('POST', path, { ...options, body }),
  put: (path, body, options = {}) => request('PUT', path, { ...options, body }),
  patch: (path, body, options = {}) => request('PATCH', path, { ...options, body }),
  del: (path, options) => request('DELETE', path, options),
  upload: (path, form, options = {}) => request('POST', path, { ...options, form }),
};

export async function maybeGet(path) {
  try { return await v1.get(path); }
  catch { return null; }
}

export function errorMessage(error, fallback = 'Something went wrong.') {
  if (error?.status === 429) return 'Too many requests. Please wait a moment.';
  if (error?.status === 401) return 'Your admin session expired. Sign in again.';
  if (error?.detail) return String(error.detail);
  return fallback;
}
