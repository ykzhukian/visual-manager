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

// --- Render photo grid ---
function renderGrid() {
  const grid = document.getElementById('photo-grid');
  const btnDescribe = document.getElementById('btn-describe');
  const countEl = document.getElementById('selection-count');

  countEl.textContent = selectedPhotos.length ? `${selectedPhotos.length} photo(s)` : '';
  btnDescribe.disabled = selectedPhotos.length === 0;

  if (!selectedPhotos.length) {
    grid.innerHTML = '<p style="color:#666;">No photos selected. Click "Add Photos" to get started.</p>';
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
