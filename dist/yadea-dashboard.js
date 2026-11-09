/**
 * 雅迪智行 · Home Assistant 仪表盘策略（Dashboard strategy）
 *
 * 安装后无需手写 YAML：在「添加仪表盘 → 社区仪表盘」里选择本策略，
 * 会自动发现家中所有雅迪车辆（雅迪集成 v2.0.0+）并生成三套视图：
 *   1. 总览     —— 车辆实拍图头卡、电量长条图、电量趋势(近7天)、本月/累计/减碳/近 7 天统计、
 *                  近 7 天柱状图、双车对比、能耗·云端计费、物联网卡、车辆档案对照、数据说明
 *   2. 骑行轨迹 —— 今日骑行大数字、近 14 天柱状图、最近路线、今日分段明细
 *   3. 能耗档案 —— 充电/耗电统计、车辆档案
 *
 * 依赖前端卡片：card-mod、mushroom、apexcharts-card；
 * 可选安装 bar-card，总览页将呈现旗舰版同款电量长条图（未装则自动降级）。
 * 生成后可在仪表盘右上角「接管控制」转为可手动编辑的普通仪表盘。
 */

const VERSION = "1.0.6";
const ACCENTS = ["#38bdf8", "#fbbf24", "#a78bfa", "#34d399", "#f472b6", "#facc15"];

const BG =
  "radial-gradient(1400px 800px at 12% -8%, #1b2b49 0%, #0b1220 58%, #070b14 100%)";

const CARD_CSS = [
  "ha-card {",
  "  --primary-text-color: #f1f5f9;",
  "  --secondary-text-color: #94a3b8;",
  "  background: rgba(17,24,39,0.72) !important;",
  "  border: 1px solid rgba(148,163,184,0.16) !important;",
  "  border-radius: 14px !important;",
  "  box-shadow: 0 8px 24px rgba(2,6,23,0.45) !important;",
  "}",
].join("\n");

const MD_CSS = [
  "ha-card {",
  "  background: rgba(17,24,39,0.72) !important;",
  "  border: 1px solid rgba(148,163,184,0.16) !important;",
  "  border-radius: 14px !important;",
  "  box-shadow: 0 8px 24px rgba(2,6,23,0.45) !important;",
  "  color: #e2e8f0 !important;",
  "}",
  ".card-content { color: #e2e8f0 !important; }",
  "table { width: 100%; border-collapse: collapse; font-size: 13px; }",
  "th { color: #94a3b8; font-weight: 600; text-align: left; padding: 4px 6px;",
  "     border-bottom: 1px solid rgba(148,163,184,0.22); }",
  "td { padding: 5px 6px; border-bottom: 1px solid rgba(148,163,184,0.10); }",
].join("\n");

/* 旗舰版同款渐变卡样式（总览页对齐旗舰版用） */
const PRO_CARD_CSS = [
  "ha-card {",
  "  --primary-text-color: #f1f5f9;",
  "  --secondary-text-color: #94a3b8;",
  "  --card-primary-color: #f1f5f9;",
  "  --card-secondary-color: #94a3b8;",
  "  --rgb-primary-text-color: 241,245,249;",
  "  --rgb-secondary-text-color: 148,163,184;",
  "  --markdown-table-border-color: rgba(148,163,184,0.22);",
  "  --divider-color: rgba(148,163,184,0.16);",
  "  --state-icon-color: #7dd3fc;",
  "  background: linear-gradient(158deg, rgba(18,27,45,0.94) 0%, rgba(9,14,26,0.96) 100%) !important;",
  "  border: 1px solid rgba(120,160,255,0.12);",
  "  border-radius: 20px;",
  "  box-shadow: 0 12px 30px rgba(2,6,23,0.40);",
  "  overflow: hidden;",
  "}",
].join("\n");

const PRO_MD_CSS = [PRO_CARD_CSS, "ha-markdown { padding: 12px 16px; font-size: 90%; }"].join(
  "\n"
);

/* ---------------------------------------------------------------- 工具函数 */

const eid = (v, suffix) => `${v.prefix}_${suffix}`;
const hasEntity = (hass, id) => Boolean(hass.states[id]);
const num = (hass, id) => {
  const s = hass.states[id];
  if (!s) return null;
  const n = Number(s.state);
  return Number.isFinite(n) ? n : null;
};
/** 「有值显示值，否则显示 —」的 Jinja 片段 */
const valTpl = (id) =>
  `{{ (states('${id}') if states('${id}') not in ('unknown', 'unavailable', 'None') else '—') }}`;
const attrTpl = (id, attr) => `{{ (state_attr('${id}', '${attr}') or '—') }}`;

function headingCard(text, icon, accent) {
  return {
    type: "heading",
    heading: text,
    icon,
    heading_style: "subtitle",
    card_mod: {
      style: [
        "ha-card {",
        "  --ha-heading-card-title-color: #e2e8f0;",
        "  --ha-heading-card-subtitle-color: #94a3b8;",
        "  --ha-heading-card-title-font-weight: 600;",
        "  --ha-heading-card-subtitle-font-weight: 600;",
        "  background: transparent !important;",
        "  border: none !important;",
        "  box-shadow: none !important;",
        "}",
        `ha-icon { color: ${accent} !important; }`,
      ].join("\n"),
    },
  };
}

function mdCard(content, extraCss = "", style = MD_CSS) {
  return {
    type: "markdown",
    content,
    card_mod: { style: extraCss ? `${style}\n${extraCss}` : style },
  };
}

/** mushroom 模板卡（无 entity，点击不触发更多信息） */
function tplCard({ icon, color, primary, secondary, multiline = false, style = CARD_CSS }) {
  return {
    type: "custom:mushroom-template-card",
    icon,
    icon_color: color,
    primary,
    secondary,
    multiline_secondary: multiline,
    tap_action: { action: "none" },
    card_mod: { style },
  };
}

/** 缺失实体时返回 null，便于过滤 */
function tplIf(hass, ids, build) {
  return ids.every((id) => hasEntity(hass, id)) ? build() : null;
}

/* ---------------------------------------------------------------- 车辆发现 */

/**
 * 优先使用用户显式配置的 vehicles；否则从实体注册表自动发现。
 * 发现依据：雅迪集成为每台车创建 sensor.<slug>_today_mileage。
 */
function discoverVehicles(hass, config) {
  const out = [];
  const seen = new Set();

  for (const [index, v] of (config.vehicles || []).entries()) {
    const prefix = String(v.prefix || "").replace(/_+$/, "");
    if (!prefix || seen.has(prefix)) continue;
    seen.add(prefix);
    const deviceId =
      (hass.entities[`${prefix}_today_mileage`] || {}).device_id ||
      (hass.entities[`${prefix}_battery`] || {}).device_id;
    const device = deviceId ? hass.devices[deviceId] || {} : {};
    out.push({
      prefix,
      name: v.name || device.name_by_user || device.name || prefix.split(".").pop(),
      model: v.model || device.model || "",
      accent: v.accent || ACCENTS[index % ACCENTS.length],
      device,
    });
  }
  if (out.length) return out;

  Object.keys(hass.states)
    .filter((id) => id.endsWith("_today_mileage"))
    .sort()
    .forEach((id, index) => {
      const prefix = id.slice(0, -"_today_mileage".length);
      if (seen.has(prefix)) return;
      seen.add(prefix);
      const registry = hass.entities[id] || {};
      const device = registry.device_id ? hass.devices[registry.device_id] || {} : {};
      out.push({
        prefix,
        name: device.name_by_user || device.name || prefix.split(".").pop(),
        model: device.model || "",
        accent: ACCENTS[index % ACCENTS.length],
        device,
      });
    });

  // 没有轨迹实体（家人共享账号）时，退化为按电池实体发现
  if (!out.length) {
    Object.keys(hass.states)
      .filter((id) => id.endsWith("_battery") && id.startsWith("sensor."))
      .sort()
      .forEach((id, index) => {
        const prefix = id.slice(0, -"_battery".length);
        const registry = hass.entities[id] || {};
        const attrs = hass.states[id].attributes || {};
        if (attrs.unit_of_measurement !== "%") return;
        if (seen.has(prefix)) return;
        seen.add(prefix);
        const device = registry.device_id ? hass.devices[registry.device_id] || {} : {};
        out.push({
          prefix,
          name: device.name_by_user || device.name || prefix.split(".").pop(),
          model: device.model || "",
          accent: ACCENTS[index % ACCENTS.length],
          device,
        });
      });
  }
  return out;
}

/* ---------------------------------------------------------------- 卡片构造 */

function heroCard(hass, v) {
  const battery = eid(v, "battery");
  const range = eid(v, "remaining_range");
  const report = eid(v, "last_report");
  const month = eid(v, "mileage_this_month");
  const count = eid(v, "battery_count");

  // 车辆实拍图：来自 sensor.<prefix>_vehicle_info 的 vehicle_image 属性（雅迪集成提供）
  const info = hass.states[eid(v, "vehicle_info")];
  const img =
    info && info.attributes && info.attributes.vehicle_image
      ? String(info.attributes.vehicle_image)
      : "";

  // 与旗舰版一致的「值或 —」模板
  const val = valTpl;
  const rel = (id) =>
    `{% set ts = as_timestamp(states('${id}')) %}{% if ts > 0 %}` +
    `{% set d = (as_timestamp(now()) - ts) | int %}` +
    `{% if d < 3600 %}{{ (d // 60) }} 分钟前` +
    `{% elif d < 86400 %}{{ (d // 3600) }} 小时前` +
    `{% else %}{{ (d // 86400) }} 天前{% endif %}{% else %}—{% endif %}`;

  const meta = [
    hasEntity(hass, count) ? `电池 ${val(count)} 组` : null,
    hasEntity(hass, month) ? `本月 ${val(month)} km` : null,
    hasEntity(hass, report) ? `上报 ${rel(report)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const content = [
    `**YADEA · SMART MOTO**  \n`,
    v.model ? `**${v.model}**\n` : "",
    `\n# ${val(battery)}%\n`,
    `\n**续航 ${val(range)} km**\n`,
    meta ? `\n${meta}\n` : "",
  ].join("");

  const bgLayers = [
    "linear-gradient(0deg, rgba(8,13,24,0.85) 0%, rgba(8,13,24,0) 30%)",
    "linear-gradient(90deg, rgba(8,13,24,0.99) 0%, rgba(8,13,24,0.95) 28%, rgba(8,13,24,0.30) 50%, rgba(8,13,24,0) 68%)",
    img ? `url("${img}") right 2px center / contain no-repeat` : null,
    "linear-gradient(160deg, #16233c 0%, #0a1020 100%)",
  ]
    .filter(Boolean)
    .join(", ");

  const styleDot = [
    "ha-card {",
    "  --primary-text-color: #f1f5f9;",
    "  --secondary-text-color: #94a3b8;",
    "  min-height: 168px;",
    "  border-radius: 24px;",
    "  overflow: hidden;",
    "  border: 1px solid rgba(120,160,255,0.14);",
    "  box-shadow: 0 16px 36px rgba(2,6,23,0.50);",
    `  background: ${bgLayers};`,
    "}",
    "ha-markdown { padding: 14px 16px; }",
    "ha-markdown h1 { margin: 2px 0 4px; letter-spacing: .5px; }",
  ].join("\n");

  const styleMd = [
    "h1 { font-size: 44px !important; font-weight: 700 !important; line-height: 1.1 !important; margin: 2px 0 6px !important; }",
    "p { margin: 0.35em 0 !important; }",
    "p strong:first-child { letter-spacing: 1.2px; font-size: 92%; }",
  ].join("\n");

  return {
    type: "markdown",
    content,
    card_mod: { style: { ".": styleDot, "ha-markdown $": styleMd } },
  };
}

/** 旗舰版同款统计四宫格：本月 / 累计 / 减碳 / 近 7 天 */
function statGrid(hass, v) {
  const items = [
    tplIf(hass, [eid(v, "mileage_this_month")], () =>
      tplCard({
        icon: "mdi:map-marker-distance",
        color: v.accent,
        primary: `${valTpl(eid(v, "mileage_this_month"))} km`,
        secondary: "本月里程",
        style: PRO_CARD_CSS,
      })
    ),
    tplIf(hass, [eid(v, "total_mileage")], () =>
      tplCard({
        icon: "mdi:road-variant",
        color: "#60a5fa",
        primary: `${valTpl(eid(v, "total_mileage"))} km`,
        secondary: "累计里程",
        style: PRO_CARD_CSS,
      })
    ),
    // 减碳：优先用 total_co2_saved 实体，缺实体时按旗舰版口径 0.18 kg/km 折算
    hasEntity(hass, eid(v, "total_co2_saved"))
      ? tplCard({
          icon: "mdi:leaf",
          color: "#22c55e",
          primary: `${valTpl(eid(v, "total_co2_saved"))} kg`,
          secondary: "累计碳减排",
          style: PRO_CARD_CSS,
        })
      : tplIf(hass, [eid(v, "total_mileage")], () =>
          tplCard({
            icon: "mdi:leaf",
            color: "#22c55e",
            primary:
              `{% set km = states('${eid(v, "total_mileage")}') %}` +
              `{% if km in ('unknown','unavailable','None') %}—` +
              `{% else %}{{ (km | float(0) * 0.18) | round(1) }}{% endif %} kg`,
            secondary: "累计碳减排 · 0.18 kg/km",
            style: PRO_CARD_CSS,
          })
        ),
    tplIf(hass, [eid(v, "this_week_mileage")], () =>
      tplCard({
        icon: "mdi:bike-fast",
        color: "#f59e0b",
        primary: `${valTpl(eid(v, "this_week_mileage"))} km`,
        secondary: "近 7 天骑行",
        style: PRO_CARD_CSS,
      })
    ),
  ].filter(Boolean);

  if (!items.length) return null;
  return { type: "grid", columns: 2, square: false, cards: items };
}

/** 旗舰版同款近 7 天柱状图（读 this_week_mileage 的 days 属性） */
function weeklyChart(hass, v) {
  const id = eid(v, "this_week_mileage");
  if (!hasEntity(hass, id)) return null;
  return {
    type: "custom:apexcharts-card",
    header: { show: false },
    graph_span: "7d",
    span: { end: "day" },
    update_interval: "30min",
    show: { loading: false },
    series: [
      {
        entity: id,
        type: "column",
        name: "每日里程",
        color: v.accent,
        data_generator: [
          "const rows = (entity && entity.attributes && entity.attributes.days) || [];",
          "return rows.map((r) => [new Date(r.date + 'T00:00:00+08:00').getTime(), Number(r.km) || 0]);",
        ].join("\n"),
      },
    ],
    apex_config: {
      chart: { height: 150, foreColor: "#94a3b8", toolbar: { show: false } },
      dataLabels: { enabled: false },
      xaxis: {
        labels: { format: "MM-dd", style: { fontSize: "10px" } },
        axisBorder: { show: false },
        axisTicks: { show: false },
      },
      yaxis: { labels: { style: { fontSize: "10px" } } },
      grid: {
        borderColor: "rgba(148,163,184,0.14)",
        yaxis: { lines: { show: true } },
      },
      plotOptions: { bar: { borderRadius: 4, columnWidth: "55%" } },
      tooltip: { theme: "dark" },
      noData: {
        text: "暂无骑行数据 · 骑行后自动累计",
        align: "center",
        style: { color: "#94a3b8", fontSize: "13px" },
      },
    },
    card_mod: { style: `${PRO_CARD_CSS}\nha-card { padding: 8px 10px 0; }` },
  };
}

/* bar-card 检测：装了就用旗舰版同款电量长条图，没装则降级为普通卡片 */
function hasBarCardSync() {
  try {
    if (customElements.get("bar-card")) return true;
  } catch (err) {
    /* ignore */
  }
  try {
    return (window.customCards || []).some((c) => c.type === "bar-card");
  } catch (err) {
    return false;
  }
}

async function detectBarCard(timeoutMs = 1500) {
  if (hasBarCardSync()) return true;
  try {
    await Promise.race([
      customElements.whenDefined("bar-card"),
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  } catch (err) {
    /* ignore */
  }
  return hasBarCardSync();
}

const BAR_CARD_CSS = [
  "ha-card {",
  "  background: linear-gradient(158deg, rgba(18,27,45,0.94) 0%, rgba(9,14,26,0.96) 100%) !important;",
  "  border: 1px solid rgba(120,160,255,0.12);",
  "  border-radius: 18px;",
  "  box-shadow: 0 12px 30px rgba(2,6,23,0.40);",
  "  padding: 10px 14px 6px;",
  "  --primary-text-color: #94a3b8;",
  "}",
  "bar-card-currentbar, bar-card-backgroundbar { border-radius: 7px; }",
  "bar-card-name { font-size: 12px; }",
  "bar-card-value { font-size: 12px; color: #e2e8f0; }",
  "bar-card-iconbar ha-icon { color: #7dd3fc; }",
].join("\n");

function batteryBarCard(v) {
  return {
    type: "custom:bar-card",
    entities: [{ entity: eid(v, "battery"), name: `${v.name} 电量`, icon: "mdi:battery-high" }],
    unit_of_measurement: "%",
    min: 0,
    max: 100,
    height: 14,
    radius: 7,
    gravity: false,
    positions: { icon: "off", indicator: "off", name: "off", value: "inside" },
    severity: [
      { color: "#ef4444", from: 0, to: 20 },
      { color: "#f59e0b", from: 20, to: 50 },
      { color: "#22c55e", from: 50, to: 100 },
    ],
    card_mod: { style: BAR_CARD_CSS },
  };
}

function batteryBar(hass, v, hasBar) {
  if (!hasEntity(hass, eid(v, "battery"))) return null;
  if (hasBar) return batteryBarCard(v);
  return {
    type: "custom:mushroom-template-card",
    grid_columns: 2,
    entity: eid(v, "battery"),
    icon: "mdi:battery-high",
    icon_color: v.accent,
    primary: "电量",
    secondary: "{{ states('" + eid(v, "battery") + "') }}% · 续航 {{ states('" + eid(v, "remaining_range") + "') }} km",
    tap_action: { action: "more-info" },
    card_mod: { style: CARD_CSS },
  };
}

/** 电量历史拉取：7 天起点可能早于 recorder 库内最早记录（HA 2026.11 对此直接返回空），
 *  故逐级回退 7→5→3→2→1 天，取第一批有数据的窗口。 */
async function fetchBatteryTrendPoints(hass, entityId) {
  for (const days of [7, 5, 3, 2, 1]) {
    try {
      const start = new Date(Date.now() - days * 86400000).toISOString();
      const res = await hass.callApi(
        "GET",
        `history/period/${start}?filter_entity_id=${entityId}&minimal_response&significant_changes_only=0`
      );
      const rows = (Array.isArray(res) && res[0]) || [];
      const points = [];
      for (const p of rows) {
        const raw = p.state !== undefined ? p.state : p.s;
        const value = Number(raw);
        if (!Number.isFinite(value) || value < 0 || value > 100) continue;
        const ts = p.last_changed || p.lu;
        if (!ts) continue;
        points.push([new Date(ts).getTime(), value]);
      }
      if (points.length > 1) return points;
    } catch (err) {
      /* 下一个窗口 */
    }
  }
  return [];
}

/** 电量趋势 · 近7天：面积图 + 阈值变色 + Min/Max 极值标注（历史点由策略生成时内嵌） */
function batteryTrend(hass, v, points) {
  const id = eid(v, "battery");
  if (!hasEntity(hass, id)) return null;
  const series = [
    {
      entity: id,
      type: "area",
      name: "电量",
      color: v.accent,
      stroke_width: 2,
      show: { extremas: true },
      data_generator: `return ${JSON.stringify(points || [])};`,
    },
  ];
  return {
    type: "custom:apexcharts-card",
    header: {
      show: true,
      title: "电量趋势 · 近7天",
      show_states: true,
      colorize_states: true,
    },
    graph_span: "7d",
    update_interval: "10min",
    show: { loading: false },
    series,
    apex_config: {
      chart: { height: 170, foreColor: "#94a3b8", toolbar: { show: false } },
      dataLabels: { enabled: false },
      fill: {
        type: "gradient",
        gradient: { shadeIntensity: 0.4, opacityFrom: 0.4, opacityTo: 0.05 },
      },
      xaxis: {
        labels: {
          datetimeFormatter: { day: "MM-dd", month: "MM-dd" },
          style: { fontSize: "10px" },
        },
        axisBorder: { show: false },
        axisTicks: { show: false },
      },
      yaxis: { min: 0, max: 100, labels: { style: { fontSize: "10px" } } },
      grid: {
        borderColor: "rgba(148,163,184,0.14)",
        yaxis: { lines: { show: true } },
      },
      tooltip: { theme: "dark" },
      noData: {
        text: "电量历史累计中 · 记录满后自动显示",
        align: "center",
        style: { color: "#94a3b8", fontSize: "13px" },
      },
    },
    card_mod: { style: `${PRO_CARD_CSS}\nha-card { padding: 8px 10px 4px; }` },
  };
}

function rideCard(hass, v) {
  if (!hasEntity(hass, eid(v, "last_ride"))) return null;
  return {
    type: "custom:mushroom-template-card",
    grid_columns: 2,
    icon: "mdi:bike-fast",
    icon_color: v.accent,
    primary: `最近一次 · ${v.name}`,
    multiline_secondary: true,
    secondary: [
      `{% set t = states('${eid(v, "last_ride")}') %}`,
      `{% if t in ('unknown','unavailable','None') %}暂无记录`,
      `{% else %}{{ as_timestamp(t) | timestamp_custom('%m-%d %H:%M', true) }} · `,
      `{{ states('${eid(v, "last_ride_distance")}') }} km · `,
      `{{ states('${eid(v, "last_ride_duration")}') }} 分 · 极速 `,
      `{{ states('${eid(v, "last_ride_max_speed")}') }} km/h{% endif %}`,
    ].join(""),
    tap_action: { action: "none" },
    card_mod: { style: CARD_CSS },
  };
}

function trackHero(v) {
  return mdCard(
    [
      `# {{ states('${eid(v, "today_mileage")}') }} km\n`,
      `今日 · 骑行 {{ states('${eid(v, "today_rides")}') }} 次 · `,
      `{{ states('${eid(v, "today_ride_time")}') }} 分钟\n`,
      `本周 {{ states('${eid(v, "this_week_mileage")}') }} km · `,
      `本月 {{ states('${eid(v, "mileage_this_month")}') }} km\n`,
      `累计 {{ states('${eid(v, "total_mileage")}') }} km · `,
      `减碳 {{ states('${eid(v, "total_co2_saved")}') }} kg`,
    ].join(""),
    `h1 { color: ${v.accent} !important; font-size: 40px !important; margin: 4px 0 8px !important; }`
  );
}

function dailyChart(hass, v) {
  const id = eid(v, "daily_mileage_7_day");
  if (!hasEntity(hass, id)) return null;
  return {
    type: "custom:apexcharts-card",
    header: { show: false },
    graph_span: "14d",
    span: { end: "day" },
    update_interval: "5min",
    show: { loading: false },
    series: [
      {
        entity: id,
        type: "column",
        name: `${v.name} 每日里程`,
        color: v.accent,
        data_generator: [
          "const rows = (entity && entity.attributes && entity.attributes.days) || [];",
          "return rows.map((r) => [new Date(r.date + 'T00:00:00+08:00').getTime(), Number(r.km) || 0]);",
        ].join("\n"),
      },
    ],
    apex_config: {
      chart: { height: 170, foreColor: "#94a3b8", toolbar: { show: false } },
      dataLabels: { enabled: false },
      xaxis: {
        labels: { format: "MM-dd", style: { fontSize: "10px" } },
        axisBorder: { show: false },
        axisTicks: { show: false },
      },
      yaxis: { labels: { style: { fontSize: "10px" } } },
      grid: {
        borderColor: "rgba(148,163,184,0.14)",
        yaxis: { lines: { show: true } },
      },
      plotOptions: { bar: { borderRadius: 4, columnWidth: "55%" } },
      tooltip: { theme: "dark" },
      noData: {
        text: "暂无骑行数据",
        align: "center",
        style: { color: "#94a3b8", fontSize: "13px" },
      },
    },
    card_mod: { style: CARD_CSS },
  };
}

function routeCard(hass, v) {
  const id = eid(v, "last_ride_route");
  if (!hasEntity(hass, id)) return null;
  return mdCard(
    [
      `**最近路线 · ${v.name}**\n`,
      `{% set r = state_attr('${id}', 'route_from') %}`,
      `{% set t = state_attr('${id}', 'route_to') %}`,
      `{% if r or t %}`,
      `🟢 {{ r or '未知' }}\n\n`,
      `🔴 {{ t or '未知' }}`,
      `{% else %}\n暂无路线数据\n{% endif %}`,
    ].join("")
  );
}

function segmentTable(hass, v) {
  if (!hasEntity(hass, eid(v, "today_mileage"))) return null;
  return mdCard(
    [
      `### 今日分段 · ${v.name}\n\n`,
      `{% set segs = state_attr('${eid(v, "today_mileage")}', 'segments') or [] %}`,
      `{% if segs | count == 0 %}\n今天还没有骑行记录。\n{% else %}\n`,
      "| 出发 | 结束 | 里程 | 时长 | 极速 |\n| --- | --- | --- | --- | --- |\n",
      "{% for s in segs %}",
      "| {{ s.start[11:16] }} | {{ s.end[11:16] }} | {{ s.km }} km | {{ s.minutes }} 分 | {{ s.max_speed }} km/h |\n",
      "{% endfor %}\n{% endif %}",
    ].join(""),
    `h3 { color: ${v.accent} !important; margin: 2px 0 8px !important; font-size: 14px !important; }`
  );
}

function energyGrid(hass, v) {
  const items = [
    [eid(v, "yesterday_charge"), "mdi:battery-charging", "昨日充电", "#34d399"],
    [eid(v, "yesterday_consumption"), "mdi:flash", "昨日耗电", "#fbbf24"],
    [eid(v, "7_day_charge"), "mdi:battery-charging-high", "7 天充电", "#34d399"],
    [eid(v, "7_day_consumption"), "mdi:lightning-bolt", "7 天耗电", "#fbbf24"],
  ]
    .filter(([id]) => hasEntity(hass, id))
    .map(([id, icon, label, color]) =>
      tplCard({
        icon,
        color,
        primary: `{{ states('${id}') }} kWh`,
        secondary: label,
      })
    );
  if (!items.length) return null;
  return { type: "grid", columns: 2, square: false, cards: items };
}

function profileTable(hass, v) {
  const rows = [
    ["型号", eid(v, "vehicle_info")],
    ["电量", eid(v, "battery")],
    ["电池组数", eid(v, "battery_count")],
    ["物联网卡剩余", eid(v, "iot_days_remaining")],
    ["物联网卡到期", eid(v, "iot_card_expires")],
  ].filter(([, id]) => hasEntity(hass, id));

  if (!rows.length) return null;
  const body = rows
    .map(([label, id]) => `| ${label} | {{ states('${id}') }} |\n`)
    .join("");
  return mdCard(`### ${v.name} 档案\n\n| 项目 | 数值 |\n| --- | --- |\n${body}`);
}

/* ------------------------------------------------ 旗舰版共享区块（总览页） */

/** 双车对比：两台车时生成（电量 / 本月里程 / 累计里程） */
function compareUnit(hass, a, b) {
  const mk = (icon, color, label, suffix, ea, eb) =>
    tplCard({
      icon,
      color,
      primary: `${valTpl(ea)}${suffix} · ${valTpl(eb)}${suffix}`,
      secondary: `${label} · ${a.name} / ${b.name}`,
      style: PRO_CARD_CSS,
    });
  const pair = (sfx) => hasEntity(hass, eid(a, sfx)) && hasEntity(hass, eid(b, sfx));
  const cards = [
    pair("battery")
      ? mk("mdi:battery-80", "#22c55e", "电量", "%", eid(a, "battery"), eid(b, "battery"))
      : null,
    pair("mileage_this_month")
      ? mk(
          "mdi:map-marker-distance",
          "#38bdf8",
          "本月里程",
          " km",
          eid(a, "mileage_this_month"),
          eid(b, "mileage_this_month")
        )
      : null,
    pair("total_mileage")
      ? mk("mdi:road-variant", "#60a5fa", "累计里程", " km", eid(a, "total_mileage"), eid(b, "total_mileage"))
      : null,
  ].filter(Boolean);
  if (!cards.length) return [];
  return [headingCard("双车对比", "mdi:compare-horizontal", "#60a5fa"), ...cards];
}

/** 车辆档案对照表：所有车辆的 vehicle_info 属性并排 */
function profileUnit(vehicles, hass) {
  const rows = vehicles.filter((v) => hasEntity(hass, eid(v, "vehicle_info")));
  if (!rows.length) return [];
  const attrs = [
    ["型号", "model_no"],
    ["颜色", "color"],
    ["电池数量", "battery_type"],
    ["蓝牙名", "bluetooth_name"],
    ["MAC", "mac_address"],
    ["ICCID", "iccid"],
    ["绑定日期", "bound_at"],
    ["物联卡到期", "iot_card_expire"],
  ];
  const head = `| 项目 | ${rows
    .map((v) => v.model || v.name)
    .join(" | ")} |\n| ${Array(1 + rows.length)
    .fill("---")
    .join(" | ")} |\n`;
  const body = attrs
    .map(
      ([label, attr]) =>
        `| ${label} | ${rows.map((v) => attrTpl(eid(v, "vehicle_info"), attr)).join(" | ")} |\n`
    )
    .join("");
  return [headingCard("车辆档案", "mdi:card-account-details", "#60a5fa"), mdCard(head + body, "", PRO_MD_CSS)];
}

/** 能耗 · 云端计费：每台车一张汇总卡 */
function energyUnit(vehicles, hass) {
  const cards = vehicles
    .filter((v) =>
      ["yesterday_charge", "yesterday_consumption", "7_day_charge", "7_day_consumption"].some((s) =>
        hasEntity(hass, eid(v, s))
      )
    )
    .map((v) =>
      tplCard({
        icon: "mdi:lightning-bolt-circle",
        color: "#f59e0b",
        primary: `${v.model || v.name} · 能耗`,
        multiline: true,
        secondary: [
          `昨充 ${valTpl(eid(v, "yesterday_charge"))} kWh · 昨用 ${valTpl(eid(v, "yesterday_consumption"))} kWh · `,
          `7天充 ${valTpl(eid(v, "7_day_charge"))} kWh · 7天用 ${valTpl(eid(v, "7_day_consumption"))} kWh`,
        ].join(""),
        style: PRO_CARD_CSS,
      })
    );
  if (!cards.length) return [];
  return [headingCard("能耗 · 云端计费", "mdi:flash", "#f59e0b"), ...cards];
}

/** 物联网卡：每台车剩余天数 */
function iotUnit(vehicles, hass) {
  const cards = vehicles
    .filter((v) => hasEntity(hass, eid(v, "iot_days_remaining")))
    .map((v) =>
      tplCard({
        icon: "mdi:sim-outline",
        color: "#22d3ee",
        primary: `${valTpl(eid(v, "iot_days_remaining"))} 天`,
        secondary: `${v.name} · 物联卡剩余`,
        style: PRO_CARD_CSS,
      })
    );
  if (!cards.length) return [];
  return [
    headingCard("物联卡", "mdi:sim", "#22d3ee"),
    { type: "grid", columns: 2, square: false, cards },
  ];
}

/** 数据说明 */
function noteUnit() {
  return [
    headingCard("数据说明", "mdi:information-outline", "#94a3b8"),
    mdCard(
      [
        "## 数据说明\n\n",
        "- 车辆状态为雅迪云端快照，默认 **60 秒** 轮询；轨迹与里程每 **5 分钟** 同步一次，仅读取不写入车辆。\n",
        "- 里程、骑行次数、时长、极速与累计里程均来自雅迪云端骑行记录（与 App「骑行统计 / 轨迹历史」同源）。\n",
        "- 轨迹/里程按账号归属：只有**车主账号**可见，家人共享账号查不到记录。\n",
        "- 云端偶有脏数据（如单段耗电为负、GPS 抖动切出 0.1 km 碎片段），展示时不做修正。\n",
      ].join(""),
      "",
      PRO_MD_CSS
    ),
  ];
}

/* ------------------------------------------------------------------ 视图 */

function overviewView(vehicles, hass, hasBar, trends) {
  // 每车一列：头图 → 电量条 → 电量趋势 → 统计四宫格 → 近 7 天柱状图
  const sections = vehicles.map((v) => ({
    type: "grid",
    cards: [
      heroCard(hass, v),
      batteryBar(hass, v, hasBar),
      batteryTrend(hass, v, trends && trends[v.prefix]),
      statGrid(hass, v),
      hasEntity(hass, eid(v, "this_week_mileage"))
        ? headingCard(`近 7 天骑行 · ${v.name}`, "mdi:chart-line", v.accent)
        : null,
      weeklyChart(hass, v),
    ].filter(Boolean),
  }));

  // 旗舰版共享区块（双车对比 / 车辆档案 / 能耗 / 物联卡 / 数据说明）
  const units = [
    ...(vehicles.length === 2 ? compareUnit(hass, vehicles[0], vehicles[1]) : []),
    ...profileUnit(vehicles, hass),
    ...energyUnit(vehicles, hass),
    ...iotUnit(vehicles, hass),
    ...noteUnit(),
  ];

  if (vehicles.length === 2) {
    // 与旗舰版一致：左列追加 对比+档案，右列追加 能耗+物联卡+数据说明
    const left =
      (units[0] && units[0].type === "heading" && units[0].heading === "双车对比"
        ? units.findIndex((c, i) => i > 0 && c.type === "heading")
        : 0) || 0;
    const profileIdx = units.findIndex((c) => c.type === "heading" && c.heading === "车辆档案");
    const leftCount = profileIdx >= 0 ? profileIdx + 2 : left; // 档案标题 + 对照表
    sections[0].cards.push(...units.slice(0, leftCount));
    sections[1].cards.push(...units.slice(leftCount));
  } else {
    // 单车全放一列；多车时轮转分配，保持两列高度均衡
    units.forEach((c, i) => sections[i % sections.length].cards.push(c));
  }

  return {
    title: "总览",
    path: "overview",
    icon: "mdi:motorbike",
    type: "sections",
    max_columns: 2,
    background: BG,
    sections,
  };
}

function trackView(vehicles, hass) {
  return {
    title: "骑行轨迹",
    path: "track",
    icon: "mdi:map-marker-path",
    type: "sections",
    max_columns: 2,
    background: BG,
    sections: vehicles.map((v) => ({
      type: "grid",
      cards: [
        rideCard(hass, v),
        headingCard(`今日骑行 · ${v.name}`, "mdi:map-marker-distance", v.accent),
        trackHero(v),
        headingCard(`近 14 天里程 · ${v.name}`, "mdi:chart-bar", v.accent),
        dailyChart(hass, v),
        routeCard(hass, v),
        // 分段表行数随当日骑行次数变化，放在最后以保持上方卡片对齐
        segmentTable(hass, v),
      ].filter(Boolean),
    })),
  };
}

function dataView(vehicles, hass) {
  return {
    title: "能耗档案",
    path: "data",
    icon: "mdi:chart-areaspline",
    type: "sections",
    max_columns: 2,
    background: BG,
    sections: vehicles.map((v) => ({
      type: "grid",
      cards: [
        headingCard(`能耗 · ${v.name}`, "mdi:flash", "#fbbf24"),
        energyGrid(hass, v),
        headingCard(`车辆档案 · ${v.name}`, "mdi:card-account-details", v.accent),
        profileTable(hass, v),
      ].filter(Boolean),
    })),
  };
}

/* ---------------------------------------------------------------- 策略本体 */

class YadeaDashboardStrategy extends HTMLElement {
  static registryDependencies = ["entities", "devices"];

  static getStubConfig() {
    return { type: "custom:yadea", title: "雅迪电动车" };
  }

  static async generate(config, hass) {
    const vehicles = discoverVehicles(hass, config);
    const title = config.title || "雅迪电动车";

    if (!vehicles.length) {
      return {
        title,
        views: [
          {
            title: "总览",
            path: "overview",
            cards: [
              {
                type: "markdown",
                content:
                  "### 没有发现雅迪车辆\n\n请先安装并配置 **雅迪智行（Yadea）** 集成，或在本仪表盘的策略配置里用 `vehicles` 显式指定实体前缀：\n\n```yaml\nstrategy:\n  type: custom:yadea\n  vehicles:\n    - prefix: sensor.my_bike\n      name: 我的电动车\n```",
              },
            ],
          },
        ],
      };
    }

    const hasBar = await detectBarCard();
    const trends = {};
    await Promise.all(
      vehicles.map(async (v) => {
        const id = eid(v, "battery");
        if (hasEntity(hass, id)) {
          trends[v.prefix] = await fetchBatteryTrendPoints(hass, id);
        }
      })
    );
    const views = [overviewView(vehicles, hass, hasBar, trends)];
    const hasTrack = vehicles.some((v) =>
      hasEntity(hass, eid(v, "today_mileage"))
    );
    if (hasTrack) views.push(trackView(vehicles, hass));
    if (config.show_data !== false) views.push(dataView(vehicles, hass));

    return { title, views };
  }
}

/* 注册必须同步完成：HA 用 customElements.whenDefined() 等待，
   任何 await / 动态 import 之前未完成注册都会触发 "Timeout waiting for
   strategy element ll-strategy-dashboard-yadea to be registered"。 */
try {
  if (!customElements.get("ll-strategy-dashboard-yadea")) {
    customElements.define("ll-strategy-dashboard-yadea", YadeaDashboardStrategy);
  }
} catch (err) {
  console.error("[YADEA-DASHBOARD] 策略元素注册失败", err);
}

try {
  window.customStrategies = window.customStrategies || [];
  if (!window.customStrategies.some((s) => s.type === "yadea")) {
    window.customStrategies.push({
      type: "yadea",
      strategyType: "dashboard",
      name: "雅迪电动车",
      description:
        "自动发现雅迪车辆，生成总览 / 骑行轨迹 / 能耗档案三套深色视图。依赖 card-mod、mushroom、apexcharts-card；可选 bar-card 提供电量长条图。",
      documentationURL: "https://github.com/flyqgs/yadea-dashboard",
    });
  }
} catch (err) {
  console.error("[YADEA-DASHBOARD] 策略条目注册失败", err);
}

console.info(
  `%c YADEA-DASHBOARD %c v${VERSION} `,
  "background:#0ea5e9;color:#fff;border-radius:4px 0 0 4px",
  "background:#0f172a;color:#7dd3fc;border-radius:0 4px 4px 0"
);
