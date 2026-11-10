/**
 * hass_map_cn.js v2 — 修复 Home Assistant 原生地图在国内网络下空白
 *
 * v2 变更：
 *   - 瓦片源默认改为高德地图（国内 CDN，稳定可达；ArcGIS 在国内不稳定，已弃用）
 *   - 高德为 GCJ-02 坐标系：自动把实体 WGS84 坐标转换为 GCJ-02，
 *     使标记与底图精确对齐（仅作用于 ha-map，不影响其他卡片）
 *   - 暗色主题下对底图做 CSS 反色，贴合暗色仪表盘
 *   - 可选：注册天地图 Key（https://lbs.tianditu.gov.cn，免费）填入 TDT_KEY，
 *     即可使用无偏移官方中文底图，并自动关闭纠偏
 *
 * 部署：configuration.yaml → frontend.extra_module_url 引用本文件，
 *      更新后必须更换 ?v= 版本号（HA 对静态文件缓存 31 天）
 */

/* ========== 配置 ========== */
const TDT_KEY = "";        // 天地图浏览器端 Key；填写后优先用天地图（无偏移），高德方案自动停用
const AMAP_STYLE = "road"; // "road" 路网图 | "satellite" 卫星图（卫星+路网叠加）
const FORCE_DARK = null;   // 底图暗色化：null=自动跟随所在卡片背景；true=强制暗色反色；false=保持亮色

/* ========== GCJ-02 纠偏（标准 wgs84→gcj02 算法） ========== */
function wgs2gcj(lat, lng) {
  if (lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271) return [lat, lng]; // 境外不偏
  const a = 6378245.0, ee = 0.00669342162296594323;
  const tLat = (x, y) => {
    let r = -100 + 2*x + 3*y + 0.2*y*y + 0.1*x*y + 0.2*Math.sqrt(Math.abs(x));
    r += (20*Math.sin(6*x*Math.PI) + 20*Math.sin(2*x*Math.PI)) * 2/3;
    r += (20*Math.sin(y*Math.PI) + 40*Math.sin(y/3*Math.PI)) * 2/3;
    r += (160*Math.sin(y/12*Math.PI) + 320*Math.sin(y*Math.PI/30)) * 2/3;
    return r;
  };
  const tLng = (x, y) => {
    let r = 300 + x + 2*y + 0.1*x*x + 0.1*x*y + 0.1*Math.sqrt(Math.abs(x));
    r += (20*Math.sin(6*x*Math.PI) + 20*Math.sin(2*x*Math.PI)) * 2/3;
    r += (20*Math.sin(x*Math.PI) + 40*Math.sin(x/3*Math.PI)) * 2/3;
    r += (150*Math.sin(x/12*Math.PI) + 300*Math.sin(x/30*Math.PI)) * 2/3;
    return r;
  };
  const dLat = tLat(lng - 105, lat - 35), dLng = tLng(lng - 105, lat - 35);
  const rad = lat / 180 * Math.PI;
  let magic = Math.sin(rad); magic = 1 - ee * magic * magic;
  const sq = Math.sqrt(magic);
  return [
    lat + (dLat * 180) / ((a * (1 - ee)) / (magic * sq) * Math.PI),
    lng + (dLng * 180) / (a / sq * Math.cos(rad) * Math.PI),
  ];
}

/* ========== 底图样式（MapLibre style JSON） ========== */
const arcTile = (s) => `https://server.arcgisonline.com/ArcGIS/rest/services/${s}/MapServer/tile/{z}/{y}/{x}`;
const amapTiles = (n) => Array.from({length: 4}, (_, i) =>
  `https://webrd0${i + 1}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=${n}&x={x}&y={y}&z={z}`);
const amapSatTiles = (n) => Array.from({length: 4}, (_, i) =>
  `https://webst0${i + 1}.is.autonavi.com/appmaptile?style=${n}&x={x}&y={y}&z={z}`);

function mapStyle(dark) {
  if (TDT_KEY) {
    const svr = Math.floor(Math.random() * 8);
    const tdt = (type) => `https://t${svr}.tianditu.gov.cn/DataServer?T=${type}&x={x}&y={y}&l={z}&tk=${TDT_KEY}`;
    return {
      version: 8,
      sources: {
        base:   { type: "raster", tiles: [tdt("vec_w")], tileSize: 256, maxzoom: 18 },
        labels: { type: "raster", tiles: [tdt("cva_w")], tileSize: 256, maxzoom: 18 },
      },
      layers: [
        { id: "base",   type: "raster", source: "base" },
        { id: "labels", type: "raster", source: "labels" },
      ],
    };
  }
  if (AMAP_STYLE === "satellite") {
    return {
      version: 8,
      sources: {
        base:   { type: "raster", tiles: amapSatTiles(6), tileSize: 256, maxzoom: 18 },
        labels: { type: "raster", tiles: amapTiles(8),    tileSize: 256, maxzoom: 18 },
      },
      layers: [
        { id: "base",   type: "raster", source: "base" },
        { id: "labels", type: "raster", source: "labels", paint: { "raster-opacity": 0.9 } },
      ],
    };
  }
  // 高德路网图（国内稳定、中文标注）；暗色主题下由 CSS 反色处理
  return {
    version: 8,
    sources: {
      base: { type: "raster", tiles: amapTiles(8), tileSize: 256, maxzoom: 18 },
    },
    layers: [{ id: "base", type: "raster", source: "base" }],
  };
}

/* 拦截前端地图样式请求 */
/* 注意：每次必须返回全新的 Response —— Response body 只能被消费一次，
   复用同一实例会导致第二个地图卡读取 body 失败而黑屏 */
const styleBody = {};
const originalFetch = window.fetch;
window.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input, location.href);
  const m = /^\/static\/map\/(light|dark)\.json$/.exec(url.pathname);
  if (m) {
    if (!styleBody[m[1]]) styleBody[m[1]] = JSON.stringify(mapStyle(m[1] === "dark"));
    return Promise.resolve(
      new Response(styleBody[m[1]], { headers: { "Content-Type": "application/json" } })
    );
  }
  return originalFetch.call(window, input, init);
};

/* ========== GCJ-02 坐标纠偏 + 车辆图片标记：hook ha-map 的 _states（实体坐标入口） ========== */
/* 只影响 ha-map（原生地图卡 + 地图面板），其他卡片拿到的是原始状态 */
const convCache = new Map();
/* 车辆图片：device_tracker.<x>_last_location → 同车 image 实体的 entity_picture。
   匹配策略：1) entity_id 前缀直接命中；2) 未命中时经实体注册表按 device_id 关联
   （tracker 与 image 命名可能不一致，如 qin_jia_dian_dong_che ↔ long_ting_70_y_g）。
   HA 原生 marker 在实体带 entity_picture 时会自动用图片替代文字气泡 */
const deviceImageMap = new Map(); // device_tracker entity_id → picture url
let deviceMapPromise = null;
function syncPicture(entityId) {
  const m = /^device_tracker\.(.+)_last_location$/.exec(entityId || "");
  if (!m) return null;
  try {
    const ha = document.querySelector("home-assistant");
    const img = ha && ha.hass && ha.hass.states && ha.hass.states["image." + m[1]];
    return (img && img.attributes && img.attributes.entity_picture) || null;
  } catch (e) { return null; }
}
function buildDeviceImageMap() {
  const ha = document.querySelector("home-assistant");
  if (!ha || !ha.hass || !ha.hass.connection) return Promise.resolve();
  return ha.hass.connection
    .sendMessagePromise({ type: "config/entity_registry/list" })
    .then((regs) => {
      const imgByDevice = new Map(); // device_id → entity_id
      for (const ent of regs) {
        if (ent.entity_id && ent.entity_id.startsWith("image.") && ent.device_id) {
          imgByDevice.set(ent.device_id, ent.entity_id);
        }
      }
      for (const ent of regs) {
        if (ent.entity_id && /^device_tracker\..+_last_location$/.test(ent.entity_id) && ent.device_id) {
          const imgEid = imgByDevice.get(ent.device_id);
          const st = imgEid && ha.hass.states[imgEid];
          const pic = st && st.attributes && st.attributes.entity_picture;
          if (pic) deviceImageMap.set(ent.entity_id, pic);
        }
      }
    })
    .catch(() => { deviceMapPromise = null; });
}
function vehiclePicture(entityId) {
  const direct = syncPicture(entityId);
  if (direct) return direct;
  if (!deviceMapPromise) deviceMapPromise = buildDeviceImageMap();
  return deviceImageMap.get(entityId) || null;
}
function convEntity(state) {
  const a = state.attributes;
  if (!a || typeof a.latitude !== "number" || typeof a.longitude !== "number") return state;
  const pic = vehiclePicture(state.entity_id);
  const key = a.latitude.toFixed(6) + "," + a.longitude.toFixed(6) + "|" + (pic || "");
  let fixed = convCache.get(key);
  if (!fixed) {
    const [gLat, gLng] = wgs2gcj(a.latitude, a.longitude);
    const attrs = { ...a, latitude: gLat, longitude: gLng };
    if (pic && !attrs.entity_picture) attrs.entity_picture = pic;
    fixed = { ...state, attributes: attrs };
    convCache.set(key, fixed);
    if (convCache.size > 500) convCache.clear();
  }
  return fixed;
}
function patchHaMapCoords() {
  const HaMap = customElements.get("ha-map");
  if (!HaMap || HaMap.prototype.__mapCnPatched) return false;
  // 沿原型链找 _states accessor（2026.11 的 ha-map 无 hass 属性，实体状态经 _states 进入）
  let proto = HaMap.prototype, desc = null;
  while (proto && proto !== Object.prototype) {
    desc = Object.getOwnPropertyDescriptor(proto, "_states");
    if (desc) break;
    proto = Object.getPrototypeOf(proto);
  }
  if (!desc || !desc.set) return false;
  Object.defineProperty(HaMap.prototype, "_states", {
    get: desc.get,
    set(v) {
      if (Array.isArray(v)) v = v.map((s) => (s && s.attributes ? convEntity(s) : s));
      desc.set.call(this, v);
    },
    configurable: true,
    enumerable: desc.enumerable,
  });
  HaMap.prototype.__mapCnPatched = true;
  return true;
}
/* 在建图完成的第一时间挂上引擎监听，避免错过建图初期的瓦片报错 */
function patchSetUpEngine() {
  const HaMap = customElements.get("ha-map");
  if (!HaMap || HaMap.prototype.__mapCnEnginePatched) return false;
  const orig = HaMap.prototype._setUpEngine;
  if (typeof orig !== "function") return false;
  HaMap.prototype._setUpEngine = async function (...args) {
    const ret = await orig.apply(this, args);
    try { watchMapEngine(this); } catch (e) { /* ignore */ }
    return ret;
  };
  HaMap.prototype.__mapCnEnginePatched = true;
  return true;
}

/* ha-map 是懒加载的自定义元素，轮询等待其注册 */
const patchTimer = setInterval(() => {
  const a = patchHaMapCoords();
  const b = patchSetUpEngine();
  if (a && b) clearInterval(patchTimer);
}, 300);
setTimeout(() => clearInterval(patchTimer), 120000);

/* ========== 暗色主题底图反色 + 标记字号 + 车辆图片标记 ========== */
const MARKER_FONT_SIZE = "10px";
const MARKER_CSS = `ha-entity-marker::part(marker) { font-size: ${MARKER_FONT_SIZE} !important; }`;
const VEHICLE_MARKER_CSS = `
.marker.has-vehicle-img {
  background: transparent !important;
  padding: 0 !important;
  width: 42px !important;
  height: 42px !important;
  border-radius: 50% !important;
  overflow: hidden;
  border: 2px solid rgba(255, 255, 255, .92);
  box-shadow: 0 1px 6px rgba(0, 0, 0, .45);
}
.marker.has-vehicle-img img { width: 100% !important; height: 100% !important; object-fit: cover; display: block; }
`;
const DARK_CSS = `.maplibregl-canvas { filter: invert(0.92) hue-rotate(180deg) saturate(0.55) brightness(0.95) contrast(0.92); }`;

function isDarkTheme() {
  try {
    const bg = getComputedStyle(document.documentElement)
      .getPropertyValue("--card-background-color").trim();
    const m = bg.match(/(\d+(\.\d+)?)/g);
    if (m && m.length >= 3) {
      const [r, g, b] = m.map(Number);
      return (0.299 * r + 0.587 * g + 0.114 * b) < 110;
    }
  } catch (e) { /* ignore */ }
  try {
    const ha = document.querySelector("home-assistant");
    return !!(ha && ha.hass && ha.hass.themes && ha.hass.themes.darkMode);
  } catch (e) { return false; }
}
/* 沿 shadow host 链向上找地图卡所在 ha-card 的背景亮度，决定是否反色 */
function isMapCardDark(mapEl) {
  try {
    let cur = mapEl;
    while (cur) {
      if (cur.tagName === "HA-CARD") {
        const bg = getComputedStyle(cur).backgroundColor;
        const m = bg.match(/(\d+(\.\d+)?)/g);
        if (m && m.length >= 3) {
          const [r, g, b] = m.map(Number);
          return (0.299 * r + 0.587 * g + 0.114 * b) < 110;
        }
        return false;
      }
      cur = cur.parentElement || (cur.getRootNode && cur.getRootNode().host) || null;
    }
  } catch (e) { /* ignore */ }
  return isDarkTheme();
}
function eachShadowRoot(root, fn) {
  root.querySelectorAll?.("*").forEach((el) => {
    if (el.shadowRoot) { fn(el.shadowRoot); eachShadowRoot(el.shadowRoot, fn); }
  });
}
/* 车辆标记换车辆图片：ha-entity-marker(.marker 文字) → 同设备 image.* 的实拍图 */
function injectVehicleMarkers() {
  eachShadowRoot(document, (sr) => {
    const host = sr.host;
    // 1) ha-entity-marker 自身 shadowRoot：替换文字为图片
    if (host && host.tagName === "HA-ENTITY-MARKER") {
      const markerDiv = sr.querySelector(".marker");
      if (markerDiv && !markerDiv.querySelector("img.vehicle-img")) {
        const eid = host.getAttribute("entity-id") || host.entityId || "";
        const pic = vehiclePicture(eid);
        if (pic && markerDiv.textContent.trim()) {
          markerDiv.textContent = "";
          const img = document.createElement("img");
          img.className = "vehicle-img";
          img.src = pic;
          img.alt = "";
          markerDiv.appendChild(img);
          markerDiv.classList.add("has-vehicle-img");
        }
      }
    }
    // 2) 包含 ha-entity-marker 的 shadowRoot：注入样式
    if ((sr.querySelector("ha-entity-marker") || (host && host.tagName === "HA-ENTITY-MARKER"))
        && !sr.querySelector("style.hass-map-cn-vehicle")) {
      const st = document.createElement("style");
      st.className = "hass-map-cn-vehicle";
      st.textContent = VEHICLE_MARKER_CSS;
      sr.appendChild(st);
    }
  });
}
function injectMapStyles() {
  eachShadowRoot(document, (sr) => {
    const mapEl = sr.querySelector("ha-map") || (sr.host && sr.host.tagName === "HA-MAP" ? sr.host : null);
    if (!mapEl) return;
    if (!sr.querySelector("style.hass-map-cn-marker")) {
      const st = document.createElement("style");
      st.className = "hass-map-cn-marker";
      st.textContent = MARKER_CSS;
      sr.appendChild(st);
    }
    if (TDT_KEY === "" && AMAP_STYLE === "road") { // 仅高德路网图需要反色
      const dark = FORCE_DARK === null ? isMapCardDark(mapEl) : FORCE_DARK;
      const want = dark ? DARK_CSS : "";
      const cur = sr.querySelector("style.hass-map-cn-dark");
      if (want && !cur) {
        const st = document.createElement("style");
        st.className = "hass-map-cn-dark";
        st.textContent = want;
        sr.appendChild(st);
      } else if (!want && cur) {
        cur.remove();
      }
    }
  });
}
/* ========== 地图自愈：底图未接管 / 瓦片加载失败 / WebGL 丢失 / 画布尺寸为 0 ========== */
/* 背景：maplibre 对 raster 瓦片失败不会重试，且 areTilesLoaded() 仍返回 true，
   一旦网络抖动或高德返回 5xx，地图就永久空白，只能刷新页面。这里做自动恢复。 */
const HEAL_MIN_INTERVAL = 20000; // 同一张地图两次自愈的最小间隔(ms)
const HEAL_MAX = 5;              // 单次页面生命周期内同一张地图最多自愈次数
const healState = new WeakMap();

function healStateOf(el) {
  let st = healState.get(el);
  if (!st) {
    st = { last: 0, count: 0, errors: 0 };
    healState.set(el, st);
  }
  return st;
}

/* 找到承载底图瓦片的 source id（normal 情况就是 base，自定义图层可能改名） */
function baseSourceId(map) {
  try {
    const st = map.getStyle();
    if (!st || !st.sources) return null;
    if (st.sources.base) return "base";
    for (const k of Object.keys(st.sources)) {
      const v = st.sources[k];
      if (v && (v.tiles || v.url)) return k;
    }
  } catch (e) { /* ignore */ }
  return null;
}

/* 强制重载瓦片：maplibre 不会重试失败的 raster 瓦片，必须主动清空重拉。
   setTiles() 会清空该 source 的瓦片缓存并重新请求，等效于"局部刷新底图"。 */
function reloadTiles(el) {
  const en = el._engine;
  const map = en && en._map;
  if (!map) return false;
  const style = mapStyle(false);
  const tiles = (style.sources.base && style.sources.base.tiles) || [];
  const sid = baseSourceId(map);
  try {
    const src = sid && map.getSource && map.getSource(sid);
    if (src && typeof src.setTiles === "function") {
      src.setTiles(tiles);
      if (map.triggerRepaint) map.triggerRepaint();
      return true;
    }
  } catch (e) { /* 落到下面 */ }
  try {
    map.setStyle(style, { diff: false });
    return true;
  } catch (e) { /* ignore */ }
  return false;
}

function requestHeal(el, reason, hard) {
  const st = healStateOf(el);
  if (st.count >= HEAL_MAX) return;
  const now = Date.now();
  if (now - st.last < (hard ? 30000 : HEAL_MIN_INTERVAL)) return;
  st.last = now;
  st.count++;
  st.errors = 0;
  el.__cnHeals = st.count; // 供排查用
  console.info("[map-cn] 地图自愈 #" + st.count + "：" + reason);
  setTimeout(() => {
    if (!el.isConnected || !el._engine) return;
    // 只有引擎真的挂了（WebGL 丢失 / 引擎标记异常）才重建容器，
    // 其余情况一律只重拉瓦片 —— 重建容器会让 lit 重渲染卡片，容易触发循环
    if (hard) {
      try {
        el._loading = false;
        if (typeof el._loadMap === "function") el._loadMap();
      } catch (e) { /* ignore */ }
      return;
    }
    if (!reloadTiles(el)) {
      try { el._engine._map.setStyle(mapStyle(false), { diff: false }); } catch (e) { /* ignore */ }
    }
  }, 400);
}

/* 监听引擎事件：瓦片连续报错就自愈；有瓦片成功则清零 */
function watchMapEngine(el) {
  const en = el._engine;
  if (!en || en.__cnWatched) return;
  const map = en._map;
  if (!map || !map.on) return;
  en.__cnWatched = true;
  map.on("error", (e) => {
    const msg = String((e && e.error && (e.error.message || e.error)) || "");
    if (e && (e.sourceId !== undefined || /tile|fetch|network|50\d|404|Failed to fetch/i.test(msg))) {
      const st = healStateOf(el);
      st.errors += 1;
      if (st.errors >= 4) requestHeal(el, "瓦片连续加载失败");
    }
  });
  map.on("data", (e) => {
    if (e && (e.dataType === "source" || e.dataType === "tile")) {
      const st = healStateOf(el);
      st.errors = 0;
      st.hasTile = true;
      st.lastTile = Date.now();
      el.__cnHasTile = true; // 供排查用
    }
  });
  map.on("idle", () => {
    // 注意：瓦片全部失败时 maplibre 也会进入 idle，不能把 idle 当成"加载成功"
    healStateOf(el).errors = 0;
  });
  // 不用 canvas 的 webglcontextlost 事件触发修复：maplibre 换样式时会销毁旧上下文，
  // 该事件会被误触发并造成"重建→再丢失"的循环。改为巡检 el._contextLost 标志。
}

/* 当前引擎实际使用的地图源地址（拿不到返回 null） */
function currentTileUrl(el) {
  const en = el._engine;
  const map = en && en._map;
  if (!map || !map.getStyle) return null;
  try {
    const st = map.getStyle();
    if (!st || !st.sources) return null;
    const sid = baseSourceId(map);
    if (!sid) return "";
    const src = st.sources[sid];
    return (src.tiles && src.tiles[0]) || src.url || "";
  } catch (e) { return null; }
}

/* 底图 source 是否已经成功加载过瓦片；拿不到返回 null */
function tileStateOf(el) {
  const st = healStateOf(el);
  return { hasTile: !!st.hasTile, lastTile: st.lastTile || 0 };
}

/* 地图是否真的在屏幕上可见（不可见时 maplibre 不加载瓦片，不能误判为失败） */
function mapVisible(el) {
  const cv = el.shadowRoot && el.shadowRoot.querySelector(".maplibregl-canvas");
  if (!cv) return false;
  if (cv.width <= 2 || cv.height <= 2) return false;
  const r = cv.getBoundingClientRect();
  if (r.width < 8 || r.height < 8) return false;
  return r.bottom > 0 && r.top < (window.innerHeight || 0);
}

function patrolMaps() {
  eachShadowRoot(document, (sr) => {
    const list = [];
    if (sr.host && sr.host.tagName === "HA-MAP") list.push(sr.host);
    sr.querySelectorAll("ha-map").forEach((m) => list.push(m));
    for (const el of list) {
      const en = el._engine;
      if (!en) continue;
      watchMapEngine(el);
      if (en._contextLost || en._refused) { requestHeal(el, "引擎状态异常", true); continue; }
      const cv = el.shadowRoot && el.shadowRoot.querySelector(".maplibregl-canvas");
      if (cv && (cv.width <= 2 || cv.height <= 2)) { requestHeal(el, "画布尺寸为 0"); continue; }
      // 底图不是我们注入的（脚本晚于建图、或被前端绕过 fetch 劫持）→ 直接热切换
      const url = currentTileUrl(el);
      if (url && !/autonavi|tianditu/.test(url)) {
        try {
          en._applyStyle(mapStyle(false));
          console.info("[map-cn] 底图未接管，已切换为高德");
        } catch (e) { requestHeal(el, "底图未接管"); }
        continue;
      }
      // 可见地图但从未成功加载过任何瓦片 = 请求全失败（maplibre 会静默放弃，不会重试）
      const st = healStateOf(el);
      if (!mapVisible(el)) { st.visibleSince = 0; continue; }
      if (!st.visibleSince) st.visibleSince = Date.now();
      // 滚入视口/初次显示 10 秒内不判失败，避免误伤正常加载
      if (Date.now() - st.visibleSince < 10000) continue;
      if (!st.hasTile) requestHeal(el, "底图瓦片从未加载成功");
    }
  });
}
document.addEventListener("visibilitychange", () => {
  // 手机切回前台、WebGL 被系统回收后常见黑屏，回前台巡检一次
  if (!document.hidden) setTimeout(patrolMaps, 800);
});
setTimeout(patrolMaps, 3000);
setInterval(patrolMaps, 8000);

new MutationObserver(() => { injectMapStyles(); injectVehicleMarkers(); }).observe(document.body, { childList: true, subtree: true });
setInterval(() => { injectMapStyles(); injectVehicleMarkers(); }, 3000);
injectMapStyles();
injectVehicleMarkers();

console.info(
  "%c HASS-MAP-CN v2 %c 底图：" + (TDT_KEY ? "天地图(官方无偏移)" : "高德地图 + GCJ02纠偏(" + AMAP_STYLE + ")") + " ",
  "background:#0ea5e9;color:#fff;border-radius:4px 0 0 4px",
  "background:#0f172a;color:#7dd3fc;border-radius:0 4px 4px 0"
);
