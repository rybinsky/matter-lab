import './style.css';
import './studio.css';
import './premium.css';
import './export-queue.css';
import './project-templates.css';
import {mountProjectTemplates} from './project-templates.js';
import './connection-editor.css';
import {mountConnectionEditor} from './connection-editor.js';
import * as THREE from 'three';
import { createIcons, icons } from 'lucide';
import { initializePhysics, LabWorld } from './physics.js';
import { CATALOG, CATEGORIES, MATERIALS, EXPERIMENTS, settingsFor } from './catalog.js';
import { LabView, thumbnail } from './visuals.js';
import { TRACKS } from './tracks.js';
import { mountComposer } from './composer.js';
import { mountStoryEditor } from './story-editor.js';
import { mountWorkspaceShell } from './workspace-shell.js';
import { mountRehearsal } from './rehearsal.js';
import { mountComparisonEditor } from './comparison-editor.js';
import { comparisonVariants } from './comparison.js';
import { validateProject } from './validation.js';
import { objectLabelMap, objectLabel } from './object-labels.js';
import { mountCameraStudio } from './camera-studio.js';
import { normalizeCameraRig } from './camera-rig.js';
import { SCENARIO_KITS, createScenarioKit } from './scenario-kits.js';
import { ENVIRONMENTS, normalizeEnvironment } from './environments.js';
import { mountStageEditor } from './stage-editor.js';
import { normalizeFilm, validateFilm, filmDuration, prepareFilmClipEditorProject } from './film.js';
import { mountFilmStudio } from './film-studio.js';
import { mountProjectLibrary } from './project-library.js';
import { mountScenePicker } from './scene-picker.js';
import { mountInteractionEditor } from './interaction-editor.js';
import { mountContextViewEditor } from './context-view-editor.js';
import {mountToolbarOverflow,mountScrollCue} from './toolbar-overflow.js';
import {mountSceneAnnotationEditor} from './scene-annotation-editor.js';
import './authoring.css';
import './gallery.css';

const $=s=>document.querySelector(s);
const icon=(name)=>`<i data-lucide="${name}" aria-hidden="true"></i>`;
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
document.querySelector('#app').innerHTML=`
<div class="app-shell">
 <header class="topbar">
  <a class="brand" href="#" aria-label="Matter Lab — лаборатория"><span class="brand-mark">${icon('boxes')}</span><span class="brand-name">matter<span>lab</span></span></a>
  <span class="top-divider"></span>
  <nav class="mode-nav" aria-label="Разделы"><button class="active" data-mode="editor">Лаборатория</button><button data-mode="gallery">Видеостудия <span id="video-count"></span></button></nav>
  <div class="top-spacer"></div><div class="local-status"><span class="status-dot"></span>Личная студия</div>
  <div class="top-actions"><button id="help-top" class="toolbar-button icon-only" aria-label="Помощь">${icon('circle-help')}</button><button class="toolbar-button" id="save-project">${icon('save')}<span class="save-label">Сохранить</span></button><button class="toolbar-button primary" id="export-top">${icon('clapperboard')}Экспорт видео</button></div>
 </header>
 <main class="workspace" id="workspace">
  <aside class="library" aria-label="Библиотека предметов">
   <div class="panel-top"><span class="panel-title">Библиотека объектов</span></div>
   <div class="panel-tabs"><button class="active" data-library="catalog">Предметы <span id="asset-count" class="panel-count">36</span></button><button data-library="tree">Сцена <span id="tree-count" class="panel-count">0</span></button></div>
   <label class="search-box">${icon('search')}<input id="asset-search" placeholder="Найти предмет…" aria-label="Найти предмет" /></label>
   <div class="category-row" id="categories"></div><div class="catalog-grid" id="catalog"></div><div class="tree hidden" id="tree"></div>
   <div class="library-foot">${icon('mouse-pointer-2')}Добавление: щелчок или перетаскивание в сцену</div>
  </aside>
  <section class="stage-column" aria-label="Редактор эксперимента">
   <div class="scene-toolbar"><div class="scene-info"><div class="eyebrow">ЭКСПЕРИМЕНТ <span id="experiment-number">01</span></div><select class="scene-select" id="experiment-select" aria-label="Выбрать эксперимент">${EXPERIMENTS.map(e=>`<option value="${e.id}">${e.title}</option>`).join('')}<option value="blank">Свободная студия</option></select></div>
    <div class="scene-tools"><button id="undo" aria-label="Отменить" data-tooltip="Отменить">${icon('undo-2')}</button><button id="redo" aria-label="Повторить">${icon('redo-2')}</button><button id="translate" class="active" aria-label="Перемещение">${icon('move')}</button><button id="rotate" aria-label="Вращение">${icon('rotate-3d')}</button><button id="array" aria-label="Создать массив предметов">${icon('grid-2x2-plus')}</button><button id="grid-toggle" class="active" aria-label="Сетка">${icon('grid-3x3')}</button><button id="open-project" aria-label="Открыть проект">${icon('folder-open')}</button></div>
   </div>
   <div class="preset-strip" id="presets"></div>
   <div class="viewport-wrap" id="viewport-wrap">
    <div class="viewport" id="viewport"></div>
    <div class="viewport-label"><span class="tag" id="physics-tag">Твёрдые тела</span><span id="scene-state">Готов к запуску</span></div>
    <div class="view-controls"><button class="active" data-camera="perspective">Перспектива</button><button data-camera="front">Спереди</button><button data-camera="top">Сверху</button></div>
    <div class="selected-label" id="selected-label" hidden>${icon('mouse-pointer-2')}<b id="selected-name"></b><span>выбран</span></div>
    <div class="physics-note" id="physics-note" hidden></div>
    <div class="stage-bottom"><span><kbd>ЛКМ</kbd>вращение</span><span><kbd>ПКМ</kbd>перемещение</span><span><kbd>Пробел</kbd>старт / пауза</span></div>
    <div class="stage-loading" id="loading"><div><div class="spinner"></div>Подготовка лаборатории…</div></div>
   </div>
   <div class="playback"><div class="playback-top"><button class="play-button" id="play" aria-label="Запустить симуляцию">${icon('play')}</button><button class="small-button" id="reset" aria-label="Сначала">${icon('rotate-ccw')}</button><button class="small-button" id="step" aria-label="На один кадр">${icon('step-forward')}</button><span class="time-display" id="time">00:00.00</span><input class="timeline" id="timeline" type="range" min="0" max="20" step=".05" value="0" aria-label="Время эксперимента"/><select class="speed-select" id="playback-speed" aria-label="Скорость воспроизведения"><option value=".25">0,25×</option><option value=".5">0,5×</option><option value="1" selected>1×</option><option value="2">2×</option></select><button class="small-button" id="sound" aria-label="Включить звук">${icon('volume-x')}</button><button class="small-button" id="screenshot" aria-label="Сохранить кадр">${icon('camera')}</button></div>
    <div class="playback-bottom"><span><span class="dot"></span><strong id="body-count">0</strong> предметов</span><span class="moving-label">В движении <strong id="moving-count">0</strong></span><span class="energy-label">Кинетическая энергия <strong id="energy">0 Дж</strong></span><span class="spacer"></span><span class="fps-label" id="fps">— FPS</span><button id="models-help">Модели физики</button></div>
   </div>
  </section>
  <aside class="inspector" aria-label="Свойства и воздействия">
   <div class="inspector-header"><h3 id="inspector-title">Настройки опыта</h3><span class="selection-icon">${icon('sliders-horizontal')}</span></div>
   <div class="inspector-scroll">
    <div class="property-section" id="selection-properties" hidden><div class="section-heading">${icon('box')}Предмет<span class="right" id="object-type"></span></div><div class="property-label">Материал</div><select id="object-material" class="field" aria-label="Материал предмета"></select><div class="property-row"><label for="object-mass">Масса</label><input class="field" id="object-mass" type="number" min=".001" max="1000000" step=".01" value="3" aria-label="Масса в килограммах"/><span>кг</span></div><div class="property-label">Положение, м</div><div class="field-grid">${['x','y','z'].map(a=>`<label class="axis-field"><span>${a.toUpperCase()}</span><input id="position-${a}" type="number" step=".1" aria-label="Положение ${a}"/></label>`).join('')}</div><div class="property-row"><label class="check-row"><input id="fixed-object" type="checkbox"/>Закрепить в пространстве</label></div><div class="property-actions"><button id="duplicate" class="toolbar-button">${icon('copy')}Копия</button><button id="delete-object" class="toolbar-button">${icon('trash-2')}Удалить</button></div></div>
    <div class="property-section" id="recipe-properties"></div>
    <div class="property-section"><div class="section-heading">${icon('navigation')}Начальное движение<span class="right">м / с</span></div><label class="property-label" for="speed">Скорость <output id="speed-value">8,0 м/с</output></label><input id="speed" class="property-range" type="range" min="0" max="24" step=".25" value="8"/><label class="property-label" for="azimuth">Азимут <output id="azimuth-value">180°</output></label><input id="azimuth" class="property-range" type="range" min="0" max="360" step="1" value="180"/><label class="property-label" for="elevation">Угол возвышения <output id="elevation-value">0°</output></label><input id="elevation" class="property-range" type="range" min="-45" max="80" step="1" value="0"/><div class="direction-preview"><span class="direction-arrow" id="direction-arrow">${icon('arrow-up-right')}</span><span id="direction-text">Бросок в глубину сцены</span></div><button class="launch-button" id="launch">${icon('send')}Бросить выбранный предмет</button><div class="material-hint" id="launch-hint">Без выбора предмета запускается снаряд опыта.</div></div>
    <div class="property-section"><div class="section-heading">${icon('orbit')}Мир</div><label class="property-label" for="gravity">Гравитация <output id="gravity-value">9,81 м/с²</output></label><input class="property-range" id="gravity" type="range" min="0" max="20" step=".01" value="9.81"/><div class="property-actions"><button class="toolbar-button" id="earth">Земля</button><button class="toolbar-button" id="moon">Луна</button><button class="toolbar-button" id="zero-g">Невесомость</button></div><div class="property-row"><label class="check-row"><input type="checkbox" id="show-grid" checked/>Показывать сетку</label></div><button class="toolbar-button" id="blank-scene" style="width:100%;margin-top:10px">${icon('plus')}Новая свободная сцена</button></div>
   </div><div class="inspector-foot">${icon('hard-drive')}Проект сохраняется на этом компьютере</div>
  </aside>
 </main>
 <section class="gallery hidden" id="gallery"><div class="gallery-heading"><div><div class="eyebrow">МЕДИАТЕКА</div><h1>Видеостудия</h1><p>Экспортированные видео и исходные сцены.</p></div><button class="toolbar-button" id="refresh-gallery">${icon('refresh-cw')}Обновить</button></div><div class="reel-grid" id="reels"></div><p class="gallery-callout">Формат экспорта: MP4. Исходные сцены сохраняют объекты, параметры симуляции и монтаж.</p></section>
</div>
<input type="file" accept="application/json,.json" id="project-file" hidden/>
<dialog id="help-dialog"><div class="dialog-head"><h2>Справка по студии</h2><button data-close="help-dialog" aria-label="Закрыть">${icon('x')}</button></div><div class="dialog-body"><p>Matter Lab — локальный редактор сцен. Создание и редактирование сцен, расчёт взаимодействий и экспорт видео.</p><h4>Управление</h4><p>Левая кнопка мыши — вращать камеру; правая — перемещать. Колесо — масштаб. Нажмите на предмет для выбора; стрелки манипулятора меняют положение. G — перемещение, R — вращение, Delete — удаление, пробел — старт и пауза.</p><h4>Твёрдые, мягкие и пластичные тела</h4><p>Расчёт выполняет <a href="https://rapier.rs/docs/user_guides/javascript/soft_bodies/" target="_blank" rel="noreferrer">Rapier 0.21</a>: столкновения, трение, импульсы, шарниры, деформируемый объём и остаточная деформация. У мягких тел отдельная объёмная сетка; вмятины пластилина остаются в расчёте.</p><h4>Материалы</h4><p>Плотности основаны на типичных справочных значениях. Трение, отскок, жёсткость и пластичность — настроенные приближённые пресеты. Контактный материал «Лёд» задаёт скольжение твёрдого тела. Нагрев и плавление включаются отдельной моделью теплообмена. «Резина» задаёт упругий контакт; объёмную деформацию нужно включить у поддерживаемой замкнутой оболочки. Значения пресетов не являются измерениями конкретного бытового предмета.</p><h4>Жидкость</h4><p>Отдельная модель частиц по <a href="https://doi.org/10.1145/1073368.1073400" target="_blank" rel="noreferrer">Double Density Relaxation (Clavet et al., 2005)</a> рассчитывает давление соседей, гравитацию и вязкость. Подготовленные желоб и резервуар ограничивают поток. Обратное воздействие жидкости на динамические предметы, плавучесть и теплоперенос пока не включены.</p><h4>Проникновение и разрушение</h4><p>Осевая модель проникновения рассчитывает эффективное сопротивление и конечный запас тепла. Она не рассчитывает трёхмерные трещины, пар и изменение формы снаряда; её коэффициенты требуют проверки для реального образца. Разрываемые связи используют распределение контактных нагрузок по графу, а не точные напряжения материала. Для количественного предсказания реального опыта нужны проверенные свойства и проверка применимости модели.</p><h4>Видеорендер</h4><p>Физика редактора и экспортера общая. Экспортер сохраняет положения и деформации и передаёт их отдельному локальному рендереру. Изменение света или камеры не меняет сохранённый исход опыта.</p></div><div class="dialog-actions"><button class="toolbar-button primary" data-close="help-dialog">Закрыть</button></div></dialog>
<dialog id="export-dialog"><div class="dialog-head"><h2>Экспорт видео</h2><button data-close="export-dialog" aria-label="Закрыть">${icon('x')}</button></div><div class="dialog-body"><p id="export-scene-title"></p><div class="property-row"><label for="export-series">Монтаж</label><select id="export-series" class="field" style="width:240px"><option value="series">4 варианта · 60 секунд</option><option value="single">Текущий дубль · 20 секунд</option></select></div><div class="property-row"><label for="export-resolution">Размер кадра</label><select id="export-resolution" class="field" style="width:240px"><option value="1080">1080 × 1920 · Full HD</option><option value="720">720 × 1280 · быстрый рендер</option></select></div><p class="material-hint">Сохранённый MP4 появится в видеостудии. Рендер выполняется локально и может занять несколько минут. Расчёт идёт независимо от воспроизведения редактора.</p><div id="export-status" hidden><div class="export-progress"><div id="export-bar" style="width:0%"></div></div><div class="export-detail" id="export-detail" aria-live="polite">Подготовка…</div></div></div><div class="dialog-actions"><button class="toolbar-button" data-close="export-dialog">Закрыть</button><button class="toolbar-button primary" id="start-export">${icon('clapperboard')}Начать рендер</button></div></dialog>
<dialog id="array-dialog"><div class="dialog-head"><h2>Построить из предметов</h2><button data-close="array-dialog" aria-label="Закрыть">${icon('x')}</button></div><div class="dialog-body"><p>Создайте ряд или стену из копий выделенного предмета.</p><div class="property-row"><label for="array-columns">Предметов в ряду</label><input class="field" id="array-columns" type="number" min="1" max="12" value="5"/></div><div class="property-row"><label for="array-rows">Рядов вверх</label><input class="field" id="array-rows" type="number" min="1" max="8" value="3"/></div><div class="property-row"><label for="array-spacing">Шаг, м</label><input class="field" id="array-spacing" type="number" min=".2" max="4" step=".1" value="1.1"/></div></div><div class="dialog-actions"><button class="toolbar-button" data-close="array-dialog">Отмена</button><button class="toolbar-button primary" id="create-array">Построить</button></div></dialog>
<div class="toast" id="toast" role="status" hidden></div>`;

function refreshIcons(){createIcons({icons,attrs:{'stroke-width':1.6}});}
refreshIcons();
// The soundtrack library is shared with the exporter, so previews and renders
// use the same composition rather than an unrelated background audio file.
document.body.insertAdjacentHTML('beforeend',`<dialog id="music-dialog" class="music-dialog"><div class="dialog-head"><div><div class="eyebrow">ЗВУКОВАЯ БИБЛИОТЕКА</div><h2>Музыкальная библиотека</h2></div><button id="close-music" aria-label="Закрыть">${icon('x')}</button></div><div class="music-intro">${TRACKS.length} композиций. Предпрослушивание и выбор дорожки.</div><div class="music-filters" id="music-filters"><button class="active" data-music-filter="all">Все</button><button data-music-filter="pulse">Ритм</button><button data-music-filter="minimal">Минимал</button><button data-music-filter="space">Космос</button><button data-music-filter="ambient">Спокойно</button><button data-music-filter="recorded">Записи · CC0</button></div><div class="music-list" id="music-list"></div><div class="dialog-actions"><span class="material-hint" style="margin-right:auto">Музыка и звуки взаимодействий смешиваются отдельно.</span><button class="toolbar-button" id="music-none">Без фоновой музыки</button></div></dialog>`);
$('.mode-nav').insertAdjacentHTML('beforeend',`<button id="music-nav">Музыка <span class="panel-count">${TRACKS.length}</span></button>`);
$('.top-actions').insertAdjacentHTML('afterbegin',`<button class="toolbar-button icon-only" id="appearance" aria-label="Сменить оформление">${icon('sun-moon')}</button>`);
const night=localStorage.getItem('matter-lab-appearance')!=='light';document.body.classList.toggle('dark-lab',night);
$('#appearance').onclick=()=>{document.body.classList.toggle('dark-lab');localStorage.setItem('matter-lab-appearance',document.body.classList.contains('dark-lab')?'dark':'light');view?.setTheme(document.body.classList.contains('dark-lab'));};
let musicFilter='all';const musicPreview=new Audio();let playingTrack=null;
function drawMusic(){
 $('#music-list').innerHTML=TRACKS.filter(t=>musicFilter==='all'||t.mood===musicFilter||musicFilter==='recorded'&&t.recording).map(t=>`<div class="music-row ${settings.musicTrack===t.id?'chosen':''}"><button class="music-play" data-play-track="${t.id}" aria-label="Послушать ${t.title}">${icon(playingTrack===t.id?'pause':'play')}</button><div class="music-title"><strong>${t.title}</strong><span>${t.artist?escape(t.artist)+' · '+escape(t.license||''):escape(t.collection)+' · '+t.bpm+' BPM'} · ${Math.floor(t.duration/60)}:${String(Math.floor(t.duration%60)).padStart(2,'0')}</span></div><div class="music-dots" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div><button class="toolbar-button" data-select-track="${t.id}">${settings.musicTrack===t.id?'Выбрано':'Выбрать'}</button></div>`).join('');
 document.querySelectorAll('[data-play-track]').forEach(el=>el.onclick=async()=>{const id=el.dataset.playTrack;if(playingTrack===id){musicPreview.pause();playingTrack=null;}else{musicPreview.src=TRACKS.find(t=>t.id===id).url;try{await musicPreview.play();playingTrack=id;}catch{toast('Дорожка ещё готовится. Попробуйте чуть позже.');}}drawMusic();});
 document.querySelectorAll('[data-select-track]').forEach(el=>el.onclick=()=>{settings.musicTrack=el.dataset.selectTrack;settings.audioPreset=TRACKS.find(t=>t.id===settings.musicTrack).mood;persist();drawMusic();toast('Дорожка выбрана для экспорта');});refreshIcons();
}
$('#music-nav').onclick=()=>{drawMusic();$('#music-dialog').showModal();};
$('#close-music').onclick=()=>{$('#music-dialog').close();musicPreview.pause();playingTrack=null;};
$('#music-none').onclick=()=>{settings.musicTrack=null;settings.audioPreset='none';persist();musicPreview.pause();playingTrack=null;drawMusic();toast('Фоновая музыка выключена');};
document.querySelectorAll('[data-music-filter]').forEach(el=>el.onclick=()=>{musicFilter=el.dataset.musicFilter;document.querySelectorAll('[data-music-filter]').forEach(b=>b.classList.toggle('active',b===el));drawMusic();});
musicPreview.onended=()=>{playingTrack=null;drawMusic();};
refreshIcons();
let settings=settingsFor('impact'),added=[],edits={},film=normalizeFilm(),projectId,selected=null,lab,view,playing=false,last=performance.now(),accumulator=0,category='Все',mode='editor',soundEnabled=false,frameCount=0,fpsTime=0;
const history=[],future=[];let toastTimer,rehearsal=null,playbackLab=null,cameraStudio=null,seekGeneration=0;
$('#selection-properties').insertAdjacentHTML('afterbegin',`<button id="set-story-hero" class="toolbar-button" style="width:100%;margin-bottom:14px">${icon('crosshair')}Сделать главным в кадре</button>`);
$('#object-material').previousElementSibling.textContent='Физический материал';
$('#selection-properties').insertAdjacentHTML('beforeend',`<details class="object-fine" id="object-appearance"><summary title="Внешний вид не меняет массу и контакты">Внешний вид</summary><div class="property-row"><label class="check-row"><input id="object-color-enabled" type="checkbox"/>Единый цвет</label><input id="object-color" class="field" type="color" aria-label="Цвет предмета" style="width:44px;height:30px;padding:3px"/></div><div class="property-row"><label for="object-roughness">Шероховатость</label><input class="field" id="object-roughness" type="number" min="0" max="1" step=".05" placeholder="Исходная"/></div><div class="property-row"><label for="object-metalness">Металличность</label><input class="field" id="object-metalness" type="number" min="0" max="1" step=".05" placeholder="Исходная"/></div><button id="object-appearance-reset" class="toolbar-button">Сбросить внешний вид</button></details>`);
$('#selection-properties').insertAdjacentHTML('beforeend',`<details class="object-fine" id="object-fine"><summary>Точные параметры</summary><div class="property-row"><label for="object-scale">Масштаб</label><input id="object-scale" class="field" type="number" min=".01" max="20" step=".05"/><span>×</span></div><p class="material-hint" id="object-scale-note">Масса задаётся отдельно от размера.</p><div class="property-label">Поворот, °</div><div class="field-grid">${['x','y','z'].map(a=>`<label class="axis-field"><span>${a.toUpperCase()}</span><input id="rotation-${a}" type="number" step="5" aria-label="Поворот ${a}, градусы"/></label>`).join('')}</div><div class="property-row"><label for="object-friction">Трение</label><input id="object-friction" class="field" type="number" min="0" max="10" step=".05"/></div><div class="property-row"><label for="object-restitution">Отскок</label><input id="object-restitution" class="field" type="number" min="0" max="1" step=".05"/></div><button id="contact-preset" class="toolbar-button">Из материала</button><div class="property-label">Начальная скорость, м/с</div><div class="field-grid">${['x','y','z'].map(a=>`<label class="axis-field"><span>${a.toUpperCase()}</span><input id="velocity-${a}" type="number" step=".1" aria-label="Начальная скорость ${a}"/></label>`).join('')}</div><div class="property-label">Вращение, рад/с</div><div class="field-grid">${['x','y','z'].map(a=>`<label class="axis-field"><span>${a.toUpperCase()}</span><input id="spin-${a}" type="number" step=".1" aria-label="Угловая скорость ${a}"/></label>`).join('')}</div><p id="object-motion-note" class="material-hint"></p></details>`);
const R=await initializePhysics();
$('#contact-preset').insertAdjacentHTML('afterend',`<div class="property-label">Затухание движения</div>${[['linearDamping','Линейное'],['angularDamping','Вращательное']].map(([key,label])=>`<div class="property-row"><label for="object-${key}">${label}</label><input id="object-${key}" class="field" type="number" min="0" max="100" step=".01"/></div>`).join('')}`);
try{const saved=JSON.parse(localStorage.getItem('matter-lab-project')||'null');if(saved?.version===1){validateProject(saved);validateFilm(saved.film);settings={...settings,...saved.settings};added=saved.objects||[];edits=saved.edits||{};film=normalizeFilm(saved.film);projectId=saved.id;}}catch{const recovery=localStorage.getItem('matter-lab-project');if(recovery)localStorage.setItem('matter-lab-project-recovery',recovery);}

function toast(text){$('#toast').textContent=text;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,4300);}
function project(){return {version:1,id:projectId,name:settings.projectTitle||settings.story?.title||'Новая сцена',settings:{...settings},objects:added,edits,film};}
function remember(){history.push(JSON.stringify(project()));if(history.length>40)history.shift();future.length=0;}
function persist(){try{localStorage.setItem('matter-lab-project',JSON.stringify(project()));}catch{}$('#undo').disabled=!history.length;$('#redo').disabled=!future.length;}
function applyProject(p,{rememberCurrent=false}={}){
 validateProject(p);validateFilm(p.film);
 const next=structuredClone(p),nextSettings={...settingsFor(next.settings?.experiment||'impact'),...next.settings,projectTitle:next.name||next.settings?.projectTitle};
 const nextAdded=next.objects||[],nextEdits=next.edits||{},nextFilm=normalizeFilm(next.film);
 // Construct before replacing the open scene. A broken import must leave the
 // producer's current objects, history and render world available.
 const prepared=new LabWorld(nextSettings,nextAdded,nextEdits);
 if(rememberCurrent)remember();
 projectId=next.id;settings=nextSettings;added=nextAdded;edits=nextEdits;film=nextFilm;
 resetLab(true,prepared);cameraStudio?.sync();if(cameraStudio?.configuredManual)workspaceShell.chooseWorkflow('shoot');persist();
}
function setPlaying(value){if(value&&rehearsal?.active)return;playing=value;$('#play').innerHTML=icon(value?'pause':'play');$('#play').setAttribute('aria-label',value?'Пауза':'Запустить симуляцию');$('#scene-state').textContent=value?'Расчёт идёт':lab?.time>0?'Пауза':'Готов к запуску';if(view?.selected)view.select(selected,!value);refreshIcons();}
function resetLab(resetCamera=false,prepared=null){
  const nextLab=prepared||new LabWorld(settings,added,edits);
  seekGeneration++;
  setPlaying(false);selected=null;accumulator=0;if(lab)lab.dispose();lab=nextLab;

  for(const[id,edit]of Object.entries(edits)){if(edit.position&&lab.find(id)?.soft)lab.moveSoft(id,{x:edit.position[0],y:edit.position[1],z:edit.position[2]});if(edit.launch)lab.actions.push({time:edit.launch.delay||.35,run:()=>lab.launch(id,{...settings,...edit.launch})});}
  if(settings.autoLaunch&&settings.focusId&&!edits[settings.focusId]?.launch)lab.actions.push({time:.35,run:()=>lab.launch(settings.focusId,settings)});
  lab.resetMeasurements();
  if(view)view.load(lab,resetCamera);cameraStudio?.sync();updateControls();renderTree();renderInspector();updateStats();
}

view=new LabView($('#viewport'),{onSelect:id=>select(id),onTransform:(id,object)=>{
  const e=lab?.find(id);if(!e?.body||e.kinematic||e.phenomenonRole||playing||rehearsal?.active||cameraStudio?.active)return;
  const p=object.position,q=object.quaternion;e.body.setTranslation({x:p.x,y:p.y,z:p.z},true);e.body.setRotation({x:q.x,y:q.y,z:q.z,w:q.w},true);e.body.setLinvel({x:0,y:0,z:0},true);e.body.setAngvel({x:0,y:0,z:0},true);
  edits[id]={...edits[id],position:[p.x,p.y,p.z],rotation:{x:q.x,y:q.y,z:q.z,w:q.w}};updatePositionFields();persist();
}});
view.transform.addEventListener('mouseDown',()=>remember());
view.setTheme(night);
$('.scene-tools').insertAdjacentHTML('beforeend',`<button id="focus-stage" aria-label="Развернуть рабочую сцену" title="Развернуть сцену">${icon('maximize-2')}</button>`);
$('#focus-stage').onclick=()=>{const active=$('#workspace').classList.toggle('focus-stage');$('#focus-stage').innerHTML=icon(active?'minimize-2':'maximize-2');$('#focus-stage').setAttribute('aria-label',active?'Вернуть панели':'Развернуть рабочую сцену');refreshIcons();};
try{resetLab(true);}catch(error){
 const recovery=localStorage.getItem('matter-lab-project');if(recovery)localStorage.setItem('matter-lab-project-recovery',recovery);
 settings=settingsFor('impact');added=[];edits={};film=normalizeFilm();projectId=undefined;
 resetLab(true);persist();toast('Не удалось восстановить сцену: '+error.message+'. Исходные данные сохранены для восстановления.');
}$('#loading').remove();

function updateControls(){
  $('#experiment-select').value=settings.experiment;$('#experiment-select').querySelector('[value=blank]').textContent=settings.experiment==='blank'?(settings.projectTitle||'Свободная студия'):'Свободная студия';
  const ex=EXPERIMENTS.find(e=>e.id===settings.experiment);$('#experiment-number').textContent=ex?String(EXPERIMENTS.indexOf(ex)+1).padStart(2,'0'):'—';
  $('#physics-tag').textContent=ex?.tag||'Свободная сборка';
  const customTakes=comparisonVariants(settings.comparison);
  $('#presets').innerHTML=customTakes.length?customTakes.map((v,i)=>`<button class="preset-button ${i===settings.variant?'active':''}" data-custom-variant="${i}" title="${escape(v.detail)}"><span class="preset-number">0${i+1}</span><span class="preset-name">${escape(v.label)}</span></button>`).join(''):ex?ex.variants.map((v,i)=>`<button class="preset-button ${i===settings.variant?'active':''}" data-variant="${i}" title="${escape(v.detail)}"><span class="preset-number">0${i+1}</span><span class="preset-name">${v.label}</span></button>`).join(''):'';
  $('#presets').classList.toggle('hidden',!customTakes.length&&!ex);
  for(const key of ['speed','azimuth','elevation','gravity']){$('#'+key).value=settings[key];updateOutput(key);}
  $('#speed').max=settings.experiment==='orbit'?3000:24;$('#speed').step=settings.experiment==='orbit'?5:.25;$('#speed').value=settings.speed;
  $('#gravity').disabled=settings.experiment==='orbit';
  $('#show-grid').checked=settings.showGrid;view.setGrid(settings.showGrid);
  const notes={flow:'Модель частиц: давление и вязкость. Подготовленные границы; без обратного воздействия на динамические предметы.',thermal:'Лёд показан в разрезе. Оценочный теплобаланс: заданный коэффициент теплообмена; без расчёта паровой плёнки и ударного разрушения. Тепловое время ×40.',orbit:'Центральное поле ∝ 1/r². Вакуум, сферическое центральное тело. Размер снаряда увеличен; модельное время ×1000.'};
  $('#physics-note').hidden=!notes[settings.experiment];$('#physics-note').textContent=notes[settings.experiment]||'';
  renderRecipe();
}
function updateOutput(key){const value=Number(settings[key]);$('#'+key+'-value').textContent=key==='speed'?value.toFixed(1).replace('.',',')+' м/с':key==='gravity'?value.toFixed(2).replace('.',',')+' м/с²':Math.round(value)+'°';$('#direction-arrow').style.transform=`rotate(${settings.azimuth-180}deg)`;$('#direction-text').textContent=`${Math.round(settings.azimuth)}° по горизонту · ${settings.elevation>0?'+':''}${Math.round(settings.elevation)}° вверх`;}
function renderRecipe(){
 const s=settings;const rigidMats=Object.entries(MATERIALS).filter(([k,m])=>m.friction!==undefined&&!m.young);
 let markup=`<div class="section-heading">${icon('flask-conical')}Параметры опыта</div>`;
 const matSelect=(list)=>`<label class="property-label" for="recipe-material">Материал опыта</label><select id="recipe-material" class="field">${list.map(([id,m])=>`<option value="${id}" ${s.material===id?'selected':''}>${m.name}</option>`).join('')}</select>`;
 const range=(id,label,min,max,step,value,unit)=>`<label class="property-label" for="recipe-${id}" style="margin-top:13px">${label}<output id="recipe-${id}-value">${value}${unit}</output></label><input id="recipe-${id}" class="property-range" type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-recipe="${id}" data-unit="${unit}"/>`;
 if(s.experiment==='impact'){markup+=matSelect(rigidMats);markup+=range('mass','Масса снаряда',1,60,1,s.mass,' кг');}
 else if(s.experiment==='cascade'){markup+=matSelect(rigidMats);markup+=range('gap','Шаг расстановки',.22,.85,.01,s.gap,' м');}
 else if(s.experiment==='mechanism'){markup+=range('mass','Масса падающего груза',2,60,1,s.mass,' кг')+range('dropHeight','Высота падения',.5,4,.1,s.dropHeight,' м');markup+='<div class="material-hint">Оранжевый груз падает на правое плечо рычага. Голубой груз на противоположном плече подбрасывается вверх.</div>';}
 else if(s.experiment==='soft'){markup+=matSelect(Object.entries(MATERIALS).filter(([,m])=>m.young));markup+=range('depth','Ход пресса',.6,1.6,.05,s.depth,' м');markup+='<div class="material-hint">Объёмная сетка, упругая деформация и пластическое течение. Пресс опускается и возвращается автоматически.</div>';}
 else if(s.experiment==='flow'){markup+=matSelect(Object.entries(MATERIALS).filter(([,m])=>m.viscosity!==undefined));markup+=range('slope','Наклон желоба',8,36,1,s.slope,'°');}
 else if(s.experiment==='thermal'){markup+=range('mass','Масса шара',.25,12,.25,s.mass,' кг')+range('temperature','Начальная температура',200,1400,25,s.temperature,' °C')+range('contactH','Эффективный теплообмен',200,2500,50,s.contactH,' Вт/(м²·К)');markup+='<div class="material-hint">Радиус следует из массы и плотности стали. Глубина определяется переданной энергией, нагревом льда до 0 °C и теплотой плавления.</div>';}
 else if(s.experiment==='orbit'){markup+='<label class="property-label" for="orbit-asset">Что запускаем</label><select class="field" id="orbit-asset">'+CATALOG.filter(a=>a.id!=='softcube').map(a=>`<option value="${a.id}" ${s.orbitAsset===a.id?'selected':''}>${a.name}</option>`).join('')+'</select>';markup+='<label class="property-label" for="orbit-planet" style="margin-top:12px">Центральное тело</label><select class="field" id="orbit-planet"><option value="moon">Луна</option><option value="earth">Земля</option><option value="mars">Марс</option></select>';markup+=range('altitude','Начальная высота',20000,1500000,10000,s.altitude,' м');markup+='<div class="material-hint">В вакууме масса и форма снаряда не меняют ускорение его центра масс. Круговой и параболический пороги вычисляются из μ и начального радиуса.</div>';}
 else markup+='<div class="material-hint">Выберите предмет, задайте материал, массу и движение. Добавьте опоры, ёмкости или постройте массив из копий.</div>';
 markup+='<button class="toolbar-button" id="apply-recipe" style="width:100%;margin-top:9px">'+icon('rotate-ccw')+'Применить и начать сначала</button>';
 $('#recipe-properties').innerHTML=markup;refreshIcons();
 $('#recipe-material')?.addEventListener('change',e=>{remember();settings.material=e.target.value;resetLab();persist();});
 $('#orbit-asset')?.addEventListener('change',e=>{remember();settings.orbitAsset=e.target.value;resetLab();persist();});
 if($('#orbit-planet')){$('#orbit-planet').value=s.planet;$('#orbit-planet').onchange=e=>{remember();settings.planet=e.target.value;resetLab(true);persist();};}
 document.querySelectorAll('[data-recipe]').forEach(el=>{el.addEventListener('input',()=>{$(`#recipe-${el.dataset.recipe}-value`).textContent=el.value+el.dataset.unit;});el.addEventListener('change',()=>{remember();settings[el.dataset.recipe]=Number(el.value);resetLab();persist();});});
 $('#apply-recipe').onclick=()=>resetLab();
}
let catalogObserver,catalogFrame,catalogGeneration=0;
const catalogThumbs=new Map();
function renderCatalog(){
 catalogObserver?.disconnect();cancelAnimationFrame(catalogFrame);const generation=++catalogGeneration;
 const search=$('#asset-search').value.toLocaleLowerCase('ru');
 const list=CATALOG.filter(a=>(category==='Все'||a.category===category)&&a.name.toLocaleLowerCase('ru').includes(search));
 $('#asset-count').textContent=CATALOG.length;
 $('#categories').innerHTML=CATEGORIES.map(c=>`<button data-category="${c}" class="${category===c?'active':''}">${c}</button>`).join('');
 $('#catalog').innerHTML=list.map(a=>`<button class="asset-card" data-asset="${a.id}" draggable="true" title="Добавить: ${a.name}"><span class="asset-plus">+</span><img alt="${a.name}"/><span class="asset-label">${a.name}</span></button>`).join('');
 const queue=[],byId=new Map(list.map(a=>[a.id,a]));
 function drawNext(){if(generation!==catalogGeneration)return;for(let n=0;n<2&&queue.length;n++){const card=queue.shift(),a=byId.get(card.dataset.asset);if(!a||!card.isConnected)continue;try{if(!catalogThumbs.has(a.id))catalogThumbs.set(a.id,thumbnail(a));card.querySelector('img').src=catalogThumbs.get(a.id);}catch{}}catalogFrame=queue.length?requestAnimationFrame(drawNext):null;}
 catalogObserver=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){catalogObserver.unobserve(entry.target);queue.push(entry.target);}if(queue.length&&!catalogFrame)catalogFrame=requestAnimationFrame(drawNext);},{root:$('#catalog'),rootMargin:'160px'});
 $('#catalog').querySelectorAll('[data-asset]').forEach(card=>catalogObserver.observe(card));
 document.querySelectorAll('[data-asset]').forEach(el=>{el.onclick=()=>addObject(el.dataset.asset);el.ondragstart=e=>{e.dataTransfer.setData('text/matter-asset',el.dataset.asset);e.dataTransfer.effectAllowed='copy';};});
 document.querySelectorAll('[data-category]').forEach(el=>el.onclick=()=>{category=el.dataset.category;renderCatalog();});
}
function renderTree(){
 const list=[...lab.entities.filter(e=>e.id!=='ground'),...lab.softs],labels=objectLabelMap(list);$('#tree-count').textContent=list.length;
 $('#tree').innerHTML=list.map(e=>`<button class="tree-row ${selected===e.id?'active':''}" data-entity="${e.id}"><span class="tree-icon">${icon(e.soft?'scan-line':e.fixed?'lock-keyhole':'box')}</span><span class="tree-name">${escape(objectLabel(e,labels))}</span><small>${settings.story?.heroId===e.id?'главный':e.soft?'мягкое':e.fixed?'опора':''}</small></button>`).join('');
 document.querySelectorAll('[data-entity]').forEach(el=>el.onclick=()=>select(el.dataset.entity));refreshIcons();
}
function select(id){if(rehearsal?.active)return;selected=id;if(cameraStudio?.active)cameraStudio.focus(id);else view.select(id,!playing);renderInspector();renderTree();}
function renderInspector(){
 const e=lab.find(selected),label=e?objectLabel(e,[...lab.entities.filter(o=>o.id!=='ground'),...lab.softs]):'';$('#selection-properties').hidden=!e;$('#inspector-title').textContent=label||'Настройки опыта';$('#selected-label').hidden=!e||settings.experiment==='flow';$('#selected-name').textContent=label;
 if(!e){$('#launch').disabled=!!lab.penetration;$('#launch-hint').textContent=lab.penetration?'Скорость снаряда задана в «Взаимодействиях». Запустите опыт кнопкой воспроизведения.':'Без выбора предмета запускается снаряд опыта.';return;}
 const isHero=settings.story?.heroId===e.id;$('#set-story-hero').disabled=isHero;$('#set-story-hero').innerHTML=icon(isHero?'check':'crosshair')+(isHero?'Главный предмет ролика':'Сделать главным в кадре');refreshIcons();
 const special=!!e.phenomenonRole||e.kinematic||!!e.soft||e.id==='planet';$('#object-type').textContent=e.phenomenonRole?'Осевая модель':lab.thermal&&e.id==='hot-ball'?'Тепловая модель':e.soft?'Деформируемый':'Твёрдое тело';
 const mats=Object.entries(MATERIALS).filter(([,m])=>e.soft?!!m.young:m.friction!==undefined&&!m.young);
 $('#object-material').innerHTML=mats.map(([id,m])=>`<option value="${id}" ${id===e.material?'selected':''}>${m.name}</option>`).join('');
 $('#object-mass').value=Number((e.phenomenonRole==='penetration'?lab.penetration.model.parameters.projectile.mass:e.soft?(e.spec.mass??3):lab.thermal&&e.id==='hot-ball'?lab.thermal.mass:e.body.mass()).toFixed(3));$('#object-mass').disabled=e.fixed||!!e.kinematic&&e.phenomenonRole!=='penetration';$('#fixed-object').checked=e.fixed;$('#fixed-object').disabled=!e.body;
 $('#object-material').disabled=e.kinematic||!!e.phenomenonRole;$('#fixed-object').disabled=special;$('#duplicate').disabled=e.kinematic||!!e.phenomenonRole;$('#delete-object').disabled=e.kinematic||!!e.phenomenonRole;for(const a of ['x','y','z'])$('#position-'+a).disabled=special;$('#launch').disabled=!!e.soft||e.fixed||e.kinematic;$('#launch-hint').textContent=e.phenomenonRole?'Начальная скорость, направление и образец задаются в «Взаимодействиях».':e.kinematic?'Движение этого тела задаётся параметрами опыта.':e.soft?'Мягкое тело реагирует на гравитацию и контакты.':`Скорость будет применена к предмету «${label}».`;
 renderFineProperties(e,special);renderObjectAppearance(e);updatePositionFields();
}
function renderObjectAppearance(e){
 const supported=!!e.soft||!!e.body&&!e.kinematic;$('#object-appearance').hidden=!supported;if(!supported)return;
 const appearance=e.appearance||{};let material;
 view.models.get(e.id)?.traverse(node=>{if(!material&&node.material)material=Array.isArray(node.material)?node.material[0]:node.material;});
 $('#object-color-enabled').checked=!!appearance.color;$('#object-color').disabled=!appearance.color;
 $('#object-color').value=appearance.color||(material?.color?'#'+material.color.getHexString():e.color||MATERIALS[e.material].color);
 $('#object-roughness').value=appearance.roughness??'';$('#object-metalness').value=appearance.metalness??'';
 $('#object-appearance-reset').disabled=!Object.keys(appearance).length;
}
function commitObjectAppearance(appearance){
 const id=selected,e=lab.find(id);if(rehearsal?.active||cameraStudio?.recording||!e||!e.soft&&(!e.body||e.kinematic))return;
 const value=appearance&&Object.keys(appearance).length?appearance:null;
 try{
  const edit={...edits[id],appearance:structuredClone(value)};
  validateProject({...project(),edits:{...edits,[id]:edit}});
  remember();edits[id]=edit;lab.setAppearance(id,value);view.load(lab,false);
  if(!cameraStudio?.active)view.select(id,!playing);renderInspector();persist();
 }catch(error){toast(error.message);renderObjectAppearance(e);}
}
$('#object-color-enabled').onchange=()=>{const appearance={...lab.find(selected)?.appearance};if($('#object-color-enabled').checked)appearance.color=$('#object-color').value;else delete appearance.color;commitObjectAppearance(appearance);};
$('#object-color').onchange=()=>commitObjectAppearance({...lab.find(selected)?.appearance,color:$('#object-color').value});
for(const key of ['roughness','metalness'])$('#object-'+key).onchange=event=>{const appearance={...lab.find(selected)?.appearance};if(event.target.value==='')delete appearance[key];else appearance[key]=Number(event.target.value);commitObjectAppearance(appearance);};
$('#object-appearance-reset').onclick=()=>commitObjectAppearance(null);
function updatePositionFields(){const p=lab.position(selected);for(const a of ['x','y','z']){$('#position-'+a).disabled=!p;if(lab.find(selected)?.kinematic)$('#position-'+a).disabled=true;if(p&&document.activeElement!==$('#position-'+a))$('#position-'+a).value=p[a].toFixed(2);}}
function renderFineProperties(e,special){
 $('#object-fine').hidden=special;if(special)return;
 const initial={...e.spec,...edits[e.id]},canScale=added.some(o=>o.id===e.id);
 $('#object-scale').value=initial.scale||1;$('#object-scale').disabled=!canScale;
 $('#object-scale-note').textContent=canScale?'Масса задаётся отдельно от размера.':'Размер сборки задаётся в её настройках.';
 const rotation=new THREE.Euler().setFromQuaternion(new THREE.Quaternion().copy(e.body.rotation()),'XYZ');
 for(const [i,a]of ['x','y','z'].entries()){
  $('#rotation-'+a).value=Number(THREE.MathUtils.radToDeg(rotation[a]).toFixed(2));
  $('#velocity-'+a).value=initial.velocity?.[i]||0;$('#spin-'+a).value=initial.angularVelocity?.[i]||0;
  $('#velocity-'+a).disabled=e.fixed;$('#spin-'+a).disabled=e.fixed;
 }
 $('#object-friction').value=initial.friction??MATERIALS[e.material].friction??.5;
 $('#object-restitution').value=initial.restitution??MATERIALS[e.material].restitution??.2;
 for(const key of ['linearDamping','angularDamping'])$('#object-'+key).value=Number(e.body[key]().toFixed(4));
 $('#object-motion-note').textContent=initial.launch?`Запуск через ${initial.launch.delay??.35} с: ${initial.launch.speed??settings.speed} м/с. Он заменит начальную скорость.`:'Изменение начальных параметров перезапускает опыт.';
}
function commitFineProperties(change){const id=selected;if(!lab.find(id))return;editSelected(change);resetLab();select(id);persist();}
$('#object-scale').onchange=event=>commitFineProperties({scale:Math.max(.01,Math.min(20,Number(event.target.value)||1))});
for(const key of ['friction','restitution'])$('#object-'+key).onchange=event=>commitFineProperties({[key]:Math.max(0,Math.min(key==='friction'?10:1,Number(event.target.value)||0))});
for(const key of ['linearDamping','angularDamping'])$('#object-'+key).onchange=event=>commitFineProperties({[key]:Math.max(0,Math.min(100,Number(event.target.value)||0))});
$('#contact-preset').onclick=()=>{const e=lab.find(selected);if(!e)return;commitFineProperties({friction:MATERIALS[e.material].friction??.5,restitution:MATERIALS[e.material].restitution??.2});};
for(const axis of ['x','y','z']){
 $('#rotation-'+axis).onchange=()=>{const angles=['x','y','z'].map(a=>THREE.MathUtils.degToRad(Number($('#rotation-'+a).value)||0)),q=new THREE.Quaternion().setFromEuler(new THREE.Euler(...angles));commitFineProperties({rotation:{x:q.x,y:q.y,z:q.z,w:q.w}});};
 for(const [prefix,key,limit]of [['velocity','velocity',1000],['spin','angularVelocity',1000]])$('#'+prefix+'-'+axis).onchange=()=>commitFineProperties({[key]:['x','y','z'].map(a=>Math.max(-limit,Math.min(limit,Number($('#'+prefix+'-'+a).value)||0)))});
}
function editSelected(change){const e=lab.find(selected);if(!e)return;remember();edits[selected]={...edits[selected],...change};persist();}
$('#set-story-hero').onclick=()=>{if(rehearsal?.active||!lab.find(selected))return;remember();settings.story={...settings.story,heroId:selected};lab.settings.story=settings.story;renderInspector();renderTree();persist();toast('Камера ролика будет следить за выбранным предметом');};
function addObject(assetId,point){
 if(rehearsal?.active)return;
 const a=CATALOG.find(a=>a.id===assetId);if(!a)return;
 remember();const pos=point||[view.controls.target.x+(added.length%3-1)*1.05,a.size[1]/2+.25,view.controls.target.z+1];
 const e=lab.addAsset(assetId,pos,{id:`added-${Date.now()}-${added.length}`,material:a.mat,...(a.mass?{mass:a.mass}:{})});added.push(e.spec);view.add(e);select(e.id);updateStats();persist();toast(`${a.name} добавлен`);
}
function updateStats(){if(!lab||rehearsal?.active)return;const s=lab.stats();$('#body-count').textContent=s.objects+(s.particles?` + ${s.particles}`:'');$('#moving-count').textContent=s.moving;$('#energy').textContent=String(s.energy<100?s.energy.toFixed(1):Math.round(s.energy)).replace('.',',')+' Дж';const t=s.time;$('#time').textContent=`${String(Math.floor(t/60)).padStart(2,'0')}:${(t%60).toFixed(2).padStart(5,'0')}`;if(document.activeElement!==$('#timeline'))$('#timeline').value=t;}

$('#experiment-select').onchange=e=>{remember();if(rehearsal?.active)rehearsal.close();settings=settingsFor(e.target.value);added=[];edits={};resetLab(true);persist();};
$('#presets').onclick=e=>{const customButton=e.target.closest('[data-custom-variant]');if(customButton){const i=Number(customButton.dataset.customVariant),v=comparisonVariants(settings.comparison)[i];remember();settings.variant=i;if(v.field==='mass'||v.field==='material')edits[v.targetId]={...edits[v.targetId],[v.field]:v.value};else settings[v.field]=v.value;resetLab();persist();return;}const button=e.target.closest('[data-variant]');if(!button)return;remember();settings=settingsFor(settings.experiment,Number(button.dataset.variant));added=[];edits={};resetLab();persist();};
$('#play').onclick=()=>setPlaying(!playing);$('#reset').onclick=()=>resetLab();$('#step').onclick=()=>{setPlaying(false);for(let i=0;i<4;i++)lab.step();view.sync();updateStats();};
for(const key of ['speed','azimuth','elevation','gravity'])$('#'+key).addEventListener('input',e=>{settings[key]=Number(e.target.value);lab.settings[key]=settings[key];if(key==='gravity'&&lab.penetration){resetLab(false);}else if(key==='gravity'){lab.world.gravity={x:0,y:-settings.gravity,z:0};if(lab.fluid)lab.fluid.settings.gravity=settings.gravity;lab.world.forEachRigidBody(b=>b.wakeUp());}updateOutput(key);persist();});
for(const [id,g]of [['earth',9.81],['moon',1.62],['zero-g',0]])$('#'+id).onclick=()=>{$('#gravity').value=g;$('#gravity').dispatchEvent(new Event('input'));};
$('#launch').onclick=()=>{const id=selected||settings.focusId||'projectile';const e=lab.find(id);if(!e?.body||e.fixed||e.kinematic){toast('Выберите свободный твёрдый предмет в сцене');return;}remember();edits[id]={...edits[id],launch:{speed:settings.speed,azimuth:settings.azimuth,elevation:settings.elevation,delay:.35}};settings.focusId=id;persist();lab.launch(id,settings);for(const a of lab.actions)a.done=true;setPlaying(true);};
$('#object-material').onchange=event=>{const e=lab.find(selected);if(!e||e.kinematic)return;editSelected({material:event.target.value});lab.setMaterial(selected,event.target.value);view.load(lab,false);renderInspector();};
$('#object-mass').onchange=event=>{const e=lab.find(selected);if(!e)return;const mass=Math.max(.001,Math.min(1e6,Number(event.target.value)||1));if(e.soft||e.phenomenonRole==='penetration'){const id=e.id;remember();edits[id]={...edits[id],mass};resetLab(false);select(id);persist();return;}if(lab.thermal&&e.id==='hot-ball'){const id=e.id;remember();settings.mass=mass;if(edits[id])delete edits[id].mass;resetLab();select(id);persist();return;}editSelected({mass});lab.setMass(selected,mass);renderInspector();};
for(const axis of ['x','y','z'])$('#position-'+axis).onchange=e=>{const obj=lab.find(selected),p=lab.position(selected);if(!p)return;p[axis]=Math.max(-1000,Math.min(1000,Number(e.target.value)||0));editSelected({position:[p.x,p.y,p.z]});if(obj.soft)lab.moveSoft(selected,p);else obj.body.setTranslation(p,true);view.sync(true);};
$('#fixed-object').onchange=e=>{const obj=lab.find(selected);if(!obj?.body)return;editSelected({fixed:e.target.checked});obj.fixed=e.target.checked;obj.body.setBodyType(obj.fixed?R.RigidBodyType.Fixed:R.RigidBodyType.Dynamic,true);renderInspector();renderTree();};
function deleteSelected(){if(rehearsal?.active||!selected||lab.find(selected)?.kinematic||lab.find(selected)?.phenomenonRole)return;remember();edits[selected]={...edits[selected],deleted:true};settings.connections=(settings.connections||[]).filter(c=>c.a!==selected&&c.b!==selected);const obj=view.models.get(selected);if(obj){view.scene.remove(obj);view.models.delete(selected);}lab.remove(selected);select(null);updateStats();persist();}
$('#delete-object').onclick=deleteSelected;
$('#duplicate').onclick=()=>{const e=lab.find(selected),p=lab.position(selected);if(!e||!p||e.kinematic)return;remember();const id='copy-'+Date.now(),spec={...e.spec,id,fixed:e.fixed,parts:e.soft?undefined:e.parts,position:[p.x+1.2*(e.scale||1),p.y,p.z],rotation:e.body?{...e.body.rotation()}:e.spec.rotation,material:e.material,mass:e.fixed?(e.spec.mass||1):e.body?.mass()||e.spec.mass||3,scale:e.scale||1};const copy=lab.addRigid(spec);added.push(copy.spec);if(edits[e.id]?.launch)edits[id]={launch:{...edits[e.id].launch}};view.add(copy);select(copy.id);updateStats();persist();};
function undo(){if(!history.length)return;const current=JSON.stringify(project());try{applyProject(JSON.parse(history.at(-1)));future.push(current);history.pop();persist();}catch(error){toast('Не удалось отменить изменение: '+error.message);}}
function redo(){if(!future.length)return;const current=JSON.stringify(project());try{applyProject(JSON.parse(future.at(-1)));history.push(current);future.pop();persist();}catch(error){toast('Не удалось вернуть изменение: '+error.message);}}
$('#undo').onclick=undo;$('#redo').onclick=redo;
function transformMode(mode){view.transform.setMode(mode);$('#translate').classList.toggle('active',mode==='translate');$('#rotate').classList.toggle('active',mode==='rotate');}
$('#translate').onclick=()=>transformMode('translate');$('#rotate').onclick=()=>transformMode('rotate');
$('#grid-toggle').onclick=()=>{settings.showGrid=!settings.showGrid;$('#show-grid').checked=settings.showGrid;view.setGrid(settings.showGrid);$('#grid-toggle').classList.toggle('active',settings.showGrid);persist();};$('#show-grid').onchange=()=>{$('#grid-toggle').click();};
document.querySelectorAll('[data-camera]').forEach(el=>el.onclick=()=>{document.querySelectorAll('[data-camera]').forEach(b=>b.classList.toggle('active',b===el));view.cameraPreset(el.dataset.camera);});
$('#asset-search').oninput=renderCatalog;
document.querySelectorAll('[data-library]').forEach(el=>el.onclick=()=>{document.querySelectorAll('[data-library]').forEach(b=>b.classList.toggle('active',b===el));const tree=el.dataset.library==='tree';$('#tree').classList.toggle('hidden',!tree);$('#catalog').classList.toggle('hidden',tree);$('#categories').hidden=tree;$('.search-box').hidden=tree;});
$('#blank-scene').onclick=()=>{$('#experiment-select').value='blank';$('#experiment-select').dispatchEvent(new Event('change'));};
$('#timeline').onchange=e=>seekPhysics(Number(e.target.value));

function download(data,name){const a=document.createElement('a');a.href=typeof data==='string'?data:URL.createObjectURL(data);a.download=name;a.click();if(typeof data!=='string')setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
$('#save-project').onclick=()=>{download(new Blob([JSON.stringify(project(),null,2)],{type:'application/json'}),'matter-lab-project.json');persist();toast('Проект сохранён');};
$('#open-project').onclick=()=>$('#project-file').click();
$('#project-file').onchange=async e=>{try{const f=e.target.files[0];if(!f)return;if(f.size>3e6)throw new Error('Слишком большой проект');const p=JSON.parse(await f.text());if(p.version!==1||!p.settings||!Array.isArray(p.objects)||p.objects.length>150)throw new Error('Неподдерживаемый проект');applyProject(p,{rememberCurrent:true});toast('Проект открыт');}catch(err){toast('Не удалось открыть проект: '+err.message);}e.target.value='';};
$('#screenshot').onclick=()=>download(view.screenshot(),'matter-lab-frame.png');
$('#help-top').onclick=$('#models-help').onclick=()=>$('#help-dialog').showModal();
document.querySelectorAll('[data-close]').forEach(el=>el.onclick=()=>$('#'+el.dataset.close).close());
// The scene composer below handles asset-independent patterns and saved groups.
const wrap=$('#viewport-wrap');wrap.ondragover=e=>{e.preventDefault();wrap.classList.add('drop-active');};wrap.ondragleave=()=>wrap.classList.remove('drop-active');wrap.ondrop=e=>{e.preventDefault();wrap.classList.remove('drop-active');const id=e.dataTransfer.getData('text/matter-asset');if(!id)return;const r=wrap.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1),view.camera);const point=new THREE.Vector3();ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),0),point);const asset=CATALOG.find(a=>a.id===id);addObject(id,[point.x,asset.size[1]/2+.18,point.z]);};
window.addEventListener('keydown',e=>{if(rehearsal?.active||['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName)||document.querySelector('dialog[open]'))return;if(cameraStudio?.active&&e.code!=='Space')return;if(e.code==='Space'){e.preventDefault();setPlaying(!playing);}if(e.key==='Delete'||e.key==='Backspace')deleteSelected();if(e.key.toLowerCase()==='f'&&!e.metaKey&&!e.ctrlKey){e.preventDefault();frameSelection();}if(e.key.toLowerCase()==='g')transformMode('translate');if(e.key.toLowerCase()==='r')transformMode('rotate');if((e.ctrlKey||e.metaKey)&&e.key==='z'){e.preventDefault();e.shiftKey?redo():undo();}});
let audio;
$('#sound').onclick=()=>{soundEnabled=!soundEnabled;$('#sound').innerHTML=icon(soundEnabled?'volume-2':'volume-x');$('#sound').setAttribute('aria-label',soundEnabled?'Выключить звук':'Включить звук');if(soundEnabled){audio||=new AudioContext();audio.resume();}refreshIcons();};
let heard=0;
function playImpacts(){if(!soundEnabled||!audio){heard=lab.impacts.length;return;}for(const impact of lab.impacts.slice(heard,heard+3)){const o=audio.createOscillator(),g=audio.createGain();o.type='sine';o.frequency.setValueAtTime(80+Math.random()*180,audio.currentTime);o.frequency.exponentialRampToValueAtTime(35,audio.currentTime+.09);g.gain.setValueAtTime(Math.min(.055,impact.strength*.065),audio.currentTime);g.gain.exponentialRampToValueAtTime(.001,audio.currentTime+.12);o.connect(g).connect(audio.destination);o.start();o.stop(audio.currentTime+.12);}heard=lab.impacts.length;}
function animate(now){requestAnimationFrame(animate);const delta=Math.min(.05,(now-last)/1000);last=now;if(playing&&mode==='editor'){accumulator+=delta*Number($('#playback-speed').value);let steps=0;while(accumulator>=1/120&&steps<18){lab.step();accumulator-=1/120;steps++;}if(lab.time>=20)setPlaying(false);view.sync();playImpacts();}protectRecordedScene();cameraStudio?.update(delta);view.render();cameraStudio?.sample();frameCount++;fpsTime+=delta;if(fpsTime>.4){$('#fps').textContent=Math.round(frameCount/fpsTime)+' FPS';frameCount=0;fpsTime=0;updateStats();if(playing)updatePositionFields();}}
requestAnimationFrame(animate);renderCatalog();persist();

function changeMode(next){if(rehearsal?.active)rehearsal.close();mode=next;document.querySelectorAll('[data-mode]').forEach(el=>el.classList.toggle('active',el.dataset.mode===mode));$('#workspace').classList.toggle('hidden',mode!=='editor');$('#gallery').classList.toggle('hidden',mode!=='gallery');if(mode==='gallery'){setPlaying(false);refreshGallery();}else view.resize();}
document.querySelectorAll('[data-mode]').forEach(el=>el.onclick=()=>changeMode(el.dataset.mode));
$('.brand').onclick=e=>{e.preventDefault();changeMode('editor');};
let gallerySignature=null,galleryRequest=0;
async function refreshGallery(){
 const request=++galleryRequest;let reels=[],jobs=[];
 const results=await Promise.allSettled(['/api/reels','/api/jobs'].map(async url=>{const response=await fetch(url);if(!response.ok)throw new Error('Не удалось загрузить список');return response.json();}));
 if(request!==galleryRequest)return;
 if(results[0].status==='fulfilled'&&Array.isArray(results[0].value))reels=results[0].value.filter(r=>(r.duration>=19||r.revision>=4&&r.duration>0)&&!r.name.startsWith('preview'));
 if(results[1].status==='fulfilled'&&Array.isArray(results[1].value))jobs=results[1].value;
 const visible=reels.filter(r=>Number(r.revision)>=3&&!/^\d\d-/.test(r.name)&&!reels.some(other=>other.masterName===r.name));$('#video-count').textContent=visible.length?`· ${visible.length}`:'';
 let queue=$('#export-jobs');if(!queue){queue=document.createElement('section');queue.id='export-jobs';queue.setAttribute('aria-label','Задания экспорта');$('#reels').before(queue);}
 const pending=jobs.filter(job=>job.status!=='done').slice(0,8);queue.hidden=!pending.length;
 const statusNames={queued:'В очереди',running:'Рендер',error:'Не завершён',interrupted:'Прерван'};
 queue.innerHTML=pending.map(job=>`<article class="export-job"><div class="export-job-heading"><strong>${escape(job.title||'Экспорт ролика')}</strong><span>${statusNames[job.status]||'Ожидает'}${job.status==='running'?' · '+Math.round(job.progress||0)+'%':''}</span></div><div class="export-job-progress" role="progressbar" aria-label="${escape(job.title||'Экспорт')}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.max(0,Math.min(100,job.progress||0))}"><span style="width:${Math.max(0,Math.min(100,job.progress||0))}%"></span></div><p>${escape(job.message||'Подготовка ролика')}</p></article>`).join('');
 const signature=visible.map(r=>[r.name,r.modified,r.title,r.description,r.sourceProjectName,r.poster,r.masterName].join(':')).join('|');
 if(signature===gallerySignature)return;gallerySignature=signature;
 const cards=list=>list.map(reel=>{
  const title=reel.title||'Мой эксперимент';
  const description=reel.description||reel.takes?.map(t=>t.label).join(' · ')||'';
  const seconds=Math.max(0,Math.round(reel.duration)||0),duration=`${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}`;
  return `<article class="reel-card">
   <a class="reel-preview" href="/watch.html?v=${encodeURIComponent(reel.name)}" target="_blank" rel="noopener" aria-label="Смотреть ${escape(title)}">
    ${reel.poster?`<img src="${escape(reel.poster)}?v=${Math.round(reel.modified)}" alt="${escape(title)}" loading="lazy" decoding="async"/>`:'<span class="reel-no-poster">Видео</span>'}
    <span class="reel-play" aria-hidden="true">${icon('play')}</span><span class="reel-duration">${duration}</span><span class="reel-preview-caption" aria-hidden="true">Смотреть</span>
   </a>
   <div class="reel-info"><h3 title="${escape(title)}">${escape(title)}</h3><p title="${escape(description)}">${escape(description)}</p>
    <div class="reel-meta"><span>${seconds} с · ${reel.width>=2160?'4K':reel.width>=1080?'Full HD':'HD'} · ${reel.fps} кадр/с</span>
     <a href="${escape(reel.url)}" download>${icon('download')}MP4</a>${reel.masterName?`<a href="/media/${encodeURIComponent(reel.masterName)}" download>4K</a>`:''}
     ${reel.sourceProjectName?`<button type="button" data-edit-reel="${escape(reel.sourceProjectName)}" aria-label="Редактировать ${escape(title)}">Редактировать</button><a href="/media/${encodeURIComponent(reel.sourceProjectName)}" download aria-label="Скачать проект ${escape(title)}">Сцена</a>`:''}
    </div>
   </div>
  </article>`;
 }).join('');
 $('#reels').innerHTML=visible.length?cards(visible):'<div class="exports-empty"><h2>Нет экспортов</h2><button type="button" class="toolbar-button" data-open-export-projects>Открыть проекты</button></div>';refreshIcons();
}
$('#reels').addEventListener('click',async event=>{
 if(event.target.closest('[data-open-export-projects]')){projectLibrary.open();return;}
 const button=event.target.closest('[data-edit-reel]');if(!button)return;
 button.disabled=true;
 try{const response=await fetch('/media/'+encodeURIComponent(button.dataset.editReel));if(!response.ok)throw new Error('Проект недоступен.');const p=await response.json();applyProject(p,{rememberCurrent:true});changeMode('editor');toast('Проект открыт.');}
 catch(error){toast('Не удалось открыть проект: '+error.message);}finally{button.disabled=false;}
});
$('#refresh-gallery').onclick=refreshGallery;
setInterval(()=>{if(mode==='gallery')refreshGallery();},4000);
$('#export-top').onclick=()=>{$('#export-status').hidden=true;if(rehearsal?.active)rehearsal.close();cameraStudio?.stop();const rig=normalizeCameraRig(settings.cameraRig),duration=['recorded','keys'].includes(rig.mode)&&rig.points.length?Math.round(rig.duration*10)/10:settings.story?.duration||60;$('#export-scene-title').textContent=settings.story?.title||EXPERIMENTS.find(e=>e.id===settings.experiment)?.title||'Свободная студия';$('#export-series').options[0].textContent=`4 варианта · ${duration} секунд`;$('#export-series').options[1].textContent=`Текущий дубль · ${duration} секунд`;$('#export-series').options[0].disabled=settings.experiment==='blank'&&!settings.comparison?.enabled;if($('#export-series').options[0].disabled)$('#export-series').value='single';$('#export-dialog').showModal();};
let activeExportId='';
$('#start-export').onclick=async()=>{
 if(cameraStudio?.recording)await cameraStudio.stop();const btn=$('#start-export');btn.disabled=true;$('#export-status').hidden=false;$('#export-detail').textContent='Подготовка расчёта…';
 try{const response=await fetch('/api/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...project(),film:{...film,enabled:$('#export-series').value==='film'},series:$('#export-series').value==='series',height:Number($('#export-resolution').value)})});const job=await response.json();if(!response.ok)throw new Error(job.error||'Ошибка экспорта');
  activeExportId=job.id;btn.disabled=false;$('#export-dialog').close();toast('Ролик добавлен в очередь экспорта.');refreshGallery();
  const poll=setInterval(async()=>{try{const response=await fetch('/api/jobs/'+job.id);const j=await response.json();if(!response.ok)throw new Error(j.error||'Задание недоступно');if(activeExportId===job.id){$('#export-detail').textContent=j.message||'Рендер…';$('#export-bar').style.width=(j.progress||0)+'%';}if(['done','error','interrupted'].includes(j.status)){clearInterval(poll);btn.disabled=false;if(j.status==='done'){toast('Экспорт завершён. Файл доступен в видеостудии.');refreshGallery();}else toast(j.message||'Не удалось завершить экспорт');}}catch{clearInterval(poll);btn.disabled=false;if(activeExportId===job.id)$('#export-detail').textContent='Связь с локальным сервером прервана';}},2000);
 }catch(err){$('#export-detail').textContent=err.message;btn.disabled=false;}
};
refreshGallery();
// Small documented bridge for local verification and future scene assistants.
window.matterLab={get settings(){return settings;},get lab(){return lab;},get view(){return view;},project,select,setPlaying,changeMode,loadExperiment(id,n=0){remember();settings=settingsFor(id,n);added=[];edits={};resetLab(true);persist();}};

// General authoring tools. Their configurations are ordinary saved scene data.
$('.scene-tools').insertAdjacentHTML('afterbegin',`<button id="open-experiments" aria-label="Каталог готовых опытов">${icon('layout-grid')}</button>`);
$('.scene-tools').insertAdjacentHTML('beforeend',`<button id="add-connection" aria-label="Соединить предметы">${icon('link-2')}</button><button id="add-emitter" aria-label="Источник предметов">${icon('cloud-rain')}</button>`);
$('.view-controls').insertAdjacentHTML('afterend',`<label class="camera-director">${icon('video')}<select id="camera-director" aria-label="Автоматическая камера"><option value="free">Ручная камера</option><option value="dolly" selected>Плавное приближение</option><option value="orbit">Плавный облёт</option><option value="follow">Следить за предметом</option></select></label>`);
$('#camera-director').value=settings.cameraMode||'dolly';view.autoMode=settings.cameraMode||'dolly';
$('#camera-director').onchange=e=>{settings.cameraMode=e.target.value;view.autoMode=e.target.value;view.basePosition=view.camera.position.clone();view.baseTarget=view.controls.target.clone();persist();};
view.controls.addEventListener('start',()=>{view.autoMode='free';if($('#camera-director'))$('#camera-director').value='free';});
$('#export-resolution').closest('.property-row').insertAdjacentHTML('afterend',`<div class="property-row"><label for="render-style">Свет и оформление</label><select class="field" id="render-style" style="width:240px"><option value="cinematic">Контрастная студия</option><option value="light">Светлая студия</option></select></div><div class="property-row"><label for="audio-preset">Звуковое оформление</label><select class="field" id="audio-preset" style="width:240px"><option value="auto">Подобрать под эксперимент</option><option value="ambient">Тёплая атмосфера</option><option value="pulse">Ритм и движение</option><option value="space">Космическая атмосфера</option><option value="none">Только звуки взаимодействий</option></select></div>`);
$('#render-style').value=settings.renderStyle||'cinematic';$('#audio-preset').value=settings.audioPreset||'auto';
$('#render-style').onchange=e=>{settings.renderStyle=e.target.value;persist();};$('#audio-preset').onchange=e=>{settings.audioPreset=e.target.value;persist();};
$('#gravity').closest('.property-section').insertAdjacentHTML('beforeend',`<div style="margin-top:18px"><label class="property-label" for="wind-speed">Ветер по оси X <output id="wind-value">${settings.windSpeed||0} м/с</output></label><input id="wind-speed" class="property-range" type="range" min="-15" max="15" value="${settings.windSpeed||0}" step=".5"/><div class="material-hint">Сопротивление воздуха зависит от относительной скорости и площади предмета.</div></div><div class="property-actions"><button class="toolbar-button" id="connection-world">${icon('link-2')}Связь</button><button class="toolbar-button" id="emitter-world">${icon('cloud-rain')}Источник</button></div>`);
$('#wind-speed').oninput=e=>{settings.windSpeed=Number(e.target.value);lab.settings.windSpeed=settings.windSpeed;$('#wind-value').textContent=settings.windSpeed+' м/с';if(!settings.windSpeed)lab.world.forEachRigidBody(b=>b.resetForces(true));persist();};
document.body.insertAdjacentHTML('beforeend',`
<dialog id="experiments-dialog" class="experiments-dialog"><div class="dialog-head"><div><div class="eyebrow">БИБЛИОТЕКА СЦЕН</div><h2>Шаблоны сцен</h2></div><button data-modal-close="experiments-dialog" aria-label="Закрыть">${icon('x')}</button></div><div class="experiment-cards" id="experiment-cards"></div><div class="dialog-actions"><button class="toolbar-button" id="choose-blank">Свободная сцена</button><button class="toolbar-button" data-modal-close="experiments-dialog">Вернуться</button></div></dialog>
<dialog id="connection-dialog"><div class="dialog-head"><h2>Связать предметы</h2><button data-modal-close="connection-dialog" aria-label="Закрыть">${icon('x')}</button></div><div class="dialog-body"><p>Связь участвует в расчёте. Можно построить собственный маятник, подвес, рычаг или пружинную систему.</p><label class="property-label" for="connection-a">Первый предмет</label><select class="field" id="connection-a"></select><label class="property-label" for="connection-b" style="margin-top:14px">Второй предмет или опора</label><select class="field" id="connection-b"></select><div class="property-row"><label for="connection-type">Тип связи</label><select class="field" id="connection-type" style="width:200px"><option value="hinge">Шарнир</option><option value="ball">Свободный подвес</option><option value="spring">Пружина</option><option value="rope">Верёвка</option><option value="fixed">Жёсткое соединение</option></select></div><div class="property-row"><label for="connection-axis">Ось шарнира</label><select class="field" id="connection-axis"><option value="x">X</option><option value="y">Y</option><option value="z">Z</option></select></div><p class="material-hint">При выборе пространства точка подвеса создаётся на 1,8 м выше первого предмета. Жёсткая связь сохраняет относительное положение предметов.</p></div><div class="dialog-actions"><button class="toolbar-button" data-modal-close="connection-dialog">Отмена</button><button class="toolbar-button primary" id="create-connection">Создать связь</button></div></dialog>
<dialog id="emitter-dialog"><div class="dialog-head"><h2>Источник предметов</h2><button data-modal-close="emitter-dialog" aria-label="Закрыть">${icon('x')}</button></div><div class="dialog-body"><p>Последовательно выпускает предметы с заданной высоты. Скорость и направление берутся из настроек начального движения.</p><label class="property-label" for="emitter-asset">Что выпускать</label><select class="field" id="emitter-asset">${CATALOG.filter(a=>a.id!=='softcube').map(a=>`<option value="${a.id}">${a.name}</option>`).join('')}</select><div class="property-row"><label for="emitter-count">Количество</label><input class="field" id="emitter-count" type="number" min="1" max="40" value="12"/></div><div class="property-row"><label for="emitter-height">Высота, м</label><input class="field" id="emitter-height" type="number" min="1" max="15" value="5" step=".5"/></div><div class="property-row"><label for="emitter-interval">Интервал, с</label><input class="field" id="emitter-interval" type="number" min=".1" max="3" value=".5" step=".1"/></div></div><div class="dialog-actions"><button class="toolbar-button" data-modal-close="emitter-dialog">Отмена</button><button class="toolbar-button primary" id="create-emitter">Добавить источник</button></div></dialog>`);
const concepts={impact:['Интерьер и столкновения','table'],cascade:['Цепная реакция','domino'],mechanism:['Рычаг и энергия','hammer'],soft:['Упругое и пластичное','softcube'],flow:['Вязкость и течение','bucket'],thermal:['Температура и плавление','ball'],orbit:['Центральное тяготение','brick']};
$('#experiment-cards').innerHTML=EXPERIMENTS.map(ex=>`<button class="experiment-card" data-concept="${ex.id}" style="--concept-color:${ex.color}"><div class="experiment-art"><img alt="${ex.title}" data-concept-image="${ex.id}"/><span>${icon(ex.icon)}</span></div><small>${concepts[ex.id]?.[0]||ex.tag}</small><strong>${ex.title}</strong><p>${ex.subtitle}</p><em>Готовая сцена · 4 сравнения ${icon('arrow-up-right')}</em></button>`).join('');
$('#open-experiments').onclick=()=>{$('#experiments-dialog').showModal();for(const ex of EXPERIMENTS){const a=CATALOG.find(a=>a.id===concepts[ex.id]?.[1]);if(a)$(`[data-concept-image="${ex.id}"]`).src=thumbnail(a);}};
document.querySelectorAll('[data-concept]').forEach(el=>el.onclick=()=>{remember();settings=settingsFor(el.dataset.concept);added=[];edits={};resetLab(true);view.autoMode=settings.cameraMode;$('#camera-director').value=view.autoMode;persist();$('#experiments-dialog').close();changeMode('editor');});
$('#choose-blank').onclick=()=>{$('#blank-scene').click();$('#experiments-dialog').close();};
document.querySelectorAll('[data-modal-close]').forEach(el=>el.onclick=()=>$('#'+el.dataset.modalClose).close());
function openConnections(){const list=lab.entities.filter(e=>e.id!=='ground'),labels=objectLabelMap(list);$('#connection-a').innerHTML=list.filter(e=>!e.fixed).map(e=>`<option value="${e.id}" ${e.id===selected?'selected':''}>${escape(objectLabel(e,labels))}</option>`).join('');$('#connection-b').innerHTML='<option value="world">Закрепить в пространстве</option>'+list.filter(e=>e.id!==selected).map(e=>`<option value="${e.id}">${escape(objectLabel(e,labels))}</option>`).join('');$('#connection-dialog').showModal();}
$('#add-connection').onclick=$('#connection-world').onclick=openConnections;
const connectionEditor=mountConnectionEditor({getState:project,getEntities:()=>lab.entities.filter(e=>e.id!=='ground'&&!e.id.startsWith('anchor-')),onCreate:openConnections,commitConnections:connections=>{
 const next=structuredClone(project());next.settings.connections=connections;
 validateProject(next);const prepared=new LabWorld(next.settings,next.objects,next.edits);
 remember();settings=next.settings;added=next.objects;edits=next.edits;resetLab(false,prepared);persist();
},notify:toast,icons:refreshIcons});
$('#add-connection').onclick=$('#connection-world').onclick=()=>connectionEditor.open();
$('#add-connection').setAttribute('aria-label','Связи предметов');
$('#create-connection').onclick=()=>{const a=$('#connection-a').value,b=$('#connection-b').value;if(!a||a===b){toast('Выберите два разных предмета');return;}if((settings.connections||[]).length>=150){toast('В сцене доступно до 150 связей.');return;}const spec={id:'connection-'+Date.now(),a,b,type:$('#connection-type').value,axis:$('#connection-axis').value,...($('#connection-type').value==='rope'?{visual:{enabled:true,color:'#DDD6BE',radius:.006}}:{})};try{const joint=lab.connect(spec);if(!joint)throw new Error('Для связи нужны существующие твёрдые предметы.');remember();settings.connections||=[];settings.connections.push(spec);view.sync(true);renderTree();persist();$('#connection-dialog').close();toast('Связь создана и включена в расчёт');}catch(error){toast(error.message);}};
function openEmitter(){if(['orbit','thermal'].includes(settings.experiment)){toast('Источники предметов доступны в механических сценах');return;}$('#emitter-asset').value=lab.find(selected)?.asset||'ball';$('#emitter-dialog').showModal();}
$('#add-emitter').onclick=$('#emitter-world').onclick=openEmitter;
$('#create-emitter').onclick=()=>{remember();const spec={id:'emitter-'+Date.now(),asset:$('#emitter-asset').value,count:Math.max(1,Math.min(40,Number($('#emitter-count').value))),interval:Math.max(.1,Math.min(3,Number($('#emitter-interval').value))),position:[view.controls.target.x,Math.max(1,Math.min(15,Number($('#emitter-height').value))),view.controls.target.z],speed:settings.speed,azimuth:settings.azimuth,elevation:settings.elevation,material:CATALOG.find(a=>a.id===$('#emitter-asset').value)?.mat||'rubber',scale:.65,mass:1};settings.emitters||=[];settings.emitters.push(spec);resetLab();persist();$('#emitter-dialog').close();toast('Источник добавлен. Нажмите запуск.');};
const composer=mountComposer({
 getState:project,getSelected:()=>selected,getEntities:()=>lab.entities.filter(e=>e.id!=='ground'&&!e.id.startsWith('anchor-')),
 getConnections:()=>lab.connections,onOpen:()=>setPlaying(false),
 commit:(spec,objects,connections=[])=>{
  const ids=new Set(added.filter(o=>o.generatorId===spec.id).map(o=>o.id)),next=structuredClone(project());
  next.objects=next.objects.filter(o=>!ids.has(o.id)).concat(objects);for(const id of ids)delete next.edits[id];
  next.settings.connections=(next.settings.connections||[]).filter(c=>c.generatorId!==spec.id&&!ids.has(c.a)&&!ids.has(c.b)).concat(connections);
  next.settings.generators=(next.settings.generators||[]).filter(g=>g.id!==spec.id);if(!spec.remove)next.settings.generators.push(spec);
  validateProject(next);const prepared=new LabWorld(next.settings,next.objects,next.edits);
  remember();settings=next.settings;added=next.objects;edits=next.edits;
  resetLab(false,prepared);persist();if(objects.length)view.frameObjects(objects);
 },
 preview:objects=>{setPlaying(false);view.autoMode='free';$('#camera-director').value='free';view.previewLayout(objects);},
 clearPreview:()=>view.clearLayoutPreview(),notify:toast,icons:refreshIcons,
});
$('.library-foot').innerHTML=`<button class="library-builder" id="library-builder">${icon('wand-sparkles')}Расстановка объектов<span>6 схем размещения</span></button>`;
$('#library-builder').onclick=()=>composer.open();
$('.scene-tools').appendChild($('#focus-stage'));
const storyEditor=mountStoryEditor({getState:project,getPreviewFrame:()=>view.screenshot(),getEntities:()=>[...lab.entities.filter(e=>e.id!=='ground'),...lab.softs],getSelected:()=>selected,commit:story=>{remember();settings.story=story;settings.renderStyle=story.theme==='editorial'?'light':'cinematic';lab.settings.story=story;renderInspector();renderTree();persist();},preview:()=>{setPlaying(false);rehearsal?.open();},notify:toast,icons:refreshIcons});
const comparisonEditor=mountComparisonEditor({getState:project,getEntities:()=>lab.entities,getSelected:()=>selected,commit:comparison=>{remember();settings.comparison=comparison;if(comparison.enabled&&comparison.targetId){settings.focusId=comparison.targetId;settings.autoLaunch=true;if(!settings.story?.heroId)settings.story={...settings.story,heroId:comparison.targetId};const value=comparison.values[settings.variant||0];if(['mass','material'].includes(comparison.field))edits[comparison.targetId]={...edits[comparison.targetId],[comparison.field]:value};else settings[comparison.field]=value;}resetLab();persist();},notify:toast,icons:refreshIcons});
$('#export-dialog .dialog-body').insertAdjacentHTML('afterbegin',`<button class="toolbar-button" id="open-comparison" style="margin-bottom:15px">${icon('git-compare-arrows')}Настроить серию сравнения</button>`);
$('#open-comparison').onclick=()=>{$('#export-dialog').close();comparisonEditor.open();};
$('#experiment-cards').insertAdjacentHTML('afterbegin',`<button class="experiment-card" id="open-crate-example"><div class="experiment-art"><img id="crate-example-thumb" alt="Стена из ящиков"/><span>${icon('boxes')}</span></div><small>Построение и сравнение</small><strong>36 ящиков. Один шар.</strong><p>Расстановка, снаряд и четыре скорости. Всё можно изменить.</p><em>Открыть сцену ${icon('arrow-up-right')}</em></button>`);
$('#crate-example-thumb').src=thumbnail(CATALOG.find(a=>a.id==='crate'));
$('#open-crate-example').onclick=async()=>{try{const p=await fetch('/projects/crate-wall.json').then(r=>r.json());applyProject(p,{rememberCurrent:true});$('#experiments-dialog').close();changeMode('editor');toast('Сцена открыта. Расстановка доступна в конструкторе, четыре скорости — в сравнении.');}catch{toast('Не удалось открыть сцену');}};
const workspaceShell=mountWorkspaceShell({openComposer:()=>composer.open(),openStory:()=>storyEditor.open(),notify:toast,icons:refreshIcons});
let savedPreviewCamera=null,savedPreviewUi=null;
function enterRehearsalReadonly(){
 if(savedPreviewUi)return;
 const nodes=[...document.querySelectorAll('.library,.inspector,.workspace-rail,.scene-tools,.preset-strip,#builder-preview-bar,#experiment-select,#workspace-story,#music-nav,#appearance,#help-top')];
 const returnButton=$('#rehearsal-open');
 savedPreviewUi={selected,mode:view.transform.getMode(),interaction:view.interactionEnabled,controls:view.controls.enabled,damping:view.controls.enableDamping,layoutPreview:view.layoutPreview?{node:view.layoutPreview,visible:view.layoutPreview.visible}:null,inert:nodes.map(node=>({node,inert:node.inert})),returnButton:returnButton?{node:returnButton,html:returnButton.innerHTML,label:returnButton.getAttribute('aria-label')}:null};
 if(!savedPreviewCamera)savedPreviewCamera={position:view.camera.position.clone(),target:view.controls.target.clone(),auto:view.autoMode};
 for(const node of nodes)node.inert=true;
 if(view.layoutPreview)view.layoutPreview.visible=false;
 view.setInteractionEnabled(false);view.autoMode='free';view.controls.enableDamping=false;
 document.body.classList.add('project-rehearsal-readonly');
 if(returnButton){returnButton.innerHTML=icon('corner-up-left')+'К сцене';returnButton.setAttribute('aria-label','Закончить репетицию и вернуться к сцене');refreshIcons();}
}
function leaveRehearsalReadonly(){
 const saved=savedPreviewUi;if(!saved)return;savedPreviewUi=null;
 document.body.classList.remove('project-rehearsal-readonly');
 for(const {node,inert}of saved.inert)node.inert=inert;
 if(saved.layoutPreview)saved.layoutPreview.node.visible=saved.layoutPreview.visible;
 view.setInteractionEnabled(saved.interaction!==false);view.controls.enabled=saved.controls;view.controls.enableDamping=saved.damping;view.transform.setMode(saved.mode);
 if(saved.returnButton){saved.returnButton.node.innerHTML=saved.returnButton.html;if(saved.returnButton.label)saved.returnButton.node.setAttribute('aria-label',saved.returnButton.label);else saved.returnButton.node.removeAttribute('aria-label');}
 select(saved.selected&&lab.find(saved.selected)?saved.selected:null);refreshIcons();
}
rehearsal=mountRehearsal({getProject:project,notify:toast,icons:refreshIcons,
 onLoadTake:(take,doc)=>{
  enterRehearsalReadonly();playing=false;
  if(playbackLab)playbackLab.dispose();const source=doc.sourceProject?.film?.clips?.[take.clipIndex]?.project||doc.sourceProject||project();playbackLab=new LabWorld(take.settings,source.objects||[],source.edits||{});
  for(const[id,edit]of Object.entries(source.edits||{})){const e=playbackLab.find(id);if(!e)continue;if(edit.deleted){playbackLab.remove(id);continue;}if(edit.material)playbackLab.setMaterial(id,edit.material);}
  view.load(playbackLab,false);view.setTheme((take.story||doc.story)?.theme!=='editorial');view.setEnvironment(take.settings?.environment||doc.environment);view.setGrid(false);view.autoMode='free';view.setInteractionEnabled(false);view.controls.enableDamping=false;
 },onFrame:(frame,take)=>view.applyRecordedFrame(frame,take),
 onStop:()=>{view.load(lab,false);view.setTheme(document.body.classList.contains('dark-lab'));if(playbackLab){playbackLab.dispose();playbackLab=null;}if(savedPreviewCamera){view.camera.position.copy(savedPreviewCamera.position);view.controls.target.copy(savedPreviewCamera.target);view.autoMode=savedPreviewCamera.auto;savedPreviewCamera=null;}view.camera.fov=40;view.camera.updateProjectionMatrix();leaveRehearsalReadonly();view.controls.update();updateStats();},
});
// Observe the actual rehearsal lifecycle, including loading, retry and internal
// close controls, rather than protecting only one entry button.
new MutationObserver(()=>{if(rehearsal?.active)enterRehearsalReadonly();else leaveRehearsalReadonly();}).observe($('#viewport-wrap'),{attributes:true,attributeFilter:['class']});
$('.scene-toolbar').insertAdjacentHTML('beforeend',`<button class="toolbar-button rehearsal-open" id="rehearsal-open">${icon('play')}Репетиция</button>`);
$('#rehearsal-open').onclick=async()=>{if(cameraStudio?.recording)await cameraStudio.stop();setPlaying(false);rehearsal.open();};
$('#export-resolution').insertAdjacentHTML('beforeend','<option value="2160">2160 × 3840 · 4K</option>');
$('#export-resolution').closest('.property-row').insertAdjacentHTML('afterend',`<div class="property-row"><label for="export-fps">Плавность движения</label><select class="field" id="export-fps" style="width:240px"><option value="24">24 кадра/с</option><option value="30" selected>30 кадров/с</option><option value="60">60 кадров/с</option></select></div>`);
$('#export-fps').value=settings.exportFps||30;$('#export-fps').onchange=e=>{settings.exportFps=Number(e.target.value);persist();};
$('#audio-preset').insertAdjacentHTML('beforeend','<option value="minimal">Минимализм</option><option value="selected-track" hidden>Выбранная композиция</option>');
const openExportDialog=$('#export-top').onclick;$('#export-top').onclick=()=>{openExportDialog();const track=TRACKS.find(t=>t.id===settings.musicTrack),option=$('#audio-preset').querySelector('[value="selected-track"]');option.hidden=!track;option.textContent=track?'Выбрано: '+track.title:'Выбранная композиция';$('#audio-preset').value=track?'selected-track':settings.audioPreset||'auto';$('#render-style').value=settings.story?.theme==='editorial'?'light':settings.renderStyle||'cinematic';$('#export-fps').value=settings.exportFps||30;};
$('#audio-preset').onchange=e=>{if(e.target.value==='selected-track')return;settings.audioPreset=e.target.value;settings.musicTrack=null;persist();};
$('#render-style').onchange=e=>{settings.renderStyle=e.target.value;settings.story||={};settings.story.theme=e.target.value==='light'?'editorial':'contrast';persist();};
$('#camera-director').setAttribute('aria-label','Камера в лаборатории');$('#camera-director').title='Камера ролика настраивается в режиссуре';$('#camera-director').options[0].textContent='Свободный обзор';$('#camera-director').options[1].textContent='Автофокус на действии';
refreshIcons();
const filmStudio=mountFilmStudio({getState:project,commitFilm:value=>{validateFilm(value);remember();film=value;persist();},loadProject:p=>applyProject(prepareFilmClipEditorProject(project(),p),{rememberCurrent:true}),exportFilm:()=>{$('#export-top').click();$('#export-series').value='film';},previewFilm:async()=>{if(cameraStudio?.recording)await cameraStudio.stop();setPlaying(false);if(rehearsal?.active)rehearsal.close();rehearsal?.open({series:false});},notify:toast,icons:refreshIcons});
$('#export-series').insertAdjacentHTML('beforeend','<option value="film">Монтаж сцен</option>');
const exportWithFilm=$('#export-top').onclick;$('#export-top').onclick=()=>{exportWithFilm();const option=$('#export-series').querySelector('[value=film]');option.disabled=!film.clips.length;option.textContent=`Монтаж · ${film.clips.length} клипов · ${Number(filmDuration(film).toFixed(1)).toLocaleString('ru-RU')} с`;if(film.enabled&&film.clips.length)$('#export-series').value='film';};
const projectLibrary=mountProjectLibrary({getState:project,applyProject:p=>applyProject(p,{rememberCurrent:true}),notify:toast,icons:refreshIcons,onSaved:metadata=>{projectId=metadata.id;persist();}});
$('#save-project').onclick=async()=>{if(cameraStudio?.recording)await cameraStudio.stop();return projectLibrary.save();};$('#open-project').onclick=async()=>{if(cameraStudio?.recording)await cameraStudio.stop();projectLibrary.open();};
$('#film-open').onclick=async()=>{if(cameraStudio?.recording)await cameraStudio.stop();filmStudio.open();};
window.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'){e.preventDefault();$('#save-project').click();}});
$('#export-dialog .dialog-body').insertAdjacentHTML('beforeend','<p id="render-availability" class="material-hint" role="status"></p>');
const exportWithStatus=$('#export-top').onclick;$('#export-top').onclick=async()=>{exportWithStatus();const status=$('#render-availability');status.textContent='Проверка видеорендера…';try{const response=await fetch('/api/render-status'),state=await response.json();$('#start-export').disabled=!state.ok;status.textContent=state.ok?(state.mode==='worker'?'Mac render worker подключён.':'Локальный видеорендер доступен.'):(state.error||'Видеорендер недоступен.');}catch{$('#start-export').disabled=true;status.textContent='Нет связи с сервером студии.';}};

// Authoring tools operate on the same saved scene used by the automatic worker.
const stageEditor=mountStageEditor({getState:project,commit:patch=>{remember();settings={...settings,...patch};lab.settings.environment=settings.environment;view.setEnvironment(normalizeEnvironment(settings.environment));persist();},notify:toast,icons:refreshIcons});
$('.scene-tools').insertAdjacentHTML('beforeend',`<button id="stage-style" aria-label="Окружение и звук" title="Окружение, свет и звук">${icon('palette')}<span class="studio-tool-label">Оформление</span></button>`);
$('#stage-style').onclick=()=>stageEditor.open();
$('#save-project').setAttribute('aria-label','Сохранить проект');$('#save-project').title='Сохранить проект';

const kitCards=SCENARIO_KITS.map(kit=>`<button class="experiment-card authored-kit" data-kit="${kit.id}" style="--concept-color:${kit.accent}"><div class="experiment-art">${kit.assetPreview.map((asset,i)=>`<img class="kit-item kit-item-${i}" alt="" data-kit-asset="${asset}"/>`).join('')}<span>${icon(kit.icon)}</span></div><small>${escape(kit.countHint)}</small><strong>${escape(kit.title)}</strong><p>${escape(kit.description)}</p><em>Редактируемая сцена ${icon('arrow-up-right')}</em></button>`).join('');
$('#experiment-cards').insertAdjacentHTML('afterbegin',kitCards);
for(const image of document.querySelectorAll('[data-kit-asset]')){const asset=CATALOG.find(a=>a.id===image.dataset.kitAsset);if(asset)image.src=thumbnail(asset);}
for(const button of document.querySelectorAll('[data-kit]'))button.onclick=()=>{if(rehearsal?.active)rehearsal.close();cameraStudio?.stop();const p=createScenarioKit(button.dataset.kit);p.settings.environment=normalizeEnvironment('gallery');p.settings.story.theme='editorial';p.settings.story.effects={slowMotion:true,heroOutline:false,eventPulse:false,trail:false,reference:false};applyProject(p,{rememberCurrent:true});$('#experiments-dialog').close();changeMode('editor');toast('Сцена готова. Предметы, расстановка, камера и свет редактируются.');};

async function seekPhysics(seconds){
 setPlaying(false);resetLab(false);
 const generation=seekGeneration,world=lab,total=Math.round(Math.max(0,Math.min(20,seconds))*120);
 let step=0;$('#scene-state').textContent='Переход к кадру…';
 while(step<total){
  await new Promise(resolve=>requestAnimationFrame(resolve));
  if(generation!==seekGeneration||world!==lab||playing)return;
  const deadline=performance.now()+8;
  do{world.step();step++;}while(step<total&&performance.now()<deadline);
  $('#scene-state').textContent=`Переход к кадру · ${Math.round(step/total*100)}%`;
 }
 if(generation!==seekGeneration||world!==lab||playing)return;
 view.sync(true);updateStats();$('#scene-state').textContent='Пауза';
}
cameraStudio=mountCameraStudio({getState:project,commitRig:rig=>{remember();settings.cameraRig=rig;settings.story={...settings.story,camera:rig.mode==='auto'?'auto':'manual'};persist();},view,getTime:()=>lab.time,getHeroPosition:id=>{const p=lab.position(id);return p?[p.x,p.y,p.z]:null;},getSelected:()=>selected||settings.story?.heroId||settings.focusId,reset:()=>resetLab(false),play:()=>setPlaying(true),pause:()=>setPlaying(false),isPlaying:()=>playing,isRehearsal:()=>!!rehearsal?.active,seekPhysics,notify:toast,icons:refreshIcons});
if(cameraStudio.configuredManual)workspaceShell.chooseWorkflow('shoot');
$('.camera-studio-live-tools').insertAdjacentHTML('beforeend',`<button id="camera-look" class="camera-btn camera-icon-btn" aria-label="Свет, фон и звук" title="Свет, фон и звук">${icon('palette')}</button>`);$('#camera-look').onclick=()=>stageEditor.open();
const stopBeforePreview=$('#rehearsal-open').onclick;$('#rehearsal-open').onclick=async()=>{if(cameraStudio.recording)await cameraStudio.stop();await stopBeforePreview();};
let recordedSceneUi=null;
function protectRecordedScene(){
 if(cameraStudio?.recording&&!recordedSceneUi){const nodes=[...document.querySelectorAll('.library,.inspector,.scene-tools,.preset-strip,#experiment-select,#workspace-story')];recordedSceneUi=nodes.map(node=>({node,inert:node.inert}));for(const node of nodes)node.inert=true;document.body.classList.add('camera-recording');}
 else if(!cameraStudio?.recording&&recordedSceneUi){for(const{node,inert}of recordedSceneUi)node.inert=inert;recordedSceneUi=null;document.body.classList.remove('camera-recording');}
}
refreshIcons();

mountProjectTemplates({host:$('#experiment-cards'),onOpenProject:p=>{applyProject(p,{rememberCurrent:true});$('#experiments-dialog').close();changeMode('editor');},notify:toast,icons:refreshIcons});
const interactionEditor=mountInteractionEditor({getState:project,getEntities:()=>[...lab.entities,...lab.softs],getSelected:()=>selected,commitProject:p=>applyProject(p,{rememberCurrent:true}),notify:toast,icons:refreshIcons});
$('.scene-tools').insertAdjacentHTML('beforeend',`<button id="interaction-editor-open" aria-label="Физические взаимодействия" title="Деформация, проникновение и разрываемые связи">${icon('atom')}<span class="studio-tool-label">Взаимодействия</span></button><button id="context-view-open" aria-label="Кадр в кадре" title="Дополнительный общий план">${icon('picture-in-picture-2')}</button>`);
$('#interaction-editor-open').onclick=()=>interactionEditor.open();
function frameSelection(){view.autoMode='free';$('#camera-director').value='free';view.frameScene(selected);}
$('.scene-tools').insertAdjacentHTML('beforeend',`<button id="frame-selection" aria-label="Вписать предмет или сцену" title="Вписать предмет или всю сцену · F">${icon('scan')}</button>`);$('#frame-selection').onclick=frameSelection;
const contextViewEditor=mountContextViewEditor({getState:project,getCamera:()=>({position:view.camera.position.toArray(),target:view.controls.target.toArray(),fov:view.camera.fov}),commit:config=>{remember();if(config)settings.contextView=config;else delete settings.contextView;lab.settings.contextView=config;persist();},notify:toast,icons:refreshIcons});
$('#context-view-open').onclick=()=>contextViewEditor.open();
const annotationEditor=mountSceneAnnotationEditor({getState:project,getEntities:()=>[...lab.entities,...lab.softs],getSelected:()=>selected,commitAnnotations:value=>{remember();settings.annotations=value;lab.settings.annotations=value;persist();},notify:toast,icons:refreshIcons});
$('.scene-tools').insertAdjacentHTML('beforeend',`<button id="scene-annotations-open" aria-label="Подписи в пространстве" title="Подписи и шкалы в сцене">${icon('type')}</button>`);$('#scene-annotations-open').onclick=()=>annotationEditor.open();
refreshIcons();
mountScenePicker({select:$('#experiment-select')});
mountToolbarOverflow({container:$('.scene-tools')});
mountScrollCue({element:$('.workspace-rail')});
view.resize();view.render();window.dispatchEvent(new Event('matter:ready'));
