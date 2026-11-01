const shells=new WeakMap();
// Layout-only shell. Existing scene, catalog and physics controls keep their
// original nodes and listeners; the rail opens the same library at small widths.
export function mountWorkspaceShell({openComposer,openStory,openProjects,notify=()=>{},icons=()=>{}}={}) {
  const $=selector=>document.querySelector(selector);
  const workspace=$('#workspace'),library=$('.library'),stage=$('.stage-column'),inspectorPanel=$('.inspector');
  if(!workspace||!library||!stage)return {destroy(){}};
  if(shells.has(workspace))return shells.get(workspace);
  workspace.dataset.premiumShell='ready';
  document.body.classList.add('premium-shell','spatial-studio');
  const media=window.matchMedia('(max-width: 1350px)');
  let activeTab=$('[data-library].active')?.dataset.library||'catalog';
  const rail=document.createElement('nav');
  rail.className='workspace-rail';rail.setAttribute('aria-label','Инструменты студии');
  rail.innerHTML=`
    <div class="workspace-rail-top">
      <button type="button" class="studio-workflow-button active" data-workflow="build" title="Собрать сцену: предметы, материалы и физика"><i data-lucide="box"></i><span>Сборка</span><small>01</small></button>
      <button type="button" class="studio-workflow-button" data-workflow="shoot" title="Настроить камеру и снять движение"><i data-lucide="video"></i><span>Съёмка</span><small>02</small></button>
      <button type="button" class="studio-workflow-button" data-rail-action="montage" title="Собрать и смонтировать ролик"><i data-lucide="panels-top-left"></i><span>Монтаж</span><small>03</small></button>
      <button type="button" data-rail-action="projects" title="Открыть проекты"><i data-lucide="folder-open"></i><span>Проекты</span></button>
      <span class="workspace-rail-divider" aria-hidden="true"></span>
      <button type="button" data-rail-tab="catalog" aria-label="Предметы" aria-controls="matter-library" aria-expanded="false" title="Предметы"><i data-lucide="shapes"></i><span>Предметы</span></button>
      <button type="button" data-rail-tab="tree" aria-label="Предметы в сцене" aria-controls="matter-library" aria-expanded="false" title="Слои сцены"><i data-lucide="layers-2"></i><span>Слои</span></button>
      <button type="button" data-rail-action="compose" aria-label="Конструктор расстановки" title="Расстановка"><i data-lucide="grid-2x2-plus"></i><span>Расстановка</span></button>
      <span class="workspace-rail-divider" aria-hidden="true"></span>
      <button type="button" data-rail-action="story" aria-label="Текст и графика ролика" title="Текст и графика"><i data-lucide="captions"></i><span>Титры</span></button>
      <button type="button" data-rail-action="comparison" aria-label="Сравнение вариантов" title="Один параметр — четыре опыта"><i data-lucide="git-compare-arrows"></i><span>Сравнение</span></button>
      <button type="button" data-rail-action="properties" aria-label="Свойства предмета и сцены" aria-expanded="false" title="Свойства"><i data-lucide="sliders-horizontal"></i><span>Свойства</span></button>
      <span class="workspace-rail-divider" aria-hidden="true"></span>
      <button type="button" data-workflow="gallery" title="Готовые видео"><i data-lucide="gallery-vertical-end"></i><span>Экспорты</span></button>
    </div>
    <button type="button" class="workspace-rail-help" data-rail-action="help" aria-label="Помощь по студии" title="Помощь"><i data-lucide="circle-help"></i><span>Помощь</span></button>`;
  workspace.parentElement.insertBefore(rail,workspace);library.id='matter-library';
  workspace.dataset.workflow='build';
  const projectHeader=document.createElement('button');projectHeader.type='button';projectHeader.className='studio-project';projectHeader.setAttribute('aria-label','Открыть проекты');projectHeader.setAttribute('aria-haspopup','dialog');
  projectHeader.innerHTML='<span class="studio-project-path"><i data-lucide="folder-open"></i>Проекты<i data-lucide="chevron-down"></i></span><strong class="studio-project-name"></strong>';
  projectHeader.onclick=()=>{
    if(document.body.classList.contains('project-rehearsal-readonly')){notify('Закройте просмотр ролика, чтобы открыть другой проект.');return;}
    return typeof openProjects==='function'?openProjects():$('#open-project')?.click();
  };
  $('.brand')?.after(projectHeader);
  const inspectorStripe=document.createElement('div');inspectorStripe.className='studio-inspector-stripe';
  inspectorPanel?.prepend(inspectorStripe);
  const sceneTitle=document.createElement('span');sceneTitle.className='studio-workflow-indicator';sceneTitle.textContent='Сцена';
  $('.scene-info')?.prepend(sceneTitle);
  const oldLibraryTitle=$('.panel-title')?.textContent;
  const galleryTitle=$('.gallery-heading h1'),oldGalleryTitle=galleryTitle?.textContent;
  if(galleryTitle)galleryTitle.textContent='Видеостудия';
  const libraryClose=document.createElement('button');
  libraryClose.type='button';libraryClose.className='premium-library-close';
  libraryClose.setAttribute('aria-label','Закрыть библиотеку');
  libraryClose.innerHTML='<i data-lucide="panel-left-close"></i>';
  $('.panel-top')?.append(libraryClose);
  const inspectorClose=document.createElement('button');inspectorClose.type='button';inspectorClose.className='premium-inspector-close';
  inspectorClose.setAttribute('aria-label','Закрыть свойства');inspectorClose.innerHTML='<i data-lucide="panel-right-close"></i>';
  $('.inspector-header')?.append(inspectorClose);
  const storyButton=document.createElement('button');
  storyButton.id='workspace-story';storyButton.type='button';
  storyButton.className='workspace-story-button';
  storyButton.innerHTML='<i data-lucide="captions"></i><span>Титры</span>';
  storyButton.setAttribute('aria-label','Текст и графика ролика');
  $('.scene-toolbar')?.append(storyButton);
  const tools=$('.scene-tools'),oldToolsParent=tools?.parentElement;
  const toolrack=document.createElement('div');toolrack.className='studio-toolrack';toolrack.setAttribute('aria-label','Инструменты сборки сцены');
  toolrack.innerHTML='';
  if(tools){toolrack.append(tools);$('#viewport-wrap')?.before(toolrack);}
  const toolLabels={translate:'Двигать',rotate:'Вращать',array:'Расстановка','open-experiments':'Шаблоны','add-connection':'Связь','add-emitter':'Источник'};
  for(const[id,label]of Object.entries(toolLabels)){const button=$('#'+id);if(button){const span=document.createElement('span');span.className='studio-tool-label';span.textContent=label;button.append(span);}}
  for(const id of ['translate','array','add-connection','focus-stage'])$('#'+id)?.classList.add('tool-group-start');
  // Existing controls now have native tooltips even when their custom tooltip
  // cannot fit near a viewport edge.
  for(const button of tools?.querySelectorAll('button')||[]) {
    const label=button.getAttribute('aria-label');if(label&&!button.title)button.title=label;
  }
  const chooseStory=()=>{
    closeLibrary();closeInspector();
    if(typeof openStory==='function')openStory();
    else if($('#story-open'))$('#story-open').click();
    else notify('Редактор режиссуры ещё загружается. Попробуйте снова.');
  };
  const chooseComposer=()=>{
    closeLibrary();closeInspector();
    if(typeof openComposer==='function')openComposer();
    else $('#library-builder')?.click();
  };
  function syncRail() {
    const current=$('#gallery')?.classList.contains('hidden')===false?'gallery':workspace.dataset.workflow||'build';
    const open=current!=='gallery'&&((!media.matches&&!workspace.classList.contains('focus-stage'))||workspace.classList.contains('library-open'));
    for(const button of rail.querySelectorAll('[data-rail-tab]')) {
      const active=open&&button.dataset.railTab===activeTab;
      button.classList.toggle('active',active);
      button.setAttribute('aria-expanded',String(active));
    }
    const editing=$('#film-dialog')?.open;
    for(const button of rail.querySelectorAll('[data-workflow]')){const active=button.dataset.workflow===current&&!(editing&&button.dataset.workflow==='shoot');button.classList.toggle('active',active);button.setAttribute('aria-current',active?'step':'false');}
    rail.querySelector('[data-rail-action="montage"]')?.classList.toggle('active',!!editing);
    if($('.panel-title'))$('.panel-title').textContent=activeTab==='tree'?'Объекты сцены':'Библиотека';
  }
  function chooseWorkflow(mode){
    if(mode==='gallery')$('.mode-nav [data-mode="gallery"]')?.click();
    else{
      $('.mode-nav [data-mode="editor"]')?.click();workspace.dataset.workflow=mode;
      sceneTitle.textContent=mode==='shoot'?'Камера':'Сцена';
      document.dispatchEvent(new CustomEvent('matter:workflow',{detail:{mode}}));
      if(mode==='shoot'){const bar=$('.camera-studio-bar');if(bar){bar.tabIndex=-1;bar.focus({preventScroll:true});}}
    }
    syncRail();
  }
  function closeLibrary() {
    workspace.classList.remove('library-open');syncRail();
  }
  function closeInspector(){workspace.classList.remove('inspector-open');rail.querySelector('[data-rail-action="properties"]')?.setAttribute('aria-expanded','false');}
  function openLibrary(tab='catalog') {
    closeInspector();
    activeTab=tab==='tree'?'tree':'catalog';
    $(`[data-library="${activeTab}"]`)?.click();
    workspace.classList.add('library-open');syncRail();
  }
  const onRailClick=event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.dataset.workflow){chooseWorkflow(button.dataset.workflow);return;}
    if(document.body.classList.contains('project-rehearsal-readonly')){notify('Закройте просмотр ролика, чтобы вернуться к сцене.');return;}
    if(button.dataset.railAction==='projects'){projectHeader.click();return;}
    if($('#gallery')?.classList.contains('hidden')===false)chooseWorkflow('build');
    if(button.dataset.railTab) {
      if(workspace.classList.contains('library-open')&&activeTab===button.dataset.railTab)closeLibrary();
      else openLibrary(button.dataset.railTab);
    }
    if(button.dataset.railAction==='compose')chooseComposer();
    if(button.dataset.railAction==='story')chooseStory();
    if(button.dataset.railAction==='montage'){chooseWorkflow('shoot');$('#film-open')?.click();syncRail();}
    if(button.dataset.railAction==='comparison')$('#open-comparison')?.click();
    if(button.dataset.railAction==='help')$('#help-top')?.click();
    if(button.dataset.railAction==='properties'){
      const open=!workspace.classList.contains('inspector-open');closeLibrary();workspace.classList.toggle('inspector-open',open);button.setAttribute('aria-expanded',String(open));
    }
  };
  rail.addEventListener('click',onRailClick);
  storyButton.addEventListener('click',chooseStory);
  libraryClose.addEventListener('click',closeLibrary);
  inspectorClose.addEventListener('click',closeInspector);
  const onLibraryClick=event=>{
    const tab=event.target.closest('[data-library]');if(tab){activeTab=tab.dataset.library;syncRail();}
    if(media.matches&&event.target.closest('[data-asset],[data-entity]'))closeLibrary();
  };
  library.addEventListener('click',onLibraryClick);
  const onOutsidePointer=event=>{
    if(media.matches&&workspace.classList.contains('library-open')&&!library.contains(event.target)&&!rail.contains(event.target))closeLibrary();
    if(workspace.classList.contains('inspector-open')&&!inspectorPanel?.contains(event.target)&&!rail.contains(event.target))closeInspector();
  };
  // Do not put a scrim over the viewport: it must remain a valid drag target.
  const onDragOver=event=>{
    if(media.matches&&event.target.closest('#viewport-wrap'))closeLibrary();
  };
  const onEscape=event=>{
    if(event.key==='Escape'&&workspace.classList.contains('library-open')&&!$('dialog[open]')) {
      closeLibrary();rail.querySelector(`[data-rail-tab="${activeTab}"]`)?.focus();
    }
    if(event.key==='Escape'&&workspace.classList.contains('inspector-open')&&!$('dialog[open]'))closeInspector();
  };
  document.addEventListener('pointerdown',onOutsidePointer);
  document.addEventListener('keydown',onEscape);
  workspace.addEventListener('dragover',onDragOver);
  const onMediaChange=()=>{closeLibrary();closeInspector();};media.addEventListener('change',onMediaChange);
  const onModeClick=event=>{if(event.target.closest('[data-mode]')){closeLibrary();syncRail();}};
  $('.mode-nav')?.addEventListener('click',onModeClick);
  const onFocusClick=()=>{closeLibrary();closeInspector();};$('#focus-stage')?.addEventListener('click',onFocusClick);

  // Collapse sections without replacing controls, IDs, or their event handlers.
  const inspector=$('.inspector-scroll');
  const prepareHeadings=()=>{
    for(const heading of inspector?.querySelectorAll('.property-section > .section-heading')||[]) {
      heading.setAttribute('role','button');heading.tabIndex=0;
      heading.setAttribute('aria-expanded',String(!heading.parentElement.classList.contains('is-collapsed')));
      heading.title='Свернуть или раскрыть раздел';
    }
  };
  const toggleSection=heading=>{
    const collapsed=heading.parentElement.classList.toggle('is-collapsed');
    heading.setAttribute('aria-expanded',String(!collapsed));
  };
  const onInspectorClick=event=>{
    const heading=event.target.closest('.property-section > .section-heading');
    if(heading&&inspector.contains(heading))toggleSection(heading);
  };
  const onInspectorKey=event=>{
    const heading=event.target.closest('.property-section > .section-heading');
    if(heading&&(event.key==='Enter'||event.code==='Space')) {
      event.preventDefault();event.stopPropagation();toggleSection(heading);
    }
  };
  inspector?.addEventListener('click',onInspectorClick);
  inspector?.addEventListener('keydown',onInspectorKey);
  const inspectorObserver=new MutationObserver(prepareHeadings);
  if(inspector)inspectorObserver.observe(inspector,{childList:true,subtree:true});
  const refreshProject=()=>{const select=$('#experiment-select');projectHeader.querySelector('strong').textContent=select?.selectedOptions[0]?.textContent||'Новая сцена';};
  const projectObserver=new MutationObserver(refreshProject);if($('#presets'))projectObserver.observe($('#presets'),{childList:true});
  $('#experiment-select')?.addEventListener('change',refreshProject);
  const modeObserver=new MutationObserver(syncRail);if($('#gallery'))modeObserver.observe($('#gallery'),{attributes:true,attributeFilter:['class']});
  const dialogObserver=new MutationObserver(syncRail);dialogObserver.observe(document.body,{subtree:true,attributes:true,attributeFilter:['open']});
  prepareHeadings();refreshProject();icons();syncRail();
  const shell={
    openLibrary,closeLibrary,chooseWorkflow,
    destroy(){
      document.body.classList.remove('premium-shell','spatial-studio');delete workspace.dataset.premiumShell;delete workspace.dataset.workflow;
      closeLibrary();closeInspector();rail.remove();libraryClose.remove();inspectorClose.remove();storyButton.remove();
      if(tools&&oldToolsParent)oldToolsParent.append(tools);
      toolrack.remove();projectHeader.remove();inspectorStripe.remove();sceneTitle.remove();tools?.querySelectorAll('.studio-tool-label').forEach(n=>n.remove());
      if($('.panel-title'))$('.panel-title').textContent=oldLibraryTitle;if(galleryTitle)galleryTitle.textContent=oldGalleryTitle;
      document.removeEventListener('pointerdown',onOutsidePointer);document.removeEventListener('keydown',onEscape);
      workspace.removeEventListener('dragover',onDragOver);media.removeEventListener('change',onMediaChange);
      $('.mode-nav')?.removeEventListener('click',onModeClick);$('#focus-stage')?.removeEventListener('click',onFocusClick);
      library.removeEventListener('click',onLibraryClick);inspector?.removeEventListener('click',onInspectorClick);
      inspector?.removeEventListener('keydown',onInspectorKey);inspectorObserver.disconnect();projectObserver.disconnect();modeObserver.disconnect();dialogObserver.disconnect();$('#experiment-select')?.removeEventListener('change',refreshProject);
      for(const heading of inspector?.querySelectorAll('.section-heading[role=button]')||[]){heading.removeAttribute('role');heading.removeAttribute('tabindex');heading.removeAttribute('aria-expanded');heading.parentElement.classList.remove('is-collapsed');}
      shells.delete(workspace);
    },
  };
  shells.set(workspace,shell);return shell;
}
