const STORAGE_KEY = 'andys-rezeptbox-v2-recipes';
const IDB_DB_NAME = 'andys-rezeptbox-db';
const IDB_STORE_NAME = 'data';
const IDB_RECIPES_KEY = 'recipes';
const SYNC_SETTINGS_KEY = 'andys-rezeptbox-sync-settings-v1';
const SYNC_DELETIONS_KEY = 'andys-rezeptbox-sync-deletions-v1';
const DEFAULT_SYNC_URL = 'https://andys-rezeptbox.synology.me:8443';

const DEFAULT_CATEGORIES = [
  ['Salate','🥗'], ['Fleisch','🥩'], ['Fisch','🐟'], ['Suppen','🍲'], ['Beilagen','🥔'],
  ['Backen','🍞'], ['Dessert','🍰'], ['Getränke','🥤'], ['Sonstiges','🍽️']
];
const CATEGORY_STORAGE_KEY = 'andys-rezeptbox-v2-categories';

let customCategories = loadCustomCategories();


const CATEGORY_ICON_LIBRARY = ["🍽️", "🥗", "🍲", "🥣", "🍝", "🍕", "🥪", "🌯", "🌮", "🍔", "🌭", "🥩", "🍗", "🍖", "🥓", "🐟", "🦐", "🦞", "🦑", "🥚", "🧀", "🥛", "🥦", "🥕", "🍅", "🥔", "🌽", "🍆", "🥒", "🫑", "🫘", "🍄", "🌿", "🥬", "🍞", "🥖", "🥨", "🥐", "🧇", "🥞", "🍚", "🍛", "🥘", "🍜", "🍱", "🍣", "🥟", "🍤", "🍰", "🎂", "🧁", "🍪", "🍩", "🍫", "🍮", "🍨", "🍦", "🥧", "🍓", "🍎", "🍋", "🍊", "🍇", "🍒", "🍑", "🍍", "🥭", "🥝", "☕", "🍵", "🫖", "🥤", "🧃", "🍹", "🍷", "🍺", "🥂", "🧊", "🔥", "♨️", "🎄", "🎉", "⭐", "❤️", "👶", "🌱", "🥬", "🧺", "🍴", "👨‍🍳"];

function getCustomCategoryEmoji(){
  const el = document.getElementById('categoryCustomEmoji');
  return el ? el.value.trim() : '';
}

function normalizeCategoryIcon(selectedIcon){
  const custom = getCustomCategoryEmoji();
  return custom || selectedIcon || '🍽️';
}

function sortCategoriesAlphabetically(list){
  return [...(list || [])].sort((a, b) => {
    const an = Array.isArray(a) ? (a[0] || '') : (typeof a === 'string' ? a : (a?.name || ''));
    const bn = Array.isArray(b) ? (b[0] || '') : (typeof b === 'string' ? b : (b?.name || ''));
    return an.localeCompare(bn, 'de-CH', { sensitivity: 'base' });
  });
}


function loadCustomCategories(){
  try { return JSON.parse(localStorage.getItem(CATEGORY_STORAGE_KEY)) || []; }
  catch { return []; }
}
function saveCustomCategories(){
  try {
    localStorage.setItem(CATEGORY_STORAGE_KEY, JSON.stringify(customCategories));
  } catch {
    // Categories are tiny; if old localStorage is already full, free the old
    // recipe payload now that V3.4 uses IndexedDB.
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.setItem(CATEGORY_STORAGE_KEY, JSON.stringify(customCategories));
    } catch {}
  }
  scheduleNasSync();
}
function allCategories(){
  return sortCategoriesAlphabetically([...DEFAULT_CATEGORIES, ...customCategories]);
}

let recipes = loadLegacyRecipes().map(normalizeRecipe);
let currentCategory = null;
let favoritesOnly = false;
let editingImages = [];
let importImages = [];
let editingVideo = '';
let importVideo = '';
let syncApplyingRemote = false;
let syncInProgress = false;
let syncTimer = null;

const el = id => document.getElementById(id);
const categoryGrid = el('categoryGrid');
const recipeGrid = el('recipeGrid');
const searchInput = el('searchInput');
const recipeDialog = el('recipeDialog');
const importDialog = el('importDialog');
const viewDialog = el('viewDialog');
const categoryDialog = el('categoryDialog');

function normalizeRecipe(r){
  const imgs = Array.isArray(r.images) ? r.images.filter(Boolean) : (r.image ? [r.image] : []);
  return {
    ...r,
    images: imgs,
    image: imgs[0] || '',
    video: r.video || ''
  };
}
function loadLegacyRecipes(){
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}

function openRecipeDb(){
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB wird von diesem Browser nicht unterstützt.'));
      return;
    }

    const request = indexedDB.open(IDB_DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
        db.createObjectStore(IDB_STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Datenbank konnte nicht geöffnet werden.'));
  });
}

async function idbRead(key){
  const db = await openRecipeDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE_NAME, 'readonly');
      const store = tx.objectStore(IDB_STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function idbWrite(key, value){
  const db = await openRecipeDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
      const store = tx.objectStore(IDB_STORE_NAME);
      store.put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error || new Error('Speichern fehlgeschlagen'));
      tx.onabort = () => reject(tx.error || new Error('Speichern abgebrochen'));
    });
  } finally {
    db.close();
  }
}

async function initializeRecipeStorage(){
  try {
    const stored = await idbRead(IDB_RECIPES_KEY);

    if (Array.isArray(stored) && stored.length) {
      recipes = stored.map(normalizeRecipe);
    } else {
      const legacy = loadLegacyRecipes().map(normalizeRecipe);
      if (legacy.length) {
        recipes = legacy;
        await idbWrite(IDB_RECIPES_KEY, recipes);
      }
    }

    render();
  } catch (err) {
    console.warn('IndexedDB konnte nicht initialisiert werden:', err);
    // The app can still display legacy data, but saving would be unsafe.
    alert(
      'Der grössere Rezept-Speicher konnte in diesem Browser nicht geöffnet werden.\n\n' +
      'Die Rezeptbox zeigt vorhandene Daten weiterhin an. Falls Speichern nicht funktioniert, ' +
      'öffne die Rezeptbox bitte in Firefox oder Edge bzw. später über GitHub Pages.'
    );
    render();
  }
  refreshSyncUi();
  scheduleNasSync(1800);
}

function saveRecipes(){
  recipes = recipes.map(normalizeRecipe);

  // Update the visible interface immediately.
  updateStats();

  // IndexedDB has much more space than localStorage and is the primary store.
  idbWrite(IDB_RECIPES_KEY, recipes)
    .then(() => {
      // Free the old small storage once the new database has the recipes.
      try { localStorage.removeItem(STORAGE_KEY); } catch {}
    })
    .catch(err => {
    console.error('Speichern in IndexedDB fehlgeschlagen:', err);
    alert(
      'Das Rezept konnte nicht dauerhaft gespeichert werden.\n\n' +
      'Bitte erstelle sicherheitshalber eine Sicherung. Falls das Problem bleibt, ' +
      'sag mir Bescheid – dann prüfen wir den Browser-Speicher.'
    );
  });

  scheduleNasSync();

  return true;
}

function loadSyncSettings(){
  try {
    const value = JSON.parse(localStorage.getItem(SYNC_SETTINGS_KEY)) || {};
    return {
      enabled: value.enabled === true,
      url: String(value.url || DEFAULT_SYNC_URL).replace(/\/+$/, ''),
      key: String(value.key || '').trim()
    };
  } catch {
    return {enabled:false, url:DEFAULT_SYNC_URL, key:''};
  }
}

function saveSyncSettings(settings){
  localStorage.setItem(SYNC_SETTINGS_KEY, JSON.stringify(settings));
}

function loadDeletedRecipes(){
  try {
    const value = JSON.parse(localStorage.getItem(SYNC_DELETIONS_KEY));
    return Array.isArray(value) ? value.filter(item => item && item.id && item.deletedAt) : [];
  } catch { return []; }
}

function saveDeletedRecipes(items){
  localStorage.setItem(SYNC_DELETIONS_KEY, JSON.stringify(items));
}

function rememberRecipeDeletion(id){
  if (!id) return;
  const items = loadDeletedRecipes().filter(item => item.id !== id);
  items.push({id, deletedAt:new Date().toISOString()});
  saveDeletedRecipes(items);
}

function syncTime(value){
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? time : 0;
}

function mergeCategoryLists(localList, remoteList){
  const merged = [];
  const names = new Set(DEFAULT_CATEGORIES.map(([name]) => name.toLowerCase()));
  for (const item of [...(localList || []), ...(remoteList || [])]) {
    if (!Array.isArray(item) || !String(item[0] || '').trim()) continue;
    const name = String(item[0]).trim();
    const key = name.toLowerCase();
    if (names.has(key)) continue;
    names.add(key);
    merged.push([name, item[1] || '🍽️']);
  }
  return merged;
}

function mergeDeletionLists(localList, remoteList){
  const byId = new Map();
  for (const item of [...(localList || []), ...(remoteList || [])]) {
    if (!item?.id || !item?.deletedAt) continue;
    const previous = byId.get(item.id);
    if (!previous || syncTime(item.deletedAt) > syncTime(previous.deletedAt)) byId.set(item.id, item);
  }
  return [...byId.values()];
}

function mergeRecipeLists(localList, remoteList, deletions){
  const byId = new Map();
  for (const raw of [...(localList || []), ...(remoteList || [])]) {
    const recipe = normalizeRecipe(raw || {});
    if (!recipe.id || !recipe.title) continue;
    const previous = byId.get(recipe.id);
    if (!previous || syncTime(recipe.updatedAt) >= syncTime(previous.updatedAt)) byId.set(recipe.id, recipe);
  }
  const deletedById = new Map((deletions || []).map(item => [item.id, item]));
  return [...byId.values()].filter(recipe => {
    const deletion = deletedById.get(recipe.id);
    return !deletion || syncTime(recipe.updatedAt) > syncTime(deletion.deletedAt);
  });
}

function currentSyncPayload(){
  return {
    app:'Andys Rezeptbox',
    version: 3.18,
    exportedAt:new Date().toISOString(),
    recipes:recipes.map(normalizeRecipe),
    customCategories,
    deletedRecipes:loadDeletedRecipes()
  };
}

async function syncFetch(action, options={}){
  const settings = loadSyncSettings();
  if (!settings.enabled || !settings.url || !settings.key) throw new Error('Synchronisation ist nicht vollständig eingerichtet.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35000);
  try {
    let supplied = {};
    if (options.body) {
      try { supplied = JSON.parse(options.body); } catch { supplied = {}; }
    }
    return await fetch(`${settings.url}/`, {
      ...options,
      method:'POST',
      cache:'no-store',
      signal:controller.signal,
      headers:{
        'Content-Type':'text/plain;charset=UTF-8'
      },
      body:JSON.stringify({ ...supplied, action, key:settings.key })
    });
  } finally { clearTimeout(timeout); }
}

function setSyncStatus(kind, text){
  const badge = el('syncStatusBadge');
  const status = el('syncStatusText');
  if (!badge || !status) return;
  badge.className = `sync-badge sync-${kind}`;
  badge.textContent = kind === 'ok' ? 'Verbunden' : kind === 'working' ? 'Synchronisiert …' : kind === 'error' ? 'NAS nicht erreichbar' : 'Ausgeschaltet';
  status.textContent = text;
}

function refreshSyncUi(){
  const settings = loadSyncSettings();
  const button = el('syncNowBtn');
  if (button) button.disabled = !settings.enabled || !settings.url || !settings.key || syncInProgress;
  if (!settings.enabled) setSyncStatus('off', 'Die NAS-Synchronisation ist auf diesem Gerät nicht eingerichtet. Deine Rezepte bleiben lokal verfügbar.');
}

async function applyRemoteSyncData(remoteData){
  const deletions = mergeDeletionLists(loadDeletedRecipes(), remoteData?.deletedRecipes);
  recipes = mergeRecipeLists(recipes, remoteData?.recipes, deletions);
  customCategories = mergeCategoryLists(customCategories, remoteData?.customCategories);
  saveDeletedRecipes(deletions);
  syncApplyingRemote = true;
  try {
    await idbWrite(IDB_RECIPES_KEY, recipes);
    localStorage.setItem(CATEGORY_STORAGE_KEY, JSON.stringify(customCategories));
  } finally { syncApplyingRemote = false; }
  render();
}

async function performNasSync(manual=false, retry=true){
  if (syncInProgress) return;
  const settings = loadSyncSettings();
  if (!settings.enabled) return;
  syncInProgress = true;
  refreshSyncUi();
  setSyncStatus('working', 'Der NAS wird kontaktiert. Falls er schläft, kann das Aufwachen etwas dauern.');
  try {
    const pullResponse = await syncFetch('pull');
    if (!pullResponse.ok) throw new Error(`Abruf fehlgeschlagen (${pullResponse.status})`);
    const pulled = await pullResponse.json();
    if (pulled.exists && pulled.data) await applyRemoteSyncData(pulled.data);

    const pushResponse = await syncFetch('push', {
      method:'POST',
      body:JSON.stringify({baseRevision:pulled.revision || null, data:currentSyncPayload()})
    });

    if (pushResponse.status === 409 && retry) {
      setTimeout(() => performNasSync(manual, false), 250);
      return;
    }
    if (!pushResponse.ok) throw new Error(`Speichern fehlgeschlagen (${pushResponse.status})`);
    const result = await pushResponse.json();
    const when = new Date().toLocaleString('de-CH', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'});
    setSyncStatus('ok', `${result.recipeCount ?? recipes.length} Rezepte synchronisiert. Letzter Abgleich: ${when}.`);
  } catch (error) {
    console.warn('NAS-Synchronisation nicht möglich:', error);
    setSyncStatus('error', 'Der NAS ist momentan nicht erreichbar. Lokal kannst du normal weiterarbeiten; der nächste Abgleich wird automatisch versucht.');
    if (manual) el('syncDialogStatus').textContent = 'Verbindung momentan nicht möglich. Prüfe NAS-Adresse, Schlüssel und Internetverbindung.';
  } finally {
    syncInProgress = false;
    refreshSyncUi();
  }
}

function scheduleNasSync(delay=3000){
  if (syncApplyingRemote || !loadSyncSettings().enabled) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => performNasSync(false), delay);
}

function uid(){ return (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(16).slice(2)); }
function escapeHtml(s=''){ return String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function formatDate(iso){
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('de-CH', { day:'2-digit', month:'2-digit', year:'numeric' }); }
  catch { return ''; }
}
function categoryCount(name){ return recipes.filter(r => r.category === name).length; }
function previewText(recipe){
  const source = recipe.notes || recipe.ingredients || recipe.instructions || '';
  const clean = source.replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, 130) + (clean.length > 130 ? ' …' : '') : 'Noch keine zusätzlichen Angaben gespeichert.';
}
function getImages(recipe){ return normalizeRecipe(recipe).images; }

function updateStats(){
  el('statTotal').textContent = recipes.length;
  el('statFavorites').textContent = recipes.filter(r => r.favorite).length;
  el('statCategories').textContent = allCategories().length;
}

function renderCategories(){
  categoryGrid.innerHTML = allCategories().map(([name,emoji]) => `
    <button class="category ${currentCategory===name?'active':''}" data-category="${name}">
      <div class="category-top">
        <span class="emoji">${emoji}</span>
        <small>${categoryCount(name)} ${categoryCount(name) === 1 ? 'Rezept' : 'Rezepte'}</small>
      </div>
      <strong>${name}</strong>
    </button>`).join('');
  categoryGrid.querySelectorAll('.category').forEach(btn => btn.addEventListener('click', () => {
    currentCategory = currentCategory === btn.dataset.category ? null : btn.dataset.category;
    favoritesOnly = false;
    render();
  }));
  el('categoryInput').innerHTML = allCategories().map(([name]) => `<option>${name}</option>`).join('');
}

function filteredRecipes(){
  const q = searchInput.value.trim().toLowerCase();
  return recipes.filter(r => {
    if (currentCategory && r.category !== currentCategory) return false;
    if (favoritesOnly && !r.favorite) return false;
    if (!q) return true;
    return [r.title,r.category,r.ingredients,r.instructions,r.notes,r.video].join(' ').toLowerCase().includes(q);
  }).sort((a,b) => a.title.localeCompare(b.title,'de'));
}

function renderRecipes(){
  const list = filteredRecipes();
  el('recipeListTitle').textContent = favoritesOnly ? 'Favoriten' : currentCategory ? currentCategory : 'Alle Rezepte';
  el('recipeCount').textContent = `${list.length} ${list.length===1?'Rezept':'Rezepte'}`;
  el('emptyState').classList.toggle('hidden', list.length !== 0);
  recipeGrid.innerHTML = list.map(r => {
    const imgs = getImages(r);
    return `
      <div class="recipe-card" data-id="${r.id}">
        <div class="recipe-media">
          <div class="recipe-card-tools">
            <button class="print-btn" data-print="${r.id}" aria-label="Rezept drucken" title="Rezept drucken">🖨️</button>
            <button class="star-btn ${r.favorite?'on':''}" data-star="${r.id}" aria-label="Favorit">${r.favorite?'★':'☆'}</button>
          </div>
          ${imgs[0]
            ? `<img src="${imgs[0]}" alt="${escapeHtml(r.title)}">`
            : r.video
              ? `<div class="video-placeholder">🎬</div>`
              : `<div class="recipe-placeholder">🍽️</div>`}
        </div>
        <div class="recipe-card-body">
          <div class="recipe-badges">
            <span class="recipe-badge">${escapeHtml(r.category)}</span>
            ${imgs.length > 1 ? `<span class="recipe-badge">📷 ${imgs.length}</span>` : ''}
            ${r.video ? `<span class="recipe-badge">🎬 Video</span>` : ''}
          </div>
          <h3>${escapeHtml(r.title)}</h3>
          <p class="recipe-preview">${escapeHtml(previewText(r))}</p>
          <p class="recipe-meta">${r.updatedAt ? `Zuletzt geändert: ${formatDate(r.updatedAt)}` : ''}</p>
        </div>
      </div>`;
  }).join('');

  recipeGrid.querySelectorAll('.recipe-card').forEach(card => card.addEventListener('click', e => {
    if (e.target.closest('[data-star]') || e.target.closest('[data-print]')) return;
    openView(card.dataset.id);
  }));
  recipeGrid.querySelectorAll('[data-print]').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    printRecipe(btn.dataset.print);
  }));
  recipeGrid.querySelectorAll('[data-star]').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    const r = recipes.find(x => x.id === btn.dataset.star);
    if (r) { r.favorite = !r.favorite; r.updatedAt = new Date().toISOString(); saveRecipes(); render(); }
  }));
}

function render(){
  updateStats();
  renderCategories();
  el('favoritesBtn').classList.toggle('active', favoritesOnly);
  el('quickFavoritesBtn').classList.toggle('active', favoritesOnly);
  el('showAllBtn').classList.toggle('active', !favoritesOnly && !currentCategory);
  renderRecipes();
}

function renderImagePreview(containerId, images, removeHandler){
  const box = el(containerId);
  box.classList.toggle('hidden', images.length === 0);
  box.innerHTML = images.map((src, i) => `
    <div class="image-preview-item" draggable="true" data-image-index="${i}" title="Ziehen, um die Reihenfolge zu ändern">
      <span class="drag-handle" aria-hidden="true">↔</span>
      <img src="${src}" alt="Bild ${i+1}">
      ${i===0 ? '<span class="image-label">Titelbild</span>' : ''}
      <button type="button" data-remove-image="${i}" aria-label="Bild entfernen">✕</button>
    </div>`).join('');

  box.querySelectorAll('[data-remove-image]').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      removeHandler(Number(btn.dataset.removeImage));
    };
  });

  let draggedIndex = null;

  box.querySelectorAll('[data-image-index]').forEach(item => {
    item.addEventListener('dragstart', e => {
      draggedIndex = Number(item.dataset.imageIndex);
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    item.addEventListener('dragend', () => {
      draggedIndex = null;
      box.querySelectorAll('.image-preview-item').forEach(x => x.classList.remove('dragging','drag-target'));
    });

    item.addEventListener('dragover', e => {
      e.preventDefault();
      if (draggedIndex === null) return;
      item.classList.add('drag-target');
      e.dataTransfer.dropEffect = 'move';
    });

    item.addEventListener('dragleave', () => item.classList.remove('drag-target'));

    item.addEventListener('drop', e => {
      e.preventDefault();
      item.classList.remove('drag-target');
      const targetIndex = Number(item.dataset.imageIndex);
      if (draggedIndex === null || draggedIndex === targetIndex) return;

      const [moved] = images.splice(draggedIndex, 1);
      images.splice(targetIndex, 0, moved);

      // Neu rendern: Bild ganz links ist immer das Titelbild.
      renderImagePreview(containerId, images, removeHandler);
      if (containerId === 'imagePreviewGrid') {
        el('removeImageBtn').classList.toggle('hidden', images.length === 0);
      }
    });
  });
}

function resetForm(){
  el('recipeForm').reset();
  el('recipeId').value = '';
  editingImages = [];
  editingVideo = '';
  renderImagePreview('imagePreviewGrid', editingImages, removeEditingImage);
  el('removeImageBtn').classList.add('hidden');
  el('videoUrlInput').value = '';
  renderVideoPreview('videoPreviewBox', '', 'removeVideoBtn');
  el('deleteBtn').classList.add('hidden');
  el('dialogTitle').textContent = 'Neues Rezept';
}
function removeEditingImage(i){
  editingImages.splice(i,1);
  renderImagePreview('imagePreviewGrid', editingImages, removeEditingImage);
  el('removeImageBtn').classList.toggle('hidden', editingImages.length === 0);
}
function openNewRecipe(){ resetForm(); recipeDialog.showModal(); }

function openEdit(id){
  const r = recipes.find(x => x.id === id); if (!r) return;
  if (viewDialog.open) viewDialog.close();
  resetForm();
  el('dialogTitle').textContent = 'Rezept bearbeiten';
  el('recipeId').value = r.id;
  el('titleInput').value = r.title;
  el('categoryInput').value = r.category;
  el('ingredientsInput').value = r.ingredients || '';
  el('instructionsInput').value = r.instructions || '';
  el('notesInput').value = r.notes || '';
  el('sourceInput').value = r.source || '';
  el('favoriteInput').checked = !!r.favorite;
  editingVideo = r.video || '';
  el('videoUrlInput').value = editingVideo.startsWith('data:video/') ? '' : editingVideo;
  renderVideoPreview('videoPreviewBox', editingVideo, 'removeVideoBtn');
  editingImages = getImages(r).slice();
  renderImagePreview('imagePreviewGrid', editingImages, removeEditingImage);
  el('removeImageBtn').classList.toggle('hidden', editingImages.length === 0);
  el('deleteBtn').classList.remove('hidden');
  recipeDialog.showModal();
}

function isDirectVideoUrl(url){
  return /^data:video\//i.test(url) || /\.(mp4|webm|mov)(?:[?#].*)?$/i.test(url);
}

function youtubeEmbedUrl(url){
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtu.be')) {
      const id = u.pathname.split('/').filter(Boolean)[0];
      return id ? `https://www.youtube.com/embed/${id}` : '';
    }
    if (u.hostname.includes('youtube.com')) {
      if (u.pathname.startsWith('/watch')) {
        const id = u.searchParams.get('v');
        return id ? `https://www.youtube.com/embed/${id}` : '';
      }
      const parts = u.pathname.split('/').filter(Boolean);
      const ix = parts.findIndex(x => ['shorts','embed'].includes(x));
      if (ix >= 0 && parts[ix+1]) return `https://www.youtube.com/embed/${parts[ix+1]}`;
    }
  } catch {}
  return '';
}

function renderVideoPreview(containerId, video, removeBtnId){
  const box = el(containerId);
  const btn = el(removeBtnId);
  box.classList.toggle('hidden', !video);
  btn.classList.toggle('hidden', !video);

  if (!video) {
    box.innerHTML = '';
    return;
  }

  if (isDirectVideoUrl(video)) {
    box.innerHTML = `<video controls preload="metadata" src="${video}"></video>`;
  } else {
    box.innerHTML = `<div class="video-link-preview">🎬 Video-Link gespeichert:<br>${escapeHtml(video)}</div>`;
  }
}

function readVideoFileAsDataUrl(file){
  return new Promise((resolve,reject)=>{
    if (!file || !file.type.startsWith('video/')) return resolve('');
    // localStorage has limited capacity. Keep embedded videos deliberately small.
    const maxBytes = 4 * 1024 * 1024;
    if (file.size > maxBytes) {
      alert(
        'Diese Videodatei ist zu gross für die direkte Speicherung in der Rezeptbox.\\n\\n' +
        'Bitte verwende für grössere Videos den Video-Link. Bis etwa 4 MB können Videos direkt gespeichert werden.'
      );
      return resolve('');
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result || '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}


function printRecipe(id){
  const recipe = recipes.find(r => r.id === id);
  if (!recipe) return;

  const r = normalizeRecipe(recipe);

  const esc = (value) => String(value || '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;');

  const nl = (value) => esc(value).replace(/\n/g,'<br>');

  const imgList = [];
  if (r.image) imgList.push(r.image);
  if (Array.isArray(r.images)) {
    for (const img of r.images) {
      if (img && !imgList.includes(img)) imgList.push(img);
    }
  }

  const imagesHtml = imgList.length
    ? `<div class="images">${imgList.map((src, idx) =>
        `<img class="recipe-image ${idx === 0 ? 'main-image' : ''}" src="${esc(src)}" alt="Rezeptbild">`
      ).join('')}</div>`
    : '';

  const category = r.category ? `<span class="meta-pill">${esc(r.category)}</span>` : '';
  const favorite = r.favorite ? `<span class="meta-pill">★ Favorit</span>` : '';
  const imageCount = imgList.length ? `<span class="meta-pill">📷 ${imgList.length} Bild${imgList.length === 1 ? '' : 'er'}</span>` : '';
  const videoBadge = (r.videoUrl || r.videoData) ? `<span class="meta-pill">🎬 Video</span>` : '';

  const updated = r.updatedAt
    ? new Date(r.updatedAt).toLocaleDateString('de-CH')
    : '';

  const ingredients = r.ingredients
    ? `<section class="box ingredients"><h2>Zutaten</h2><div class="content">${nl(r.ingredients)}</div></section>`
    : '';

  const instructions = r.instructions
    ? `<section class="box instructions"><h2>Zubereitung</h2><div class="content">${nl(r.instructions)}</div></section>`
    : '';

  const notes = r.notes
    ? `<section class="box notes"><h2>Eigene Notizen</h2><div class="content">${nl(r.notes)}</div></section>`
    : '';

  const videoValue = r.videoUrl || '';
  const video = videoValue
    ? `<div class="small-row"><strong>Video:</strong> <span>${esc(videoValue)}</span></div>`
    : '';

  const source = r.source
    ? `<div class="small-row"><strong>Original-Link:</strong> <span>${esc(r.source)}</span></div>`
    : '';

  const infoBlock = (video || source)
    ? `<section class="links">${video}${source}</section>`
    : '';

  const textLen = [r.ingredients, r.instructions, r.notes, r.source, r.videoUrl]
    .filter(Boolean)
    .join(' ')
    .length;

  let density = 'normal';
  if (textLen < 700) density = 'short';
  else if (textLen > 1550) density = 'long';

  const hasInstructions = !!r.instructions;
  const hasIngredients = !!r.ingredients;

  let mainGridClass = 'main-grid';
  if (!hasInstructions || !hasIngredients) mainGridClass += ' single-column';

  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('Das Druckfenster konnte nicht geöffnet werden. Bitte Pop-ups für diese Seite erlauben.');
    return;
  }

  printWindow.document.open();
  printWindow.document.write(`<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(r.title)} – Andys Rezeptbox</title>
<style>
  @page {
    size: A4 portrait;
    margin: 9mm 10mm 9mm 10mm;
  }

  * { box-sizing: border-box; }

  html, body {
    margin: 0;
    padding: 0;
    background: #fff;
    color: #20251f;
    font-family: Arial, Helvetica, sans-serif;
    line-height: 1.34;
  }

  body.normal { font-size: 10.6pt; }
  body.short { font-size: 11.4pt; }
  body.long { font-size: 8.9pt; line-height: 1.22; }

  .sheet {
    max-width: 190mm;
    margin: 0 auto;
  }

  header {
    border-bottom: 1px solid #9ca69b;
  }

  body.normal header,
  body.short header {
    padding-bottom: 3.5mm;
    margin-bottom: 5mm;
  }

  body.long header {
    padding-bottom: 2.5mm;
    margin-bottom: 3mm;
  }

  h1 {
    line-height: 1.12;
    margin: 0 0 2.5mm 0;
    font-weight: 700;
  }

  body.normal h1 { font-size: 20pt; }
  body.short h1 { font-size: 22pt; }
  body.long h1 { font-size: 16.5pt; }

  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 2mm;
    align-items: center;
    color: #4f5a50;
  }

  body.normal .meta { font-size: 8.8pt; }
  body.short .meta { font-size: 9.2pt; }
  body.long .meta { font-size: 7.4pt; gap: 1.4mm; }

  .meta-pill {
    display: inline-block;
    border: 1px solid #d8ded7;
    border-radius: 999px;
    background: #f7f8f5;
  }

  body.normal .meta-pill,
  body.short .meta-pill { padding: 1mm 2.2mm; }

  body.long .meta-pill { padding: 0.7mm 1.7mm; }

  .updated {
    margin-left: auto;
    white-space: nowrap;
  }

  .images {
    display: flex;
    justify-content: center;
    align-items: flex-start;
    gap: 4mm;
    flex-wrap: wrap;
    page-break-inside: avoid;
    break-inside: avoid;
  }

  body.normal .images { margin-bottom: 5mm; }
  body.short .images { margin-bottom: 7mm; }
  body.long .images { margin-bottom: 3mm; gap: 3mm; }

  .recipe-image {
    display: block;
    width: auto;
    height: auto;
    object-fit: contain;
    border-radius: 2mm;
  }

  body.normal .recipe-image {
    max-width: 72mm;
    max-height: 72mm;
  }

  body.short .recipe-image {
    max-width: 82mm;
    max-height: 82mm;
  }

  body.long .recipe-image {
    max-width: 48mm;
    max-height: 48mm;
  }

  body.normal .images:has(.recipe-image:nth-child(2)) .recipe-image {
    max-width: 54mm;
    max-height: 54mm;
  }

  body.short .images:has(.recipe-image:nth-child(2)) .recipe-image {
    max-width: 62mm;
    max-height: 62mm;
  }

  body.long .images:has(.recipe-image:nth-child(2)) .recipe-image {
    max-width: 40mm;
    max-height: 40mm;
  }

  .main-grid {
    display: grid;
    grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.35fr);
    align-items: start;
  }

  body.normal .main-grid { gap: 5mm; margin-top: 1mm; }
  body.short .main-grid { gap: 6mm; margin-top: 2mm; }
  body.long .main-grid { gap: 3mm; margin-top: 0; }

  .main-grid.single-column {
    grid-template-columns: 1fr;
    margin-left: auto;
    margin-right: auto;
  }

  body.normal .main-grid.single-column { max-width: 125mm; }
  body.short .main-grid.single-column { max-width: 145mm; }
  body.long .main-grid.single-column { max-width: 135mm; }

  .box {
    border: 1px solid #d8ded7;
    border-radius: 2.5mm;
    margin: 0;
  }

  body.normal .box { padding: 4mm; }
  body.short .box { padding: 5mm; }
  body.long .box { padding: 2.3mm; }

  .box h2 {
    margin: 0 0 2.2mm 0;
    padding-bottom: 1.2mm;
    border-bottom: 1px solid #e4e8e3;
  }

  body.normal .box h2 { font-size: 12pt; }
  body.short .box h2 { font-size: 13pt; }
  body.long .box h2 {
    font-size: 10pt;
    margin-bottom: 1.3mm;
    padding-bottom: 0.8mm;
  }

  .content { white-space: normal; }

  body.normal .content { font-size: 10.4pt; }
  body.short .content { font-size: 11.2pt; }
  body.long .content { font-size: 8.6pt; }

  .notes {
    margin-top: 5mm;
  }

  body.short .notes { margin-top: 7mm; }
  body.long .notes { margin-top: 2.5mm; }

  .links {
    padding-top: 2.5mm;
    border-top: 1px solid #d8ded7;
    color: #455045;
  }

  body.normal .links { margin-top: 4mm; font-size: 8.2pt; }
  body.short .links { margin-top: 6mm; font-size: 8.8pt; }
  body.long .links { margin-top: 2mm; padding-top: 1.5mm; font-size: 6.9pt; }

  .small-row {
    margin: 1mm 0;
    word-break: break-word;
    overflow-wrap: anywhere;
  }

  body.long .small-row { margin: 0.6mm 0; }

  footer {
    padding-top: 2.5mm;
    border-top: 1px solid #e4e8e3;
    color: #6b746c;
    display: flex;
    justify-content: space-between;
    gap: 4mm;
  }

  body.normal footer { margin-top: 4mm; font-size: 7.4pt; }
  body.short footer { margin-top: 6mm; font-size: 7.8pt; }
  body.long footer { margin-top: 2mm; padding-top: 1.5mm; font-size: 6.6pt; }

  @media print {
    html, body {
      width: auto;
      height: auto;
      overflow: visible;
    }

    .sheet {
      max-width: none;
    }

    .ingredients,
    .instructions,
    .notes {
      break-inside: auto;
      page-break-inside: auto;
    }
  }
</style>
</head>
<body class="${density}">
  <div class="sheet">
    <header>
      <h1>${esc(r.title)}</h1>
      <div class="meta">
        ${category}
        ${favorite}
        ${imageCount}
        ${videoBadge}
        ${updated ? `<span class="updated">Zuletzt geändert: ${esc(updated)}</span>` : ''}
      </div>
    </header>

    ${imagesHtml}

    <div class="${mainGridClass}">
      ${ingredients || ''}
      ${instructions || ''}
    </div>

    ${notes}
    ${infoBlock}

    <footer>
      <span>Gedruckt aus Andys Rezeptbox</span>
      <span>V3.18</span>
    </footer>
  </div>

<script>
  window.addEventListener('load', function(){
    setTimeout(function(){
      window.print();
    }, 250);
  });
<\/script>
</body>
</html>`);
  printWindow.document.close();
}

function openView(id){
  const r = recipes.find(x => x.id === id); if (!r) return;
  const imgs = getImages(r);
  const image = imgs[0] ? `<img class="view-hero" src="${imgs[0]}" alt="${escapeHtml(r.title)}">` : '';
  const gallery = imgs.length > 1 ? `<div class="view-gallery">${imgs.slice(1).map((src,i)=>`<img src="${src}" alt="Zusatzbild ${i+2}">`).join('')}</div>` : '';
  const ytEmbed = r.video ? youtubeEmbedUrl(r.video) : '';
  const video = r.video
    ? isDirectVideoUrl(r.video)
      ? `<div class="view-video"><video controls preload="metadata" src="${r.video}"></video></div>`
      : ytEmbed
        ? `<div class="view-video"><iframe width="100%" height="360" src="${ytEmbed}" title="Rezeptvideo" frameborder="0" allowfullscreen></iframe></div>`
        : `<div class="view-video"><a class="primary video-open-link" href="${escapeHtml(r.video)}" target="_blank" rel="noopener">▶ Video öffnen</a></div>`
    : '';
  el('recipeView').innerHTML = `${image}<div class="view-content">
    <h2>${escapeHtml(r.title)} ${r.favorite?'★':''}</h2>
    <div class="view-meta">${escapeHtml(r.category)}${r.updatedAt ? ` · zuletzt geändert ${formatDate(r.updatedAt)}` : ''}</div>
    ${gallery}
    ${video}
    <div class="view-section"><strong>Zutaten</strong>\n${escapeHtml(r.ingredients || '—')}</div>
    <div class="view-section"><strong>Zubereitung</strong>\n${escapeHtml(r.instructions || '—')}</div>
    ${r.notes ? `<div class="view-section"><strong>Eigene Notizen</strong>\n${escapeHtml(r.notes)}</div>` : ''}
    ${r.source ? `<div class="view-section"><strong>Original-Link</strong><br><a class="source-link" href="${escapeHtml(r.source)}" target="_blank" rel="noopener">${escapeHtml(r.source)}</a></div>` : ''}
    <div class="view-actions">
      <button class="secondary" id="printFromView">🖨️ Drucken</button>
      <button class="primary" id="editFromView">Bearbeiten</button>
      <button class="secondary" id="closeView">Schliessen</button>
    </div>
  </div>`;
  el('printFromView').onclick = () => printRecipe(id);
  el('editFromView').onclick = () => openEdit(id);
  el('closeView').onclick = () => viewDialog.close();
  viewDialog.showModal();
}

function fileToImageElement(file){
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Bild konnte nicht gelesen werden'));
    };
    img.src = url;
  });
}

async function compressImageFile(file){
  if (!file || !file.type.startsWith('image/')) return '';

  // Very small images are already fine, but still route through canvas
  // so all stored images have predictable dimensions and size.
  try {
    const img = await fileToImageElement(file);

    const MAX_DIMENSION = 1400;
    const scale = Math.min(
      1,
      MAX_DIMENSION / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height)
    );

    const width = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
    const height = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');

    // White background avoids black backgrounds when a transparent PNG
    // is converted to JPEG.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    // 0.80 gives good recipe-photo quality while remaining compact enough
    // for localStorage.
    return canvas.toDataURL('image/jpeg', 0.80);
  } catch {
    // Fallback: original file if canvas conversion fails.
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result || '');
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
}

async function readFilesAsDataUrls(files){
  const results = [];
  for (const file of [...files].filter(f => f.type.startsWith('image/'))) {
    const data = await compressImageFile(file);
    if (data) results.push(data);
  }
  return results;
}


function normalizeImageUrlForCompare(url){
  try {
    const u = new URL(url);

    // Fragment never matters for the actual image resource.
    u.hash = '';

    // Remove common tracking/cache parameters that often make the same image
    // look like several different URLs when dragged from a website.
    const dropParams = new Set([
      'fbclid','utm_source','utm_medium','utm_campaign','utm_term','utm_content',
      'w','width','h','height','quality','q','fit','crop','auto','format','fm',
      'ver','version','v','cache','cb'
    ]);

    const kept = [...u.searchParams.entries()]
      .filter(([key]) => !dropParams.has(key.toLowerCase()))
      .sort(([a],[b]) => a.localeCompare(b));

    u.search = '';
    kept.forEach(([k,v]) => u.searchParams.append(k,v));

    return u.toString();
  } catch {
    return String(url || '').trim();
  }
}

function uniqueStrings(values){
  const seen = new Set();
  const result = [];

  for (const raw of values.filter(Boolean)) {
    const value = String(raw).trim();
    const key = /^https?:\/\//i.test(value)
      ? normalizeImageUrlForCompare(value)
      : value;

    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function imageSignature(src){
  if (!src) return '';
  if (src.startsWith('data:')) {
    // A practical signature for locally stored images.
    // Using beginning + length avoids storing or hashing huge strings.
    return `data:${src.length}:${src.slice(0,180)}`;
  }
  return `url:${normalizeImageUrlForCompare(src)}`;
}

function pushUniqueImages(targetArray, candidates){
  const existing = new Set(targetArray.map(imageSignature));
  let added = 0;

  for (const src of candidates) {
    const sig = imageSignature(src);
    if (!sig || existing.has(sig)) continue;
    targetArray.push(src);
    existing.add(sig);
    added++;
  }

  return added;
}

function imageUrlsFromDataTransfer(dt){
  // Ein einzelner Drag von einer Webseite soll genau EIN Bild ergeben.
  // Browser liefern oft mehrere Varianten desselben Bildes (src, srcset,
  // Thumbnail, Original). Deshalb nehmen wir bewusst nur die erste
  // brauchbare Bildadresse.

  const candidates = [];

  const html = dt?.getData?.('text/html') || '';
  if (html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const img = doc.querySelector('img');
    if (img?.src) candidates.push(img.src);
  }

  const uriList = dt?.getData?.('text/uri-list') || '';
  for (const line of uriList.split(/\r?\n/)) {
    const value = line.trim();
    if (value && !value.startsWith('#')) candidates.push(value);
  }

  const plain = (dt?.getData?.('text/plain') || '').trim();
  if (/^https?:\/\//i.test(plain)) candidates.push(plain);

  const unique = uniqueStrings(candidates);
  return unique.length ? [unique[0]] : [];
}

function canDisplayImageUrl(url){
  return new Promise(resolve => {
    if (!/^https?:\/\//i.test(url)) return resolve(false);
    const img = new Image();
    const timer = setTimeout(() => resolve(false), 8000);
    img.onload = () => { clearTimeout(timer); resolve(true); };
    img.onerror = () => { clearTimeout(timer); resolve(false); };
    img.referrerPolicy = 'no-referrer';
    img.src = url;
  });
}

async function imageUrlsToStoredImages(urls){
  const url = uniqueStrings(urls)[0];
  if (!url) return [];

  try {
    const response = await fetch(url, { mode:'cors', credentials:'omit' });
    if (response.ok) {
      const blob = await response.blob();
      if (blob.type.startsWith('image/')) {
        const [dataUrl] = await readFilesAsDataUrls([
          new File([blob], 'webbild', {type: blob.type})
        ]);
        if (dataUrl) return [{src:dataUrl, permanent:true}];
      }
    }
  } catch {}

  if (await canDisplayImageUrl(url)) {
    return [{src:url, permanent:false}];
  }

  return [];
}

async function addImagesFromDrop(dataTransfer, targetArray, renderFn){
  const files = [...(dataTransfer?.files || [])].filter(f => f.type.startsWith('image/'));
  let added = 0;
  let remoteOnly = 0;

  if (files.length) {
    // Bei echten Dateien dürfen mehrere gleichzeitig ausgewählt sein.
    const dataUrls = await readFilesAsDataUrls(files);
    added += pushUniqueImages(targetArray, dataUrls);
  } else {
    // Bei einem Bild direkt von einer Webseite: exakt EIN Bild übernehmen.
    const urls = imageUrlsFromDataTransfer(dataTransfer);
    if (urls.length) {
      const imported = await imageUrlsToStoredImages([urls[0]]);
      if (imported.length) {
        const before = targetArray.length;
        added += pushUniqueImages(targetArray, [imported[0].src]);
        if (targetArray.length > before && !imported[0].permanent) remoteOnly = 1;
      }
    }
  }

  renderFn();

  if (!added) {
    alert(
      'Ich konnte aus dem hineingezogenen Element kein Bild übernehmen.\n\n' +
      'Versuche bitte Rechtsklick auf das Bild → „Bild kopieren“ und danach Strg+V, ' +
      'oder speichere das Bild kurz und wähle es über „Bilder auswählen“.'
    );
  } else if (remoteOnly) {
    alert(
      'Das Bild wurde übernommen. Die Webseite erlaubt aber keinen direkten Download des Bildes.\n\n' +
      'Darum ist dieses Bild momentan über seine Internetadresse eingebunden. ' +
      'Für eine dauerhaft sichere Speicherung kannst du es später zusätzlich über ' +
      '„Bild speichern unter…“ als Datei hinzufügen.'
    );
  }

  return added;
}

function cleanLines(text){
  return text
    .replace(/\r/g,'')
    .split('\n')
    .map(x => x.replace(/\u00a0/g,' ').trim())
    .filter(Boolean);
}

function headingKey(line){
  return line
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/^[^a-zäöüß]+/i,'')
    .replace(/[^a-zäöüß]+$/i,'')
    .replace(/\s+/g,' ')
    .trim();
}

function isHeading(line, words){
  const key = headingKey(line);
  return words.some(w => {
    const wk = headingKey(w);
    return key === wk || key.startsWith(wk + ' ');
  });
}

function looksLikeIngredient(line){
  const s = line.trim();
  if (!s) return false;

  // Typical amount + ingredient
  if (
    /^(?:[•\-–—*]\s*)?(?:ca\.?\s*)?(?:\d+[\d\s.,/]*|½|¼|¾|⅓|⅔|ein(?:e|en)?|zwei|drei|vier|fünf)\s*(?:g|kg|mg|ml|cl|dl|l|el|tl|stk|stück|stücke|prise|prisen|bund|dose|dosen|zehe|zehen|tasse|tassen|becher|packung|päckchen|scheibe|scheiben)?\b/i.test(s)
  ) return true;

  // Frequently quantity-free ingredients
  if (
    /^(?:salz|pfeffer|paprika|chili|zucker|mehl|butter|öl|oel|olivenöl|olivenoel|wasser|milch|sahne|rahm|knoblauch|zwiebel|zwiebeln|zucchini|möhren|moehren|karotten|parmesan|semmelbrösel|semmelbroesel|kräuter|kraeuter)\b/i.test(s)
  ) return true;

  // "optional Knoblauchpulver", "etwas Öl", etc.
  if (/^(?:optional|etwas|nach geschmack|zum abschmecken)\b/i.test(s)) return true;

  // Short food-like lines without punctuation are probably ingredients,
  // but avoid long sentences.
  const words = s.split(/\s+/);
  if (
    words.length <= 6 &&
    !/[.!?]$/.test(s) &&
    !/^(?:zubereitung|anleitung|so geht|so mache)/i.test(s)
  ) {
    if (/\b(?:zwiebel|möhren|moehren|zucchini|knoblauch|keimöl|keimoel|zucker|gemüsebouillon|gemuesebouillon|schlagsahne|paprika|parmesan|ei|eier|salz|pfeffer|öl|oel)\b/i.test(s)) {
      return true;
    }
  }

  return false;
}

function isImportNoiseLine(line){
  const s = line.trim();
  const k = headingKey(s);

  if (!s) return true;
  if (/^https?:\/\//i.test(s)) return true;

  // Facebook-/Website-Metadaten und Navigation
  if (/^(beitrag|gespeichert|reels?|facebook|von |teilen|gefällt mir|kommentieren)\b/i.test(k)) return true;
  if (/^(post author|post last modified|reading time|remaining time|video thumbnail|video duration|jump to recipe|print recipe)\b/i.test(k)) return true;

  // Typische Zeit-/Videozeilen aus eingebetteten Rezeptseiten
  if (/^(remaining time|video thumbnail)\s*[:\-]?\s*\d/i.test(s)) return true;
  if (/^reading time\s*[:\-]?\s*\d/i.test(s)) return true;

  // Werbe-, Crosslink- und "noch ein Rezept"-Zeilen
  if (/^(auch\s+)?(superlecker|auch lecker|das könnte dir auch gefallen|weitere rezepte|mehr rezepte|empfohlen|anzeige|werbung)\s*[:\-]/i.test(s)) return true;
  if (/^(auch\s+)?(superlecker|auch lecker)\b/i.test(s)) return true;

  // Seitenelemente
  if (/^(newsletter|abonnieren|subscribe|datenschutz|impressum|cookie|cookies)\b/i.test(k)) return true;

  return false;
}

function stripImportNoise(lines){
  return lines.filter(l => !isImportNoiseLine(l));
}

function removeDuplicateLines(lines){
  const seen = new Set();
  return lines.filter(line => {
    const key = headingKey(line);
    if (!key) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseImportedText(raw){
  const lines = cleanLines(raw);
  if (!lines.length) {
    return {title:'', ingredients:'', instructions:'', notes:''};
  }

  const ingredientWords = [
    'zutaten','zutatenliste','ingredients','du brauchst','was du brauchst'
  ];
  const instructionWords = [
    'zubereitung','anleitung','zubereiten','zubereitungsschritte',
    'instructions','so mache ich es','so gehts','so geht es',
    'ubereitung','ubereiten'
  ];
  const noteWords = [
    'tipp','tipps','hinweis','hinweise','notizen','notiz'
  ];

  let title = lines[0].trim();

  if (
    title.length > 160 ||
    isHeading(title, [...ingredientWords, ...instructionWords, ...noteWords])
  ) {
    title = 'Importiertes Rezept';
  }

  // Störzeilen und Wiederholungen entfernen.
  let cleaned = removeDuplicateLines(lines)
    .filter((line, index) => {
      if (index === 0) return true;
      if (isImportNoiseLine(line)) return false;
      return headingKey(line) !== headingKey(title);
    });

  if (!cleaned.length) cleaned = lines;

  // Titel als erste Zeile beibehalten.
  const body = cleaned.slice(1);

  const ingredientIndex = body.findIndex(l => isHeading(l, ingredientWords));
  const instructionIndex = body.findIndex(l => isHeading(l, instructionWords));
  const noteIndex = body.findIndex(l => isHeading(l, noteWords));

  let ingredients = [];
  let instructions = [];
  let notes = [];

  // FALL 1:
  // Es gibt eine explizite Überschrift "Zutaten".
  if (ingredientIndex >= 0) {
    const ingredientEndCandidates = [
      instructionIndex,
      noteIndex
    ].filter(i => i > ingredientIndex);

    const ingredientEnd = ingredientEndCandidates.length
      ? Math.min(...ingredientEndCandidates)
      : body.length;

    ingredients = stripImportNoise(
      body.slice(ingredientIndex + 1, ingredientEnd)
    );

    if (instructionIndex >= 0) {
      const instructionEnd = noteIndex > instructionIndex
        ? noteIndex
        : body.length;

      instructions = stripImportNoise(
        body.slice(instructionIndex + 1, instructionEnd)
      );
    }

    if (noteIndex >= 0) {
      notes = stripImportNoise(body.slice(noteIndex + 1));
    }
  }

  // FALL 2:
  // Keine Überschrift "Zutaten", aber "Zubereitung" ist vorhanden.
  // Alles davor wird intelligent in Zutaten / Rest getrennt.
  else if (instructionIndex >= 0) {
    const beforeInstructions = stripImportNoise(
      body.slice(0, instructionIndex)
    );

    const likelyIngredients = [];
    const leftovers = [];

    for (const line of beforeInstructions) {
      if (looksLikeIngredient(line)) {
        likelyIngredients.push(line);
      } else {
        leftovers.push(line);
      }
    }

    // Wenn mindestens zwei typische Zutaten erkannt wurden,
    // verwenden wir sie als Zutatenliste.
    if (likelyIngredients.length >= 2) {
      ingredients = likelyIngredients;

      // Nicht als Zutaten erkannte Zeilen vor "Zubereitung"
      // kommen in die Notizen, nicht in die Zubereitung.
      notes.push(...leftovers);
    } else {
      // Falls die Erkennung unsicher ist, behandeln wir fast alles
      // vor "Zubereitung" als Zutaten, solange es keine langen Sätze sind.
      for (const line of beforeInstructions) {
        const wordCount = line.split(/\s+/).length;
        const sentenceLike = /[.!?]$/.test(line) && wordCount > 8;

        if (!sentenceLike) ingredients.push(line);
        else notes.push(line);
      }
    }

    const instructionEnd = noteIndex > instructionIndex
      ? noteIndex
      : body.length;

    instructions = stripImportNoise(
      body.slice(instructionIndex + 1, instructionEnd)
    );

    if (noteIndex >= 0) {
      notes.push(...stripImportNoise(body.slice(noteIndex + 1)));
    }
  }

  // FALL 3:
  // Keine Überschriften vorhanden.
  // Wir erkennen zunächst zusammenhängende Zutatenzeilen.
  else {
    let foundIngredientBlock = false;
    let switchedToInstructions = false;

    for (const line of stripImportNoise(body)) {
      if (!switchedToInstructions && looksLikeIngredient(line)) {
        ingredients.push(line);
        foundIngredientBlock = true;
        continue;
      }

      if (foundIngredientBlock) {
        switchedToInstructions = true;
      }

      if (switchedToInstructions) {
        instructions.push(line);
      } else {
        notes.push(line);
      }
    }
  }

  // Zusätzliche Nachkorrektur:
  // Falls Zutaten versehentlich noch am Anfang der Zubereitung stehen,
  // verschieben wir sie nach oben, bis der erste echte Satz beginnt.
  if (instructions.length) {
    const moved = [];

    while (instructions.length && looksLikeIngredient(instructions[0])) {
      moved.push(instructions.shift());
    }

    if (moved.length) {
      ingredients.push(...moved);
    }

    // Falls eine versehentlich mitkopierte Überschrift "Zubereitung"
    // noch in der Liste steht, entfernen.
    instructions = instructions.filter(
      l => !isHeading(l, instructionWords)
    );
  }

  // Doppelte Zutaten/Zeilen entfernen.
  ingredients = removeDuplicateLines(ingredients);
  instructions = removeDuplicateLines(instructions);
  notes = removeDuplicateLines(notes);

  return {
    title: title.trim(),
    ingredients: ingredients.join('\n').trim(),
    instructions: instructions.join('\n').trim(),
    notes: notes.join('\n').trim()
  };
}

function resetImport(){
  el('importForm').reset();
  importImages = [];
  importVideo = '';
  renderImagePreview('importImagePreviewGrid', importImages, removeImportImage);
  renderVideoPreview('importVideoPreviewBox', '', 'removeImportVideoBtn');
}
function removeImportImage(i){
  importImages.splice(i,1);
  renderImagePreview('importImagePreviewGrid', importImages, removeImportImage);
}
function openImport(){ resetImport(); importDialog.showModal(); }
async function addImportFiles(files){
  const added = await readFilesAsDataUrls(files);
  pushUniqueImages(importImages, added);
  renderImagePreview('importImagePreviewGrid', importImages, removeImportImage);
}


function openCategoryDialog(){
  el('categoryForm').reset();
  if (el('categoryCustomEmoji')) el('categoryCustomEmoji').value = '';
  categoryDialog.showModal();
  setTimeout(() => el('newCategoryInput').focus(), 50);
}

el('addCategoryBtn').onclick = openCategoryDialog;
el('closeCategoryDialogBtn').onclick = () => categoryDialog.close();
el('cancelCategoryBtn').onclick = () => categoryDialog.close();

el('categoryForm').addEventListener('submit', e => {
  e.preventDefault();

  const name = el('newCategoryInput').value.trim();
  const emoji = (el('categoryCustomEmoji')?.value || '').trim() || el('newCategoryEmoji').value || '🍽️';

  if (!name) return;

  const exists = allCategories().some(([n]) => n.toLowerCase() === name.toLowerCase());
  if (exists) {
    alert('Diese Kategorie gibt es bereits.');
    return;
  }

  customCategories.push([name, emoji]);
  saveCustomCategories();
  categoryDialog.close();
  render();
});

el('recipeForm').addEventListener('submit', e => {
  e.preventDefault();
  const id = el('recipeId').value || uid();
  const data = {
    id,
    title: el('titleInput').value.trim(),
    category: el('categoryInput').value,
    images: editingImages.slice(),
    image: editingImages[0] || '',
    video: editingVideo || el('videoUrlInput').value.trim(),
    ingredients: el('ingredientsInput').value.trim(),
    instructions: el('instructionsInput').value.trim(),
    notes: el('notesInput').value.trim(),
    source: el('sourceInput').value.trim(),
    favorite: el('favoriteInput').checked,
    updatedAt: new Date().toISOString()
  };
  const i = recipes.findIndex(r => r.id === id);
  const previous = i >= 0 ? {...recipes[i]} : null;

  // V3.12: Ähnlichkeitsprüfung aus Titel, Bild, Text und Quelle.
  // Der Nutzer entscheidet selbst, ob eine ähnliche Variante trotzdem gespeichert wird.
  const similar = findSimilarRecipe(data, id);

  if (similar) {
    const reasons = similar.similarity.reasons.length
      ? similar.similarity.reasons.join(', ')
      : 'mehrere ähnliche Merkmale';

    const saveAnyway = confirm(
      `Dieses Rezept ähnelt einem bereits gespeicherten Rezept sehr stark:\n\n` +
      `„${similar.recipe.title}“\n\n` +
      `Übereinstimmung: ${reasons}.\n\n` +
      `OK = trotzdem speichern\nAbbrechen = nicht speichern`
    );

    if (!saveAnyway) return;
  }

  if (i >= 0) recipes[i] = {...recipes[i], ...data};
  else recipes.push(data);

  if (!saveRecipes()) {
    if (i >= 0) recipes[i] = previous;
    else recipes = recipes.filter(r => r.id !== id);
    return;
  }

  recipeDialog.close();
  render();
});

async function addEditingFiles(files){
  const added = await readFilesAsDataUrls(files || []);
  if (!added.length) return;
  pushUniqueImages(editingImages, added);
  renderImagePreview('imagePreviewGrid', editingImages, removeEditingImage);
  el('removeImageBtn').classList.toggle('hidden', editingImages.length === 0);
}

el('imageInput').addEventListener('change', async e => {
  await addEditingFiles(e.target.files || []);
  e.target.value = '';
});

el('chooseImagesBtn').onclick = () => el('imageInput').click();

['dragenter','dragover'].forEach(type => el('imageDropZone').addEventListener(type, e => {
  e.preventDefault();
  e.stopPropagation();
  el('imageDropZone').classList.add('dragover');
}));
['dragleave','drop'].forEach(type => el('imageDropZone').addEventListener(type, e => {
  e.preventDefault();
  e.stopPropagation();
  el('imageDropZone').classList.remove('dragover');
}));
el('imageDropZone').addEventListener('drop', async e => {
  await addImagesFromDrop(
    e.dataTransfer,
    editingImages,
    () => {
      renderImagePreview('imagePreviewGrid', editingImages, removeEditingImage);
      el('removeImageBtn').classList.toggle('hidden', editingImages.length === 0);
    }
  );
});
el('imageDropZone').addEventListener('click', e => {
  if (!e.target.closest('button')) el('imageDropZone').focus();
});
el('imageDropZone').addEventListener('paste', async e => {
  const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
  if (files.length) {
    e.preventDefault();
    await addEditingFiles(files);
  }
});

// Wenn das Rezeptfenster geöffnet ist, kann ein kopiertes Bild überall mit Strg+V eingefügt werden.
recipeDialog.addEventListener('paste', async e => {
  const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
  if (files.length) {
    e.preventDefault();
    await addEditingFiles(files);
  }
});

el('videoUrlInput').addEventListener('input', () => {
  const value = el('videoUrlInput').value.trim();
  if (value) {
    editingVideo = value;
    renderVideoPreview('videoPreviewBox', editingVideo, 'removeVideoBtn');
  } else if (!editingVideo.startsWith('data:video/')) {
    editingVideo = '';
    renderVideoPreview('videoPreviewBox', '', 'removeVideoBtn');
  }
});

el('chooseVideoBtn').onclick = () => el('videoFileInput').click();

el('videoFileInput').addEventListener('change', async e => {
  const file = e.target.files?.[0];
  const data = await readVideoFileAsDataUrl(file);
  if (data) {
    editingVideo = data;
    el('videoUrlInput').value = '';
    renderVideoPreview('videoPreviewBox', editingVideo, 'removeVideoBtn');
  }
  e.target.value = '';
});

el('removeVideoBtn').onclick = () => {
  editingVideo = '';
  el('videoUrlInput').value = '';
  el('videoFileInput').value = '';
  renderVideoPreview('videoPreviewBox', '', 'removeVideoBtn');
};

el('removeImageBtn').onclick = () => {
  editingImages = [];
  el('imageInput').value='';
  renderImagePreview('imagePreviewGrid', editingImages, removeEditingImage);
  el('removeImageBtn').classList.add('hidden');
};
el('deleteBtn').onclick = () => {
  const id = el('recipeId').value;
  const r = recipes.find(x => x.id === id);
  if (r && confirm(`„${r.title}“ wirklich löschen?`)) {
    rememberRecipeDeletion(id);
    recipes = recipes.filter(x => x.id !== id);
    saveRecipes();
    recipeDialog.close();
    render();
  }
};

el('importImagesInput').addEventListener('change', async e => {
  await addImportFiles(e.target.files || []);
  e.target.value = '';
});
['dragenter','dragover'].forEach(type => el('importDropZone').addEventListener(type, e => {
  e.preventDefault(); e.stopPropagation(); el('importDropZone').classList.add('dragover');
}));
['dragleave','drop'].forEach(type => el('importDropZone').addEventListener(type, e => {
  e.preventDefault(); e.stopPropagation(); el('importDropZone').classList.remove('dragover');
}));
el('importDropZone').addEventListener('drop', async e => {
  await addImagesFromDrop(
    e.dataTransfer,
    importImages,
    () => renderImagePreview('importImagePreviewGrid', importImages, removeImportImage)
  );
});
function handlePastedImages(e){
  const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
  if (files.length && importDialog.open) {
    e.preventDefault();
    addImportFiles(files);
  }
}
document.addEventListener('paste', handlePastedImages);


el('importVideoUrlInput').addEventListener('input', () => {
  const value = el('importVideoUrlInput').value.trim();
  if (value) {
    importVideo = value;
    renderVideoPreview('importVideoPreviewBox', importVideo, 'removeImportVideoBtn');
  } else if (!importVideo.startsWith('data:video/')) {
    importVideo = '';
    renderVideoPreview('importVideoPreviewBox', '', 'removeImportVideoBtn');
  }
});

el('chooseImportVideoBtn').onclick = () => el('importVideoFileInput').click();

el('importVideoFileInput').addEventListener('change', async e => {
  const file = e.target.files?.[0];
  const data = await readVideoFileAsDataUrl(file);
  if (data) {
    importVideo = data;
    el('importVideoUrlInput').value = '';
    renderVideoPreview('importVideoPreviewBox', importVideo, 'removeImportVideoBtn');
  }
  e.target.value = '';
});

el('removeImportVideoBtn').onclick = () => {
  importVideo = '';
  el('importVideoUrlInput').value = '';
  el('importVideoFileInput').value = '';
  renderVideoPreview('importVideoPreviewBox', '', 'removeImportVideoBtn');
};

el('importForm').addEventListener('submit', e => {
  e.preventDefault();
  const raw = el('importTextInput').value.trim();
  if (!raw && importImages.length === 0 && !importVideo && !el('importVideoUrlInput').value.trim()) {
    alert('Bitte zuerst einen Rezepttext, ein Bild oder ein Video einfügen.');
    return;
  }
  const parsed = parseImportedText(raw);
  importDialog.close();
  resetForm();
  el('dialogTitle').textContent = 'Importiertes Rezept prüfen';
  el('titleInput').value = parsed.title || 'Importiertes Rezept';
  el('ingredientsInput').value = parsed.ingredients;
  el('instructionsInput').value = parsed.instructions;
  el('notesInput').value = parsed.notes;
  el('sourceInput').value = el('importSourceInput').value.trim();
  editingImages = importImages.slice();
  editingVideo = importVideo || el('importVideoUrlInput').value.trim();
  el('videoUrlInput').value = editingVideo.startsWith('data:video/') ? '' : editingVideo;
  renderVideoPreview('videoPreviewBox', editingVideo, 'removeVideoBtn');
  renderImagePreview('imagePreviewGrid', editingImages, removeEditingImage);
  el('removeImageBtn').classList.toggle('hidden', editingImages.length === 0);
  recipeDialog.showModal();
});

el('addRecipeBtn').onclick = openNewRecipe;
el('quickAddBtn').onclick = openNewRecipe;
el('mobileAddBtn').onclick = openNewRecipe;
el('emptyAddBtn').onclick = openNewRecipe;
el('importRecipeBtn').onclick = openImport;
el('quickImportRecipeBtn').onclick = openImport;
el('closeDialogBtn').onclick = () => recipeDialog.close();
el('cancelBtn').onclick = () => recipeDialog.close();
el('closeImportDialogBtn').onclick = () => importDialog.close();
el('cancelImportBtn').onclick = () => importDialog.close();
el('clearImportBtn').onclick = resetImport;
searchInput.addEventListener('input', renderRecipes);
el('favoritesBtn').onclick = () => { favoritesOnly = !favoritesOnly; currentCategory = null; render(); };
el('quickFavoritesBtn').onclick = () => { favoritesOnly = !favoritesOnly; currentCategory = null; render(); };
el('showAllBtn').onclick = () => { favoritesOnly = false; currentCategory = null; searchInput.value=''; render(); };

function triggerImport(){ el('importInput').click(); }
function triggerExport(){ el('exportBtn').click(); }

function normalizeFingerprintText(value){
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizedRecipeFingerprint(recipe){
  const r = normalizeRecipe(recipe);
  return [
    normalizeFingerprintText(r.title),
    normalizeFingerprintText(r.ingredients),
    normalizeFingerprintText(r.instructions),
    normalizeFingerprintText(r.source)
  ].join('||');
}

function recipeImageKeys(recipe){
  const r = normalizeRecipe(recipe);
  const values = [];

  if (r.image) values.push(r.image);
  if (Array.isArray(r.images)) values.push(...r.images);

  const keys = new Set();

  for (const raw of values) {
    const value = String(raw || '').trim();
    if (!value) continue;

    // Exakte Bilddaten bzw. exakte URL.
    keys.add(value);

    // Bei Web-Bildern zusätzlich die URL ohne Query-Parameter.
    if (/^https?:\/\//i.test(value)) {
      try {
        const u = new URL(value);
        u.search = '';
        u.hash = '';
        keys.add(u.toString().toLowerCase());

        const fileName = decodeURIComponent(u.pathname.split('/').pop() || '').toLowerCase();
        if (fileName) keys.add('file:' + fileName);
      } catch (_) {}
    }
  }

  return keys;
}

function tokenSet(value){
  const text = normalizeFingerprintText(value);
  return new Set(
    text.split(' ').filter(token => token.length >= 3)
  );
}

function textSimilarity(a, b){
  const A = tokenSet(a);
  const B = tokenSet(b);

  if (!A.size && !B.size) return 1;
  if (!A.size || !B.size) return 0;

  let intersection = 0;
  for (const token of A) {
    if (B.has(token)) intersection++;
  }

  const union = new Set([...A, ...B]).size;
  return union ? intersection / union : 0;
}

function hasCommonImage(a, b){
  const A = recipeImageKeys(a);
  const B = recipeImageKeys(b);
  if (!A.size || !B.size) return false;

  for (const key of A) {
    if (B.has(key)) return true;
  }
  return false;
}

function recipeSimilarity(a, b){
  const A = normalizeRecipe(a);
  const B = normalizeRecipe(b);

  const titleA = normalizeFingerprintText(A.title);
  const titleB = normalizeFingerprintText(B.title);
  const titleExact = !!titleA && titleA === titleB;
  const titleScore = textSimilarity(A.title, B.title);

  const textA = [A.ingredients, A.instructions, A.notes].filter(Boolean).join(' ');
  const textB = [B.ingredients, B.instructions, B.notes].filter(Boolean).join(' ');
  const textScore = textSimilarity(textA, textB);

  const sourceA = normalizeFingerprintText(A.source);
  const sourceB = normalizeFingerprintText(B.source);
  const sameSource = !!sourceA && !!sourceB && sourceA === sourceB;

  const sameImage = hasCommonImage(A, B);

  let score = 0;
  if (titleExact) score += 5;
  else if (titleScore >= 0.80) score += 4;
  else if (titleScore >= 0.60) score += 2;

  if (sameImage) score += 4;

  if (textScore >= 0.75) score += 4;
  else if (textScore >= 0.50) score += 3;
  else if (textScore >= 0.30) score += 1;

  if (sameSource) score += 3;

  // Warnen bei gleichem Titel immer.
  // Sonst müssen mindestens zwei starke Merkmale zusammenpassen.
  const suspicious =
    titleExact ||
    score >= 6 ||
    (sameImage && textScore >= 0.30) ||
    (sameSource && (titleScore >= 0.50 || textScore >= 0.30));

  const reasons = [];
  if (titleExact) reasons.push('gleicher Titel');
  else if (titleScore >= 0.80) reasons.push('sehr ähnlicher Titel');
  else if (titleScore >= 0.60) reasons.push('ähnlicher Titel');

  if (sameImage) reasons.push('gleiches Bild');
  if (textScore >= 0.75) reasons.push('sehr ähnlicher Text');
  else if (textScore >= 0.50) reasons.push('ähnlicher Text');
  if (sameSource) reasons.push('gleiche Quelle');

  return { suspicious, score, reasons, titleScore, textScore, sameImage, sameSource };
}

function findSimilarRecipe(candidate, currentId){
  let best = null;

  for (const existing of recipes) {
    if (existing.id === currentId) continue;

    const similarity = recipeSimilarity(candidate, existing);
    if (!similarity.suspicious) continue;

    if (!best || similarity.score > best.similarity.score) {
      best = {recipe: existing, similarity};
    }
  }

  return best;
}

function dedupeRecipeList(incomingRecipes){
  if (!Array.isArray(incomingRecipes)) return {recipes:[], skipped:0};

  const seen = new Set();
  const cleaned = [];
  let skipped = 0;

  for (const raw of incomingRecipes) {
    const recipe = normalizeRecipe(raw);
    const fingerprint = normalizedRecipeFingerprint(recipe);

    if (!recipe.title || seen.has(fingerprint)) {
      skipped++;
      continue;
    }

    // Falls innerhalb einer Sicherung zwei verschiedene Rezepte dieselbe ID haben,
    // bekommt der spätere Eintrag eine neue ID.
    if (!recipe.id || cleaned.some(r => r.id === recipe.id)) {
      recipe.id = uid();
    }

    seen.add(fingerprint);
    cleaned.push(recipe);
  }

  return {recipes: cleaned, skipped};
}

function mergeCustomCategories(incoming){
  if (!Array.isArray(incoming)) return 0;

  let added = 0;
  const existingNames = new Set(
    allCategories().map(([name]) => name.trim().toLowerCase())
  );

  for (const item of incoming) {
    if (!Array.isArray(item) || !item[0]) continue;
    const name = String(item[0]).trim();
    const emoji = item[1] || '🍽️';
    const key = name.toLowerCase();

    if (!name || existingNames.has(key)) continue;

    customCategories.push([name, emoji]);
    existingNames.add(key);
    added++;
  }

  if (added) saveCustomCategories();
  return added;
}

function mergeRecipesFromBackup(incomingRecipes){
  if (!Array.isArray(incomingRecipes)) return {added:0, skipped:0};

  const existingFingerprints = new Set(
    recipes.map(normalizedRecipeFingerprint)
  );

  let added = 0;
  let skipped = 0;

  for (const raw of incomingRecipes) {
    const recipe = normalizeRecipe(raw);
    const fingerprint = normalizedRecipeFingerprint(recipe);

    if (!recipe.title || existingFingerprints.has(fingerprint)) {
      skipped++;
      continue;
    }

    // ID clashes are possible when two backups came from different versions.
    if (!recipe.id || recipes.some(r => r.id === recipe.id)) {
      recipe.id = uid();
    }

    recipes.push(recipe);
    existingFingerprints.add(fingerprint);
    added++;
  }

  return {added, skipped};
}

el('exportBtn').onclick = () => {
  const payload = JSON.stringify({
    app:'Andys Rezeptbox',
    version: 3.18,
    exportedAt:new Date().toISOString(),
    recipes,
    customCategories,
    deletedRecipes:loadDeletedRecipes()
  }, null, 2);
  const blob = new Blob([payload], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download=`Andys_Rezeptbox_Sicherung_${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(url);
};
el('quickExportBtn').onclick = triggerExport;
el('importBtn').onclick = triggerImport;
el('mergeImportBtn').onclick = () => el('mergeImportInput').click();
el('quickImportBtn').onclick = triggerImport;

el('mergeImportInput').addEventListener('change', async e => {
  const file = e.target.files?.[0];
  if (!file) return;

  try {
    const data = JSON.parse(await file.text());

    if (!Array.isArray(data.recipes)) {
      throw new Error('Ungültige Sicherung');
    }

    const incomingCount = data.recipes.length;

    if (!confirm(
      `Diese Sicherung enthält ${incomingCount} ${incomingCount === 1 ? 'Rezept' : 'Rezepte'}.\n\n` +
      'Die Rezepte werden zu deiner aktuellen Sammlung hinzugefügt. Vorhandene Rezepte bleiben erhalten. Fortfahren?'
    )) {
      e.target.value = '';
      return;
    }

    const categoryAdded = mergeCustomCategories(data.customCategories);
    const result = mergeRecipesFromBackup(data.recipes);

    if (!saveRecipes()) {
      alert('Die Sicherung konnte wegen zu wenig Browser-Speicher nicht vollständig hinzugefügt werden.');
      e.target.value = '';
      return;
    }
    render();

    let message = `${result.added} ${result.added === 1 ? 'Rezept wurde' : 'Rezepte wurden'} hinzugefügt.`;

    if (result.skipped) {
      message += `\n${result.skipped} ${result.skipped === 1 ? 'Doppelter Eintrag wurde' : 'Doppelte Einträge wurden'} übersprungen.`;
    }

    if (categoryAdded) {
      message += `\n${categoryAdded} ${categoryAdded === 1 ? 'neue Kategorie wurde' : 'neue Kategorien wurden'} ebenfalls übernommen.`;
    }

    alert(message);
  } catch(err) {
    alert('Diese Datei konnte nicht als gültige Rezeptbox-Sicherung gelesen werden.');
  }

  e.target.value = '';
});

el('importInput').addEventListener('change', async e => {
  const file = e.target.files?.[0]; if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.recipes)) throw new Error('Ungültige Sicherung');
    if (confirm(`Sicherung mit ${data.recipes.length} Rezepten wiederherstellen? Die aktuellen Rezepte werden ersetzt.`)) {
      const cleaned = dedupeRecipeList(data.recipes);
      recipes = cleaned.recipes;
      customCategories = Array.isArray(data.customCategories) ? data.customCategories : [];
      saveDeletedRecipes(Array.isArray(data.deletedRecipes) ? data.deletedRecipes : []);
      if (!saveRecipes()) {
        alert('Die Sicherung konnte wegen zu wenig Browser-Speicher nicht vollständig wiederhergestellt werden.');
        e.target.value = '';
        return;
      }
      saveCustomCategories();
      render();

      let message = `Komplette Sicherung wurde ersetzt.\n${recipes.length} ${recipes.length === 1 ? 'Rezept ist' : 'Rezepte sind'} jetzt gespeichert.`;
      if (cleaned.skipped) {
        message += `\n${cleaned.skipped} ${cleaned.skipped === 1 ? 'doppelter Eintrag wurde' : 'doppelte Einträge wurden'} automatisch übersprungen.`;
      }
      alert(message);
    }
  } catch(err) { alert('Diese Datei konnte nicht als gültige Rezeptbox-Sicherung gelesen werden.'); }
  e.target.value='';
});

window.addEventListener('load', () => {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
  updateStats();
});

el('syncSettingsBtn').onclick = () => {
  const settings = loadSyncSettings();
  el('syncEnabledInput').checked = settings.enabled;
  el('syncUrlInput').value = settings.url || DEFAULT_SYNC_URL;
  el('syncKeyInput').value = settings.key || '';
  el('syncDialogStatus').textContent = '';
  el('syncDialog').showModal();
};

el('closeSyncDialogBtn').onclick = () => el('syncDialog').close();
el('syncNowBtn').onclick = () => performNasSync(true);

el('testSyncBtn').onclick = async () => {
  const temporary = {
    enabled:true,
    url:el('syncUrlInput').value.trim().replace(/\/+$/, ''),
    key:el('syncKeyInput').value.trim()
  };
  if (!temporary.url || !temporary.key) {
    el('syncDialogStatus').textContent = 'Bitte NAS-Adresse und Synchronisationsschlüssel eintragen.';
    return;
  }
  const previous = loadSyncSettings();
  saveSyncSettings(temporary);
  el('syncDialogStatus').textContent = 'Verbindung wird geprüft …';
  try {
    const response = await syncFetch('status');
    if (!response.ok) throw new Error(String(response.status));
    const result = await response.json();
    el('syncDialogStatus').textContent = result.ok ? '✓ Verbindung und Schlüssel sind gültig.' : 'Verbindung konnte nicht bestätigt werden.';
  } catch {
    el('syncDialogStatus').textContent = 'Keine Verbindung. Prüfe Adresse, Schlüssel und ob der NAS erreichbar ist.';
  } finally {
    saveSyncSettings(previous);
  }
};

el('syncForm').addEventListener('submit', e => {
  e.preventDefault();
  const settings = {
    enabled:el('syncEnabledInput').checked,
    url:el('syncUrlInput').value.trim().replace(/\/+$/, ''),
    key:el('syncKeyInput').value.trim()
  };
  if (settings.enabled && (!settings.url || !settings.key)) {
    el('syncDialogStatus').textContent = 'Für die Aktivierung werden NAS-Adresse und Schlüssel benötigt.';
    return;
  }
  saveSyncSettings(settings);
  el('syncDialog').close();
  refreshSyncUi();
  if (settings.enabled) performNasSync(true);
});

el('disableSyncBtn').onclick = () => {
  saveSyncSettings({enabled:false, url:DEFAULT_SYNC_URL, key:''});
  el('syncDialog').close();
  refreshSyncUi();
};

window.addEventListener('online', () => scheduleNasSync(1200));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') scheduleNasSync(1500);
});
setInterval(() => scheduleNasSync(0), 5 * 60 * 1000);

render();
initializeRecipeStorage();
