import { COMPARISON_FIELDS, COMPARISON_MATERIALS, normalizeComparison, comparisonVariants } from './comparison.js';
import { objectLabelMap, objectLabel } from './object-labels.js';
import { normalizedStory } from './storyboard.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
const css = `
.comparison-dialog{width:min(940px,calc(100% - 32px));max-height:calc(100dvh - 40px);color:var(--ink);overflow:hidden}.comparison-dialog .dialog-head{padding:25px 27px}.comparison-dialog h2{font-size:25px;letter-spacing:-.8px;font-weight:550}.comparison-dialog .dialog-head p{font-size:12px;color:var(--sub);margin:9px 0 0}.comparison-body{padding:23px 27px;overflow:auto;max-height:calc(100dvh - 255px)}.comparison-enable{display:flex;align-items:center;gap:10px;font-size:13px;font-weight:550;margin-bottom:24px}.comparison-enable input{accent-color:#a9c76b;width:16px;height:16px}.comparison-control-row{display:grid;grid-template-columns:1fr 1fr;gap:18px}.comparison-field{display:flex;flex-direction:column;gap:8px;min-width:0}.comparison-field>label{font-size:11px;color:var(--sub)}.comparison-dialog .field{font-size:12px;padding:11px 12px;width:100%;box-sizing:border-box}.comparison-hint{color:var(--sub);font-size:11px;line-height:1.65;margin:14px 0 23px;min-height:36px}.comparison-overline{display:flex;justify-content:space-between;gap:12px;font-size:9px;letter-spacing:1px;color:var(--sub);margin-bottom:13px}.comparison-overline span{letter-spacing:0}.comparison-takes{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.comparison-take{padding:16px 13px;border:1px solid var(--border);border-radius:9px;background:color-mix(in srgb,var(--paper) 92%,#879a76 8%);min-width:0}.comparison-take-number{font-size:11px;color:var(--sub);font-variant-numeric:tabular-nums;margin-bottom:20px;display:flex;align-items:center;gap:8px}.comparison-take-number:before{content:'';height:6px;width:6px;border-radius:50%;background:#a9c76b}.comparison-value{display:flex;align-items:center;gap:5px;min-width:0}.comparison-value .field{font-size:18px;letter-spacing:-.3px;padding:10px 8px;min-width:0}.comparison-value select.field{font-size:12px;letter-spacing:0}.comparison-unit{font-size:10px;color:var(--sub);white-space:nowrap}.comparison-take .comparison-field+.comparison-field{margin-top:18px}.comparison-take input[type=text]{font-size:11px}.comparison-explanation{display:flex;align-items:flex-start;gap:12px;border-top:1px solid var(--border);padding-top:19px;margin-top:24px;font-size:11px;line-height:1.7;color:var(--sub)}.comparison-explanation svg{width:17px;min-width:17px;margin-top:3px}.comparison-explanation strong{color:var(--ink);font-weight:550}.comparison-error{font-size:11px;color:#d98660;line-height:1.6;min-height:18px;margin-top:14px}.comparison-dialog .dialog-actions{padding:17px 27px;background:var(--paper)}.comparison-footer-note{margin-right:auto;color:var(--sub);font-size:10px;line-height:1.5;max-width:420px}.comparison-disabled .comparison-settings{opacity:.55}.comparison-take .field:invalid{border-color:#d98660}.dark-lab .comparison-dialog{color:#dcecf3}.dark-lab .comparison-explanation strong{color:#dcecf3}.dark-lab .comparison-dialog .dialog-actions{background:#142d3d}
@media(max-width:660px){.comparison-dialog{width:calc(100% - 16px)}.comparison-dialog .dialog-head{padding:19px}.comparison-dialog h2{font-size:21px}.comparison-body{padding:19px;max-height:calc(100dvh - 245px)}.comparison-control-row{grid-template-columns:1fr;gap:15px}.comparison-takes{grid-template-columns:1fr 1fr;gap:10px}.comparison-take-number{margin-bottom:13px}.comparison-dialog .dialog-actions{padding:14px 19px}.comparison-footer-note{display:none}.comparison-overline{font-size:8px}.comparison-hint{min-height:0}}
`;

/** The host persists the normalized spec in settings.comparison via commit(). */
export function mountComparisonEditor({ getState, getEntities = () => [], getSelected = () => null, commit, notify = () => {}, icons = () => {} }) {
  if (typeof getState !== 'function' || typeof commit !== 'function') throw new Error('Comparison editor needs getState() and commit()');
  if (document.getElementById('comparison-dialog')) throw new Error('Comparison editor is already mounted');
  const style = document.createElement('style'); style.textContent = css; style.id = 'comparison-editor-styles'; document.head.appendChild(style);
  document.body.insertAdjacentHTML('beforeend', `<dialog id="comparison-dialog" class="comparison-dialog" aria-labelledby="comparison-title"><div class="dialog-head"><div><div class="eyebrow">СЕРИЯ ЭКСПЕРИМЕНТОВ</div><h2 id="comparison-title">Сравнение параметров</h2><p>Четыре варианта одного параметра в текущей сцене.</p></div><button id="comparison-close" aria-label="Закрыть сравнение"><i data-lucide="x"></i></button></div><div class="comparison-body"><label class="comparison-enable"><input id="comparison-enabled" type="checkbox"/>Серия сравнений</label><div class="comparison-settings"><div class="comparison-control-row"><div class="comparison-field"><label for="comparison-field">Параметр</label><select class="field" id="comparison-field">${COMPARISON_FIELDS.map(f => `<option value="${f.id}">${f.name}</option>`).join('')}</select></div><div class="comparison-field"><label for="comparison-target">Объект воздействия</label><select class="field" id="comparison-target"></select></div></div><p class="comparison-hint" id="comparison-hint"></p><div class="comparison-overline">ЧЕТЫРЕ ВАРИАНТА<span id="comparison-duration"></span></div><div class="comparison-takes" id="comparison-takes"></div></div><div class="comparison-explanation"><i data-lucide="git-compare-arrows"></i><div><strong>Условия сравнения</strong><br>Каждый вариант запускается из исходного состояния сцены. Изменяется выбранный параметр. Длительность задаётся в редакторе ролика.</div></div><div id="comparison-error" class="comparison-error" role="status" aria-live="polite"></div></div><div class="dialog-actions"><span class="comparison-footer-note">Сравнение сохраняется в проекте.</span><button id="comparison-cancel" class="toolbar-button">Отмена</button><button id="comparison-save" class="toolbar-button primary"><i data-lucide="check"></i>Сохранить сравнение</button></div></dialog>`);
  const $ = id => document.getElementById(id);
  let entities = [], draft = normalizeComparison(), busy = false;
  const currentField = () => COMPARISON_FIELDS.find(f => f.id === $('comparison-field').value) || COMPARISON_FIELDS[0];
  const numeric = value => typeof value === 'string' && value.trim() ? Number(value.trim().replace(',', '.')) : NaN;
  const rigid = entity => entity && entity.id && entity.id !== 'ground' && !String(entity.id).startsWith('anchor-') && !entity.soft && entity.asset !== 'softcube';

  function collect() {
    return {
      enabled: $('comparison-enabled').checked, field: $('comparison-field').value, targetId: $('comparison-target').value,
      values: Array.from({ length: 4 }, (_, i) => currentField().id === 'material' ? $('comparison-value-' + i).value : numeric($('comparison-value-' + i).value)),
      labels: Array.from({ length: 4 }, (_, i) => $('comparison-label-' + i).value),
    };
  }
  function validate() {
    const raw = collect(), field = currentField(); let error = '';
    if (raw.enabled && field.id !== 'gravity' && !entities.some(e => String(e.id) === raw.targetId)) error = 'Выберите объект сцены.';
    if(raw.enabled&&['speed','mass','elevation'].includes(field.id)&&entities.find(e=>String(e.id)===raw.targetId)?.fixed)error='Скорость, массу и угол броска можно менять у незакреплённого объекта.';
    if (raw.enabled) raw.values.forEach((value, i) => {
      if (error) return;
      if (field.id === 'material' && !COMPARISON_MATERIALS.some(m => m.id === value)) error = `Вариант ${i + 1}: выберите материал твёрдого тела.`;
      else if (field.id !== 'material' && (!Number.isFinite(value) || value < field.min || value > field.max)) error = `Вариант ${i + 1}: введите число от ${field.min} до ${field.max} ${field.unit}.`;
    });
    $('comparison-save').disabled = busy || !!error;
    $('comparison-error').textContent = error || (raw.enabled && new Set(raw.values).size < 4 ? 'Повторяющиеся значения дадут одинаковые условия.' : '');
    $('comparison-dialog').classList.toggle('comparison-disabled', !raw.enabled);
    return !error;
  }
  function renderValues() {
    const field = currentField(), labels = comparisonVariants({ ...draft, enabled: true });
    $('comparison-takes').innerHTML = Array.from({ length: 4 }, (_, i) => `<div class="comparison-take"><div class="comparison-take-number">0${i + 1} / ВАРИАНТ</div><div class="comparison-field"><label for="comparison-value-${i}">${field.id === 'material' ? 'Материал' : 'Значение'}</label><div class="comparison-value">${field.id === 'material' ? `<select class="field" id="comparison-value-${i}" aria-label="Материал в опыте ${i + 1}">${COMPARISON_MATERIALS.map(m => `<option value="${m.id}" ${draft.values[i] === m.id ? 'selected' : ''}>${m.name}</option>`).join('')}</select>` : `<input class="field" id="comparison-value-${i}" type="number" min="${field.min}" max="${field.max}" step="${field.step}" value="${draft.values[i]}" required aria-label="${field.name} в опыте ${i + 1}"/><span class="comparison-unit">${field.unit}</span>`}</div></div><div class="comparison-field"><label for="comparison-label-${i}">Подпись варианта</label><input class="field" id="comparison-label-${i}" type="text" maxlength="64" value="${escape(draft.labels[i])}" placeholder="${escape(labels[i].label)}" aria-label="Подпись опыта ${i + 1}"/></div></div>`).join('');
    $('comparison-hint').textContent = field.hint;
    $('comparison-target').disabled = field.id === 'gravity';
    validate();
  }
  function open() {
    const allEntities = getEntities(), entityLabels = objectLabelMap(allEntities);
    entities = allEntities.filter(rigid);
    const state = getState() || {}, settings = state.settings || state;
    const current = settings.comparison;
    draft = normalizeComparison(current || { enabled: true, targetId: getSelected() || settings.story?.heroId || settings.focusId || entities.find(e => !e.fixed)?.id || '' });
    $('comparison-enabled').checked = draft.enabled;
    $('comparison-field').value = draft.field;
    $('comparison-target').innerHTML = '<option value="">Выбрать объект</option>' + entities.map(e => `<option value="${escape(e.id)}">${escape(objectLabel(e, entityLabels))}${e.fixed ? ' · закреплён' : ''}</option>`).join('');
    $('comparison-target').value = draft.targetId;
    const story = normalizedStory(settings.story);
    const formatDuration = value => value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
    $('comparison-duration').textContent = `${story.autoTrim ? 'до ' : ''}${formatDuration(story.duration)} с · 4 варианта${story.autoTrim ? '' : ` по ${formatDuration(story.duration / 4)} с`}`;
    $('comparison-duration').title = story.autoTrim ? 'Контрольные дубли могут быть сокращены. Физическое время наблюдения одинаковое.' : 'Общая длительность распределяется между четырьмя вариантами поровну.';
    renderValues(); $('comparison-dialog').showModal(); icons();
  }
  $('comparison-field').addEventListener('change', () => {
    const field = currentField();
    draft = normalizeComparison({ ...draft, field: field.id, enabled: $('comparison-enabled').checked, targetId: $('comparison-target').value, values: field.defaults, labels: [] });
    renderValues();
  });
  $('comparison-dialog').addEventListener('input', validate);
  $('comparison-dialog').addEventListener('change', validate);
  $('comparison-close').onclick = $('comparison-cancel').onclick = () => { if (!busy) $('comparison-dialog').close(); };
  $('comparison-dialog').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  $('comparison-save').onclick = async () => {
    if (!validate() || busy) return;
    busy = true; $('comparison-save').disabled = true;
    try { await commit(normalizeComparison(collect())); $('comparison-dialog').close(); notify('Параметры сравнения сохранены.'); }
    catch (error) { notify(error?.message || 'Не удалось сохранить сравнение'); }
    finally { busy = false; validate(); }
  };
  icons();
  return { open };
}
