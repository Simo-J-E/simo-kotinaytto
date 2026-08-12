(function () {
  "use strict";

  var VERSION = "V6 CANVAS";
  var DATA_URL = "data/latest.json";
  var DATA_CACHE_KEY = "simo-kotinaytto-canvas-data-v6";
  var SETTINGS_KEY = "simo-kotinaytto-settings-v5";
  var canvas = document.getElementById("screen");
  var fallback = document.getElementById("fallback");
  var context = canvas && canvas.getContext ? canvas.getContext("2d") : null;
  var state = {
    width: 1024,
    height: 672,
    ratio: 1,
    mode: "main",
    offset: 0,
    detailCellWidth: 72,
    prices: [],
    weather: null,
    location: "Turku",
    updated: 0,
    loading: true,
    error: "",
    hits: [],
    lastTouch: 0,
    touchX: 0,
    touchY: 0,
    touchOffset: 0,
    touchMoved: false,
    settings: loadSettings()
  };
  var weekdays = ["Sunnuntai", "Maanantai", "Tiistai", "Keskiviikko", "Torstai", "Perjantai", "Lauantai"];
  var months = ["tammikuuta", "helmikuuta", "maaliskuuta", "huhtikuuta", "toukokuuta", "kesäkuuta", "heinäkuuta", "elokuuta", "syyskuuta", "lokakuuta", "marraskuuta", "joulukuuta"];

  if (!context) {
    if (fallback) { fallback.style.display = "block"; fallback.innerHTML = "Tämä iPad ei tue Canvas-näyttöä."; }
    return;
  }

  function number(value, fallbackValue) {
    var parsed = parseFloat(value);
    return isFinite(parsed) ? parsed : fallbackValue;
  }
  function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }
  function pad(value) { return value < 10 ? "0" + value : String(value); }
  function formatTime(date) { return pad(date.getHours()) + ":" + pad(date.getMinutes()); }
  function formatDay(date) { return pad(date.getDate()) + "." + pad(date.getMonth() + 1) + "."; }
  function dayKey(date) { return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()); }
  function formatPrice(value, decimals) {
    if (!isFinite(value)) { return "--"; }
    return value.toFixed(typeof decimals === "number" ? decimals : 2).replace(".", ",");
  }
  function formatTemperature(value) { return isFinite(value) ? Math.round(value) + "°" : "--°"; }
  function parseDate(value) {
    var parts;
    if (value instanceof Date) { return value; }
    if (/Z$|[+-]\d\d:\d\d$/.test(String(value))) { return new Date(value); }
    parts = String(value).split(/[-T:]/);
    return new Date(number(parts[0], 1970), number(parts[1], 1) - 1, number(parts[2], 1), number(parts[3], 0), number(parts[4], 0), number(parts[5], 0));
  }
  function loadSettings() {
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); } catch (error) { saved = {}; }
    return {
      margin: number(saved.margin, 0),
      addition: number(saved.addition, 0),
      vat: number(saved.vat, 25.5),
      cheap: number(saved.cheap, 5),
      expensive: number(saved.expensive, 15),
      theme: saved.theme === "light" || saved.theme === "dark" ? saved.theme : "auto"
    };
  }
  function saveSettings() {
    var old = {};
    try { old = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); } catch (error) { old = {}; }
    old.margin = state.settings.margin;
    old.addition = state.settings.addition;
    old.vat = state.settings.vat;
    old.cheap = state.settings.cheap;
    old.expensive = state.settings.expensive;
    old.theme = state.settings.theme;
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(old)); } catch (error2) { void error2; }
  }
  function isDark() {
    var hour = new Date().getHours();
    return state.settings.theme === "dark" || (state.settings.theme === "auto" && (hour >= 21 || hour < 7));
  }
  function palette() {
    if (isDark()) {
      return {
        paper: "#111b24", surface: "#1c2b36", ink: "#edf3f6", muted: "#a8b8c3", line: "#3b4c58",
        accent: "#78acd0", accentDark: "#9bc8e4", weather: "#243d49", weatherLine: "#46616e",
        clock: "#0b141c", footer: "#0b141c", bar: "#cfdae0", safe: "#87ad94", danger: "#d27b82"
      };
    }
    return {
      paper: "#e9eef2", surface: "#ffffff", ink: "#17212b", muted: "#65727e", line: "#c7d0d8",
      accent: "#2f6387", accentDark: "#204963", weather: "#dceaf0", weatherLine: "#a9c2ce",
      clock: "#172737", footer: "#17212b", bar: "#354d5e", safe: "#4e765d", danger: "#a75860"
    };
  }

  function setFont(size, weight, mono) {
    context.font = String(weight || 700) + " " + Math.max(6, Math.round(size)) + "px " + (mono ? "Menlo, Monaco, Consolas, monospace" : "-apple-system, Helvetica Neue, Arial, sans-serif");
  }
  function text(value, x, y, size, color, weight, align, maxWidth, mono) {
    var actualSize = size;
    var content = String(value);
    context.textAlign = align || "left";
    context.textBaseline = "alphabetic";
    context.fillStyle = color;
    setFont(actualSize, weight, mono);
    if (maxWidth) {
      while (actualSize > 7 && context.measureText(content).width > maxWidth) {
        actualSize -= 1;
        setFont(actualSize, weight, mono);
      }
    }
    context.fillText(content, Math.round(x), Math.round(y));
  }
  function box(x, y, width, height, fill, stroke, lineWidth) {
    if (fill) { context.fillStyle = fill; context.fillRect(Math.round(x), Math.round(y), Math.round(width), Math.round(height)); }
    if (stroke) {
      context.strokeStyle = stroke;
      context.lineWidth = lineWidth || 1;
      context.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(width) - 1, Math.round(height) - 1);
    }
  }
  function line(x1, y1, x2, y2, color, width) {
    context.beginPath();
    context.moveTo(Math.round(x1) + 0.5, Math.round(y1) + 0.5);
    context.lineTo(Math.round(x2) + 0.5, Math.round(y2) + 0.5);
    context.strokeStyle = color;
    context.lineWidth = width || 1;
    context.stroke();
  }
  function addHit(name, x, y, width, height) { state.hits.push({ name: name, x: x, y: y, width: width, height: height }); }
  function sectionLabel(value, x, y, colors) { text(value, x, y, 10, colors.ink, 800, "left", null, true); }

  function finalPrice(rawPrice) {
    return number(rawPrice, 0) + (state.settings.margin + state.settings.addition) * (1 + state.settings.vat / 100);
  }
  function normalizePrices(rows) {
    var output = [];
    var i;
    for (i = 0; rows && i < rows.length; i += 1) {
      if (!rows[i].startDate || !rows[i].endDate || typeof rows[i].price === "undefined") { continue; }
      output.push({
        start: parseDate(rows[i].startDate),
        end: parseDate(rows[i].endDate),
        raw: number(rows[i].price, 0),
        price: finalPrice(rows[i].price)
      });
    }
    output.sort(function (a, b) { return a.start.getTime() - b.start.getTime(); });
    return output;
  }
  function currentPeriod(now) {
    var i;
    for (i = 0; i < state.prices.length; i += 1) {
      if (state.prices[i].start <= now && state.prices[i].end > now) { return state.prices[i]; }
    }
    return null;
  }
  function nextPeriod(current, now) {
    var i;
    for (i = 0; i < state.prices.length; i += 1) {
      if (current && state.prices[i].start >= current.end) { return state.prices[i]; }
      if (!current && state.prices[i].start > now) { return state.prices[i]; }
    }
    return null;
  }
  function todayPrices(now) {
    var rows = [];
    var i;
    for (i = 0; i < state.prices.length; i += 1) {
      if (state.prices[i].start.getFullYear() === now.getFullYear() && state.prices[i].start.getMonth() === now.getMonth() && state.prices[i].start.getDate() === now.getDate()) { rows.push(state.prices[i]); }
    }
    return rows;
  }
  function average(items) {
    var total = 0;
    var duration = 0;
    var i;
    var part;
    for (i = 0; i < items.length; i += 1) {
      part = Math.max(1, items[i].end.getTime() - items[i].start.getTime());
      total += items[i].price * part;
      duration += part;
    }
    return duration ? total / duration : NaN;
  }
  function bestWindow(items, minutes) {
    var target = minutes * 60000;
    var best = null;
    var i;
    var j;
    var duration;
    var weighted;
    var part;
    for (i = 0; i < items.length; i += 1) {
      duration = 0;
      weighted = 0;
      for (j = i; j < items.length && duration < target; j += 1) {
        part = Math.min(items[j].end.getTime() - items[j].start.getTime(), target - duration);
        weighted += items[j].price * part;
        duration += part;
      }
      if (duration >= target && (!best || weighted / duration < best.average)) {
        best = { start: items[i].start, end: new Date(items[i].start.getTime() + target), average: weighted / duration };
      }
    }
    return best;
  }
  function hourlyGroups(now) {
    var groups = [];
    var start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0, 0, 0);
    var hour;
    var groupStart;
    var groupEnd;
    var rows;
    var i;
    for (hour = 0; hour < 10; hour += 1) {
      groupStart = new Date(start.getTime() + hour * 3600000);
      groupEnd = new Date(groupStart.getTime() + 3600000);
      rows = [];
      for (i = 0; i < state.prices.length; i += 1) {
        if (state.prices[i].end > groupStart && state.prices[i].start < groupEnd) { rows.push(state.prices[i]); }
      }
      if (rows.length) { groups.push({ start: groupStart, price: average(rows), current: hour === 0 }); }
    }
    return groups;
  }
  function futurePrices(now) {
    var rows = [];
    var i;
    for (i = 0; i < state.prices.length; i += 1) { if (state.prices[i].end > now) { rows.push(state.prices[i]); } }
    return rows;
  }
  function dailyExtremes() {
    var output = {};
    var key;
    var item;
    var i;
    for (i = 0; i < state.prices.length; i += 1) {
      item = state.prices[i];
      key = dayKey(item.start);
      if (!output[key]) { output[key] = { minimum: item, maximum: item }; }
      if (item.price < output[key].minimum.price) { output[key].minimum = item; }
      if (item.price > output[key].maximum.price) { output[key].maximum = item; }
    }
    return output;
  }
  function priceClass(price) {
    if (price <= state.settings.cheap) { return "cheap"; }
    if (price >= state.settings.expensive) { return "expensive"; }
    return "normal";
  }
  function levelForPrice(price) {
    if (price <= state.settings.cheap * 0.55) { return "ERITTÄIN HALPA"; }
    if (price <= state.settings.cheap) { return "HALPA"; }
    if (price >= state.settings.expensive * 1.5) { return "ERITTÄIN KALLIS"; }
    if (price >= state.settings.expensive) { return "KALLIS"; }
    return "NORMAALI";
  }
  function colorForPrice(price, colors) {
    var type = priceClass(price);
    return type === "cheap" ? colors.safe : (type === "expensive" ? colors.danger : colors.bar);
  }

  function weatherInfo(code, isDay) {
    code = number(code, 0);
    if (code === 0) { return { icon: isDay ? "☀" : "☾", label: "Selkeää" }; }
    if (code === 1) { return { icon: isDay ? "☀" : "☾", label: "Melko selkeää" }; }
    if (code === 2) { return { icon: "☁", label: "Puolipilvistä" }; }
    if (code === 3) { return { icon: "☁", label: "Pilvistä" }; }
    if (code === 45 || code === 48) { return { icon: "≋", label: "Sumua" }; }
    if (code >= 51 && code <= 57) { return { icon: "☂", label: "Tihkusadetta" }; }
    if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) { return { icon: "☂", label: code >= 65 || code === 82 ? "Voimakasta sadetta" : "Sadetta" }; }
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) { return { icon: "❄", label: "Lumisadetta" }; }
    if (code >= 95) { return { icon: "⚡", label: "Ukkosta" }; }
    return { icon: "☁", label: "Vaihtelevaa" };
  }
  function windDirection(degrees) {
    var names = ["P", "KO", "I", "KA", "E", "LO", "L", "LU"];
    return names[Math.round(number(degrees, 0) / 45) % 8];
  }
  function weatherRows(now, maximum) {
    var hourly = state.weather && state.weather.hourly ? state.weather.hourly : {};
    var rows = [];
    var i;
    var time;
    for (i = 0; hourly.time && i < hourly.time.length; i += 1) {
      time = parseDate(hourly.time[i]);
      if (time.getTime() >= now.getTime() - 1800000) {
        rows.push({
          time: time,
          temperature: number(hourly.temperature_2m && hourly.temperature_2m[i], NaN),
          precipitation: number(hourly.precipitation && hourly.precipitation[i], 0),
          probability: number(hourly.precipitation_probability && hourly.precipitation_probability[i], 0),
          code: number(hourly.weather_code && hourly.weather_code[i], 0),
          isDay: number(hourly.is_day && hourly.is_day[i], 1)
        });
        if (rows.length >= maximum) { break; }
      }
    }
    return rows;
  }

  function drawHeader(colors, headerHeight, now) {
    var width = state.width;
    var clockWidth = width * (state.height > state.width ? 0.34 : 0.29);
    var systemWidth = Math.max(205, width * 0.235);
    var dateWidth = width - clockWidth - systemWidth;
    var buttonY = 8;
    var refreshWidth = 34;
    var themeWidth = 70;
    var buttonHeight = Math.max(28, headerHeight * 0.39);
    var updatedLabel;
    var clockSize = headerHeight * 0.67;
    var clockValue = formatTime(now);
    var clockEnd;
    box(0, 0, width, headerHeight, colors.paper, colors.ink);
    box(0, 0, clockWidth, headerHeight, colors.clock, null);
    text(clockValue, 17, headerHeight * 0.72, clockSize, "#f7fafb", 800, "left", clockWidth - 58, false);
    setFont(clockSize, 800, false);
    clockEnd = 17 + context.measureText(clockValue).width;
    text(pad(now.getSeconds()), Math.min(clockWidth - 18, clockEnd + 14), headerHeight * 0.71, 15, colors.accent, 800, "center", null, true);
    line(clockWidth, 0, clockWidth, headerHeight, colors.ink);
    text(weekdays[now.getDay()].toUpperCase(), clockWidth + 18, headerHeight * 0.34, Math.max(18, headerHeight * 0.23), colors.ink, 800, "left", dateWidth - 32, false);
    text(now.getDate() + ". " + months[now.getMonth()] + " " + now.getFullYear(), clockWidth + 18, headerHeight * 0.59, Math.max(14, headerHeight * 0.18), colors.ink, 500, "left", dateWidth - 32, false);
    text(state.location.toUpperCase() + " · KOTINÄYTTÖ", clockWidth + 18, headerHeight * 0.82, 8, colors.muted, 800, "left", dateWidth - 30, true);
    line(clockWidth + dateWidth, 0, clockWidth + dateWidth, headerHeight, colors.ink);
    box(width - themeWidth - refreshWidth - 18, buttonY, themeWidth, buttonHeight, null, colors.ink);
    box(width - refreshWidth - 12, buttonY, refreshWidth, buttonHeight, null, colors.ink);
    text("TEEMA", width - refreshWidth - 18 - themeWidth / 2, buttonY + buttonHeight * 0.64, 8, colors.ink, 800, "center", themeWidth - 8, true);
    text("↻", width - refreshWidth / 2 - 12, buttonY + buttonHeight * 0.7, 16, colors.ink, 800, "center", null, false);
    addHit("theme", width - themeWidth - refreshWidth - 18, buttonY, themeWidth, buttonHeight);
    addHit("refresh", width - refreshWidth - 12, buttonY, refreshWidth, buttonHeight);
    context.fillStyle = state.error ? colors.danger : colors.safe;
    context.beginPath();
    context.arc(width - systemWidth + 13, headerHeight - 24, 4, 0, Math.PI * 2, false);
    context.fill();
    text(state.error ? "PÄIVITYSVIRHE" : (navigator.onLine === false ? "YHTEYS KATKENNUT" : "YHDISTETTY"), width - systemWidth + 23, headerHeight - 20, 8, colors.ink, 800, "left", systemWidth - 34, true);
    updatedLabel = state.updated ? "PÄIVITETTY " + formatTime(new Date(state.updated)) : (state.loading ? "HAETAAN TIETOJA" : "EI TIETOJA");
    text(updatedLabel + " · " + VERSION, width - systemWidth + 13, headerHeight - 8, 8, colors.muted, 800, "left", systemWidth - 24, true);
  }

  function drawPricePanel(rectangle, colors, now) {
    var current = currentPeriod(now);
    var next = nextPeriod(current, now);
    var value = current ? current.price : NaN;
    var change = current && next ? next.price - current.price : NaN;
    var compact = rectangle.height < 520;
    box(rectangle.x, rectangle.y, rectangle.width, rectangle.height, colors.surface, colors.ink);
    box(rectangle.x, rectangle.y, 8, rectangle.height, colors.accent, null);
    sectionLabel("01 / SÄHKÖ NYT", rectangle.x + 25, rectangle.y + 28, colors);
    text(current ? formatTime(current.start) + "–" + formatTime(current.end) : "EI NYKYISTÄ HINTAA", rectangle.x + 25, rectangle.y + (compact ? 75 : 108), 12, colors.muted, 800, "left", rectangle.width - 44, true);
    text(formatPrice(value, 2), rectangle.x + 25, rectangle.y + (compact ? 130 : 184), compact ? 58 : 72, colors.accentDark, 800, "left", rectangle.width - 42, false);
    text("snt/kWh", rectangle.x + 25, rectangle.y + (compact ? 158 : 214), 11, colors.ink, 800, "left", null, true);
    box(rectangle.x + 25, rectangle.y + (compact ? 190 : 264), 31, 4, colors.ink, null);
    text(current ? levelForPrice(current.price) : "ODOTTAA HINTOJA", rectangle.x + 64, rectangle.y + (compact ? 195 : 270), 11, colors.ink, 800, "left", rectangle.width - 82, true);
    line(rectangle.x + 25, rectangle.y + rectangle.height - 109, rectangle.x + rectangle.width - 17, rectangle.y + rectangle.height - 109, colors.line);
    text("SEURAAVA HINTA", rectangle.x + 25, rectangle.y + rectangle.height - 92, 8, colors.muted, 800, "left", null, true);
    text(next ? formatPrice(next.price, 2) : "--", rectangle.x + 25, rectangle.y + rectangle.height - 59, 28, colors.accentDark, 800, "left", rectangle.width - 100, false);
    text("snt/kWh", rectangle.x + Math.min(rectangle.width - 55, 112), rectangle.y + rectangle.height - 60, 7, colors.muted, 800, "left", 50, true);
    text(next ? formatTime(next.start) + "–" + formatTime(next.end) : "EI TIEDOSSA", rectangle.x + 25, rectangle.y + rectangle.height - 39, 9, colors.ink, 800, "left", rectangle.width - 44, true);
    text(isFinite(change) ? (Math.abs(change) < 0.005 ? "HINTA PYSYY SAMANA" : (change > 0 ? "NOUSEE " : "LASKEE ") + formatPrice(Math.abs(change), 2) + " snt/kWh") : "ODOTTAA TIETOJA", rectangle.x + 25, rectangle.y + rectangle.height - 23, 7, colors.muted, 800, "left", rectangle.width - 44, true);
    text("Näytä kaikki tulevat hinnat", rectangle.x + 25, rectangle.y + rectangle.height - 7, 10, colors.accentDark, 800, "left", rectangle.width - 42, false);
    addHit("detail", rectangle.x, rectangle.y, rectangle.width, rectangle.height);
  }

  function drawMainChart(rectangle, colors, now) {
    var groups = hourlyGroups(now);
    var top = rectangle.y + 55;
    var bottom = rectangle.y + rectangle.height - 46;
    var chartBottom = bottom - 27;
    var chartHeight = Math.max(80, chartBottom - top);
    var cellWidth = (rectangle.width - 26) / Math.max(1, groups.length || 10);
    var min = Infinity;
    var max = -Infinity;
    var range;
    var height;
    var i;
    var x;
    box(rectangle.x, rectangle.y, rectangle.width, rectangle.height, colors.surface, colors.ink);
    sectionLabel("02 / SEURAAVAT 10 TUNTIA", rectangle.x + 14, rectangle.y + 28, colors);
    text("TUNTIKESKIARVO · snt/kWh", rectangle.x + rectangle.width - 13, rectangle.y + 28, 7, colors.muted, 800, "right", rectangle.width * 0.46, true);
    if (!groups.length) {
      text(state.loading ? "Haetaan hintatietoja…" : "Hintatietoja ei saatavilla", rectangle.x + rectangle.width / 2, rectangle.y + rectangle.height / 2, 12, colors.muted, 700, "center", rectangle.width - 40, false);
    } else {
      for (i = 0; i < groups.length; i += 1) { min = Math.min(min, groups[i].price); max = Math.max(max, groups[i].price); }
      range = Math.max(1, max - min);
      for (i = 0; i < groups.length; i += 1) {
        x = rectangle.x + 13 + i * cellWidth;
        if (groups[i].current) { box(x, top, cellWidth, bottom - top, colors.weather, null); }
        line(x, top, x, bottom, colors.line);
        text(formatPrice(groups[i].price, 1), x + cellWidth / 2, top + 14, 9, colors.ink, 800, "center", cellWidth - 4, true);
        height = chartHeight * (0.18 + ((groups[i].price - min) / range) * 0.54);
        box(x + cellWidth * 0.22, chartBottom - height, cellWidth * 0.56, height, colorForPrice(groups[i].price, colors), null);
        line(x, chartBottom, x + cellWidth, chartBottom, colors.ink);
        text(formatTime(groups[i].start), x + cellWidth / 2, bottom - 8, 8, colors.ink, 800, "center", cellWidth - 3, true);
        if (groups[i].current) { text("NYT", x + 3, top - 7, 7, colors.ink, 800, "left", null, true); }
      }
      line(rectangle.x + 13 + groups.length * cellWidth, top, rectangle.x + 13 + groups.length * cellWidth, bottom, colors.line);
    }
    text("Avaa tarkat hinnat koko näytölle →", rectangle.x + rectangle.width - 14, rectangle.y + rectangle.height - 8, 10, colors.accentDark, 800, "right", rectangle.width - 30, false);
    addHit("detail", rectangle.x, rectangle.y, rectangle.width, rectangle.height);
  }

  function drawWeather(rectangle, colors, now) {
    var headingHeight = rectangle.height < 520 ? 38 : 44;
    var nowHeight = rectangle.height < 520 ? 101 : 119;
    var labelsHeight = 25;
    var creditHeight = 16;
    var rowCount = 8;
    var rowsArea = rectangle.height - headingHeight - nowHeight - labelsHeight - creditHeight;
    var rowHeight = rowsArea / rowCount;
    var current = state.weather && state.weather.current ? state.weather.current : null;
    var daily = state.weather && state.weather.daily ? state.weather.daily : {};
    var info = current ? weatherInfo(current.weather_code, number(current.is_day, 1)) : { icon: "○", label: "Haetaan säätä…" };
    var probability = current ? number(current.precipitation_probability, 0) : NaN;
    var wide = rectangle.width >= 480;
    var factsX = wide ? rectangle.x + rectangle.width * 0.50 : rectangle.x + rectangle.width - 140;
    var mainX = rectangle.x + (wide ? 72 : 50);
    var iconX = rectangle.x + (wide ? 34 : 22);
    var rows = weatherRows(now, rowCount);
    var i;
    var rowY;
    var rowInfo;
    var firstColumn;
    box(rectangle.x, rectangle.y, rectangle.width, rectangle.height, colors.surface, colors.ink);
    sectionLabel("03 / ULKOILMA", rectangle.x + 13, rectangle.y + 27, colors);
    text(state.location.toUpperCase(), rectangle.x + rectangle.width - 12, rectangle.y + 18, 8, colors.muted, 800, "right", rectangle.width * 0.35, true);
    text("TÄNÄÄN " + formatTemperature(number(daily.temperature_2m_max && daily.temperature_2m_max[0], NaN)) + " / " + formatTemperature(number(daily.temperature_2m_min && daily.temperature_2m_min[0], NaN)), rectangle.x + rectangle.width - 12, rectangle.y + 32, 7, colors.muted, 800, "right", rectangle.width * 0.45, true);
    rowY = rectangle.y + headingHeight;
    box(rectangle.x, rowY, rectangle.width, nowHeight, colors.weather, colors.ink);
    text(info.icon, iconX, rowY + nowHeight * 0.52, wide ? 36 : 31, colors.ink, 600, "center", null, false);
    text("NYT · " + formatTime(now), mainX, rowY + 21, 8, colors.ink, 800, "left", factsX - mainX - 8, true);
    text(current ? formatTemperature(number(current.temperature_2m, NaN)) : "--°", mainX, rowY + 68, wide ? 52 : 49, colors.ink, 800, "left", factsX - mainX - 8, false);
    text(info.label, mainX, rowY + nowHeight - 11, 13, colors.ink, 800, "left", factsX - mainX - 8, false);
    line(factsX, rowY + 10, factsX, rowY + nowHeight - 10, colors.weatherLine);
    firstColumn = (rectangle.x + rectangle.width - factsX) / 2;
    text("TUNTUU", factsX + 10, rowY + 21, 8, colors.muted, 800, "left", firstColumn - 16, true);
    text(current ? formatTemperature(number(current.apparent_temperature, NaN)) : "--°", factsX + 10, rowY + 41, 12, colors.ink, 800, "left", firstColumn - 16, true);
    text("TUULI", factsX + firstColumn, rowY + 21, 8, colors.muted, 800, "left", firstColumn - 8, true);
    text(current ? formatPrice(number(current.wind_speed_10m, 0) / 3.6, 1) + " m/s " + windDirection(current.wind_direction_10m) : "-- m/s", factsX + firstColumn, rowY + 41, 11, colors.ink, 800, "left", firstColumn - 8, true);
    text("SADE", factsX + 10, rowY + nowHeight - 36, 8, colors.muted, 800, "left", firstColumn - 16, true);
    text(current ? formatPrice(number(current.precipitation, 0), 1) + " mm" : "-- mm", factsX + 10, rowY + nowHeight - 16, 11, colors.ink, 800, "left", firstColumn - 16, true);
    text("SATEEN RISKI", factsX + firstColumn, rowY + nowHeight - 36, 8, colors.muted, 800, "left", firstColumn - 8, true);
    text(isFinite(probability) ? Math.round(probability) + " %" : "-- %", factsX + firstColumn, rowY + nowHeight - 16, 11, colors.ink, 800, "left", firstColumn - 8, true);
    rowY += nowHeight;
    box(rectangle.x, rowY, rectangle.width, labelsHeight, colors.surface, colors.line);
    text("KELLO JA SÄÄ", rectangle.x + 10, rowY + 17, 8, colors.muted, 800, "left", rectangle.width - 140, true);
    text("LÄMPÖ", rectangle.x + rectangle.width - 75, rowY + 17, 8, colors.muted, 800, "right", 45, true);
    text("SADE / %", rectangle.x + rectangle.width - 8, rowY + 17, 8, colors.muted, 800, "right", 64, true);
    rowY += labelsHeight;
    for (i = 0; i < rowCount; i += 1) {
      box(rectangle.x, rowY + i * rowHeight, rectangle.width, rowHeight, colors.surface, null);
      line(rectangle.x, rowY + (i + 1) * rowHeight, rectangle.x + rectangle.width, rowY + (i + 1) * rowHeight, colors.line);
      if (rows[i]) {
        rowInfo = weatherInfo(rows[i].code, rows[i].isDay);
        text(formatTime(rows[i].time), rectangle.x + 10, rowY + i * rowHeight + rowHeight * 0.62, 10, colors.ink, 800, "left", 42, true);
        text(rowInfo.icon, rectangle.x + 56, rowY + i * rowHeight + rowHeight * 0.67, 17, colors.ink, 600, "center", null, false);
        text(rowInfo.label, rectangle.x + 72, rowY + i * rowHeight + rowHeight * 0.62, 11, colors.ink, 800, "left", rectangle.width - 172, false);
        text(formatTemperature(rows[i].temperature), rectangle.x + rectangle.width - 76, rowY + i * rowHeight + rowHeight * 0.57, 12, colors.ink, 800, "right", 40, true);
        text(formatPrice(rows[i].precipitation, 1) + " mm", rectangle.x + rectangle.width - 8, rowY + i * rowHeight + rowHeight * 0.47, 10, colors.ink, 800, "right", 62, true);
        text(Math.round(rows[i].probability) + " %", rectangle.x + rectangle.width - 8, rowY + i * rowHeight + rowHeight * 0.77, 8, colors.muted, 800, "right", 62, true);
      }
    }
    text("SÄÄDATA · " + String(state.weather && state.weather.source || "ODOTTAA TIETOJA").toUpperCase(), rectangle.x + rectangle.width - 8, rectangle.y + rectangle.height - 4, 6, colors.muted, 800, "right", rectangle.width - 16, true);
  }

  function drawFooter(colors, y, height, now) {
    var widths = [0.217, 0.217, 0.217, 0.349];
    var labels = ["KESKIHINTA TÄNÄÄN", "HALVIN", "KALLEIN", "PARAS 90 MIN AIKA"];
    var today = todayPrices(now);
    var minimum = null;
    var maximum = null;
    var best;
    var values;
    var small;
    var i;
    var x = 0;
    if (today.length) {
      minimum = today[0];
      maximum = today[0];
      for (i = 1; i < today.length; i += 1) {
        if (today[i].price < minimum.price) { minimum = today[i]; }
        if (today[i].price > maximum.price) { maximum = today[i]; }
      }
    }
    best = bestWindow(todayPrices(now), 90);
    values = [formatPrice(average(today), 2), minimum ? formatPrice(minimum.price, 2) : "--", maximum ? formatPrice(maximum.price, 2) : "--", best ? formatTime(best.start) + "–" + formatTime(best.end) : "--:--–--:--"];
    small = ["snt/kWh", minimum ? formatTime(minimum.start) : "--:--", maximum ? formatTime(maximum.start) : "--:--", best ? formatPrice(best.average, 2) + " snt/kWh keskim." : "-- snt/kWh keskim."];
    box(0, y, state.width, height, colors.footer, null);
    for (i = 0; i < 4; i += 1) {
      if (i) { line(x, y, x, y + height, "#53606a"); }
      text(labels[i], x + 11, y + 17, 9, "#bcc7cd", 800, "left", state.width * widths[i] - 20, true);
      text(values[i], x + 11, y + 49, i === 3 ? 25 : 28, i === 3 ? "#9ccbe4" : "#edf3f6", 800, "left", state.width * widths[i] - 20, false);
      text(small[i], x + 11, y + height - 8, 10, i === 1 || i === 2 ? "#9ccbe4" : "#dbe5ea", 800, "left", state.width * widths[i] - 20, true);
      x += state.width * widths[i];
    }
  }

  function drawMain() {
    var colors = palette();
    var now = new Date();
    var headerHeight = clamp(state.height * 0.12, 68, 92);
    var footerHeight = clamp(state.height * 0.125, 82, 92);
    var contentY = headerHeight;
    var contentHeight = state.height - headerHeight - footerHeight;
    var leftWidth;
    var middleWidth;
    var topHeight;
    state.hits = [];
    box(0, 0, state.width, state.height, colors.paper, null);
    drawHeader(colors, headerHeight, now);
    if (state.width >= state.height) {
      leftWidth = state.width * 0.24;
      middleWidth = state.width * 0.46;
      drawPricePanel({ x: 0, y: contentY, width: leftWidth, height: contentHeight }, colors, now);
      drawMainChart({ x: leftWidth, y: contentY, width: middleWidth, height: contentHeight }, colors, now);
      drawWeather({ x: leftWidth + middleWidth, y: contentY, width: state.width - leftWidth - middleWidth, height: contentHeight }, colors, now);
    } else {
      topHeight = contentHeight * 0.44;
      leftWidth = state.width * 0.35;
      drawPricePanel({ x: 0, y: contentY, width: leftWidth, height: topHeight }, colors, now);
      drawMainChart({ x: leftWidth, y: contentY, width: state.width - leftWidth, height: topHeight }, colors, now);
      drawWeather({ x: 0, y: contentY + topHeight, width: state.width, height: contentHeight - topHeight }, colors, now);
    }
    drawFooter(colors, state.height - footerHeight, footerHeight, now);
  }

  function drawDetail() {
    var colors = palette();
    var now = new Date();
    var future = futurePrices(now);
    var headerHeight = clamp(state.height * 0.115, 72, 92);
    var keyHeight = 38;
    var dayBandHeight = 44;
    var footerHeight = 36;
    var side = 20;
    var availableWidth = state.width - side * 2;
    var visible = Math.max(7, Math.floor(availableWidth / 70));
    var cellWidth = availableWidth / visible;
    var maximumOffset = Math.max(0, future.length - visible);
    var start;
    var end;
    var minimum = Infinity;
    var maximum = -Infinity;
    var extremes = dailyExtremes();
    var range;
    var bandTop = headerHeight + keyHeight;
    var chartTop = bandTop + dayBandHeight + 10;
    var baseline = state.height - footerHeight - 65;
    var maximumBarHeight = Math.max(100, baseline - chartTop - 30);
    var minimumBarHeight = Math.min(54, maximumBarHeight * 0.35);
    var i;
    var groupEnd;
    var groupKey;
    var groupX;
    var groupWidth;
    var extreme;
    var dailyMinimum;
    var dailyMaximum;
    var tagLabel;
    var tagColor;
    var item;
    var x;
    var height;
    var current;
    state.hits = [];
    state.detailCellWidth = cellWidth;
    state.offset = clamp(state.offset, 0, maximumOffset);
    start = state.offset;
    end = Math.min(future.length, start + visible);
    for (i = 0; i < future.length; i += 1) {
      minimum = Math.min(minimum, future[i].price);
      maximum = Math.max(maximum, future[i].price);
    }
    range = Math.max(1, maximum - minimum);
    box(0, 0, state.width, state.height, colors.paper, null);
    sectionLabel("SÄHKÖN HINNAT · TARKKA AIKA", 18, 24, colors);
    text("Tulevat hinnat", 18, headerHeight - 20, clamp(headerHeight * 0.42, 29, 38), colors.ink, 800, "left", state.width - 155, false);
    box(state.width - 118, 14, 100, Math.max(44, headerHeight - 28), colors.footer, colors.accent, 3);
    text("SULJE ×", state.width - 68, headerHeight * 0.61, 10, "#edf3f6", 800, "center", 82, true);
    addHit("close", state.width - 128, 0, 128, headerHeight);
    line(0, headerHeight, state.width, headerHeight, colors.ink);
    box(0, headerHeight, state.width, keyHeight, colors.paper, null);
    box(18, headerHeight + 13, 12, 12, colors.accent, null);
    text("NYT", 36, headerHeight + 23, 8, colors.muted, 800, "left", null, true);
    box(77, headerHeight + 13, 12, 12, colors.safe, null);
    text("HALVIN", 95, headerHeight + 23, 8, colors.muted, 800, "left", null, true);
    box(158, headerHeight + 13, 12, 12, colors.danger, null);
    text("KALLEIN", 176, headerHeight + 23, 8, colors.muted, 800, "left", null, true);
    text("Pyyhkäise vasemmalle tai oikealle", state.width - 18, headerHeight + 23, 8, colors.muted, 800, "right", state.width * 0.48, true);
    line(0, headerHeight + keyHeight, state.width, headerHeight + keyHeight, colors.line);
    if (!future.length) {
      text("Tulevia hintatietoja ei ole saatavilla", state.width / 2, state.height / 2, 14, colors.muted, 700, "center", state.width - 40, false);
    } else {
      i = start;
      while (i < end) {
        groupKey = dayKey(future[i].start);
        groupEnd = i + 1;
        while (groupEnd < end && dayKey(future[groupEnd].start) === groupKey) { groupEnd += 1; }
        groupX = side + (i - start) * cellWidth;
        groupWidth = (groupEnd - i) * cellWidth;
        extreme = extremes[groupKey];
        box(groupX, bandTop, groupWidth, dayBandHeight, (future[i].start.getDate() % 2 ? colors.weather : colors.surface), colors.line);
        text((groupWidth >= 132 ? weekdays[future[i].start.getDay()].toUpperCase() + " " : "") + formatDay(future[i].start), groupX + 8, bandTop + 17, 10, colors.ink, 800, "left", groupWidth - 16, true);
        if (extreme && groupWidth >= 160) {
          text("HALVIN " + formatTime(extreme.minimum.start) + " " + formatPrice(extreme.minimum.price, 2) + "  ·  KALLEIN " + formatTime(extreme.maximum.start) + " " + formatPrice(extreme.maximum.price, 2), groupX + 8, bandTop + 35, 8, colors.muted, 800, "left", groupWidth - 16, true);
        }
        line(groupX, bandTop, groupX, state.height - footerHeight, colors.accent, 3);
        i = groupEnd;
      }
      for (i = start; i < end; i += 1) {
        item = future[i];
        x = side + (i - start) * cellWidth;
        current = item.start <= now && item.end > now;
        extreme = extremes[dayKey(item.start)];
        dailyMinimum = extreme && item === extreme.minimum;
        dailyMaximum = extreme && item === extreme.maximum;
        tagLabel = "";
        tagColor = null;
        if (current) {
          box(x, chartTop - 4, cellWidth, baseline - chartTop + 4, colors.weather, null);
          tagLabel = "NYT";
          tagColor = colors.accent;
        } else if (dailyMinimum) {
          box(x, chartTop - 4, cellWidth, baseline - chartTop + 4, isDark() ? "#243a32" : "#e1ebe4", null);
          tagLabel = "HALVIN";
          tagColor = colors.safe;
        } else if (dailyMaximum) {
          box(x, chartTop - 4, cellWidth, baseline - chartTop + 4, isDark() ? "#3a292d" : "#f2e1e3", null);
          tagLabel = "KALLEIN";
          tagColor = colors.danger;
        }
        line(x, chartTop - 4, x, state.height - footerHeight, colors.line);
        if (tagLabel) {
          box(x + 4, chartTop, cellWidth - 8, 18, tagColor, null);
          text(tagLabel, x + cellWidth / 2, chartTop + 13, 7, "#ffffff", 800, "center", cellWidth - 12, true);
        }
        height = minimumBarHeight + ((item.price - minimum) / range) * (maximumBarHeight - minimumBarHeight);
        box(x + cellWidth * 0.22, baseline - height, cellWidth * 0.56, height, colorForPrice(item.price, colors), null);
        text(formatPrice(item.price, 2), x + cellWidth / 2, baseline + 22, 11, colors.ink, 800, "center", cellWidth - 5, true);
        text(formatTime(item.start), x + cellWidth / 2, baseline + 41, 9, colors.ink, 800, "center", cellWidth - 5, true);
        text(formatDay(item.start), x + cellWidth / 2, baseline + 56, 7, colors.muted, 800, "center", cellWidth - 5, true);
      }
      line(side + (end - start) * cellWidth, bandTop, side + (end - start) * cellWidth, state.height - footerHeight, colors.accent, 3);
    }
    box(0, state.height - footerHeight, state.width, footerHeight, colors.paper, null);
    line(0, state.height - footerHeight, state.width, state.height - footerHeight, colors.ink);
    text("Näytetään " + (future.length ? (start + 1) + "–" + end + " / " + future.length : "0") + " hintajaksoa", 18, state.height - 13, 8, colors.muted, 800, "left", state.width * 0.42, true);
    text("Jokaisessa pylväässä näkyvät hinta ja alkamisaika", state.width - 18, state.height - 13, 8, colors.muted, 800, "right", state.width * 0.52, true);
  }

  function render() {
    context.setTransform(state.ratio, 0, 0, state.ratio, 0, 0);
    context.clearRect(0, 0, state.width, state.height);
    if (state.mode === "detail") { drawDetail(); } else { drawMain(); }
  }

  function viewportSize() {
    var width = number(window.innerWidth, document.documentElement.clientWidth || 1024);
    var height = number(window.innerHeight, document.documentElement.clientHeight || 672);
    if (window.visualViewport) {
      width = Math.min(width, number(window.visualViewport.width, width));
      height = Math.min(height, number(window.visualViewport.height, height));
    }
    return { width: Math.max(480, Math.round(width)), height: Math.max(400, Math.round(height)) };
  }
  function resize() {
    var viewport = viewportSize();
    var ratio = Math.min(number(window.devicePixelRatio, 1), 1.5);
    state.width = viewport.width;
    state.height = viewport.height;
    state.ratio = ratio;
    canvas.style.width = viewport.width + "px";
    canvas.style.height = viewport.height + "px";
    canvas.width = Math.round(viewport.width * ratio);
    canvas.height = Math.round(viewport.height * ratio);
    render();
  }

  function applyBundle(bundle) {
    var parsed;
    if (!bundle || !(bundle.prices instanceof Array) || !bundle.weather) { throw new Error("Tietotiedosto on puutteellinen"); }
    state.prices = normalizePrices(bundle.prices);
    state.weather = bundle.weather;
    state.location = bundle.location && bundle.location.name ? String(bundle.location.name) : "Turku";
    parsed = bundle.generatedAt ? parseDate(bundle.generatedAt).getTime() : Date.now();
    state.updated = isFinite(parsed) ? parsed : Date.now();
    state.loading = false;
    state.error = "";
    try { localStorage.setItem(DATA_CACHE_KEY, JSON.stringify(bundle)); } catch (error) { void error; }
    render();
  }
  function restoreCache() {
    try {
      var bundle = JSON.parse(localStorage.getItem(DATA_CACHE_KEY) || "null");
      if (bundle) { applyBundle(bundle); }
    } catch (error) { void error; }
  }
  function loadData() {
    var request = new XMLHttpRequest();
    var finished = false;
    var timer;
    state.loading = !state.prices.length;
    render();
    function finish(error, bundle) {
      if (finished) { return; }
      finished = true;
      clearTimeout(timer);
      if (error) {
        state.loading = false;
        state.error = error.message || "Päivitys epäonnistui";
        render();
        return;
      }
      try { applyBundle(bundle); }
      catch (applyError) { state.loading = false; state.error = applyError.message; render(); }
    }
    timer = setTimeout(function () { request.abort(); finish(new Error("Aikakatkaisu")); }, 12000);
    request.onreadystatechange = function () {
      var bundle;
      if (request.readyState !== 4) { return; }
      if (request.status < 200 || request.status >= 300) { finish(new Error("HTTP " + request.status)); return; }
      try { bundle = JSON.parse(request.responseText); }
      catch (error) { finish(new Error("Virheellinen tietotiedosto")); return; }
      finish(null, bundle);
    };
    request.onerror = function () { finish(new Error("Verkkovirhe")); };
    request.open("GET", DATA_URL + "?v=" + Date.now(), true);
    request.setRequestHeader("Cache-Control", "no-cache");
    request.send(null);
  }

  function removeOldPageCache() {
    function unregister(registration) { if (registration && registration.unregister) { registration.unregister(); } }
    if ("serviceWorker" in navigator && navigator.serviceWorker.getRegistration) {
      navigator.serviceWorker.getRegistration().then(unregister).catch(function () {});
    }
    if (window.caches && window.caches.keys) {
      window.caches.keys().then(function (keys) {
        var i;
        var tasks = [];
        for (i = 0; i < keys.length; i += 1) { if (keys[i].indexOf("simo-kotinaytto") === 0) { tasks.push(window.caches.delete(keys[i])); } }
        return Promise.all(tasks);
      }).catch(function () {});
    }
  }

  function hitAt(x, y) {
    var i;
    for (i = state.hits.length - 1; i >= 0; i -= 1) {
      if (x >= state.hits[i].x && x <= state.hits[i].x + state.hits[i].width && y >= state.hits[i].y && y <= state.hits[i].y + state.hits[i].height) { return state.hits[i].name; }
    }
    return "";
  }
  function cycleTheme() {
    if (state.settings.theme === "auto") { state.settings.theme = "light"; }
    else if (state.settings.theme === "light") { state.settings.theme = "dark"; }
    else { state.settings.theme = "auto"; }
    saveSettings();
    render();
  }
  function activate(x, y) {
    var action = hitAt(x, y);
    if (action === "detail") { state.mode = "detail"; state.offset = 0; render(); }
    else if (action === "close") { state.mode = "main"; render(); }
    else if (action === "refresh") { loadData(); }
    else if (action === "theme") { cycleTheme(); }
  }
  function pointFromMouse(event) {
    var rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  function pointFromTouch(touch) {
    var rect = canvas.getBoundingClientRect();
    return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
  }
  function onTouchStart(event) {
    var point;
    if (!event.touches || !event.touches.length) { return; }
    point = pointFromTouch(event.touches[0]);
    state.touchX = point.x;
    state.touchY = point.y;
    state.touchOffset = state.offset;
    state.touchMoved = false;
  }
  function onTouchMove(event) {
    var point;
    var difference;
    var future;
    var visible;
    var maximum;
    if (state.mode !== "detail" || !event.touches || !event.touches.length) { return; }
    event.preventDefault();
    point = pointFromTouch(event.touches[0]);
    difference = point.x - state.touchX;
    if (Math.abs(difference) > 8) { state.touchMoved = true; }
    future = futurePrices(new Date());
    visible = Math.max(7, Math.floor((state.width - 40) / 70));
    maximum = Math.max(0, future.length - visible);
    state.offset = clamp(state.touchOffset + Math.round(-difference / Math.max(42, state.detailCellWidth)), 0, maximum);
    render();
  }
  function onTouchEnd(event) {
    state.lastTouch = Date.now();
    if (!state.touchMoved) { activate(state.touchX, state.touchY); }
    if (event && event.preventDefault) { event.preventDefault(); }
  }

  canvas.addEventListener("click", function (event) {
    var point;
    if (Date.now() - state.lastTouch < 600) { return; }
    point = pointFromMouse(event);
    activate(point.x, point.y);
  }, false);
  canvas.addEventListener("touchstart", onTouchStart, false);
  canvas.addEventListener("touchmove", onTouchMove, false);
  canvas.addEventListener("touchend", onTouchEnd, false);
  window.addEventListener("resize", resize, false);
  window.addEventListener("orientationchange", function () {
    setTimeout(resize, 100);
    setTimeout(resize, 500);
    setTimeout(resize, 1000);
  }, false);
  window.addEventListener("online", loadData, false);
  window.addEventListener("pageshow", function () { resize(); loadData(); }, false);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) { resize(); loadData(); } }, false);

  restoreCache();
  removeOldPageCache();
  resize();
  loadData();
  setInterval(render, 1000);
  setInterval(loadData, 15 * 60000);
}());
