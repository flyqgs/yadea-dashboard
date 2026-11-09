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
const styleCache = {};
const originalFetch = window.fetch;
window.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input, location.href);
  const m = /^\/static\/map\/(light|dark)\.json$/.exec(url.pathname);
  if (m) {
    const dark = m[1] === "dark";
    if (!styleCache[m[1]]) {
      styleCache[m[1]] = Promise.resolve(
        new Response(JSON.stringify(mapStyle(dark)), {
          headers: { "Content-Type": "application/json" },
        })
      );
    }
    return styleCache[m[1]];
  }
  return originalFetch.call(window, input, init);
};

/* ========== GCJ-02 坐标纠偏：hook ha-map 的 _states（实体坐标入口） ========== */
/* 只影响 ha-map（原生地图卡 + 地图面板），其他卡片拿到的是原始状态 */
const convCache = new Map();
function convEntity(state) {
  const a = state.attributes;
  if (!a || typeof a.latitude !== "number" || typeof a.longitude !== "number") return state;
  const key = a.latitude.toFixed(6) + "," + a.longitude.toFixed(6);
  let fixed = convCache.get(key);
  if (!fixed) {
    const [gLat, gLng] = wgs2gcj(a.latitude, a.longitude);
    fixed = { ...state, attributes: { ...a, latitude: gLat, longitude: gLng } };
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
/* ha-map 是懒加载的自定义元素，轮询等待其注册 */
const patchTimer = setInterval(() => { if (patchHaMapCoords()) clearInterval(patchTimer); }, 300);
setTimeout(() => clearInterval(patchTimer), 120000);

/* ========== 暗色主题底图反色 + 标记字号 ========== */
const MARKER_FONT_SIZE = "10px";
const MARKER_CSS = `ha-entity-marker::part(marker) { font-size: ${MARKER_FONT_SIZE} !important; }`;
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
new MutationObserver(() => injectMapStyles()).observe(document.body, { childList: true, subtree: true });
setInterval(injectMapStyles, 3000);
injectMapStyles();

console.info(
  "%c HASS-MAP-CN v2 %c 底图：" + (TDT_KEY ? "天地图(官方无偏移)" : "高德地图 + GCJ02纠偏(" + AMAP_STYLE + ")") + " ",
  "background:#0ea5e9;color:#fff;border-radius:4px 0 0 4px",
  "background:#0f172a;color:#7dd3fc;border-radius:0 4px 4px 0"
);
