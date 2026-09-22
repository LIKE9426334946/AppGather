const $ = selector => document.querySelector(selector);
const groups = $('#tag-groups');
const starredSection = $('#starred-section');
const starredGrid = $('#starred-grid');
const addDialog = $('#add-dialog');
const deleteDialog = $('#delete-dialog');
const tagDialog = $('#tag-dialog');
const form = $('#add-form');
const nameInput = $('#link-name');
const urlInput = $('#link-url');
const tagInput = $('#link-tag');
const manageButton = $('#manage-button');
const searchInput = $('#link-search');
const DEFAULT_TAG_ID = 'default';
const tones = ['blue', 'violet', 'teal', 'orange', 'rose', 'cyan'];
const arrowSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M7 7h10v10"/></svg>';
const plusSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
const trashSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6"/></svg>';
const starSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z"/></svg>';
const editSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5 5 5M4 20l5-1L20 8a2.1 2.1 0 0 0-5-5L4 14Z"/></svg>';
let links = [];
let tags = [];
let loaded = false;
let managing = false;
let saving = false;
let deleting = false;
let creatingTag = false;
let groupBusy = false;
let pendingDelete = null;
let editingLink = null;
let toastTimer;
let sessionTimer;
let leaving = false;
let checkingSession = false;
let searchTerm = '';
const searchCollapsedTags = new Set();

function returnToLogin() {
  if (leaving) return;
  leaving = true;
  clearTimeout(sessionTimer);
  loaded = false;
  links = [];
  tags = [];
  groups.replaceChildren();
  starredGrid.replaceChildren();
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  document.body.hidden = true;
  window.location.replace('/login');
}

function watchSession(session) {
  clearTimeout(sessionTimer);
  // A 30-day timeout exceeds the browser limit; check at least once each day.
  const delay = Math.min(Math.max(session.expiresAt - Date.now(), 1000), 24 * 60 * 60 * 1000);
  sessionTimer = setTimeout(checkSession, delay);
}

async function checkSession() {
  if (leaving || checkingSession) return;
  checkingSession = true;
  clearTimeout(sessionTimer);
  try {
    watchSession(await api('/api/auth/session'));
  } catch {
    // An expired/revoked session redirects in api(); retry transient network errors.
    if (!leaving) sessionTimer = setTimeout(checkSession, 60 * 1000);
  } finally {
    checkingSession = false;
  }
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
    });
  } catch {
    throw new Error('连接失败，请检查网络后重试。');
  }
  if (response.status === 401) {
    returnToLogin();
    throw new Error('登录已失效，请重新登录。');
  }
  if (response.status === 204) return;
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '操作失败，请稍后重试。');
  return data;
}

function normalizeUrl(input) {
  let value = input.trim();
  if (!/^https?:\/\//i.test(value)) {
    // IP / localhost 默认使用 HTTP，普通域名默认使用 HTTPS。
    if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^[^/:\s]+:\d+(?:[/?#]|$)/.test(value)) {
      throw new Error('网址需要使用 http:// 或 https://。');
    }
    const local = /^(localhost|(?:\d{1,3}\.){3}\d{1,3}|\[[a-f\d:]+\])(?=[:/?#]|$)/i.test(value);
    value = `${local ? 'http' : 'https'}://${value}`;
  }
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
    return url.href;
  } catch {
    throw new Error('请输入有效的网址，例如 https://example.com。');
  }
}

function toneFor(name, url = '') {
  const hash = Array.from(name + url).reduce((value, char) => ((value * 31) + char.codePointAt(0)) >>> 0, 0);
  return `tone-${tones[hash % tones.length]}`;
}

function makeIcon(link) {
  const icon = element('div', `app-icon ${toneFor(link.name, link.url)}`);
  icon.setAttribute('aria-hidden', 'true');
  const initial = element('span', 'icon-initial', Array.from(link.name)[0].toUpperCase());
  const image = element('img', 'site-icon');
  image.alt = '';
  image.hidden = true;
  image.loading = 'lazy';
  image.referrerPolicy = 'no-referrer';
  image.addEventListener('load', () => {
    if (image.naturalWidth > 0) {
      image.hidden = false;
      initial.hidden = true;
    }
  });
  image.addEventListener('error', () => image.remove());
  // 只由浏览器访问目标网站图标，不经过第三方图标服务。
  image.src = new URL('/favicon.ico', link.url).href;
  icon.append(initial, image);
  return icon;
}

function makeCard(link) {
  const card = element('article', 'app-card');
  card.dataset.linkId = link.id;
  card.classList.toggle('is-starred', Boolean(link.starred));
  const anchor = element('a', 'app-link');
  anchor.href = link.url;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  anchor.title = `${link.name}\n${link.url}`;
  anchor.setAttribute('aria-label', `${link.name}，在新标签页打开`);
  const arrow = element('span', 'card-arrow');
  arrow.innerHTML = arrowSvg;
  anchor.append(arrow, makeIcon(link), element('h3', 'app-name', link.name), element('p', 'app-address', new URL(link.url).host));

  const star = element('button', 'star-button');
  star.type = 'button';
  star.dataset.star = link.id;
  star.innerHTML = starSvg;
  star.setAttribute('aria-pressed', String(Boolean(link.starred)));
  star.setAttribute('aria-label', `${link.starred ? '取消星标' : '设为星标'} ${link.name}`);
  star.title = link.starred ? '取消星标' : '设为星标';
  star.addEventListener('click', () => toggleStar(link));

  const edit = element('button', 'edit-button');
  edit.type = 'button';
  edit.dataset.edit = link.id;
  edit.innerHTML = editSvg;
  edit.setAttribute('aria-label', `编辑 ${link.name}`);
  edit.title = '编辑网页';
  edit.hidden = !managing;
  edit.addEventListener('click', () => openLinkForm(link));

  const remove = element('button', 'remove-button');
  remove.type = 'button';
  remove.innerHTML = trashSvg;
  remove.setAttribute('aria-label', `移除 ${link.name}`);
  remove.title = `移除 ${link.name}`;
  remove.hidden = !managing;
  remove.addEventListener('click', () => openDelete(link));
  const move = element('label', 'move-control', '所属标签');
  move.hidden = !managing;
  const select = element('select', 'move-select');
  select.dataset.move = link.id;
  select.setAttribute('aria-label', `将 ${link.name} 移动到标签`);
  fillTagOptions(select, link.tagId);
  select.addEventListener('change', () => moveLink(link, select));
  move.append(select);
  card.append(anchor, star, edit, remove, move);
  return card;
}

function fillTagOptions(select, selectedId) {
  select.replaceChildren(...tags.map(tag => {
    const option = element('option', '', tag.name);
    option.value = tag.id;
    return option;
  }));
  select.value = selectedId;
}

function matchingLinks() {
  return links.filter(link => link.name.toLowerCase().includes(searchTerm));
}

function visibleTags(matched = matchingLinks()) {
  if (searchTerm) return tags.filter(tag => matched.some(link => link.tagId === tag.id));
  return tags.filter(tag => tag.id !== DEFAULT_TAG_ID || links.some(link => link.tagId === tag.id));
}

function isCollapsed(tag) {
  return searchTerm ? searchCollapsedTags.has(tag.id) : tag.collapsed;
}

function applySearch() {
  searchTerm = searchInput.value.trim().toLowerCase();
  searchCollapsedTags.clear();
  $('#clear-search').hidden = !searchInput.value;
  if (loaded) render();
}

function clearSearch() {
  searchInput.value = '';
  applySearch();
  searchInput.focus();
}

function updateControls() {
  const displayed = visibleTags();
  searchInput.disabled = !loaded;
  $('#clear-search').disabled = !loaded;
  manageButton.disabled = !loaded || groupBusy || !links.length;
  $('#add-tag-button').disabled = !loaded || groupBusy;
  $('#collapse-all').disabled = !loaded || groupBusy || !displayed.some(tag => !isCollapsed(tag));
  $('#expand-all').disabled = !loaded || groupBusy || !displayed.some(isCollapsed);
  document.querySelectorAll('[data-add], .tag-toggle, .star-button, .edit-button, .remove-button, [data-move]').forEach(control => {
    control.disabled = !loaded || groupBusy;
  });
}

function updateCollapseUI() {
  for (const section of groups.children) {
    const tag = tags.find(item => item.id === section.dataset.tagId);
    const collapsed = isCollapsed(tag);
    const toggle = section.querySelector('.tag-toggle');
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-label', `${collapsed ? '展开' : '折叠'}标签「${tag.name}」`);
    section.querySelector('.tag-content').hidden = collapsed;
    section.classList.toggle('is-collapsed', collapsed);
  }
}

function makeGroup(tag) {
  const section = element('section', 'tag-section');
  section.dataset.tagId = tag.id;
  const header = element('div', 'tag-header');
  const heading = element('h2', 'tag-heading');
  const toggle = element('button', 'tag-toggle');
  toggle.id = `tag-toggle-${tag.id}`;
  toggle.setAttribute('aria-controls', `tag-content-${tag.id}`);
  const chevron = element('span', 'tag-chevron');
  chevron.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>';
  const tagLinks = matchingLinks().filter(link => link.tagId === tag.id);
  toggle.append(chevron, element('span', 'tag-name', tag.name), element('span', 'tag-count', `${tagLinks.length} 个网页`));
  toggle.title = tag.name;
  toggle.addEventListener('click', () => setCollapsed(!isCollapsed(tags.find(item => item.id === tag.id)), tag.id));
  heading.append(toggle);

  const add = element('button', 'button button-secondary tag-add');
  add.dataset.add = '';
  add.innerHTML = plusSvg;
  add.append(element('span', '', '添加网页'));
  add.setAttribute('aria-label', `在 ${tag.name} 下添加网页`);
  add.addEventListener('click', () => openAdd(tag.id));
  header.append(heading, add);

  const content = element('div', 'tag-content link-grid');
  content.id = `tag-content-${tag.id}`;
  content.setAttribute('aria-labelledby', toggle.id);
  content.append(...tagLinks.map(makeCard));
  const addCard = element('button', 'add-card');
  addCard.dataset.add = '';
  const mark = element('span', 'add-card-icon');
  mark.innerHTML = plusSvg;
  addCard.append(mark, element('span', 'add-card-label', tagLinks.length ? '添加网页' : '添加第一个网页'));
  addCard.addEventListener('click', () => openAdd(tag.id));
  if (!searchTerm) content.append(addCard);
  section.append(header, content);
  return section;
}

function updateManage() {
  for (const area of [groups, starredSection]) {
    area.classList.toggle('is-managing', managing);
    area.querySelectorAll('.edit-button, .remove-button, .move-control').forEach(control => { control.hidden = !managing; });
  }
  manageButton.setAttribute('aria-pressed', String(managing));
  manageButton.querySelector('span').textContent = managing ? '完成整理' : '整理网页';
  $('#workspace-hint').textContent = searchTerm
    ? `找到 ${matchingLinks().length} 个匹配的网页。`
    : managing ? '编辑网页名称和地址，调整所属标签，或移除网页。' : '点击星号置顶，点击标签折叠或展开。';
}

function render() {
  if (!links.length) managing = false;
  const matched = matchingLinks();
  const displayed = visibleTags(matched);
  $('#link-count').hidden = false;
  $('#link-count').textContent = searchTerm ? `${matched.length} / ${links.length}` : links.length;
  $('#link-count').setAttribute('aria-label', searchTerm ? `匹配 ${matched.length} 个，共 ${links.length} 个网页` : `${links.length} 个网页`);
  $('#empty-state').hidden = Boolean(searchTerm) || displayed.length > 0;
  $('#search-empty').hidden = !searchTerm || matched.length > 0;
  const starred = matched.filter(link => link.starred);
  starredSection.hidden = !starred.length;
  $('#starred-count').textContent = starred.length;
  starredGrid.replaceChildren(...starred.map(makeCard));
  groups.hidden = !displayed.length;
  groups.replaceChildren(...displayed.map(makeGroup));
  updateManage();
  updateCollapseUI();
  updateControls();
}

async function loadLinks() {
  loaded = false;
  $('#loading-state').hidden = false;
  $('#error-state').hidden = true;
  $('#empty-state').hidden = true;
  $('#search-empty').hidden = true;
  starredSection.hidden = true;
  groups.hidden = true;
  updateControls();
  try {
    const [data, session] = await Promise.all([api('/api/links'), api('/api/auth/session')]);
    if (leaving) return;
    watchSession(session);
    links = data.links;
    tags = data.tags;
    loaded = true;
    applySearch();
  } catch (error) {
    $('#load-error').textContent = error.message;
    $('#error-state').hidden = false;
  } finally {
    $('#loading-state').hidden = true;
  }
}

async function setCollapsed(collapsed, tagId) {
  if (groupBusy) return;
  // Searching changes only the result view; clearing the query restores saved folds.
  if (searchTerm) {
    for (const tag of visibleTags()) {
      if (!tagId || tag.id === tagId) {
        if (collapsed) searchCollapsedTags.add(tag.id);
        else searchCollapsedTags.delete(tag.id);
      }
    }
    updateCollapseUI();
    updateControls();
    return;
  }
  groupBusy = true;
  const before = tags;
  tags = tags.map(tag => !tagId || tag.id === tagId ? { ...tag, collapsed } : tag);
  updateCollapseUI();
  updateControls();
  try {
    await api(tagId ? `/api/tags/${tagId}` : '/api/tags', { method: 'PATCH', body: JSON.stringify({ collapsed }) });
  } catch (error) {
    tags = before;
    updateCollapseUI();
    showToast(error.message);
  } finally {
    groupBusy = false;
    updateControls();
  }
}

async function moveLink(original, select) {
  if (groupBusy || select.value === original.tagId) return;
  let destination;
  groupBusy = true;
  updateControls();
  try {
    const { link, tag } = await api(`/api/links/${original.id}`, { method: 'PATCH', body: JSON.stringify({ tagId: select.value }) });
    links = links.map(item => item.id === link.id ? link : item);
    tags = tags.map(item => item.id === tag.id ? tag : item);
    render();
    destination = tag.id;
    showToast(`已移到「${tag.name}」`);
  } catch (error) {
    select.value = original.tagId;
    showToast(error.message);
  } finally {
    groupBusy = false;
    updateControls();
    if (destination) document.getElementById(`tag-toggle-${destination}`)?.focus();
  }
}

function focusCardAction(id, action) {
  const target = Array.from(document.querySelectorAll(`[data-${action}]`))
    .find(button => button.dataset[action] === id && !button.closest('[hidden]'));
  (target || manageButton).focus({ preventScroll: true });
}

async function toggleStar(original) {
  if (groupBusy) return;
  groupBusy = true;
  updateControls();
  try {
    const { link } = await api(`/api/links/${original.id}`, {
      method: 'PATCH', body: JSON.stringify({ starred: !original.starred }),
    });
    links = links.map(item => item.id === link.id ? link : item);
    render();
    showToast(link.starred ? '已加入顶部星标网页' : '已取消星标');
  } catch (error) {
    showToast(error.message);
  } finally {
    groupBusy = false;
    updateControls();
    focusCardAction(original.id, 'star');
  }
}

function showToast(message) {
  clearTimeout(toastTimer);
  const toast = $('#toast');
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3000);
}

function openModal(dialog) {
  dialog.showModal();
  document.body.classList.add('modal-open');
}

function updatePreview() {
  const name = nameInput.value.trim();
  const icon = $('#preview-icon');
  icon.textContent = name ? Array.from(name)[0].toUpperCase() : 'A';
  let url = '';
  try { if (urlInput.value.trim()) url = normalizeUrl(urlInput.value); } catch {}
  icon.className = `app-icon ${toneFor(name || 'A', url)}`;
  $('#preview-name').textContent = name || '网页名称';
  $('#preview-url').textContent = url ? new URL(url).host : 'example.com';
  $('#form-error').hidden = true;
}

function openAdd(tagId = DEFAULT_TAG_ID) {
  openLinkForm(null, tagId);
}

function openLinkForm(link = null, tagId = DEFAULT_TAG_ID) {
  editingLink = link;
  form.reset();
  fillTagOptions(tagInput, link?.tagId ?? tagId);
  nameInput.value = link?.name ?? '';
  urlInput.value = link?.url ?? '';
  $('#add-title').textContent = link ? '编辑网页' : '添加网页';
  $('#add-description').textContent = link ? '修改名称、网址或所属标签。' : '给常用网页留一个位置。';
  $('#add-dialog .icon-button').setAttribute('aria-label', link ? '关闭编辑窗口' : '关闭添加窗口');
  setSaving(false);
  updatePreview();
  openModal(addDialog);
  nameInput.focus();
}

function setSaving(busy) {
  saving = busy;
  $('#save-button').textContent = editingLink
    ? (busy ? '正在保存…' : '保存修改')
    : (busy ? '正在添加…' : '添加网页');
  addDialog.querySelectorAll('input, select, button').forEach(control => { control.disabled = busy; });
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (saving) return;
  $('#form-error').hidden = true;
  try {
    const url = normalizeUrl(urlInput.value);
    setSaving(true);
    const payload = { name: nameInput.value.trim(), url, tagId: tagInput.value };
    if (editingLink) {
      for (const key of Object.keys(payload)) {
        if (payload[key] === editingLink[key]) delete payload[key];
      }
    }
    const { link, tag } = await api(editingLink ? `/api/links/${editingLink.id}` : '/api/links', {
      method: editingLink ? 'PATCH' : 'POST', body: JSON.stringify(payload),
    });
    if (editingLink) links = links.map(item => item.id === link.id ? link : item);
    else links.push(link);
    tags = tags.map(item => item.id === tag.id ? tag : item);
    render();
    addDialog.close();
    if (editingLink) focusCardAction(link.id, 'edit');
    else $('.header-add').focus();
    showToast(`已${editingLink ? '更新' : '添加'}「${link.name}」`);
  } catch (error) {
    $('#form-error').textContent = error.message;
    $('#form-error').hidden = false;
  } finally {
    setSaving(false);
  }
});

function openTag() {
  $('#tag-form').reset();
  $('#tag-error').hidden = true;
  openModal(tagDialog);
  $('#tag-name').focus();
}

$('#tag-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (creatingTag) return;
  creatingTag = true;
  $('#tag-error').hidden = true;
  tagDialog.querySelectorAll('input, button').forEach(control => { control.disabled = true; });
  $('#save-tag-button').textContent = '正在创建…';
  try {
    const { tag } = await api('/api/tags', { method: 'POST', body: JSON.stringify({ name: $('#tag-name').value.trim() }) });
    tags.push(tag);
    render();
    tagDialog.close();
    (document.getElementById(`tag-toggle-${tag.id}`) || $('#add-tag-button')).focus();
    showToast(`已创建标签「${tag.name}」`);
  } catch (error) {
    $('#tag-error').textContent = error.message;
    $('#tag-error').hidden = false;
  } finally {
    creatingTag = false;
    tagDialog.querySelectorAll('input, button').forEach(control => { control.disabled = false; });
    $('#save-tag-button').textContent = '创建标签';
  }
});

function openDelete(link) {
  pendingDelete = link;
  $('#delete-description').textContent = `「${link.name}」会从导航台移除，原网站不会受到影响。`;
  $('#delete-error').hidden = true;
  openModal(deleteDialog);
  $('#cancel-delete').focus();
}

$('#confirm-delete').addEventListener('click', async () => {
  if (deleting || !pendingDelete) return;
  deleting = true;
  const button = $('#confirm-delete');
  button.disabled = true;
  $('#cancel-delete').disabled = true;
  button.textContent = '正在移除…';
  try {
    await api(`/api/links/${pendingDelete.id}`, { method: 'DELETE' });
    links = links.filter(link => link.id !== pendingDelete.id);
    deleteDialog.close();
    render();
    (links.length ? manageButton : $('.header-add')).focus();
    showToast('网页已移除');
  } catch (error) {
    $('#delete-error').textContent = error.message;
    $('#delete-error').hidden = false;
  } finally {
    deleting = false;
    button.disabled = false;
    $('#cancel-delete').disabled = false;
    button.textContent = '确认移除';
  }
});

for (const dialog of [addDialog, deleteDialog, tagDialog]) {
  const busy = () => dialog === addDialog ? saving : dialog === tagDialog ? creatingTag : deleting;
  dialog.addEventListener('cancel', event => { if (busy()) event.preventDefault(); });
  dialog.addEventListener('click', event => {
    const rect = dialog.getBoundingClientRect();
    const outside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
    if (event.target === dialog && outside && !busy()) dialog.close();
  });
  dialog.addEventListener('close', () => document.body.classList.remove('modal-open'));
}

document.querySelectorAll('[data-add]').forEach(button => button.addEventListener('click', () => openAdd()));
document.querySelectorAll('.close-dialog').forEach(button => button.addEventListener('click', () => { if (!saving) addDialog.close(); }));
document.querySelectorAll('.close-tag-dialog').forEach(button => button.addEventListener('click', () => { if (!creatingTag) tagDialog.close(); }));
$('#add-tag-button').addEventListener('click', openTag);
$('#collapse-all').addEventListener('click', () => setCollapsed(true));
$('#expand-all').addEventListener('click', () => setCollapsed(false));
$('#cancel-delete').addEventListener('click', () => { if (!deleting) deleteDialog.close(); });
$('#retry-button').addEventListener('click', loadLinks);
searchInput.addEventListener('input', applySearch);
searchInput.addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.preventDefault(); clearSearch(); }
});
$('#search-form').addEventListener('submit', event => { event.preventDefault(); applySearch(); });
$('#clear-search').addEventListener('click', clearSearch);
$('#reset-search').addEventListener('click', clearSearch);
nameInput.addEventListener('input', updatePreview);
urlInput.addEventListener('input', updatePreview);
manageButton.addEventListener('click', () => { managing = !managing; updateManage(); });
$('#logout-button').addEventListener('click', async () => {
  const button = $('#logout-button');
  if (button.disabled || leaving) return;
  button.disabled = true;
  try {
    await api('/api/auth/logout', { method: 'POST' });
    returnToLogin();
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
});
window.addEventListener('pageshow', event => {
  if (event.persisted) {
    document.body.hidden = true;
    window.location.reload();
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkSession();
});
loadLinks();
