(() => {
  const host = location.hostname;
  const isBilibili = host === 'bilibili.com' || host.endsWith('.bilibili.com');
  const isZhihu = host === 'zhihu.com' || host.endsWith('.zhihu.com');
  if (!isBilibili && !isZhihu) return;

  const searchSelector = isBilibili
    ? '.nav-search-content input[type="text"]'
    : '.SearchBar input';

  function clearSearchPlaceholders() {
    document.querySelectorAll(searchSelector).forEach((input) => {
      if (input.placeholder) input.placeholder = '';
      if (!input.hasAttribute('aria-label') && !input.hasAttribute('aria-labelledby')) {
        input.setAttribute('aria-label', '搜索');
      }
    });
  }

  function hideLiveCards() {
    document.querySelectorAll('.floor-single-card').forEach((card) => {
      const hasLiveTitle = card.querySelector('.floor-title')?.textContent.trim() === '直播';
      const hasLiveLink = [...card.querySelectorAll('a[href]')].some((link) => {
        try {
          return new URL(link.href).hostname === 'live.bilibili.com';
        } catch {
          return false;
        }
      });
      card.toggleAttribute('data-quiet-browsing-live', hasLiveTitle || hasLiveLink);
    });
  }

  function applyAll() {
    clearSearchPlaceholders();
    if (isBilibili) hideLiveCards();
  }

  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    // Batch page updates without relying on animation frames, which pause in background tabs.
    queueMicrotask(() => {
      scheduled = false;
      applyAll();
    });
  });

  // At document_start the root element may not exist yet; observing the document covers its creation too.
  observer.observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['placeholder', 'href'],
  });
  applyAll();
})();
