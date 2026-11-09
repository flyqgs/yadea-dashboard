/**
 * hass_map_cn.js — 修复 Home Assistant 原生地图在国内网络下空白（/api/map_tiles 502）
 *
 * 原理：拦截前端地图样式请求（/static/map/light.json、dark.json），
 *       把默认的 OSM 矢量底图替换为可达的栅格瓦片源。
 *       天地图（CGCS2000≈WGS84，无坐标偏移）优先；未填 Key 时回退 ArcGIS Canvas 底图。
 *       修复后对所有原生地图组件生效（地图面板、ha-map 卡片等）。
 *
 * 用法：
 *   1. 推荐到 https://lbs.tianditu.gov.cn 注册个人开发者（免费），申请"浏览器端"类型 Key，
 *      填到下方 TDT_KEY，即可使用中文底图；
 *   2. 不填则使用 ArcGIS 底图（免 Key，英文标注）。
 *   3. 在 configuration.yaml 中配置并重启：
 *      frontend:
 *        themes: !include_dir_merge_named themes
 *        extra_module_url:
 *          - /local/hass_map_cn.js?v=20261109
 *      （更新本文件后记得更换 ?v= 版本号，HA 对静态文件缓存 31 天）
 */
const TDT_KEY = ""; // 天地图 Key，留空则使用 ArcGIS 底图

const arcTile = (service) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/${service}/MapServer/tile/{z}/{y}/{x}`;

function mapStyle(dark) {
  if (TDT_KEY) {
    const svr = Math.floor(Math.random() * 8);
    const tdt = (type) =>
      `https://t${svr}.tianditu.gov.cn/DataServer?T=${type}&x={x}&y={y}&l={z}&tk=${TDT_KEY}`;
    return {
      version: 8,
      sources: {
        base: { type: "raster", tiles: [tdt(dark ? "vec_w" : "vec_w")], tileSize: 256, maxzoom: 18 },
        labels: { type: "raster", tiles: [tdt("cva_w")], tileSize: 256, maxzoom: 18 },
      },
      layers: [
        { id: "base", type: "raster", source: "base" },
        { id: "labels", type: "raster", source: "labels" },
      ],
    };
  }
  // ArcGIS Canvas：明/暗两套，maxzoom 16 之外 MapLibre 自动放大父瓦片
  const base = dark ? "Canvas/World_Dark_Gray_Base" : "Canvas/World_Light_Gray_Base";
  const ref = dark ? "Canvas/World_Dark_Gray_Reference" : "Canvas/World_Light_Gray_Reference";
  return {
    version: 8,
    sources: {
      base: { type: "raster", tiles: [arcTile(base)], tileSize: 256, maxzoom: 16 },
      labels: { type: "raster", tiles: [arcTile(ref)], tileSize: 256, maxzoom: 16 },
    },
    layers: [
      { id: "base", type: "raster", source: "base" },
      { id: "labels", type: "raster", source: "labels" },
    ],
  };
}

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

console.info(
  "%c HASS-MAP-CN %c 地图瓦片源替换已启用：" + (TDT_KEY ? "天地图" : "ArcGIS(未配置天地图Key)") + " ",
  "background:#0ea5e9;color:#fff;border-radius:4px 0 0 4px",
  "background:#0f172a;color:#7dd3fc;border-radius:0 4px 4px 0"
);

/* ---- 地图标记字号调整：默认气泡文字偏大，缩到 10px ---- */
const MARKER_FONT_SIZE = "10px";
const MARKER_CSS = `ha-entity-marker::part(marker) { font-size: ${MARKER_FONT_SIZE} !important; }`;

function eachShadowRoot(root, fn) {
  // 递归遍历所有 shadow root（ha-map 藏在 hui-map-card 等 shadow 内）
  root.querySelectorAll?.("*").forEach((el) => {
    if (el.shadowRoot) {
      fn(el.shadowRoot);
      eachShadowRoot(el.shadowRoot, fn);
    }
  });
}

function injectMarkerStyle() {
  eachShadowRoot(document, (sr) => {
    // ::part() 样式必须注入到 ha-entity-marker host 所在的 shadow root
    if (sr.querySelector("ha-entity-marker") && !sr.querySelector("style.hass-map-cn")) {
      const st = document.createElement("style");
      st.className = "hass-map-cn";
      st.textContent = MARKER_CSS;
      sr.appendChild(st);
    }
  });
}

new MutationObserver(() => injectMarkerStyle()).observe(document.body, {
  childList: true,
  subtree: true,
});
setInterval(injectMarkerStyle, 3000);
injectMarkerStyle();
