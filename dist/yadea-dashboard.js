/**
 * 雅迪智行 · Home Assistant 仪表盘策略（Dashboard strategy）
 *
 * 安装后无需手写 YAML：在「添加仪表盘 → 社区仪表盘」里选择本策略，
 * 会自动发现家中所有雅迪车辆（雅迪集成 v2.0.0+）并生成三套视图：
 *   1. 总览     —— 电量、续航、今日/本周/本月/累计里程
 *   2. 骑行轨迹 —— 今日骑行大数字、近 14 天柱状图、最近路线、今日分段明细
 *   3. 能耗档案 —— 充电/耗电统计、车辆档案
 *
 * 依赖前端卡片：card-mod、mushroom、apexcharts-card
 * 生成后可在仪表盘右上角「接管控制」转为可手动编辑的普通仪表盘。
 */

const VERSION = "1.0.1";
const ACCENTS = ["#f97316", "#38bdf8", "#a78bfa", "#34d399", "#f472b6", "#facc15"];

const BG =
  "radial-gradient(1400px 800px at 12% -8%, #14243d 0%, #0b1220 58%, #070b14 100%)";

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

/* ---------------------------------------------------------------- 工具函数 */

const eid = (v, suffix) => `${v.prefix}_${suffix}`;
const hasEntity = (hass, id) => Boolean(hass.states[id]);
const num = (hass, id) => {
  const s = hass.states[id];
  if (!s) return null;
  const n = Number(s.state);
  return Number.isFinite(n) ? n : null;
};

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
        "  background: transparent !important;",
        "  border: none !important;",
        "  box-shadow: none !important;",
        "}",
        `ha-icon { color: ${accent} !important; }`,
      ].join("\n"),
    },
  };
}

function mdCard(content, extraCss = "") {
  return {
    type: "markdown",
    content,
    card_mod: { style: extraCss ? `${MD_CSS}\n${extraCss}` : MD_CSS },
  };
}

/** mushroom 模板卡（无 entity，点击不触发更多信息） */
function tplCard({ icon, color, primary, secondary, multiline = false }) {
  return {
    type: "custom:mushroom-template-card",
    icon,
    icon_color: color,
    primary,
    secondary,
    multiline_secondary: multiline,
    tap_action: { action: "none" },
    card_mod: { style: CARD_CSS },
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

function heroCard(v) {
  const battery = eid(v, "battery");
  const range = eid(v, "remaining_range");
  const report = eid(v, "last_report");
  const month = eid(v, "mileage_this_month");
  const model = v.model || "";

  const lines = [];
  lines.push(model ? `**${model}**\n` : "");
  lines.push(
    `# {{ states('${battery}') | int(0) }}%\n`,
    `续航 {{ states('${range}') }} km · 本月 {{ states('${month}') }} km\n`,
    `上报 {{ states('${report}') | as_timestamp | timestamp_custom('%m-%d %H:%M', true) }}`
  );

  return mdCard(
    lines.join(""),
    `h1 { color: ${v.accent} !important; font-size: 44px !important; margin: 4px 0 6px !important; }`
  );
}

function statGrid(hass, v) {
  const items = [
    tplIf(hass, [eid(v, "today_mileage")], () =>
      tplCard({
        icon: "mdi:map-marker-distance",
        color: v.accent,
        primary: `{{ states('${eid(v, "today_mileage")}') }} km`,
        secondary: "今日里程",
      })
    ),
    tplIf(hass, [eid(v, "this_week_mileage")], () =>
      tplCard({
        icon: "mdi:calendar-week",
        color: v.accent,
        primary: `{{ states('${eid(v, "this_week_mileage")}') }} km`,
        secondary: "本周里程",
      })
    ),
    tplIf(hass, [eid(v, "mileage_this_month")], () =>
      tplCard({
        icon: "mdi:calendar-month",
        color: v.accent,
        primary: `{{ states('${eid(v, "mileage_this_month")}') }} km`,
        secondary: "本月里程",
      })
    ),
    tplIf(hass, [eid(v, "total_mileage")], () =>
      tplCard({
        icon: "mdi:counter",
        color: v.accent,
        primary: `{{ states('${eid(v, "total_mileage")}') }} km`,
        secondary: "累计里程",
      })
    ),
    tplIf(hass, [eid(v, "total_co2_saved")], () =>
      tplCard({
        icon: "mdi:leaf",
        color: "#34d399",
        primary: `{{ states('${eid(v, "total_co2_saved")}') }} kg`,
        secondary: "累计减碳",
      })
    ),
    tplIf(hass, [eid(v, "today_rides"), eid(v, "today_ride_time")], () =>
      tplCard({
        icon: "mdi:bike-fast",
        color: v.accent,
        primary: `{{ states('${eid(v, "today_rides")}') }} 次`,
        secondary: `今日骑行 · {{ states('${eid(v, "today_ride_time")}') }} 分钟`,
      })
    ),
  ].filter(Boolean);

  if (!items.length) return null;
  return { type: "grid", columns: 2, square: false, cards: items };
}

function batteryBar(hass, v) {
  if (!hasEntity(hass, eid(v, "battery"))) return null;
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

/* ------------------------------------------------------------------ 视图 */

function overviewView(vehicles, hass) {
  return {
    title: "总览",
    path: "overview",
    icon: "mdi:motorbike",
    type: "sections",
    max_columns: 2,
    background: BG,
    sections: vehicles.map((v) => ({
      type: "grid",
      cards: [
        headingCard(v.name, "mdi:motorbike", v.accent),
        heroCard(v),
        batteryBar(hass, v),
        statGrid(hass, v),
        hasEntity(hass, eid(v, "last_ride"))
          ? rideCard(hass, v)
          : null,
      ].filter(Boolean),
    })),
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

    const views = [overviewView(vehicles, hass)];
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
        "自动发现雅迪车辆，生成总览 / 骑行轨迹 / 能耗档案三套深色视图。依赖 card-mod、mushroom、apexcharts-card。",
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
