const { contextBridge, ipcRenderer, webUtils } = require('electron');

const BACKEND_URL = 'http://127.0.0.1:8765';

contextBridge.exposeInMainWorld('api', {
  // File picker (multi-select images)
  pickFiles: () => ipcRenderer.invoke('dialog:openFiles'),

  // Drag-drop: get absolute path from a dropped File object
  getFilePath: (file) => webUtils.getPathForFile(file),

  // Generic fetch wrapper
  backend: async (endpoint, options = {}) => {
    const url = `${BACKEND_URL}${endpoint}`;
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options,
    });
    return res.json();
  },

  // --- Photos ---

  loadPhotos: (params = '') =>
    fetch(`${BACKEND_URL}/api/photos${params}`).then(r => r.json()),

  addPhotos: (paths) =>
    fetch(`${BACKEND_URL}/api/photos/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths }),
    }).then(r => r.json()),

  removePhoto: (path) =>
    fetch(`${BACKEND_URL}/api/photos`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    }).then(r => r.json()),

  describePhotos: (paths) =>
    fetch(`${BACKEND_URL}/api/describe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths }),
    }).then(r => r.json()),

  describePhotosStream: (paths, onEvent) =>
    fetch(`${BACKEND_URL}/api/describe-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths }),
    }).then(async (res) => {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6));
              onEvent(event);
            } catch {}
          }
        }
      }
    }),

  // --- Categories ---

  getCategories: () =>
    fetch(`${BACKEND_URL}/api/categories`).then(r => r.json()),

  createCategory: (name) =>
    fetch(`${BACKEND_URL}/api/categories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }).then(r => r.json()),

  renameCategory: (id, name) =>
    fetch(`${BACKEND_URL}/api/categories/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }).then(r => r.json()),

  deleteCategory: (id) =>
    fetch(`${BACKEND_URL}/api/categories/${id}`, {
      method: 'DELETE',
    }).then(r => r.json()),

  categorizePhotos: (paths, category_ids) =>
    fetch(`${BACKEND_URL}/api/photos/categorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths, category_ids }),
    }).then(r => r.json()),

  uncategorizePhotos: (paths, category_ids) =>
    fetch(`${BACKEND_URL}/api/photos/categorize`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths, category_ids }),
    }).then(r => r.json()),

  // --- File stats ---

  getFileStats: (paths) => ipcRenderer.invoke('file:stats', paths),

  // --- Media matching ---

  matchPairs: (directory, threshold = 0.25) =>
    fetch(`${BACKEND_URL}/api/match-pairs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ directory, threshold }),
    }).then(r => r.json()),

  // --- File picker (directory) ---

  pickDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),

  // --- Backend health ---

  getBackendStatus: () =>
    fetch(`${BACKEND_URL}/health`).then(r => r.json()),
});
