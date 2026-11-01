// The HTML owns the first paint. Keep all app nodes measurable but hidden until
// main has mounted the final shell, controls and first 3D frame.
const root = document.documentElement;
const app = document.getElementById('app');
let state = 'loading';

function ready() {
  if (state !== 'loading') return;
  state = 'ready';
  app.removeAttribute('inert');
  app.removeAttribute('aria-hidden');
  app.setAttribute('aria-busy', 'false');
  root.dataset.appState = 'ready';
  document.getElementById('app-bootstrap')?.remove();
}

function fail(error) {
  if (state !== 'loading') return;
  state = 'error';
  root.dataset.appState = 'error';
  window.removeEventListener('matter:ready', ready);
  console.error('[Matter Lab] Не удалось открыть студию:', error);
}

window.addEventListener('matter:ready', ready, { once: true });
document.getElementById('boot-retry')?.addEventListener('click', event => {
  event.preventDefault();
  window.location.reload();
});

try {
  await import('./main.js');
  if (state === 'loading') fail(new Error('Студия завершила загрузку без сигнала готовности.'));
} catch (error) {
  fail(error);
}
