import './project-library.css';
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]));
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value);
const date = value => {
  const time = new Date(value);
  return Number.isFinite(time.getTime()) ? time.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
};

/** Server-backed local library; JSON import/export stays available separately. */
export function mountProjectLibrary({ getState, applyProject, notify = () => {}, icons = () => {}, onSaved = () => {} }) {

  document.body.insertAdjacentHTML('beforeend', `<dialog id="project-library-dialog" class="project-library-dialog" aria-labelledby="project-library-title"><div class="dialog-head"><div><h2 id="project-library-title">Проекты</h2><p class="project-library-subtitle">Сохранённые сцены и монтажи</p></div><button type="button" id="project-library-close" aria-label="Закрыть проекты"><i data-lucide="x"></i></button></div><div class="project-library-tools"><label class="project-library-search"><i data-lucide="search"></i><input id="project-library-search" type="search" placeholder="Поиск по названию" aria-label="Поиск проектов"/></label><button type="button" id="project-library-refresh" class="toolbar-button icon-only" aria-label="Обновить список"><i data-lucide="refresh-cw"></i></button></div><div class="project-library-content"><p id="project-library-status" class="project-library-status" role="status" aria-live="polite"></p><div id="project-library-list" class="project-library-list"></div><div id="project-library-message" class="project-library-message" hidden></div></div><div class="dialog-actions"><button type="button" id="project-library-import" class="toolbar-button"><i data-lucide="file-up"></i>Импорт JSON</button><button type="button" id="project-library-download" class="toolbar-button"><i data-lucide="download"></i>Скачать проект</button><button type="button" id="project-library-save" class="toolbar-button primary"><i data-lucide="save"></i>Сохранить текущий</button></div></dialog>`);
  const $ = id => document.getElementById(`project-library-${id}`), dialog = $('dialog');
  let projects = [], loading = false, opening = false, saving = null, generation = 0;

  async function request(url, options) {
    const response = await fetch(url, { cache: 'no-store', ...options });
    let payload;
    try { payload = await response.json(); }
    catch { throw new Error('Сервер вернул нечитаемый ответ.'); }
    if (!response.ok) throw new Error(payload.error || 'Не удалось выполнить запрос.');
    return payload;
  }
  function message(title, detail = '', failed = false) {
    $('message').innerHTML = `<strong>${escape(title)}</strong>${escape(detail)}`;
    $('message').hidden = false; $('message').classList.toggle('project-library-error', failed);
  }
  function draw() {
    const query = $('search').value.trim().toLocaleLowerCase('ru-RU'), visible = projects.filter(item => String(item.name).toLocaleLowerCase('ru-RU').includes(query));
    $('list').innerHTML = visible.map(item => `<button type="button" class="project-library-row" data-project-id="${escape(item.id)}" ${opening ? 'disabled' : ''} aria-label="Открыть ${escape(item.name)}"><span class="project-library-symbol"><i data-lucide="${item.clips ? 'clapperboard' : 'box'}"></i></span><span class="project-library-row-copy"><span class="project-library-name">${escape(item.name)}</span><span class="project-library-meta"><span>${Number(item.objects) || 0} объектов${item.clips ? ` · ${Number(item.clips)} клипов` : ''}</span><time datetime="${escape(item.updated)}">${escape(date(item.updated))}</time></span></span><i data-lucide="arrow-up-right" class="project-library-arrow"></i></button>`).join('');
    $('message').hidden = true;
    if (!visible.length && !loading) message(projects.length ? 'Совпадений нет' : 'Нет сохранённых проектов', projects.length ? 'Попробуйте другое название.' : 'Сохраните текущую сцену или импортируйте JSON.');
    icons();
  }
  async function refresh() {
    const current = ++generation; loading = true; $('refresh').disabled = true;
    $('status').textContent = 'Загружаем проекты…'; $('message').hidden = true;
    try {
      const payload = await request('/api/projects'), list = Array.isArray(payload) ? payload : payload.projects;
      if (!Array.isArray(list)) throw new Error('Не удалось прочитать список проектов.');
      if (current !== generation) return;
      projects = list.filter(item => item && validId(item.id)); loading = false; draw();
      $('status').textContent = `${projects.length} сохранено`;
    } catch (cause) {
      if (current !== generation) return;
      $('list').replaceChildren(); $('status').textContent = '';
      message('Проекты недоступны', cause.message, true);
    } finally { if (current === generation) { loading = false; $('refresh').disabled = false; } }
  }
  async function openProject(id) {
    if (!validId(id) || opening) return;
    opening = true; draw(); $('status').textContent = 'Открываем проект…';
    try {
      const payload = await request(`/api/projects/${encodeURIComponent(id)}`), project = payload.project || payload;
      await applyProject({ ...project, id }); dialog.close();
      notify('Проект открыт.');
    } catch (cause) { $('status').textContent = cause.message; notify(`Не удалось открыть проект: ${cause.message}`); }
    finally { opening = false; draw(); }
  }
  function save(options = {}) {
    if (saving) return saving;
    saving = (async () => {
      $('save').disabled = true;
      try {
        const project = structuredClone(getState()), id = options.id ?? project.id;
        const payload = await request('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project, ...(id === undefined ? {} : { id }) }) });
        const saved = payload.metadata || payload;
        if (!validId(saved.id)) throw new Error('Сервер не вернул идентификатор проекта.');
        await onSaved(saved);
        notify('Проект сохранён.');
        if (dialog.open) await refresh();
        return saved;
      } catch (cause) { notify(`Не удалось сохранить проект: ${cause.message}`); return null; }
      finally { $('save').disabled = false; saving = null; }
    })();
    return saving;
  }
  function download() {
    try {
      const project = getState(), blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }), url = URL.createObjectURL(blob), link = document.createElement('a');
      const name = String(project.name || 'matter-lab-project').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').slice(0, 100);
      link.href = url; link.download = `${name}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { notify(`Не удалось скачать проект: ${cause.message}`); }
  }
  function openLibrary() { if (!dialog.open) dialog.showModal(); void refresh(); }
  $('close').onclick = () => dialog.close();
  $('refresh').onclick = () => void refresh();
  $('search').oninput = draw;
  $('save').onclick = () => void save();
  $('download').onclick = download;
  $('import').onclick = () => {
    const input = document.getElementById('project-file');
    if (!input) { notify('Импорт проектов недоступен.'); return; }
    dialog.close(); input.click();
  };
  $('list').onclick = event => { const row = event.target.closest('[data-project-id]'); if (row) void openProject(row.dataset.projectId); };
  icons();
  return { open: openLibrary, refresh, save, saveProject: save, download };
}
