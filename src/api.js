let encryptionDevice = null;
export function setEncryptionDevice(id) { encryptionDevice = id; }
export async function api(path, options = {}) {
  const isForm = options.body instanceof FormData;
  let res;
  try {
    res = await fetch(`/api${path}`, { credentials: 'same-origin', ...options,
      headers: { ...(encryptionDevice ? {'x-churp-device':encryptionDevice} : {}), ...(!isForm && options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
      body: options.body ? (isForm ? options.body : JSON.stringify(options.body)) : undefined,
    });
  } catch { throw new Error('You appear to be offline. Check your connection and try again.'); }
  const data = await res.json();
  if (!res.ok) { const error = new Error(data.error || 'Something went wrong.'); error.status = res.status; throw error; }
  return data;
}
export const post = (path, body = {}) => api(path, { method: 'POST', body });
export const patch = (path, body) => api(path, { method: 'PATCH', body });
export async function upload(file) {
  if (file.size > 15 * 1024 * 1024) throw new Error('Each file must be 15 MB or smaller.');
  const form = new FormData(); form.append('file', file);
  return (await post('/uploads', form)).file;
}
