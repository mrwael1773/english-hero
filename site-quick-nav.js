(function () {
  'use strict';

  const main = document.querySelector('main');
  if (!main) return;

  const nav = document.createElement('nav');
  nav.className = 'quick-nav';
  nav.setAttribute('aria-label', 'التنقل السريع داخل الصفحة');
  nav.hidden = true;

  const heading = document.createElement('span');
  heading.className = 'quick-nav-heading';
  heading.textContent = 'انتقل مباشرة إلى';
  const list = document.createElement('div');
  list.className = 'quick-nav-list';
  nav.append(heading, list);

  main.insertBefore(nav, main.firstChild);

  let lastSignature = '';
  let scheduled = false;

  function isVisible(node) {
    if (node.closest('.quick-nav, [hidden], .hidden, .view:not(.active), [aria-hidden="true"]')) return false;
    return node.getClientRects().length > 0;
  }

  function collectHeadings() {
    return Array.from(main.querySelectorAll('h2, h3'))
      .filter(isVisible)
      .map((node, index) => {
        if (!node.id) {
          let id = 'quick-section-' + (index + 1);
          while (document.getElementById(id)) id += '-x';
          node.id = id;
        }
        const label = (node.textContent || '').replace(/\s+/g, ' ').trim();
        return label ? { node, id: node.id, label } : null;
      })
      .filter(Boolean);
  }

  function render() {
    const items = collectHeadings();
    if (items.length < 2) {
      nav.hidden = true;
      document.body.classList.remove('quick-nav-active');
      lastSignature = '';
      return;
    }

    const signature = JSON.stringify(items.map(item => [item.id, item.label]));
    nav.hidden = false;
    document.body.classList.add('quick-nav-active');
    if (signature === lastSignature) return;
    lastSignature = signature;
    list.replaceChildren();

    items.forEach(item => {
      const link = document.createElement('a');
      link.className = 'quick-nav-link';
      link.href = '#' + encodeURIComponent(item.id);
      link.textContent = item.label;
      link.title = item.label;
      link.setAttribute('aria-label', 'انتقل إلى: ' + item.label);
      link.addEventListener('click', event => {
        event.preventDefault();
        item.node.scrollIntoView({
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
          block: 'start'
        });
        list.querySelectorAll('[aria-current="location"]').forEach(active => active.removeAttribute('aria-current'));
        link.setAttribute('aria-current', 'location');
      });
      list.append(link);
    });
  }

  function scheduleRender() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      render();
    });
  }

  const observer = new MutationObserver(scheduleRender);
  observer.observe(main, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'hidden', 'aria-hidden']
  });

  window.addEventListener('resize', scheduleRender, { passive: true });
  window.addEventListener('hashchange', scheduleRender);
  render();
})();
