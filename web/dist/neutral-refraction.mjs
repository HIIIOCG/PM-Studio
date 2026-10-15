/**
 * Neutral, edge-only background refraction for schedule surfaces.
 * Independently written; optical reference: https://kube.io/blog/liquid-glass-css-svg/
 * The displacement map is geometry, never visible color or a captured data payload.
 *
 * Apply --project-refraction only to backdrop-filter on an empty decorative
 * surface. Do not apply filter to a card or its text. Example:
 * .project-glass-surface { backdrop-filter: var(--project-refraction, none); }
 *
 * A valid CSS url() is not proof that an engine renders SVG backdrop filters.
 * No UA detection or automatic claim of cross-browser optical support is made.
 * data-refraction="off" on a surface or ancestor requests the CSS fallback.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const PROPERTY = '--project-refraction';
const STATE = 'data-refraction-state';
const MAX_MAP_PIXELS = 262144;
const MAX_MAP_SIDE = 4096;
let installationNumber = 0;

const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/** Pure geometry in CSS pixels; short strips reduce bezel and optical strength. */
export function neutralRefractionGeometry(width, height, { strength = 3, bezel = 6, radius = 12 } = {}) {
  width = Math.max(0, finite(width, 0));
  height = Math.max(0, finite(height, 0));
  const halfShortSide = Math.min(width, height) / 2;
  const effectiveBezel = clamp(finite(bezel, 6), 0, halfShortSide);
  return {
    width,
    height,
    radius: clamp(finite(radius, 12), 0, halfShortSide),
    bezel: effectiveBezel,
    strength: clamp(finite(strength, 3), 0, effectiveBezel * 0.5),
  };
}

/**
 * Pure signed-distance sampler. dx/dy are source-sampling offsets in CSS px.
 * The rounded rectangle has a flat center and a fixed-width optical bezel.
 * A smooth envelope avoids a discontinuity at the inside/outside of the bezel.
 */
export function sampleNeutralRefraction(x, y, geometry) {
  const { width, height, radius, bezel, strength } = geometry;
  const px = x - width / 2;
  const py = y - height / 2;
  const qx = Math.abs(px) - (width / 2 - radius);
  const qy = Math.abs(py) - (height / 2 - radius);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  const outsideLength = Math.hypot(ox, oy);
  const distance = outsideLength + Math.min(Math.max(qx, qy), 0) - radius;
  const depth = -distance;
  if (distance > 0 || bezel === 0 || strength === 0 || depth >= bezel) {
    return { dx: 0, dy: 0, inside: distance <= 0, depth };
  }
  let nx = 0;
  let ny = 0;
  if (outsideLength > 0) {
    nx = Math.sign(px) * ox / outsideLength;
    ny = Math.sign(py) * oy / outsideLength;
  } else if (qx > qy) {
    nx = Math.sign(px);
  } else {
    ny = Math.sign(py);
  }
  const wave = Math.sin(Math.PI * clamp(depth / bezel, 0, 1));
  const displacement = strength * wave * wave;
  return { dx: -nx * displacement, dy: -ny * displacement, inside: true, depth };
}

/**
 * Pure RGBA map generator, importable in Node for geometry checks.
 * RG=128 is neutral; alpha is opaque. Blue is unused and remains 128.
 * No DPI multiplication: sampling is bounded and geometry stays in CSS pixels.
 */
export function createNeutralDisplacementPixels(width, height, options = {}) {
  const geometry = neutralRefractionGeometry(width, height, options);
  const mapWidth = Math.max(1, Math.ceil(geometry.width));
  const mapHeight = Math.max(1, Math.ceil(geometry.height));
  if (mapWidth > MAX_MAP_SIDE || mapHeight > MAX_MAP_SIDE || mapWidth * mapHeight > MAX_MAP_PIXELS) {
    throw new RangeError('Refraction map exceeds the rendering pixel budget.');
  }
  const data = new Uint8ClampedArray(mapWidth * mapHeight * 4);
  for (let row = 0; row < mapHeight; row += 1) {
    const y = (row + 0.5) * geometry.height / mapHeight;
    for (let column = 0; column < mapWidth; column += 1) {
      const x = (column + 0.5) * geometry.width / mapWidth;
      const { dx, dy } = sampleNeutralRefraction(x, y, geometry);
      const index = (row * mapWidth + column) * 4;
      data[index] = geometry.strength ? Math.round(128 + 127 * dx / geometry.strength) : 128;
      data[index + 1] = geometry.strength ? Math.round(128 + 127 * dy / geometry.strength) : 128;
      data[index + 2] = 128;
      data[index + 3] = 255;
    }
  }
  return { width: mapWidth, height: mapHeight, geometry, data };
}

function borderBox(element, computed) {
  const number = property => finite(parseFloat(computed[property]), 0);
  let width = number('width');
  let height = number('height');
  if (computed.boxSizing !== 'border-box') {
    width += number('paddingLeft') + number('paddingRight') + number('borderLeftWidth') + number('borderRightWidth');
    height += number('paddingTop') + number('paddingBottom') + number('borderTopWidth') + number('borderBottomWidth');
  }
  if (!width || !height) {
    width = element.offsetWidth || 0;
    height = element.offsetHeight || 0;
  }
  // Quarter-pixel sharing prevents inconsequential layout jitter rebuilding PNGs.
  return { width: Math.round(width * 4) / 4, height: Math.round(height * 4) / 4 };
}

function computedRadius(computed, width, height, fallback) {
  const parts = computed.borderTopLeftRadius.trim().split(/\s+/);
  const resolve = (part, side) => part?.endsWith('%') ? finite(parseFloat(part), 0) * side / 100 : parseFloat(part);
  const horizontal = resolve(parts[0], width);
  const vertical = resolve(parts[1] || parts[0], height);
  return Number.isFinite(horizontal) && Number.isFinite(vertical) ? Math.min(horizontal, vertical) : fallback;
}

/**
 * Installs geometry maps; data-refraction-state="ready" means a map is attached,
 * not that the browser has passed an optical rendering test. Other states are
 * off, empty, budget or unavailable; each supplies an identity blur for fallback.
 *
 * Return value: refresh(), setEnabled(boolean), destroy(), and read-only stats.
 * Attribute changes to class/data-refraction and layout resizes are observed.
 * Call refresh() after CSS changes that alter only radius without a resize.
 */
export function installNeutralRefraction({
  root = document,
  selector = '.project-card',
  strength = 3,
  bezel = 6,
  radius = 12,
  enabled = true,
  maxFilters = 64,
  maxElements = 512,
  maxMapsPerFrame = 3,
} = {}) {
  const doc = root.nodeType === 9 ? root : root.ownerDocument;
  const view = doc?.defaultView;
  if (!doc || !view || !root.querySelectorAll) throw new TypeError('A document or element root is required.');
  root.querySelectorAll(selector); // Validate the selector before mutating anything.
  maxFilters = clamp(Math.floor(finite(maxFilters, 64)), 1, 128);
  maxElements = clamp(Math.floor(finite(maxElements, 512)), 1, 2048);
  maxMapsPerFrame = clamp(Math.floor(finite(maxMapsPerFrame, 3)), 1, 8);
  const prefix = `neutral-refraction-${++installationNumber}`;
  const cache = new Map();
  const records = new Map();
  const dirty = new Set();
  let sequence = 0;
  let frame = 0;
  let scanNeeded = true;
  let destroyed = false;
  let modeEnabled = Boolean(enabled);
  const requestFrame = view.requestAnimationFrame.bind(view);
  const cancelFrame = view.cancelAnimationFrame.bind(view);
  const syntaxAccepted = Boolean(view.CSS?.supports('backdrop-filter', 'url("#neutral-refraction-probe")') ||
    view.CSS?.supports('-webkit-backdrop-filter', 'url("#neutral-refraction-probe")'));
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
  const defs = doc.createElementNS(SVG_NS, 'defs');
  svg.append(defs);
  const host = root.nodeType === 9 ? (doc.body || doc.documentElement) : root;
  host.append(svg); // Keep SVG in the tree; display:none can disable filter references.

  function schedule() {
    if (!destroyed && !frame) frame = requestFrame(flush);
  }

  function release(record) {
    if (!record.entry) return;
    record.entry.references -= 1;
    if (record.entry.references === 0) {
      record.entry.filter.remove();
      cache.delete(record.entry.key);
    }
    record.entry = null;
  }

  function writeState(element, state, value = 'blur(0px)') {
    if (element.style.getPropertyValue(PROPERTY) !== value) element.style.setProperty(PROPERTY, value);
    if (element.getAttribute(STATE) !== state) element.setAttribute(STATE, state);
  }

  function restore(element, record) {
    release(record);
    if (record.previousValue) element.style.setProperty(PROPERTY, record.previousValue, record.previousPriority);
    else element.style.removeProperty(PROPERTY);
    if (record.previousState === null) element.removeAttribute(STATE);
    else element.setAttribute(STATE, record.previousState);
  }

  function buildEntry(key, geometry) {
    const map = createNeutralDisplacementPixels(geometry.width, geometry.height, geometry);
    const canvas = doc.createElement('canvas');
    canvas.width = map.width;
    canvas.height = map.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable.');
    const pixels = context.createImageData(map.width, map.height);
    pixels.data.set(map.data);
    context.putImageData(pixels, 0, 0);
    const imageUrl = canvas.toDataURL('image/png');
    canvas.width = canvas.height = 1;
    const filter = doc.createElementNS(SVG_NS, 'filter');
    const id = `${prefix}-${++sequence}`;
    for (const [name, value] of Object.entries({ id, filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse',
      x: 0, y: 0, width: geometry.width, height: geometry.height, 'color-interpolation-filters': 'sRGB' })) {
      filter.setAttribute(name, String(value));
    }
    const image = doc.createElementNS(SVG_NS, 'feImage');
    for (const [name, value] of Object.entries({ x: 0, y: 0, width: geometry.width, height: geometry.height,
      href: imageUrl, preserveAspectRatio: 'none', result: 'raw-neutral-map' })) image.setAttribute(name, String(value));
    // RG=128 encodes the exact midpoint. Correct 128/255 to 0.5 before sampling.
    const correction = doc.createElementNS(SVG_NS, 'feComponentTransfer');
    correction.setAttribute('in', 'raw-neutral-map');
    correction.setAttribute('result', 'neutral-map');
    for (const channel of ['R', 'G']) {
      const transfer = doc.createElementNS(SVG_NS, `feFunc${channel}`);
      transfer.setAttribute('type', 'linear');
      transfer.setAttribute('slope', String(255 / 254));
      transfer.setAttribute('intercept', String(-1 / 254));
      correction.append(transfer);
    }
    const displacement = doc.createElementNS(SVG_NS, 'feDisplacementMap');
    for (const [name, value] of Object.entries({ in: 'SourceGraphic', in2: 'neutral-map',
      scale: geometry.strength * 2, xChannelSelector: 'R', yChannelSelector: 'G' })) {
      displacement.setAttribute(name, String(value));
    }
    filter.append(image, correction, displacement);
    defs.append(filter);
    const entry = { key, id, filter, references: 0, pixels: map.width * map.height };
    cache.set(key, entry);
    return entry;
  }

  const resizeObserver = typeof view.ResizeObserver === 'function' ? new view.ResizeObserver(entries => {
    for (const { target } of entries) if (records.has(target)) dirty.add(target);
    schedule();
  }) : null;

  function scan() {
    scanNeeded = false;
    const selected = [];
    if (root.nodeType === 1 && root.matches(selector)) selected.push(root);
    for (const element of root.querySelectorAll(selector)) {
      if (selected.length >= maxElements) break;
      selected.push(element);
    }
    const live = new Set(selected);
    for (const [element, record] of records) {
      if (live.has(element)) continue;
      resizeObserver?.unobserve(element);
      dirty.delete(element);
      restore(element, record);
      records.delete(element);
    }
    for (const element of selected) {
      if (!records.has(element)) {
        records.set(element, { entry: null, previousValue: element.style.getPropertyValue(PROPERTY),
          previousPriority: element.style.getPropertyPriority(PROPERTY), previousState: element.getAttribute(STATE) });
        resizeObserver?.observe(element);
      }
      dirty.add(element);
    }
  }

  function update(element, builds) {
    const record = records.get(element);
    if (!record) return true;
    if (!modeEnabled || element.closest('[data-refraction="off"],[data-refraction="false"]')) {
      release(record);
      writeState(element, 'off');
      return true;
    }
    if (!syntaxAccepted) {
      release(record);
      writeState(element, 'unavailable');
      return true;
    }
    const computed = view.getComputedStyle(element);
    const { width, height } = borderBox(element, computed);
    const geometry = neutralRefractionGeometry(width, height, {
      strength, bezel, radius: computedRadius(computed, width, height, radius),
    });
    const pixels = Math.ceil(width) * Math.ceil(height);
    if (width < 1 || height < 1 || !element.getClientRects().length || geometry.strength === 0) {
      release(record);
      writeState(element, 'empty');
      return true;
    }
    if (width > MAX_MAP_SIDE || height > MAX_MAP_SIDE || pixels > MAX_MAP_PIXELS) {
      release(record);
      writeState(element, 'budget');
      return true;
    }
    const key = [width, height, geometry.radius, geometry.bezel, geometry.strength].join(':');
    if (record.entry?.key === key) return true;
    let entry = cache.get(key);
    if (!entry && builds.count >= maxMapsPerFrame) return false;
    release(record);
    if (!entry && cache.size >= maxFilters) {
      writeState(element, 'budget');
      return true;
    }
    if (!entry) {
      try { entry = buildEntry(key, geometry); builds.count += 1; }
      catch { writeState(element, 'unavailable'); return true; }
    }
    entry.references += 1;
    record.entry = entry;
    writeState(element, 'ready', `url("#${entry.id}")`);
    return true;
  }

  function flush() {
    frame = 0;
    if (destroyed) return;
    if (scanNeeded) scan();
    const builds = { count: 0 };
    let count = 0;
    for (const element of dirty) {
      if (count >= 48 || !update(element, builds)) break;
      dirty.delete(element);
      count += 1;
    }
    if (dirty.size || scanNeeded) schedule();
  }

  function refresh() {
    if (destroyed) return;
    scanNeeded = true;
    schedule();
  }

  const mutationObserver = typeof view.MutationObserver === 'function' ? new view.MutationObserver(changes => {
    if (changes.some(change => change.target !== svg && !svg.contains(change.target))) refresh();
  }) : null;
  mutationObserver?.observe(root.nodeType === 9 ? doc.documentElement : root, {
    subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'data-refraction'],
  });
  view.addEventListener('resize', refresh, { passive: true });
  schedule();

  return {
    refresh,
    setEnabled(value) { modeEnabled = Boolean(value); refresh(); },
    get stats() {
      return { elements: records.size, filters: cache.size,
        pixels: [...cache.values()].reduce((sum, entry) => sum + entry.pixels, 0),
        pending: dirty.size, enabled: modeEnabled, syntaxAccepted, destroyed };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelFrame(frame);
      frame = 0;
      mutationObserver?.disconnect();
      resizeObserver?.disconnect();
      view.removeEventListener('resize', refresh);
      for (const [element, record] of records) restore(element, record);
      records.clear();
      dirty.clear();
      cache.clear();
      svg.remove();
    },
  };
}

/** The static material remains usable when browser rendering APIs are absent. */
export function startScheduleRefraction(doc = document) {
  if (!doc.defaultView?.requestAnimationFrame || !doc.createElementNS) return null;
  const view = doc.defaultView;
  const mount = () => installNeutralRefraction({ root:doc, selector:'.project-glass-surface', strength:4, bezel:7, radius:12 });
  let refraction = mount();
  const hide = () => refraction.destroy();
  const show = event => { if (event.persisted) refraction = mount(); };
  view.addEventListener('pagehide', hide);
  view.addEventListener('pageshow', show);
  return {
    get stats() { return refraction.stats; },
    destroy() {
      view.removeEventListener('pagehide', hide);
      view.removeEventListener('pageshow', show);
      refraction.destroy();
    },
  };
}
