const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');

// Hot reload in development — watches source files and reloads the window on change
try { require('electron-reloader')(module, { watchRenderer: true }); } catch (_) {}

const BACKEND_PORT = 8765;
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;

let backendProcess = null;
let mainWindow = null;

// --- Python backend lifecycle ---

function startBackend() {
  const rootDir = path.join(__dirname, '..');
  const backendDir = path.join(rootDir, 'backend');
  const pythonExe = process.platform === 'win32'
    ? path.join(rootDir, '.venv', 'Scripts', 'python.exe')
    : path.join(rootDir, '.venv', 'bin', 'python');

  backendProcess = spawn(pythonExe, [path.join(backendDir, 'main.py')], {
    cwd: backendDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      HF_HOME: 'A:\\cache\\huggingface',
      TORCH_HOME: 'A:\\cache\\torch',
      HF_ENDPOINT: 'https://hf-mirror.com',
    },
  });

  backendProcess.stdout.on('data', (data) => {
    console.log(`[backend] ${data.toString().trim()}`);
  });

  backendProcess.stderr.on('data', (data) => {
    console.error(`[backend] ${data.toString().trim()}`);
  });

  backendProcess.on('exit', (code) => {
    console.log(`[backend] exited with code ${code}`);
  });
}

function stopBackend() {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
}

function waitForBackend(retries = 30, interval = 300) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      http.get(`${BACKEND_URL}/health`, (res) => {
        if (res.statusCode === 200) resolve();
        else if (++attempts < retries) setTimeout(check, interval);
        else reject(new Error('Backend did not become healthy'));
      }).on('error', () => {
        if (++attempts < retries) setTimeout(check, interval);
        else reject(new Error('Backend did not start'));
      });
    };
    check();
  });
}

// --- IPC: file picker (multi-select images) ---

ipcMain.handle('dialog:openFiles', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    title: 'Select Photos',
    filters: [
      { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tiff', 'heic', 'heif'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return [];
  return result.filePaths;
});

// --- IPC: directory picker ---

ipcMain.handle('dialog:openDirectory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Directory',
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// --- IPC: file stats ---

ipcMain.handle('file:stats', async (_event, paths) => {
  const stats = {};
  for (const p of paths) {
    try {
      stats[p] = fs.statSync(p).size;
    } catch {
      stats[p] = null;
    }
  }
  return stats;
});

// --- Window ---

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1800,
    height: 1050,
    minWidth: 900,
    minHeight: 600,
    title: 'Visual Manager',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

// --- App lifecycle ---

app.whenReady().then(async () => {
  startBackend();
  try {
    await waitForBackend();
    console.log('[main] Backend is ready');
  } catch (err) {
    console.error('[main] Failed to start backend:', err.message);
  }
  createWindow();
});

app.on('window-all-closed', () => {
  stopBackend();
  app.quit();
});

app.on('before-quit', () => {
  stopBackend();
});
