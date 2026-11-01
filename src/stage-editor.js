import './stage-editor.css';
import { ENVIRONMENTS, normalizeEnvironment } from './environments.js';
import { TRACKS } from './tracks.js';
import { normalizeSoundDesign } from './sound-design.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]));
const percent = value => `${Math.round(value * 100)}%`;
const shade = (hex, multiplier) => '#' + [1, 3, 5].map(index => Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(index, index + 2), 16) * multiplier))).toString(16).padStart(2, '0')).join('');

function palettePreview(environment) {
  const bright = environment.id === 'gallery';
  return `<svg class="st-palette-preview" viewBox="0 0 280 148" aria-hidden="true">
    <rect width="280" height="148" fill="${environment.background}"/>
    <path d="M0 85 280 66V148H0Z" fill="${environment.floor}"/>
    <path d="M34 123 247 103M27 109 218 92M69 148 194 77" fill="none" stroke="${bright ? '#302d26' : '#c6d4f1'}" opacity=".10" stroke-width=".7"/>
    <ellipse cx="152" cy="120" rx="61" ry="10" fill="${bright ? '#3e3b34' : '#03060c'}" opacity=".20"/>
    <path d="M92 70 140 47 188 69 140 94Z" fill="${environment.keyColor}"/>
    <path d="M92 70 140 94V124L92 100Z" fill="${shade(environment.fillColor, .69)}"/>
    <path d="M140 94 188 69V99L140 124Z" fill="${shade(environment.keyColor, .71)}"/>
    <circle cx="205" cy="93" r="17" fill="${environment.fillColor}"/>
    <circle cx="200" cy="87" r="4" fill="${environment.keyColor}" opacity=".8"/>
    <rect x="22" y="18" width="34" height="2" rx="1" fill="${environment.keyColor}"/>
    <rect x="22" y="25" width="20" height="2" rx="1" fill="${environment.fillColor}" opacity=".65"/>
  </svg>`;
}

/** A draft-only editor. The host owns persistence and merges this partial patch. */
export function mountStageEditor({ getState, commit, notify = () => {}, icons = () => {} }) {
  if (typeof getState !== 'function' || typeof commit !== 'function') throw new Error('Stage editor needs getState() and commit()');
  if (document.getElementById('stage-editor-dialog')) throw new Error('Stage editor is already mounted');
  const collections = [...new Set(TRACKS.map(track => track.collection))];
  const dialog = document.createElement('dialog');
  dialog.id = 'stage-editor-dialog';
  dialog.className = 'stage-editor';
  dialog.setAttribute('aria-labelledby', 'stage-editor-title');
  dialog.innerHTML = `
    <header class="st-header">
      <div><div class="st-eyebrow">НАСТРОЙКИ СЦЕНЫ</div><h2 id="stage-editor-title">Оформление и звук</h2><p>Освещение, палитра, звук и титры.</p></div>
      <button type="button" class="st-close" id="stage-editor-close" aria-label="Закрыть без сохранения"><i data-lucide="x"></i></button>
    </header>
    <form id="stage-editor-form">
      <div class="st-scroll">
        <fieldset class="st-fields" id="stage-editor-fields">
          <section class="st-section" aria-labelledby="stage-light-title">
            <div class="st-section-heading"><span class="st-number">01</span><div><h3 id="stage-light-title">Освещение и палитра</h3><p>Выберите схему освещения и задайте цвета фона и пола.</p></div></div>
            <div class="st-environments" role="group" aria-label="Схема освещения">
              ${ENVIRONMENTS.map(environment => `<button type="button" class="st-environment" data-stage-environment="${environment.id}" aria-pressed="false">${palettePreview(environment)}<span class="st-environment-copy"><span class="st-environment-title">${escape(environment.name)}<span class="st-chosen" aria-hidden="true"><i data-lucide="check"></i></span></span><span class="st-environment-description">${escape({studio:'Тёмный фон, тёплый ключевой свет',gallery:'Светлый фон, мягкие тени',arena:'Тёмный фон, холодный заполняющий свет'}[environment.id]||environment.description)}</span><span class="st-palette-swatches" aria-hidden="true"><span style="background:${environment.background}"></span><span style="background:${environment.floor}"></span><span style="background:${environment.keyColor}"></span><span style="background:${environment.fillColor}"></span></span></span></button>`).join('')}
            </div>
            <div class="st-palette-controls">
              <label class="st-color-control"><span>Фон</span><span class="st-color-input"><input id="stage-background" type="color" aria-label="Цвет фона"/><output id="stage-background-value"></output></span></label>
              <label class="st-color-control"><span>Пол</span><span class="st-color-input"><input id="stage-floor" type="color" aria-label="Цвет пола"/><output id="stage-floor-value"></output></span></label>
              <label class="st-range-control st-exposure-control" for="stage-exposure"><span>Экспозиция<output id="stage-exposure-value"></output></span><input id="stage-exposure" type="range" min="-1" max="1" step=".01"/><span class="st-range-ends"><span>Темнее</span><span>Светлее</span></span></label>
            </div>
            <button type="button" class="st-text-button" id="stage-reset-palette"><i data-lucide="rotate-ccw"></i>Вернуть цвета схемы</button>
          </section>
          <section class="st-section" aria-labelledby="stage-sound-title">
            <div class="st-section-heading"><span class="st-number">02</span><div><h3 id="stage-sound-title">Звук</h3><p>Уровни музыки, эффектов и фонового звука.</p></div><span class="st-section-meta">Композиции: ${TRACKS.length}</span></div>
            <div class="st-track-panel">
              <div class="st-track-select"><label for="stage-track">Музыка</label><select id="stage-track">${collections.map(collection => `<optgroup label="${escape(collection)}">${TRACKS.filter(track => track.collection === collection).map(track => `<option value="${track.id}">${escape(track.title)}</option>`).join('')}</optgroup>`).join('')}</select></div>
              <div class="st-player"><div class="st-player-label"><i data-lucide="headphones"></i><span>Предпрослушивание</span><span id="stage-track-details"></span></div><audio id="stage-track-audio" controls preload="none" aria-label="Прослушивание выбранной композиции"></audio><p class="st-audio-error" id="stage-audio-error" role="status" hidden>Не удалось загрузить аудиофайл.</p></div>
            </div>
            <div class="st-mix-controls">
              <label class="st-range-control" for="stage-music-gain"><span>Громкость музыки<output id="stage-music-gain-value"></output></span><input id="stage-music-gain" type="range" min="0" max="150" step="1"/><span class="st-range-ends"><span>Без музыки</span><span>150%</span></span></label>
              <label class="st-range-control" for="stage-effects-gain"><span>Эффекты столкновений<output id="stage-effects-gain-value"></output></span><input id="stage-effects-gain" type="range" min="0" max="150" step="1"/><span class="st-range-ends"><span>Без эффектов</span><span>150%</span></span></label>
            </div>
            <div class="st-sound-options">
              <label class="st-check"><input id="stage-ducking" type="checkbox"/><span><strong>Приглушение музыки при столкновениях</strong><small>Уровень музыки восстанавливается после эффекта.</small></span></label>
              <label class="st-check"><input id="stage-ambience" type="checkbox"/><span><strong>Фоновый звук сцены</strong><small>Синтезированный фон по активности сцены. Выключен по умолчанию.</small></span></label>
            </div>
          </section>
          <section class="st-section st-caption-section" aria-labelledby="stage-caption-title">
            <div class="st-section-heading"><span class="st-number">03</span><div><h3 id="stage-caption-title">Графика в кадре</h3></div></div>
            <label class="st-check st-caption-toggle"><input id="stage-captions" type="checkbox"/><span><strong>Показывать титры и измерения</strong><small>Тексты и показатели настраиваются в редакторе ролика.</small></span><i data-lucide="captions"></i></label>
          </section>
        </fieldset>
        <p id="stage-editor-error" class="st-error" role="alert" hidden></p>
      </div>
      <footer class="st-footer"><span>Изменения применяются после сохранения.</span><button type="button" class="st-button st-cancel" id="stage-editor-cancel">Отмена</button><button type="submit" class="st-button st-save" id="stage-editor-save"><i data-lucide="check"></i><span>Сохранить настройки</span></button></footer>
    </form>`;
  document.body.appendChild(dialog);
  const $ = id => dialog.querySelector(`#${id}`);
  const audio = $('stage-track-audio');
  let environment, soundDesign, musicTrack, busy = false, duckingAmount = .55;
  let audioContext = null, audioSource = null, audioGain = null;
  const settingsNow = () => { const state = getState(); return state?.settings || state || {}; };

  function stopAudio(clear = false) {
    audio.pause();
    try { audio.currentTime = 0; } catch { /* Some browsers have not loaded metadata. */ }
    if (clear) {
      audio.removeAttribute('src'); audio.load();
      if (audioContext?.state === 'running') audioContext.suspend().catch(() => {});
    }
  }

  function updatePreviewGain() {
    if (audioGain) audioGain.gain.value = soundDesign.musicGain;
    else audio.volume = Math.min(1, soundDesign.musicGain);
  }

  // Native controls remain available. A gain node also previews values >100%.
  audio.addEventListener('play', () => {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (Context && !audioContext) {
      try {
        audioContext = new Context();
        audioSource = audioContext.createMediaElementSource(audio);
        audioGain = audioContext.createGain();
        audioSource.connect(audioGain); audioGain.connect(audioContext.destination);
        audio.volume = 1;
      } catch { audioContext = null; audioSource = null; audioGain = null; }
    }
    updatePreviewGain();
    if (audioContext?.state === 'suspended') audioContext.resume().catch(() => {});
  });
  audio.addEventListener('error', () => { $('stage-audio-error').hidden = !audio.getAttribute('src'); });

  function renderEnvironment() {
    for (const button of dialog.querySelectorAll('[data-stage-environment]')) {
      const selected = button.dataset.stageEnvironment === environment.id;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
      const palette = selected ? environment : ENVIRONMENTS.find(preset => preset.id === button.dataset.stageEnvironment);
      button.querySelector('.st-palette-preview').outerHTML = palettePreview(palette);
      [...button.querySelectorAll('.st-palette-swatches>span')].forEach((swatch, index) => { swatch.style.background = [palette.background, palette.floor, palette.keyColor, palette.fillColor][index]; });
    }
    $('stage-background').value = environment.background;
    $('stage-floor').value = environment.floor;
    $('stage-background-value').textContent = environment.background.toUpperCase();
    $('stage-floor-value').textContent = environment.floor.toUpperCase();
    $('stage-exposure').value = environment.exposure;
    $('stage-exposure-value').textContent = `${environment.exposure > 0 ? '+' : ''}${environment.exposure.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}`;
  }

  function renderSound() {
    $('stage-music-gain').value = Math.round(soundDesign.musicGain * 100);
    $('stage-effects-gain').value = Math.round(soundDesign.effectsGain * 100);
    $('stage-music-gain-value').textContent = percent(soundDesign.musicGain);
    $('stage-effects-gain-value').textContent = percent(soundDesign.effectsGain);
    $('stage-ducking').checked = soundDesign.ducking > 0;
    $('stage-ambience').checked = soundDesign.ambience === 'activity';
    updatePreviewGain();
  }

  function changeTrack(id) {
    const track = TRACKS.find(item => item.id === id) || TRACKS[0];
    stopAudio(); musicTrack = track.id;
    $('stage-track').value = track.id;
    $('stage-track-details').textContent = track.artist?`${track.artist} · ${track.license}`:`${track.collection} · ${track.bpm} BPM`;
    $('stage-audio-error').hidden = true;
    audio.src = track.url; audio.load(); updatePreviewGain();
  }

  function setBusy(value) {
    busy = value;
    audio.controls = !value;
    dialog.setAttribute('aria-busy', String(value));
    for (const id of ['stage-editor-fields', 'stage-editor-save', 'stage-editor-cancel', 'stage-editor-close']) $(id).disabled = value;
    $('stage-editor-save').querySelector('span').textContent = value ? 'Сохранение…' : 'Сохранить настройки';
  }

  function open() {
    if (dialog.open || busy) return;
    const settings = settingsNow();
    environment = normalizeEnvironment(settings.environment || ENVIRONMENTS[0].id);
    soundDesign = normalizeSoundDesign(settings.soundDesign);
    duckingAmount = soundDesign.ducking || .55;
    $('stage-captions').checked = settings.story?.enabled !== false;
    $('stage-editor-error').hidden = true;
    renderEnvironment(); renderSound(); changeTrack(settings.musicTrack);
    setBusy(false); dialog.showModal();
    dialog.querySelector('.st-scroll').scrollTop = 0;
    dialog.querySelector('[data-stage-environment].is-selected')?.focus({ preventScroll: true });
    icons();
  }

  function close() { if (!busy && dialog.open) { stopAudio(true); dialog.close(); } }

  async function save(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); stopAudio(); $('stage-editor-error').hidden = true;
    const patch = {
      environment: normalizeEnvironment(environment),
      soundDesign: normalizeSoundDesign(soundDesign), musicTrack,
      story: { ...structuredClone(settingsNow().story || {}), enabled: $('stage-captions').checked },
    };
    try {
      await commit(patch); dialog.close(); notify('Оформление и звук сохранены.');
    } catch (error) {
      $('stage-editor-error').textContent = error?.message || 'Не удалось сохранить настройки.';
      $('stage-editor-error').hidden = false;
    } finally { setBusy(false); }
  }

  for (const button of dialog.querySelectorAll('[data-stage-environment]')) button.addEventListener('click', () => {
    environment = normalizeEnvironment(button.dataset.stageEnvironment); renderEnvironment();
  });
  for (const [id, key] of [['stage-background', 'background'], ['stage-floor', 'floor']]) $(id).addEventListener('input', event => {
    environment = normalizeEnvironment({ ...environment, [key]: event.target.value }); renderEnvironment();
  });
  $('stage-exposure').addEventListener('input', event => { environment = normalizeEnvironment({ ...environment, exposure: Number(event.target.value) }); renderEnvironment(); });
  $('stage-reset-palette').addEventListener('click', () => { environment = normalizeEnvironment({ id: environment.id, exposure: environment.exposure }); renderEnvironment(); });
  $('stage-track').addEventListener('change', event => changeTrack(event.target.value));
  for (const [id, key] of [['stage-music-gain', 'musicGain'], ['stage-effects-gain', 'effectsGain']]) $(id).addEventListener('input', event => {
    soundDesign = normalizeSoundDesign({ ...soundDesign, [key]: Number(event.target.value) / 100 }); renderSound();
  });
  $('stage-ducking').addEventListener('change', event => { soundDesign.ducking = event.target.checked ? duckingAmount : 0; });
  $('stage-ambience').addEventListener('change', event => { soundDesign.ambience = event.target.checked ? 'activity' : 'off'; });
  $('stage-editor-close').addEventListener('click', close);
  $('stage-editor-cancel').addEventListener('click', close);
  $('stage-editor-form').addEventListener('submit', save);
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); else stopAudio(true); });
  dialog.addEventListener('close', () => { if (!dialog.open) stopAudio(true); });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
  });
  icons();
  return { open, close };
}
