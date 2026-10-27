try {
  var t = localStorage.getItem('acme-theme');
  if (t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches))
    document.documentElement.classList.add('dark');
} catch (e) {}
