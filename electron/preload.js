const { contextBridge, ipcRenderer, webUtils } = require('electron');

const BACKEND_URL = 'http://127.0.0.1:8765';

contextBridge.exposeInMainWorld('api', {
  // File picker (multi-select images)
  pickFiles: () => ipcRenderer.invoke('dialog:openFiles'),

  // Drag-drop: get absolute path from a dropped File object (Electron 29+)
  getFilePath: (file) => webUtils.getPathForFile(file),

  // Generic fetch wrapper for backend calls
  backend: async (endpoint, options = {}) => {
    const url = `${BACKEND_URL}${endpoint}`;
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options,
    });
    return res.json();
  },

  // Photo operations
  scanPhotos: (directory) =>
    fetch(`${BACKEND_URL}/api/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ directory }),
    }).then(r => r.json()),

  describePhotos: (paths) =>
    fetch(`${BACKEND_URL}/api/describe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths }),
    }).then(r => r.json()),

  classifyPhotos: (paths, categories) =>
    fetch(`${BACKEND_URL}/api/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths, categories }),
    }).then(r => r.json()),

  getBackendStatus: () =>
    fetch(`${BACKEND_URL}/health`).then(r => r.json()),
});
