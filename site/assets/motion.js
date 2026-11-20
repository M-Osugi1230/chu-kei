/*
 * Chu-kei Insight Motion System v1.0
 * Vanilla JS / no external dependencies
 */
(() => {
  'use strict';

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  const selectors = [
    '.reveal',
    '.section-heading',
    '.strategy-card',
    '.preset-button',
    '.company-card',
    '.progress-card'
  ].join(',');

  const gridSelector = [
    '.strategy-grid',
    '.preset-grid',
    '.company-grid',
    '.progress-grid'
  ].join(',');

  const seen = new WeakSet();
  const counted = new WeakSet();
  const staggerMs = 35;
  const maxIndex = 5;

  const numberFormat = new Intl.NumberFormat('ja-JP', {
    maximumFractionDigits: 0
  });

  function countUp(node) {
    if (counted.has(node) || reduced.matches) return;

    const original = node.textContent.trim();
    const match = original.match(/^([\d,]+)(.*)$/);
    if (!match) return;

    const rawTarget = node.getAttribute('data-countup');
    const target = rawTarget
      ? Number(rawTarget.replace(/,/g, ''))
      : Number(match[1].replace(/,/g, ''));

    if (
      !Number.isFinite(target) ||
      target < 0 ||
      target > 10000000 ||
      !Number.isInteger(target)
    ) return;

    counted.add(node);

    const suffix = match[2];
    const finalText = original;
    const duration = 650;
    let start = null;

    if (!node.hasAttribute('aria-label')) {
      node.setAttribute('aria-label', finalText);
    }

    const width = node.getBoundingClientRect().width;
    if (width > 0) {
      node.style.minWidth = `${Math.ceil(width)}px`;
    }

    function frame(time) {
      if (reduced.matches) {
        node.textContent = finalText;
        return;
      }
      if (start === null) start = time;
      const t = Math.min((time - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const value = Math.round(target * eased);
      node.textContent = numberFormat.format(value) + suffix;
      if (t < 1 && node.isConnected) {
        requestAnimationFrame(frame);
      } else {
        node.textContent = finalText;
      }
    }

    requestAnimationFrame(frame);
  }

  const observer = !reduced.matches && 'IntersectionObserver' in window
    ? new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const node = entry.target;
          const index = Number(node.style.getPropertyValue('--i')) || 0;
          if (node.matches('.reveal')) {
            window.setTimeout(() => {
              if (node.isConnected) {
                node.classList.add('is-inview');
              }
            }, index * staggerMs);
          }
          if (node.matches('.summary-grid [data-countup]')) {
            countUp(node);
          }
          observer.unobserve(node);
        }
      }, {
        root: null,
        rootMargin: '0px 0px -6% 0px',
        threshold: 0.04
      })
    : null;

  function inViewport(node) {
    const rect = node.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < window.innerHeight;
  }

  function prepare(node, immediate) {
    if (seen.has(node)) return;
    seen.add(node);

    if (!node.classList.contains('reveal')) {
      node.classList.add('reveal');
    }

    const grid = node.parentElement;
    if (grid && grid.matches(gridSelector)) {
      const index = Array.prototype.indexOf.call(grid.children, node);
      node.style.setProperty(
        '--i',
        String(Math.min(Math.max(index, 0), maxIndex))
      );
    }

    if (!observer) {
      node.classList.add('is-inview');
    } else if (inViewport(node)) {
      // Nodes that are already visible when prepared (initial viewport or
      // dynamically added, e.g. search re-renders) must not replay the
      // entrance animation: settle them instantly so content is never left
      // in a mid-fade, low-contrast state.
      node.classList.add('is-inview', 'motion-settled');
    } else {
      observer.observe(node);
    }
  }

  function scan(root = document, immediate = false) {
    if (root.nodeType === 1 && root.matches(selectors)) {
      prepare(root, immediate);
    }
    if (root.querySelectorAll) {
      root.querySelectorAll(selectors).forEach(node => prepare(node, immediate));
    }
    if (observer && root.querySelectorAll) {
      root.querySelectorAll('.summary-grid [data-countup]').forEach(node => {
        if (!seen.has(node)) {
          seen.add(node);
          observer.observe(node);
        }
      });
    }
  }

  function init() {
    scan();

    if (!reduced.matches) {
      document.documentElement.classList.add('motion-ready');
    }

    const mutations = new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType === 1) scan(node, true);
        }
      }
    });

    mutations.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
