/* ==========================================================================
   Luxaderme — interactions
   ========================================================================== */
(function () {
  'use strict';

  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const smoothBehavior = reducedMotion ? 'auto' : 'smooth';
  const pad = (number) => String(number).padStart(2, '0');
  const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
  const money = (value) => '₹' + inr.format(value);
  const esc = (value) =>
    String(value).replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[character]));

  const body = document.body;
  const header = $('#siteHeader');

  /* ---------- Sticky header ---------- */
  if (header) {
    let headerTick = false;
    const updateHeader = () => {
      header.classList.toggle('is-scrolled', window.scrollY > 8);
      headerTick = false;
    };
    window.addEventListener('scroll', () => {
      if (!headerTick) {
        headerTick = true;
        requestAnimationFrame(updateHeader);
      }
    }, { passive: true });
    updateHeader();
  }

  /* ---------- Overlay manager ---------- */
  const overlayElements = $$('.overlay');
  let activeOverlay = null;
  let lastFocused = null;

  function visibleFocusables(root) {
    return $$('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', root)
      .filter((element) => element.getClientRects().length > 0 && element.getAttribute('aria-hidden') !== 'true');
  }

  function openOverlay(overlay, opener) {
    if (!overlay) return;
    if (activeOverlay && activeOverlay !== overlay) {
      closeOverlay(activeOverlay, false);
    }
    lastFocused = opener || document.activeElement;
    activeOverlay = overlay;
    overlay.removeAttribute('inert');
    overlay.setAttribute('aria-hidden', 'false');
    overlay.classList.add('is-open');
    body.classList.add('no-scroll');

    if (overlay.id === 'mobileMenu') {
      const menuButton = $('[data-open-menu]');
      if (menuButton) menuButton.setAttribute('aria-expanded', 'true');
    }

    requestAnimationFrame(() => {
      const target = $('[data-autofocus]', overlay) || visibleFocusables(overlay)[0];
      if (target) target.focus({ preventScroll: true });
      // The opening transition can swallow the first focus call in some browsers.
      window.setTimeout(() => {
        if (activeOverlay === overlay && !overlay.contains(document.activeElement)) {
          const retry = $('[data-autofocus]', overlay) || visibleFocusables(overlay)[0];
          if (retry) retry.focus({ preventScroll: true });
        }
      }, 80);
    });
  }

  function closeOverlay(overlay = activeOverlay, restoreFocus = true) {
    if (!overlay) return;
    const wasOpen = overlay.classList.contains('is-open');
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.setAttribute('inert', '');

    if (overlay.id === 'mobileMenu') {
      const menuButton = $('[data-open-menu]');
      if (menuButton) menuButton.setAttribute('aria-expanded', 'false');
    }

    if (activeOverlay === overlay) activeOverlay = null;
    if (!activeOverlay) body.classList.remove('no-scroll');

    if (wasOpen && restoreFocus && lastFocused && document.contains(lastFocused)) {
      lastFocused.focus({ preventScroll: true });
      lastFocused = null;
    }
  }

  document.addEventListener('click', (event) => {
    const closer = event.target.closest('[data-close-overlay]');
    if (closer) {
      const overlay = closer.closest('.overlay');
      if (overlay) closeOverlay(overlay);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (!activeOverlay) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      closeOverlay();
      return;
    }

    if (event.key === 'Tab') {
      const focusables = visibleFocusables(activeOverlay);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!activeOverlay.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  /* ---------- Toast ---------- */
  const toast = $('#toast');
  let toastTimer = null;
  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2800);
  }

  /* ---------- Product catalogue ---------- */
  const productCards = $$('[data-product]');
  const products = new Map();
  productCards.forEach((card) => {
    const data = card.dataset;
    products.set(data.id, {
      id: data.id,
      name: data.name,
      shortName: data.shortName || data.name,
      price: Number(data.price),
      oldPrice: Number(data.oldPrice),
      category: data.category,
      categoryLabel: data.categoryLabel,
      art: data.art,
      size: data.size,
      rating: Number(data.rating),
      reviews: Number(data.reviews),
      desc: data.desc
    });
  });

  /* ---------- Carousels ---------- */
  const carouselControllers = new Map();

  function initCarousel(root, controlsRoot) {
    if (!root) return null;
    const track = $('[data-carousel-track]', root);
    if (!track) return null;
    const controls = controlsRoot || root;
    const prev = $('[data-carousel-prev]', controls) || $('[data-routine-prev]', controls);
    const next = $('[data-carousel-next]', controls) || $('[data-routine-next]', controls);
    const count = $('[data-carousel-count]', controls) || $('[data-routine-count]', controls);
    const progress = $('[data-carousel-progress]', controls);

    let ticking = false;
    let justDragged = false;
    let pointerId = null;
    let pointerStart = 0;
    let pointerScroll = 0;
    let isDragging = false;

    const cards = () => Array.from(track.children).filter((child) => child.nodeType === 1 && !child.hidden);
    const step = () => {
      const first = cards()[0];
      if (!first) return track.clientWidth;
      const gap = parseFloat(window.getComputedStyle(track).columnGap) || 0;
      return first.getBoundingClientRect().width + gap;
    };

    const update = () => {
      const list = cards();
      const maxScroll = Math.max(0, track.scrollWidth - track.clientWidth);
      const current = step();
      const index = current ? Math.min(list.length, Math.round(track.scrollLeft / current) + 1) : 1;
      if (count) count.textContent = `${pad(list.length ? index : 0)} / ${pad(list.length)}`;
      if (progress) {
        const ratio = maxScroll ? Math.min(1, track.scrollLeft / maxScroll) : 1;
        progress.style.width = `${25 + ratio * 75}%`;
      }
      if (prev) prev.disabled = track.scrollLeft <= 2 || list.length === 0;
      if (next) next.disabled = track.scrollLeft >= maxScroll - 2 || list.length === 0;
      ticking = false;
    };

    const scheduleUpdate = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    };

    const move = (direction) => {
      track.scrollBy({ left: direction * step(), behavior: smoothBehavior });
    };

    if (prev) prev.addEventListener('click', () => move(-1));
    if (next) next.addEventListener('click', () => move(1));
    track.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate, { passive: true });

    track.addEventListener('keydown', (event) => {
      if (event.target !== track) return;
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        move(1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        move(-1);
      }
    });

    track.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      pointerId = event.pointerId;
      pointerStart = event.clientX;
      pointerScroll = track.scrollLeft;
      isDragging = false;
    });

    track.addEventListener('pointermove', (event) => {
      if (pointerId !== event.pointerId) return;
      const distance = event.clientX - pointerStart;
      if (!isDragging && Math.abs(distance) > 6) {
        isDragging = true;
        track.classList.add('is-dragging');
        try { track.setPointerCapture(pointerId); } catch (error) { /* noop */ }
      }
      if (!isDragging) return;
      track.scrollLeft = pointerScroll - distance;
      event.preventDefault();
    });

    const endDrag = (event) => {
      if (pointerId !== event.pointerId) return;
      if (isDragging) {
        justDragged = true;
        window.setTimeout(() => { justDragged = false; }, 80);
      }
      pointerId = null;
      isDragging = false;
      track.classList.remove('is-dragging');
      if (track.hasPointerCapture(event.pointerId)) {
        try { track.releasePointerCapture(event.pointerId); } catch (error) { /* noop */ }
      }
      scheduleUpdate();
    };

    track.addEventListener('pointerup', endDrag);
    track.addEventListener('pointercancel', endDrag);

    track.addEventListener('click', (event) => {
      if (justDragged) {
        event.preventDefault();
        event.stopPropagation();
        justDragged = false;
      }
    }, true);

    if (window.ResizeObserver) {
      const observer = new ResizeObserver(scheduleUpdate);
      observer.observe(track);
    }

    const api = {
      update,
      refresh() {
        track.scrollLeft = 0;
        scheduleUpdate();
      }
    };
    carouselControllers.set(root, api);
    update();
    return api;
  }

  $$('[data-carousel]').forEach((root) => {
    if (root.closest('.routines__inner')) {
      initCarousel(root, $('#routines'));
    } else {
      initCarousel(root, root);
    }
  });

  const productsCarousel = carouselControllers.get($('[data-carousel]'));

  /* ---------- Product filtering ---------- */
  const filterButtons = $$('[data-filter]');
  const filterStatus = $('#filterStatus');
  const filterLabels = { all: 'all products', feet: 'foot care', hands: 'hand care', face: 'face care', sets: 'gift sets' };

  function applyFilter(category, options) {
    const settings = Object.assign({ scroll: false, closeMenu: false }, options);
    const valid = ['all', 'feet', 'hands', 'face', 'sets'];
    const selected = valid.includes(category) ? category : 'all';

    productCards.forEach((card) => {
      card.hidden = selected !== 'all' && card.dataset.category !== selected;
    });

    filterButtons.forEach((button) => {
      const active = button.dataset.filter === selected;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });

    const shown = productCards.filter((card) => !card.hidden).length;
    if (filterStatus) {
      filterStatus.textContent = `Showing ${shown} ${filterLabels[selected] || 'products'}.`;
    }

    if (productsCarousel) productsCarousel.refresh();

    if (settings.closeMenu) {
      const menu = $('#mobileMenu');
      if (menu) closeOverlay(menu);
    }

    if (settings.scroll) {
      const section = $('#bestsellers');
      if (section) section.scrollIntoView({ behavior: smoothBehavior, block: 'start' });
    }
  }

  filterButtons.forEach((button) => {
    button.addEventListener('click', () => applyFilter(button.dataset.filter));
  });

  $$('[data-filter-link]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      applyFilter(link.dataset.filterLink, { scroll: true, closeMenu: true });
    });
  });

  $$('[data-routine]').forEach((card) => {
    card.addEventListener('click', () => {
      const category = card.dataset.routine;
      const target = $('#bestsellers');
      if (target) target.scrollIntoView({ behavior: smoothBehavior, block: 'start' });
      window.setTimeout(() => applyFilter(category), reducedMotion ? 0 : 450);
    });
  });

  /* ---------- Cart ---------- */
  const CART_KEY = 'luxaderme-bag-v1';
  const cartDrawer = $('#cartDrawer');
  const cartItems = $('[data-cart-items]');
  const cartFoot = $('[data-cart-foot]');
  const cartShip = $('[data-cart-ship]');
  const cartShipBar = $('[data-cart-ship-bar]');
  const cartShipMsg = $('[data-cart-ship-msg]');
  const cartSubtotal = $('[data-cart-subtotal]');
  const cartTitleCount = $('[data-cart-title-count]');
  const bagButton = $('[data-open-cart]');
  const badge = $('[data-cart-count]');
  const FREE_SHIPPING = 999;
  let cart = [];

  try {
    const saved = JSON.parse(window.localStorage.getItem(CART_KEY) || '[]');
    if (Array.isArray(saved)) {
      cart = saved
        .filter((item) => item && products.has(item.id) && Number(item.qty) > 0)
        .map((item) => ({ id: item.id, qty: Math.min(99, Math.floor(Number(item.qty))) }));
    }
  } catch (error) {
    cart = [];
  }

  const cartQuantity = () => cart.reduce((total, item) => total + item.qty, 0);
  const cartSubtotalValue = () => cart.reduce((total, item) => {
    const product = products.get(item.id);
    return total + (product ? product.price * item.qty : 0);
  }, 0);

  function saveCart() {
    try {
      window.localStorage.setItem(CART_KEY, JSON.stringify(cart));
    } catch (error) {
      /* Storage can be unavailable — the cart still works for this visit. */
    }
  }

  function updateBadge() {
    const quantity = cartQuantity();
    if (badge) {
      badge.textContent = String(quantity);
      badge.classList.toggle('has-items', quantity > 0);
    }
    if (bagButton) {
      bagButton.setAttribute('aria-label', `Open shopping bag, ${quantity} ${quantity === 1 ? 'item' : 'items'}`);
    }
  }

  function cartItemMarkup(product, quantity) {
    return `
      <article class="cart-item">
        <div class="cart-item__media ph ph--product" aria-hidden="true">
          <svg class="product-art" viewBox="0 0 160 220"><use href="#art-${esc(product.art)}"/></svg>
        </div>
        <div class="cart-item__body">
          <p class="cart-item__name">${esc(product.name)}</p>
          <p class="cart-item__meta">${esc(product.size)} · ${esc(product.categoryLabel)}</p>
          <div class="cart-item__row">
            <div class="qty">
              <button type="button" data-cart-minus="${esc(product.id)}" aria-label="Decrease quantity of ${esc(product.name)}">
                <svg class="icon" aria-hidden="true"><use href="#i-minus"/></svg>
              </button>
              <span>${quantity}</span>
              <button type="button" data-cart-plus="${esc(product.id)}" aria-label="Increase quantity of ${esc(product.name)}">
                <svg class="icon" aria-hidden="true"><use href="#i-plus"/></svg>
              </button>
            </div>
            <span class="cart-item__price">${money(product.price * quantity)}</span>
          </div>
        </div>
        <button class="cart-item__remove" type="button" data-cart-remove="${esc(product.id)}" aria-label="Remove ${esc(product.name)} from bag">
          <svg class="icon" aria-hidden="true"><use href="#i-close"/></svg>
        </button>
      </article>`;
  }

  function renderCart() {
    if (!cartItems) return;
    const empty = cart.length === 0;

    if (empty) {
      cartItems.innerHTML = `
        <div class="cart__empty">
          <span class="cart__empty-icon" aria-hidden="true">
            <svg class="icon"><use href="#i-bag"/></svg>
          </span>
          <h3>Your bag is empty</h3>
          <p>Start with a bestseller — your skin will thank you.</p>
          <button class="btn" type="button" data-empty-shop>Shop bestsellers</button>
        </div>`;
    } else {
      cartItems.innerHTML = cart.map((item) => {
        const product = products.get(item.id);
        return product ? cartItemMarkup(product, item.qty) : '';
      }).join('');
    }

    if (cartFoot) cartFoot.hidden = empty;
    if (cartShip) cartShip.hidden = empty;
    if (cartTitleCount) cartTitleCount.textContent = `(${cartQuantity()})`;

    const subtotal = cartSubtotalValue();
    if (cartSubtotal) cartSubtotal.textContent = money(subtotal);

    if (cartShipMsg && cartShipBar) {
      const remaining = Math.max(0, FREE_SHIPPING - subtotal);
      cartShipMsg.textContent = remaining > 0
        ? `You're ${money(remaining)} away from complimentary shipping`
        : 'You have unlocked complimentary shipping';
      cartShipBar.style.width = `${Math.min(100, (subtotal / FREE_SHIPPING) * 100)}%`;
    }

    updateBadge();
  }

  function addToCart(id, quantity = 1) {
    const product = products.get(id);
    if (!product) return;
    const amount = Math.max(1, Math.min(99, Number(quantity) || 1));
    const existing = cart.find((item) => item.id === id);
    if (existing) {
      existing.qty = Math.min(99, existing.qty + amount);
    } else {
      cart.push({ id, qty: amount });
    }
    saveCart();
    renderCart();
    showToast(`${product.shortName} added to your bag`);
  }

  function changeCartQuantity(id, delta) {
    const item = cart.find((entry) => entry.id === id);
    if (!item) return;
    item.qty += delta;
    if (item.qty <= 0) cart = cart.filter((entry) => entry.id !== id);
    saveCart();
    renderCart();
  }

  function removeFromCart(id) {
    cart = cart.filter((entry) => entry.id !== id);
    saveCart();
    renderCart();
  }

  if (cartItems) {
    cartItems.addEventListener('click', (event) => {
      const plus = event.target.closest('[data-cart-plus]');
      const minus = event.target.closest('[data-cart-minus]');
      const remove = event.target.closest('[data-cart-remove]');
      const shop = event.target.closest('[data-empty-shop]');

      if (plus) changeCartQuantity(plus.dataset.cartPlus, 1);
      if (minus) changeCartQuantity(minus.dataset.cartMinus, -1);
      if (remove) removeFromCart(remove.dataset.cartRemove);
      if (shop) {
        closeOverlay(cartDrawer);
        const target = $('#bestsellers');
        if (target) target.scrollIntoView({ behavior: smoothBehavior, block: 'start' });
      }
    });
  }

  const checkoutButton = $('[data-checkout]');
  if (checkoutButton) {
    checkoutButton.addEventListener('click', () => {
      showToast('This is a concept store — checkout is not connected yet.');
    });
  }

  $$('[data-open-cart]').forEach((button) => {
    button.addEventListener('click', () => openOverlay(cartDrawer, button));
  });

  renderCart();

  /* ---------- Quick view ---------- */
  const quickView = $('#quickView');
  const qvTitle = $('#quickViewTitle');
  const qvCategory = $('#qvCategory');
  const qvReviews = $('#qvReviews');
  const qvPrice = $('#qvPrice');
  const qvOldPrice = $('#qvOldPrice');
  const qvDesc = $('#qvDesc');
  const qvSize = $('#qvSize');
  const qvGoal = $('#qvGoal');
  const qvArtUse = $('#qvArtUse');
  const qvQtyValue = $('[data-qty-value]', quickView);
  const qvTotal = $('[data-qv-total]', quickView);
  const qvAdd = $('[data-qv-add]', quickView);
  const qvMinus = $('[data-qty-minus]', quickView);
  const qvPlus = $('[data-qty-plus]', quickView);
  let quickViewId = null;
  let quickViewQuantity = 1;

  const goalFor = {
    feet: 'Soft, smooth feet',
    hands: 'Soft, strong hands',
    face: 'Glow & hydration',
    sets: 'A complete ritual'
  };

  function updateQuickViewTotal() {
    if (!quickViewId) return;
    const product = products.get(quickViewId);
    if (!product) return;
    if (qvQtyValue) qvQtyValue.textContent = String(quickViewQuantity);
    if (qvTotal) qvTotal.textContent = money(product.price * quickViewQuantity);
  }

  function openQuickView(id, opener) {
    const product = products.get(id);
    if (!product || !quickView) return;

    quickViewId = id;
    quickViewQuantity = 1;

    if (qvTitle) qvTitle.textContent = product.name;
    if (qvCategory) qvCategory.textContent = product.categoryLabel;
    if (qvReviews) qvReviews.textContent = `${product.reviews} reviews`;
    if (qvPrice) qvPrice.textContent = money(product.price);
    if (qvOldPrice) qvOldPrice.textContent = money(product.oldPrice);
    if (qvDesc) qvDesc.textContent = product.desc;
    if (qvSize) qvSize.textContent = product.size;
    if (qvGoal) qvGoal.textContent = goalFor[product.category] || 'Healthy skin';
    if (qvArtUse) qvArtUse.setAttribute('href', `#art-${product.art}`);
    updateQuickViewTotal();
    openOverlay(quickView, opener);
  }

  if (qvMinus) {
    qvMinus.addEventListener('click', () => {
      quickViewQuantity = Math.max(1, quickViewQuantity - 1);
      updateQuickViewTotal();
    });
  }

  if (qvPlus) {
    qvPlus.addEventListener('click', () => {
      quickViewQuantity = Math.min(99, quickViewQuantity + 1);
      updateQuickViewTotal();
    });
  }

  if (qvAdd) {
    qvAdd.addEventListener('click', () => {
      if (!quickViewId) return;
      const id = quickViewId;
      addToCart(id, quickViewQuantity);
      closeOverlay(quickView, false);
      const bag = $('[data-open-cart]');
      if (bag) {
        window.setTimeout(() => openOverlay(cartDrawer, bag), 180);
      }
    });
  }

  /* ---------- Global product triggers ---------- */
  document.addEventListener('click', (event) => {
    const add = event.target.closest('[data-add]');
    if (add) {
      event.preventDefault();
      addToCart(add.dataset.add, 1);
      return;
    }

    const quick = event.target.closest('[data-quickview]');
    if (quick) {
      event.preventDefault();
      openQuickView(quick.dataset.quickview, quick);
    }
  });

  /* ---------- Mobile menu ---------- */
  const mobileMenu = $('#mobileMenu');
  $$('[data-open-menu]').forEach((button) => {
    button.addEventListener('click', () => openOverlay(mobileMenu, button));
  });

  $$('.mobile-nav a').forEach((link) => {
    link.addEventListener('click', () => closeOverlay(mobileMenu));
  });

  /* ---------- Search ---------- */
  const searchOverlay = $('#searchOverlay');
  const searchInput = $('#searchInput');
  const searchResults = $('[data-search-results]');
  const searchDefault = $('[data-search-default]');
  const searchClear = $('[data-search-clear]');
  const searchForm = $('[data-search-form]');

  const sectionIndex = [
    { title: 'Bestsellers', meta: 'Shop all products', href: '#bestsellers' },
    { title: 'The Luxaderme difference', meta: 'Why our formulas work', href: '#difference' },
    { title: 'The community', meta: 'Real routines, real skin', href: '#community' },
    { title: 'Shop by routine', meta: 'Find your ritual', href: '#routines' },
    { title: 'Ingredients', meta: 'Clinically proven actives', href: '#ingredients' },
    { title: 'FAQs', meta: 'Answers to your questions', href: '#faq' },
    { title: 'Reviews', meta: '4.9 from 306 reviews', href: '#reviews' },
    { title: 'Contact us', meta: 'We are here to help', href: '#footer' }
  ];

  function resetSearch() {
    if (searchInput) searchInput.value = '';
    if (searchClear) searchClear.hidden = true;
    if (searchDefault) searchDefault.hidden = false;
    if (searchResults) {
      searchResults.hidden = true;
      searchResults.innerHTML = '';
    }
  }

  function productSearchMarkup(product) {
    return `
      <button class="search-result" type="button" data-search-product="${esc(product.id)}">
        <span class="search-result__thumb ph ph--product" aria-hidden="true">
          <svg class="product-art" viewBox="0 0 160 220"><use href="#art-${esc(product.art)}"/></svg>
        </span>
        <span>
          <span class="search-result__name">${esc(product.name)}</span>
          <span class="search-result__meta">${esc(product.categoryLabel)} · ${esc(product.size)}</span>
        </span>
        <span class="search-result__price">${money(product.price)}</span>
      </button>`;
  }

  function runSearch(rawQuery) {
    if (!searchResults) return;
    const query = rawQuery.trim().toLowerCase();

    if (!query) {
      if (searchDefault) searchDefault.hidden = false;
      searchResults.hidden = true;
      searchResults.innerHTML = '';
      if (searchClear) searchClear.hidden = true;
      return;
    }

    if (searchDefault) searchDefault.hidden = true;
    searchResults.hidden = false;
    if (searchClear) searchClear.hidden = false;

    const productMatches = Array.from(products.values()).filter((product) => {
      const haystack = [product.name, product.shortName, product.categoryLabel, product.desc].join(' ').toLowerCase();
      return haystack.includes(query);
    }).slice(0, 6);

    const sectionMatches = sectionIndex.filter((section) => {
      return `${section.title} ${section.meta}`.toLowerCase().includes(query);
    }).slice(0, 5);

    if (!productMatches.length && !sectionMatches.length) {
      searchResults.innerHTML = `
        <div class="search-empty">
          <strong>No matches for “${esc(rawQuery.trim())}”</strong>
          <p>Try “foot mask”, “toner pads”, “hand cream” or “gift”.</p>
        </div>`;
      return;
    }

    let markup = '';
    if (productMatches.length) {
      markup += `<div class="search__group"><p class="search__group-label">Products</p>${productMatches.map(productSearchMarkup).join('')}</div>`;
    }
    if (sectionMatches.length) {
      markup += `<div class="search__group"><p class="search__group-label">Explore</p><div class="search__sections">${sectionMatches.map((section) => `
        <a href="${section.href}" data-close-overlay>
          <span>${esc(section.title)}<span class="search-result__meta">${esc(section.meta)}</span></span>
          <svg class="icon" aria-hidden="true"><use href="#i-arrow-up-right"/></svg>
        </a>`).join('')}</div></div>`;
    }
    searchResults.innerHTML = markup;
  }

  $$('[data-open-search]').forEach((button) => {
    button.addEventListener('click', () => {
      resetSearch();
      openOverlay(searchOverlay, button);
      window.setTimeout(() => {
        if (searchInput) searchInput.focus({ preventScroll: true });
      }, 80);
    });
  });

  if (searchInput) {
    searchInput.addEventListener('input', () => runSearch(searchInput.value));
    searchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        const firstProduct = $('[data-search-product]', searchResults);
        if (firstProduct) {
          closeOverlay(searchOverlay);
          openQuickView(firstProduct.dataset.searchProduct, searchInput);
        }
      }
    });
  }

  if (searchForm) {
    searchForm.addEventListener('submit', (event) => event.preventDefault());
  }

  if (searchClear) {
    searchClear.addEventListener('click', () => {
      resetSearch();
      if (searchInput) searchInput.focus({ preventScroll: true });
    });
  }

  $$('[data-search-term]').forEach((chip) => {
    chip.addEventListener('click', () => {
      if (!searchInput) return;
      searchInput.value = chip.dataset.searchTerm;
      runSearch(searchInput.value);
      searchInput.focus({ preventScroll: true });
    });
  });

  if (searchResults) {
    searchResults.addEventListener('click', (event) => {
      const productResult = event.target.closest('[data-search-product]');
      if (productResult) {
        closeOverlay(searchOverlay);
        openQuickView(productResult.dataset.searchProduct, productResult);
      }
    });
  }

  /* ---------- Difference tabs ---------- */
  const tabs = $$('.difference__tab');
  const panes = $$('.difference__pane');

  function activateTab(index, focusTab) {
    tabs.forEach((tab, tabIndex) => {
      const active = tabIndex === index;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      const pane = panes[tabIndex];
      if (pane) {
        pane.classList.toggle('is-active', active);
        pane.hidden = !active;
      }
      if (active && focusTab) tab.focus();
    });
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activateTab(index, false));
    tab.addEventListener('keydown', (event) => {
      let target = null;
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') target = (index + 1) % tabs.length;
      if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') target = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'Home') target = 0;
      if (event.key === 'End') target = tabs.length - 1;
      if (target !== null) {
        event.preventDefault();
        activateTab(target, true);
      }
    });
  });

  /* ---------- FAQ accordion ---------- */
  const faqItems = $$('.faq__item');
  const allFaqButton = $('[data-toggle-all-faqs]');

  function setFaq(item, open) {
    const button = $('.faq__question', item);
    if (!button) return;
    item.classList.toggle('is-open', open);
    button.setAttribute('aria-expanded', String(open));
  }

  faqItems.forEach((item) => {
    const button = $('.faq__question', item);
    if (!button) return;
    button.addEventListener('click', () => {
      const open = !item.classList.contains('is-open');
      faqItems.forEach((other) => setFaq(other, false));
      setFaq(item, open);
    });
  });

  if (allFaqButton) {
    allFaqButton.addEventListener('click', () => {
      const anyClosed = faqItems.some((item) => !item.classList.contains('is-open'));
      faqItems.forEach((item) => setFaq(item, anyClosed));
      allFaqButton.textContent = anyClosed ? 'Collapse FAQs' : 'Read all FAQs';
    });
  }

  /* ---------- Reviews ---------- */
  const loadReviewsButton = $('[data-load-reviews]');
  let hiddenReviews = $$('[data-review][hidden]');

  if (loadReviewsButton) {
    if (!hiddenReviews.length) {
      loadReviewsButton.disabled = true;
      loadReviewsButton.textContent = 'All reviews loaded';
    }
    loadReviewsButton.addEventListener('click', () => {
      const nextBatch = hiddenReviews.slice(0, 2);
      nextBatch.forEach((review) => { review.hidden = false; });
      hiddenReviews = hiddenReviews.slice(nextBatch.length);
      if (!hiddenReviews.length) {
        loadReviewsButton.disabled = true;
        loadReviewsButton.textContent = 'All reviews loaded';
      }
      if (nextBatch[0]) {
        nextBatch[0].scrollIntoView({ behavior: smoothBehavior, block: 'center' });
      }
    });
  }

  /* ---------- Newsletter ---------- */
  $$('[data-newsletter]').forEach((form) => {
    const input = $('input[type="email"]', form);
    const message = $('.newsletter-form__msg', form);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!input || !message) return;
      const value = input.value.trim();
      const valid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);

      if (!valid) {
        message.textContent = 'Please enter a valid email address.';
        message.classList.add('is-error');
        input.setAttribute('aria-invalid', 'true');
        input.focus();
        return;
      }

      input.removeAttribute('aria-invalid');
      message.classList.remove('is-error');
      message.textContent = "Thank you — you're on the list.";
      input.value = '';
      showToast('Welcome to Luxaderme. Check your inbox soon.');
    });

    if (input) {
      input.addEventListener('input', () => {
        if (message) message.textContent = '';
        input.removeAttribute('aria-invalid');
      });
    }
  });

  /* ---------- Community lightbox ---------- */
  const lightbox = $('#lightbox');
  const lightboxMedia = $('#lightboxMedia');
  const lightboxCaption = $('#lightboxCaption');
  const lightboxCount = $('#lightboxCount');
  const lightboxButtons = $$('[data-lightbox]');
  let lightboxIndex = 0;

  function toneFrom(element) {
    const match = Array.from(element.classList).find((name) => name.startsWith('ph--'));
    return match || 'ph--tan';
  }

  function showLightbox(index) {
    if (!lightboxButtons.length) return;
    lightboxIndex = (index + lightboxButtons.length) % lightboxButtons.length;
    const source = lightboxButtons[lightboxIndex];
    const tone = toneFrom(source);
    const caption = source.dataset.caption || 'Community photo';

    if (lightboxMedia) {
      lightboxMedia.className = `lightbox__media ph ${tone}`;
      lightboxMedia.setAttribute('aria-label', `Community photo placeholder — ${caption}`);
      lightboxMedia.innerHTML = '<span class="ph__logo">LUXADERME</span><span class="ph__note">Your photo here</span>';
    }
    if (lightboxCaption) lightboxCaption.textContent = caption;
    if (lightboxCount) lightboxCount.textContent = `${lightboxIndex + 1} / ${lightboxButtons.length}`;
  }

  lightboxButtons.forEach((button, index) => {
    button.addEventListener('click', () => {
      showLightbox(index);
      openOverlay(lightbox, button);
    });
  });

  const lightboxPrev = $('[data-lightbox-prev]');
  const lightboxNext = $('[data-lightbox-next]');
  if (lightboxPrev) lightboxPrev.addEventListener('click', () => showLightbox(lightboxIndex - 1));
  if (lightboxNext) lightboxNext.addEventListener('click', () => showLightbox(lightboxIndex + 1));

  document.addEventListener('keydown', (event) => {
    if (activeOverlay !== lightbox) return;
    if (event.key === 'ArrowLeft') showLightbox(lightboxIndex - 1);
    if (event.key === 'ArrowRight') showLightbox(lightboxIndex + 1);
  });

  /* ---------- Info modal ---------- */
  const infoModal = $('#infoModal');
  const infoTitle = $('#infoTitle');
  const infoEyebrow = $('#infoEyebrow');
  const infoBody = $('#infoBody');

  const INFO = {
    difference: {
      eyebrow: 'Why Luxaderme',
      title: 'The Luxaderme difference',
      body: `
        <p>We believe effective skincare should feel as good as it looks. Every Luxaderme formula starts in a Korean lab and ends on real skin — tested, refined and made in small, careful batches.</p>
        <h3>Made in Korea</h3>
        <p>Our products are manufactured in cGMP-certified facilities in South Korea. We work directly with our laboratories, so every batch meets the same standard for purity, safety and performance.</p>
        <h3>Formulated with intention</h3>
        <p>Floral waters instead of plain water. Clinically proven actives at meaningful percentages. And a short list of ingredients we are proud to put on the label.</p>
        <p>No parabens, no sulphates, no mineral oil. Always vegan and cruelty-free.</p>`
    },
    ingredients: {
      eyebrow: 'Inci corner',
      title: 'Inside the formula',
      body: `
        <p>Korean skincare is built on layers of hydration and gentle, consistent care. These are a few of the actives we return to again and again.</p>
        <h3>Niacinamide</h3>
        <p>Helps refine the look of pores, even tone and strengthen the skin barrier — a quiet workhorse for daily glow.</p>
        <h3>Shea butter</h3>
        <p>Rich in fatty acids, it seals in moisture and softens dry hands, feet and cuticles without feeling greasy.</p>
        <h3>Rice water</h3>
        <p>A traditional Korean beauty ingredient valued for its soothing, brightening and conditioning properties.</p>
        <h3>Urea &amp; ceramides</h3>
        <p>Our foot care duo: urea gently softens thickened skin while ceramides help repair the barrier overnight.</p>
        <p>Every formula is dermatologically tested and free from parabens, sulphates and mineral oil.</p>`
    },
    press: {
      eyebrow: 'Media & press',
      title: 'Recognised by the best',
      body: `
        <p><strong>Vogue India</strong> — “I tried that scary viral foot mask that peels your skin off, and here's what happened.”</p>
        <p>By Anjan Sachar, 16 April 2021.</p>
        <p>Our Peeling &amp; Exfoliating Foot Mask became a word-of-mouth favourite for its gentle, gradual results. For press enquiries, collaborations or product samples, write to <a href="mailto:press@luxaderme.com">press@luxaderme.com</a>.</p>`
    },
    privacy: {
      eyebrow: 'Legal',
      title: 'Privacy policy',
      body: `
        <p>Last updated: January 2026. This concept page outlines how Luxaderme would handle your information.</p>
        <p>We collect only what we need to process an order and improve your experience: your name, contact details, delivery address and order history. We never sell your data.</p>
        <h3>Your choices</h3>
        <p>You can ask to access, correct or delete your information at any time by emailing <a href="mailto:hello@luxaderme.com">hello@luxaderme.com</a>. Newsletter emails include an unsubscribe link in every message.</p>
        <h3>Cookies</h3>
        <p>This demo uses local browser storage to remember the contents of your bag. No analytics or advertising cookies are set.</p>`
    },
    terms: {
      eyebrow: 'Legal',
      title: 'Terms & conditions',
      body: `
        <p>By using this website you agree to these terms. This is a demonstration storefront; no orders are processed and no payment is taken.</p>
        <h3>Products &amp; pricing</h3>
        <p>Product descriptions, prices and availability are illustrative. Prices are shown in Indian rupees and include applicable taxes.</p>
        <h3>Intellectual property</h3>
        <p>The Luxaderme name, wordmark and imagery are used here for design demonstration purposes only.</p>
        <h3>Contact</h3>
        <p>Questions about these terms? Email <a href="mailto:hello@luxaderme.com">hello@luxaderme.com</a>.</p>`
    },
    returns: {
      eyebrow: 'Customer care',
      title: 'Returns and refunds',
      body: `
        <p>We want you to love your ritual. If something is not right, contact us within 7 days of delivery.</p>
        <h3>What can be returned</h3>
        <p>Unopened products in their original packaging can be returned within 7 days. For hygiene reasons, opened skincare cannot be returned unless the product is faulty.</p>
        <h3>How to start a return</h3>
        <p>Email <a href="mailto:hello@luxaderme.com">hello@luxaderme.com</a> with your order number and a short note. We will arrange a pickup where available and confirm your refund once the product is received.</p>`
    },
    contact: {
      eyebrow: 'We would love to hear from you',
      title: 'Contact us',
      body: `
        <p>Questions about your routine, an order or a partnership? Our team is here Monday to Friday, 10am–6pm IST.</p>
        <h3>Email</h3>
        <p><a href="mailto:hello@luxaderme.com">hello@luxaderme.com</a></p>
        <h3>Phone</h3>
        <p><a href="tel:+919820000000">+91 98200 00000</a></p>
        <h3>Press &amp; partnerships</h3>
        <p><a href="mailto:press@luxaderme.com">press@luxaderme.com</a></p>
        <p>For order support, please include your order number so we can help faster.</p>`
    },
    clinics: {
      eyebrow: 'Trade',
      title: 'Clinics, salons & spas',
      body: `
        <p>Bring Luxaderme into your treatment room or retail shelf. We partner with clinics, salons and spas across India with professional pricing and education for your team.</p>
        <h3>Partner with us</h3>
        <p>Email <a href="mailto:trade@luxaderme.com">trade@luxaderme.com</a> with your studio name, city and a little about your services. Our trade team will be in touch within two working days.</p>`
    },
    careers: {
      eyebrow: 'Join the team',
      title: 'Careers',
      body: `
        <p>We are a small, curious team building thoughtful Korean skincare for Indian skin. We look for people who care about the details and want to make everyday rituals feel a little more special.</p>
        <p>Send your portfolio and a note about what you would love to work on to <a href="mailto:careers@luxaderme.com">careers@luxaderme.com</a>.</p>`
    }
  };

  $$('[data-info]').forEach((trigger) => {
    trigger.addEventListener('click', (event) => {
      if (trigger.tagName === 'A') event.preventDefault();
      const content = INFO[trigger.dataset.info];
      if (!content || !infoModal) return;
      if (infoEyebrow) infoEyebrow.textContent = content.eyebrow;
      if (infoTitle) infoTitle.textContent = content.title;
      if (infoBody) infoBody.innerHTML = content.body;
      openOverlay(infoModal, trigger);
    });
  });

  /* ---------- Reveal on scroll ---------- */
  const revealElements = $$('[data-reveal]');
  if (revealElements.length) {
    if ('IntersectionObserver' in window && !reducedMotion) {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in');
            observer.unobserve(entry.target);
          }
        });
      }, { threshold: 0.06, rootMargin: '0px 0px -30px 0px' });
      revealElements.forEach((element) => observer.observe(element));
    } else {
      revealElements.forEach((element) => element.classList.add('is-in'));
    }
  }

  /* ---------- Collapse open overlays when resizing up ---------- */
  window.addEventListener('resize', () => {
    if (window.innerWidth > 900) {
      closeOverlay(mobileMenu, false);
    }
  }, { passive: true });

  /* ---------- Initial focus / state ---------- */
  updateBadge();
})();
