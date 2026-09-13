/* Mode preference for standalone legal, error, and owner pages. */
const KEY = 'portfolio-shell-mode-v1';
let mode = 'directory';
try { mode = localStorage.getItem(KEY) === 'world' ? 'world' : 'directory'; } catch { /* optional */ }
document.body.dataset.shellMode = mode;
document.querySelectorAll('[data-set-shell]').forEach(button => {
  button.setAttribute('aria-pressed', String(button.dataset.setShell === mode));
  button.addEventListener('click', () => {
    mode = button.dataset.setShell;
    try { localStorage.setItem(KEY, mode); } catch { /* optional */ }
    document.body.dataset.shellMode = mode;
    document.querySelectorAll('[data-set-shell]').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.setShell === mode)));
  });
});
