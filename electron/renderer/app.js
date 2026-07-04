// --- Navigation ---
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

    btn.classList.add('active');
    document.getElementById(`view-${btn.dataset.view}`).classList.add('active');
  });
});

// --- Backend health check ---
async function checkBackend() {
  try {
    const status = await window.api.getBackendStatus();
    const dot = document.getElementById('status-dot');
    const text = document.getElementById('status-text');

    if (status.status === 'ok') {
      dot.className = 'dot connected';
      text.textContent = 'Backend ✓';
    } else {
      dot.className = 'dot disconnected';
      text.textContent = 'Backend —';
    }
  } catch {
    document.getElementById('status-dot').className = 'dot disconnected';
    document.getElementById('status-text').textContent = 'Backend ✗';
  }
}

// Check immediately and every 5 seconds
checkBackend();
setInterval(checkBackend, 5000);

// --- State ---
let selectedPhotos = [];  // array of file paths

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.tif', '.heic', '.heif',
]);

// --- Drag & Drop ---

const photoGrid = document.getElementById('photo-grid');
let dragCounter = 0;

photoGrid.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.stopPropagation();
  e.dataTransfer.dropEffect = 'copy';
});

photoGrid.addEventListener('dragenter', (e) => {
  e.preventDefault();
  e.stopPropagation();
  dragCounter++;
  photoGrid.classList.add('drag-over');
});

photoGrid.addEventListener('dragleave', (e) => {
  e.preventDefault();
  e.stopPropagation();
  dragCounter--;
  if (dragCounter <= 0) {
    dragCounter = 0;
    photoGrid.classList.remove('drag-over');
  }
});

photoGrid.addEventListener('drop', (e) => {
  e.preventDefault();
  e.stopPropagation();
  dragCounter = 0;
  photoGrid.classList.remove('drag-over');

  const files = Array.from(e.dataTransfer.files);
  if (!files.length) return;

  // Use Electron's webUtils.getPathForFile (replaces deprecated File.path)
  const imagePaths = [];
  for (const f of files) {
    const p = window.api.getFilePath(f);
    if (p) {
      const ext = p.slice(p.lastIndexOf('.')).toLowerCase();
      if (IMAGE_EXTENSIONS.has(ext)) imagePaths.push(p);
    }
  }

  if (!imagePaths.length) {
    document.getElementById('scan-status').textContent = 'No valid image files dropped.';
    return;
  }

  const existing = new Set(selectedPhotos);
  let added = 0;
  for (const p of imagePaths) {
    if (!existing.has(p)) {
      selectedPhotos.push(p);
      existing.add(p);
      added++;
    }
  }

  renderGrid();
  document.getElementById('scan-status').textContent =
    `Dropped ${imagePaths.length} file(s). Added ${added} new. Total: ${selectedPhotos.length}.`;
});

// Block OS file-open on areas outside the grid
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  // Only preventDefault for drops outside the grid (grid handler stops propagation)
  e.preventDefault();
});

// --- Render photo grid ---
function renderGrid() {
  const grid = document.getElementById('photo-grid');
  const btnDescribe = document.getElementById('btn-describe');
  const countEl = document.getElementById('selection-count');

  countEl.textContent = selectedPhotos.length ? `${selectedPhotos.length} photo(s)` : '';
  btnDescribe.disabled = selectedPhotos.length === 0;

  if (!selectedPhotos.length) {
    grid.innerHTML = '<div id="drop-hint">Drop images here</div>';
    return;
  }

  grid.innerHTML = selectedPhotos.map((path, i) => {
    const fname = path.split('\\').pop() || path;
    return `
      <div class="photo-card" data-index="${i}">
        <button class="btn-remove" data-index="${i}" title="Remove">✕</button>
        <img src="file:///${path.replace(/\\/g, '/')}"
             onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <div class="photo-placeholder" style="display:none">📷</div>
        <div class="photo-info">${fname}</div>
      </div>
    `;
  }).join('');

  // Remove button handlers
  grid.querySelectorAll('.btn-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.index);
      removePhoto(idx);
    });
  });
}

function removePhoto(index) {
  selectedPhotos.splice(index, 1);
  renderGrid();
}

// --- Add Photos ---
document.getElementById('btn-browse').addEventListener('click', async () => {
  const files = await window.api.pickFiles();
  if (files && files.length) {
    // Deduplicate
    const existing = new Set(selectedPhotos);
    for (const f of files) {
      if (!existing.has(f)) {
        selectedPhotos.push(f);
        existing.add(f);
      }
    }
    renderGrid();
    document.getElementById('scan-status').textContent =
      `Added ${files.length} photo(s). Total: ${selectedPhotos.length}.`;
  }
});

// --- Describe photos ---
document.getElementById('btn-describe').addEventListener('click', async () => {
  if (!selectedPhotos.length) return;

  const statusEl = document.getElementById('scan-status');
  statusEl.textContent = 'Describing photos...';

  try {
    const result = await window.api.describePhotos(selectedPhotos);
    if (result.status === 'ok') {
      const cards = document.querySelectorAll('.photo-card');
      result.results.forEach((r, i) => {
        if (cards[i]) {
          const infoEl = cards[i].querySelector('.photo-info');
          if (infoEl) {
            infoEl.textContent = r.status === 'ok' ? r.description : `❌ ${r.error}`;
          }
        }
      });
      statusEl.textContent = `Described ${result.count} photo(s).`;
    }
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
  }
});
