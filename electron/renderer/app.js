// ======================================================================
// Backend health check
// ======================================================================

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

// ======================================================================
// Init
// ======================================================================

async function initApp() {
  await checkBackend();
  await loadCategories();
  await loadPersistedPhotos();
  document.getElementById('photo-count').textContent = `${selectedPhotos.length} photos`;
}
initApp();
setInterval(checkBackend, 5000);

// ======================================================================
// State
// ======================================================================

let selectedPhotos = [];
const photoStore = {};          // path → { description, descriptionStatus, categories: [{id,name},...] }
let allCategories = [];         // [{id, name, photo_count}, ...]
let activeCategoryId = null;    // null = "All Photos"
let selectedCardPaths = new Set(); // multi-select for batch categorization

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.tif', '.heic', '.heif',
]);

// ======================================================================
// Utilities
// ======================================================================

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

const BACKEND_URL = 'http://127.0.0.1:8765';

function thumbUrl(path) {
  return `${BACKEND_URL}/api/thumbnails?path=${encodeURIComponent(path)}`;
}

function formatSize(bytes) {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

// Cache file sizes so we never fetch the same path twice
const fileSizeCache = {};

async function loadFileSizes(container) {
  if (!container) return;
  const cards = container.querySelectorAll('.photo-card');
  const uncached = [];
  const cardMap = [];
  cards.forEach(card => {
    const p = card.dataset.path;
    if (p && fileSizeCache[p] === undefined) {
      uncached.push(p);
      cardMap.push(card);
    } else if (p) {
      const badge = card.querySelector('.photo-badge');
      if (badge) badge.textContent = formatSize(fileSizeCache[p]);
    }
  });
  if (!uncached.length) return;
  try {
    const stats = await window.api.getFileStats(uncached);
    cardMap.forEach(card => {
      const p = card.dataset.path;
      fileSizeCache[p] = stats[p];
      const badge = card.querySelector('.photo-badge');
      if (badge) badge.textContent = formatSize(stats[p]);
    });
  } catch { /* ignore */ }
}

// ======================================================================
// Categories
// ======================================================================

async function loadCategories() {
  try {
    const result = await window.api.getCategories();
    if (result.status === 'ok') {
      allCategories = result.categories || [];
      renderCategoryList();
      updateBatchSelect();
      updateCategoryCounts();
    }
  } catch (err) {
    console.error('Failed to load categories:', err);
  }
}

function renderCategoryList() {
  const container = document.getElementById('category-list');
  container.innerHTML = `
    <div class="category-item all${activeCategoryId === null ? ' active' : ''}" data-category-id="">
      <span class="category-name">All Photos</span>
      <span class="category-count" id="count-all">${selectedPhotos.length}</span>
    </div>
  ` + allCategories.map(cat => {
    const active = activeCategoryId === cat.id ? ' active' : '';
    return `
      <div class="category-item${active}" data-category-id="${cat.id}">
        <span class="category-name">${escapeHtml(cat.name)}</span>
        <span class="category-count">${cat.photo_count}</span>
        <span class="category-actions">
          <button class="cat-edit" data-id="${cat.id}" data-name="${escapeHtml(cat.name)}" title="Rename">✎</button>
          <button class="cat-delete" data-id="${cat.id}" title="Delete">✕</button>
        </span>
        <span class="category-action-edit" style="display:none">
          <input class="category-edit-input" value="${escapeHtml(cat.name)}" maxlength="60">
          <button class="cat-edit-save" data-id="${cat.id}">✓</button>
        </span>
      </div>
    `;
  }).join('');

  // Click handler: filter by category
  container.querySelectorAll('.category-item').forEach(item => {
    item.addEventListener('click', (e) => {
      // Don't trigger when clicking edit/delete buttons or inputs
      if (e.target.closest('button') || e.target.closest('input')) return;
      const catId = item.dataset.categoryId;
      activeCategoryId = catId ? parseInt(catId) : null;
      renderCategoryList();
      loadFilteredPhotos();
    });
  });

  // Edit button
  container.querySelectorAll('.cat-edit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = btn.closest('.category-item');
      item.classList.add('editing');
      item.querySelector('.category-edit-input').focus();
    });
  });

  // Save edit
  container.querySelectorAll('.cat-edit-save').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.id);
      const input = btn.closest('.category-item').querySelector('.category-edit-input');
      const newName = input.value.trim();
      if (newName) {
        await window.api.renameCategory(id, newName);
        await loadCategories();
        await loadFilteredPhotos();
      }
    });
  });

  // Enter key in edit input
  container.querySelectorAll('.category-edit-input').forEach(input => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        input.closest('.category-item').querySelector('.cat-edit-save').click();
      }
      if (e.key === 'Escape') {
        const item = input.closest('.category-item');
        item.classList.remove('editing');
      }
    });
  });

  // Delete button
  container.querySelectorAll('.cat-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.id);
      await window.api.deleteCategory(id);
      if (activeCategoryId === id) activeCategoryId = null;
      await loadCategories();
      await loadFilteredPhotos();
    });
  });

  // "All Photos" click handler re-bind
  const allBtn = container.querySelector('.category-item.all');
  if (allBtn) {
    allBtn.addEventListener('click', () => {
      activeCategoryId = null;
      renderCategoryList();
      loadFilteredPhotos();
    });
  }
}

function updateCategoryCounts() {
  const countAll = document.getElementById('count-all');
  if (countAll) countAll.textContent = selectedPhotos.length;
}

// Batch select dropdown
function updateBatchSelect() {
  const sel = document.getElementById('batch-category-select');
  sel.innerHTML = '<option value="">Assign category...</option>' +
    allCategories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
}

// Create category
document.getElementById('btn-add-category').addEventListener('click', async () => {
  const input = document.getElementById('category-input');
  const name = input.value.trim();
  if (!name) return;
  await window.api.createCategory(name);
  input.value = '';
  await loadCategories();
});

document.getElementById('category-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-add-category').click();
});

// ======================================================================
// Photo loading & filtering
// ======================================================================

async function loadPersistedPhotos() {
  try {
    const result = await window.api.loadPhotos();
    if (result.status === 'ok' && result.photos.length) {
      for (const p of result.photos) {
        if (!selectedPhotos.includes(p.path)) {
          selectedPhotos.push(p.path);
        }
        photoStore[p.path] = {
          description: p.description || '',
          descriptionStatus: p.descriptionStatus || '',
          categories: p.categories || [],
        };
      }
      renderGrid();
      document.getElementById('btn-describe').disabled = selectedPhotos.length === 0;
      document.getElementById('btn-describe').disabled = selectedPhotos.length === 0;
    }
  } catch (err) {
    console.error('Failed to load photos:', err);
  }
}

async function loadFilteredPhotos() {
  // Reload from backend with category filter
  let params = '';
  if (activeCategoryId !== null) {
    params = `?category_id=${activeCategoryId}`;
  }
  try {
    const result = await window.api.loadPhotos(params);
    if (result.status === 'ok') {
      // Update selectedPhotos and photoStore from filtered result
      const paths = [];
      for (const p of result.photos) {
        paths.push(p.path);
        photoStore[p.path] = {
          description: p.description || '',
          descriptionStatus: p.descriptionStatus || '',
          categories: p.categories || [],
        };
      }
      // Don't overwrite selectedPhotos; just filter what we show
      // But we need to update category data from backend
      for (const p of result.photos) {
        if (photoStore[p.path]) {
          photoStore[p.path].categories = p.categories || [];
        }
      }
      updateCategoryCountsInner();
      renderGrid();
    }
  } catch (err) {
    console.error('Failed to filter photos:', err);
  }
}

function updateCategoryCountsInner() {
  const countEl = document.getElementById('count-all');
  if (countEl) {
    countEl.textContent = activeCategoryId === null ? selectedPhotos.length : getFilteredPhotos().length;
  }
}

function getFilteredPhotos() {
  let paths = [...selectedPhotos];
  // Apply category filter
  if (activeCategoryId !== null) {
    paths = paths.filter(p => {
      const cats = (photoStore[p] && photoStore[p].categories) || [];
      return cats.some(c => c.id === activeCategoryId);
    });
  }
  // Apply search filter
  const query = document.getElementById('search-input').value.trim().toLowerCase();
  if (query) {
    paths = paths.filter(p => {
      const entry = photoStore[p];
      if (!entry) return false;
      const descMatch = entry.description && entry.description.toLowerCase().includes(query);
      const catMatch = entry.categories && entry.categories.some(c => c.name.toLowerCase().includes(query));
      return descMatch || catMatch;
    });
  }
  return paths;
}

// ======================================================================
// Render
// ======================================================================

function renderGrid() {
  const container = document.getElementById('photo-grid');
  if (!container) return;

  const paths = getFilteredPhotos();

  if (!paths.length) {
    container.innerHTML = '<div class="drop-hint">No photos</div>';
    updateSelectionBar();
    updateCategoryCountsInner();
    return;
  }

  container.innerHTML = paths.map((path) => {
    const entry = photoStore[path] || {};
    const fname = path.split('\\').pop() || path;
    const infoText = entry.description || fname;
    const isSel = selectedCardPaths.has(path) ? ' selected' : '';

    const catTags = (entry.categories || []).map(c =>
      `<span class="photo-badge cat-tag" data-category-id="${c.id}" title="Filter: ${escapeHtml(c.name)}">${escapeHtml(c.name)}</span>`
    ).join('');

    const sizeText = fileSizeCache[path] !== undefined ? formatSize(fileSizeCache[path]) : '...';

    return `
      <div class="photo-card${isSel}" data-path="${escapeHtml(path)}">
        <button class="btn-remove" data-path="${escapeHtml(path)}" title="Remove">✕</button>
        <div class="photo-badges">
          <span class="photo-badge">${sizeText}</span>
          ${catTags}
        </div>
        <img decoding="async" src="${thumbUrl(path)}"
             onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <div class="photo-placeholder" style="display:none">📷</div>
        <div class="photo-info">${escapeHtml(infoText)}</div>
      </div>
    `;
  }).join('');

  loadFileSizes(container);

  updateSelectionBar();
  updateCategoryCountsInner();
  document.getElementById('photo-count').textContent = `${selectedPhotos.length} photos`;
}

// Event delegation on the grid (set up once, not re-bound on every render)
document.getElementById('photo-grid').addEventListener('click', (e) => {
  // Remove button
  const removeBtn = e.target.closest('.btn-remove');
  if (removeBtn) {
    e.stopPropagation();
    removePhoto(removeBtn.dataset.path);
    return;
  }

  // Category tag → filter by that category
  const catTag = e.target.closest('.cat-tag');
  if (catTag) {
    e.stopPropagation();
    const catId = parseInt(catTag.dataset.categoryId);
    activeCategoryId = catId;
        renderCategoryList();
    renderGrid();
    return;
  }

  // Card → toggle selection
  const card = e.target.closest('.photo-card');
  if (card) {
    const p = card.dataset.path;
    if (selectedCardPaths.has(p)) {
      selectedCardPaths.delete(p);
      card.classList.remove('selected');
    } else {
      selectedCardPaths.add(p);
      card.classList.add('selected');
    }
    updateSelectionBar();
  }
});

function updateSelectionBar() {
  const countEl = document.getElementById('selection-count');
  const deselectBtn = document.getElementById('btn-deselect-all');
  const catSelect = document.getElementById('batch-category-select');
  const catBtn = document.getElementById('btn-batch-categorize');

  if (selectedCardPaths.size > 0) {
    countEl.textContent = `${selectedCardPaths.size} selected`;
    countEl.style.visibility = 'visible';
    deselectBtn.style.visibility = 'visible';
    catSelect.style.visibility = 'visible';
    catBtn.style.visibility = 'visible';
    catBtn.disabled = false;
  } else {
    countEl.style.visibility = 'hidden';
    deselectBtn.style.visibility = 'hidden';
    catSelect.style.visibility = 'hidden';
    catBtn.style.visibility = 'hidden';
    catBtn.disabled = true;
  }
}

// ======================================================================
// Photo management
// ======================================================================

function removePhoto(path) {
  selectedPhotos = selectedPhotos.filter(p => p !== path);
  selectedCardPaths.delete(path);
  _lastRenderedPaths = ''; // force rebuild
  window.api.removePhoto(path).catch(() => {});
  renderGrid();
  document.getElementById('btn-describe').disabled = selectedPhotos.length === 0;
  updateCategoryCounts();
  updateBatchSelect();
}

// ======================================================================
// Deselect all
// ======================================================================

document.getElementById('btn-deselect-all').addEventListener('click', () => {
  selectedCardPaths.clear();
  document.querySelectorAll('.photo-card.selected').forEach(c => c.classList.remove('selected'));
  updateSelectionBar();
});

// ======================================================================
// Batch categorize
// ======================================================================

document.getElementById('btn-batch-categorize').addEventListener('click', async () => {
  const sel = document.getElementById('batch-category-select');
  const catId = parseInt(sel.value);
  if (!catId || selectedCardPaths.size === 0) return;

  const paths = Array.from(selectedCardPaths);
  await window.api.categorizePhotos(paths, [catId]);

  // Update local store
  const catName = allCategories.find(c => c.id === catId)?.name || '';
  paths.forEach(p => {
    if (!photoStore[p]) photoStore[p] = { description: '', descriptionStatus: '', categories: [] };
    const cats = photoStore[p].categories;
    if (!cats.some(c => c.id === catId)) {
      cats.push({ id: catId, name: catName });
    }
  });

  selectedCardPaths.clear();
    await loadCategories();
  renderGrid();
  sel.value = '';
});

// Remove category from selected photos (via clicking tag in selection context)
// This is handled by a right-click or could be a future feature
// For now: clicking a tag on a card filters by that category

// ======================================================================
// Drag & Drop
// ======================================================================

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

  const imagePaths = [];
  for (const f of files) {
    const p = window.api.getFilePath(f);
    if (p) {
      const ext = p.slice(p.lastIndexOf('.')).toLowerCase();
      if (IMAGE_EXTENSIONS.has(ext)) imagePaths.push(p);
    }
  }

  if (!imagePaths.length) return;

  const existing = new Set(selectedPhotos);
  const newPaths = [];
  for (const p of imagePaths) {
    if (!existing.has(p)) {
      selectedPhotos.push(p);
      existing.add(p);
      newPaths.push(p);
    }
  }

  if (newPaths.length) {
    window.api.addPhotos(newPaths).catch(() => {});
  }

    renderGrid();
  document.getElementById('btn-describe').disabled = selectedPhotos.length === 0;
  updateCategoryCounts();
});

document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => { e.preventDefault(); });

// ======================================================================
// Browse photos
// ======================================================================

document.getElementById('btn-browse').addEventListener('click', async () => {
  const files = await window.api.pickFiles();
  if (files && files.length) {
    const existing = new Set(selectedPhotos);
    const newPaths = [];
    for (const f of files) {
      if (!existing.has(f)) {
        selectedPhotos.push(f);
        existing.add(f);
        newPaths.push(f);
      }
    }
    if (newPaths.length) {
      window.api.addPhotos(newPaths).catch(() => {});
    }
        renderGrid();
    document.getElementById('btn-describe').disabled = selectedPhotos.length === 0;
    updateCategoryCounts();
  }
});

// ======================================================================
// Describe
// ======================================================================

document.getElementById('btn-describe').addEventListener('click', async () => {
  // Determine which photos need describing: undescribed + manually selected
  const needsDescribe = selectedPhotos.filter(p => {
    const entry = photoStore[p];
    return !entry || !entry.description || entry.descriptionStatus !== 'ok';
  });
  const selectedSet = new Set(selectedCardPaths);
  const toDescribe = [...new Set([...needsDescribe, ...Array.from(selectedCardPaths)])];
  // Also include any selected card that's not yet in photoStore
  selectedCardPaths.forEach(p => {
    if (!toDescribe.includes(p)) toDescribe.push(p);
  });

  const paths = [...new Set(toDescribe.filter(p => selectedPhotos.includes(p)))];

  if (!paths.length) return;

  const btn = document.getElementById('btn-describe');
  btn.disabled = true;
  btn.textContent = `Describing 0/${paths.length}...`;

  try {
    await window.api.describePhotosStream(paths, (event) => {
      if (event.type === 'progress') {
        // Update photo store immediately
        if (!photoStore[event.path]) {
          photoStore[event.path] = { description: '', descriptionStatus: '', categories: [] };
        }
        photoStore[event.path].description = event.description || '';
        photoStore[event.path].descriptionStatus = event.status;

        // Update the specific card in DOM without full re-render
        // CSS.escape handles backslashes in Windows paths
        const safePath = CSS.escape(event.path);
        const card = document.querySelector(`.photo-card[data-path="${safePath}"]`);
        if (card) {
          const info = card.querySelector('.photo-info');
          if (info) {
            const fname = event.path.split('\\').pop() || event.path;
            info.textContent = event.description || fname;
          }
        }

        btn.textContent = `Describing ${event.current}/${event.total}...`;
      } else if (event.type === 'done') {
        btn.textContent = 'Describe All';
        btn.disabled = selectedPhotos.length === 0;
        updateCategoryCounts();
      }
    });
  } catch (err) {
    console.error('Describe error:', err);
    btn.textContent = 'Describe All';
    btn.disabled = selectedPhotos.length === 0;
  }
});

// ======================================================================
// Search
// ======================================================================

let searchTimeout;
document.getElementById('search-input').addEventListener('input', () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    _lastRenderedPaths = ''; // force rebuild on search
    renderGrid();
  }, 200);
});

// ======================================================================
// Media matching
// ======================================================================

document.getElementById('btn-match').addEventListener('click', async () => {
  const dir = await window.api.pickDirectory();
  if (!dir) return;

  const overlay = document.getElementById('match-overlay');
  const statusEl = document.getElementById('match-status');
  const resultsEl = document.getElementById('match-results');

  overlay.style.display = 'flex';
  statusEl.textContent = 'Matching media with CLIP... (this may take a moment)';
  resultsEl.innerHTML = '';

  try {
    const result = await window.api.matchPairs(dir, 0.25);
    statusEl.textContent =
      `${result.total_images} images · ${result.total_videos} videos · ${result.pairs.length} matched`;

    let html = '';

    if (result.pairs.length) {
      html += '<div class="match-section-title">Matched Pairs</div>';
      result.pairs.forEach(p => {
        const imgName = p.image.split('\\').pop();
        const vidName = p.video.split('\\').pop();
        html += `
          <div class="match-pair">
            <span class="match-icon">✓</span>
            <div class="match-files">
              <div class="match-file">📷 ${escapeHtml(imgName)}</div>
              <div class="match-file video">🎬 ${escapeHtml(vidName)}</div>
            </div>
            <span class="match-score">${(p.similarity * 100).toFixed(0)}%</span>
          </div>`;
      });
    }

    if (result.unmatched_images?.length) {
      html += '<div class="match-section-title" style="margin-top:16px">Unmatched Images</div>';
      result.unmatched_images.forEach(p => {
        html += `<div class="match-unmatched">📷 ${escapeHtml(p.split('\\').pop())}</div>`;
      });
    }

    if (result.unmatched_videos?.length) {
      html += '<div class="match-section-title" style="margin-top:16px">Unmatched Videos</div>';
      result.unmatched_videos.forEach(p => {
        html += `<div class="match-unmatched">🎬 ${escapeHtml(p.split('\\').pop())}</div>`;
      });
    }

    if (!html) {
      html = '<div class="match-unmatched">No media found in this directory.</div>';
    }

    resultsEl.innerHTML = html;
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
    statusEl.style.color = '#e94560';
  }
});

// Close match overlay
document.getElementById('btn-close-match').addEventListener('click', () => {
  document.getElementById('match-overlay').style.display = 'none';
});
