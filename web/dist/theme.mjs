(() => {
  let theme = 'dark';
  try {
    const saved = localStorage.getItem('pm-studio-theme');
    if (saved === 'dark' || saved === 'light') theme = saved;
  } catch { /* A blocked preference store still opens the dark theme. */ }
  document.documentElement.dataset.theme = theme;
})();
