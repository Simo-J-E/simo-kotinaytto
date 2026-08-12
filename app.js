(function () {
  "use strict";

  var DEFAULTS = {
    location: "Turku",
    latitude: 60.4518,
    longitude: 22.2666,
    margin: 0,
    addition: 0,
    vat: 25.5,
    monthly: 0,
    cheap: 5,
    expensive: 15,
    theme: "auto",
    refresh: 15
  };
  var SETTINGS_KEY = "simo-kotinaytto-settings-v5";
  var PRICE_CACHE_KEY = "simo-kotinaytto-electricity-v5";
  var WEATHER_CACHE_KEY = "simo-kotinaytto-weather-v5";
  var state = {
    settings: loadSettings(),
    prices: [],
    weather: null,
    priceUpdated: 0,
    weatherUpdated: 0,
    requestRunning: false,
    lastError: "",
    refreshTimer: null,
    retryTimer: null,
    retryCount: 0,
    bundlePromise: null,
    dataLocation: ""
  };
  var weekdays = ["Sunnuntai", "Maanantai", "Tiistai", "Keskiviikko", "Torstai", "Perjantai", "Lauantai"];
  var months = ["tammikuuta", "helmikuuta", "maaliskuuta", "huhtikuuta", "toukokuuta", "kesäkuuta", "heinäkuuta", "elokuuta", "syyskuuta", "lokakuuta", "marraskuuta", "joulukuuta"];

  function byId(id) { return document.getElementById(id); }
  function pad(value) { return value < 10 ? "0" + value : String(value); }
  function number(value, fallback) {
    var parsed = parseFloat(value);
    return isFinite(parsed) ? parsed : fallback;
  }
  function formatPrice(value, decimals) {
    if (!isFinite(value)) { return "--"; }
    return value.toFixed(typeof decimals === "number" ? decimals : 2).replace(".", ",");
  }
  function formatTemperature(value) { return isFinite(value) ? Math.round(value) + "°" : "--°"; }
  function formatTime(date) { return pad(date.getHours()) + ":" + pad(date.getMinutes()); }
  function formatDay(date) { return pad(date.getDate()) + "." + pad(date.getMonth() + 1) + "."; }
  function parseDate(value) {
    var parts;
    if (value instanceof Date) { return value; }
    if (/Z$|[+-]\d\d:\d\d$/.test(value)) { return new Date(value); }
    parts = String(value).split(/[-T:]/);
    return new Date(number(parts[0], 1970), number(parts[1], 1) - 1, number(parts[2], 1), number(parts[3], 0), number(parts[4], 0), number(parts[5], 0));
  }
  function escapeHtml(value) {
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
  }
  function hasClass(element, name) { return (" " + element.className + " ").indexOf(" " + name + " ") !== -1; }
  function addClass(element, name) { if (!hasClass(element, name)) { element.className += (element.className ? " " : "") + name; } }
  function removeClass(element, name) { element.className = (" " + element.className + " ").replace(" " + name + " ", " ").replace(/^\s+|\s+$/g, ""); }

  function copySettings(source) {
    var result = {};
    var key;
    for (key in DEFAULTS) {
      if (Object.prototype.hasOwnProperty.call(DEFAULTS, key)) {
        result[key] = source && typeof source[key] !== "undefined" ? source[key] : DEFAULTS[key];
      }
    }
    result.location = String(result.location || DEFAULTS.location).slice(0, 30);
    result.latitude = number(result.latitude, DEFAULTS.latitude);
    result.longitude = number(result.longitude, DEFAULTS.longitude);
    result.margin = number(result.margin, 0);
    result.addition = number(result.addition, 0);
    result.vat = number(result.vat, DEFAULTS.vat);
    result.monthly = number(result.monthly, 0);
    result.cheap = number(result.cheap, DEFAULTS.cheap);
    result.expensive = number(result.expensive, DEFAULTS.expensive);
    result.refresh = Math.max(5, Math.min(60, number(result.refresh, DEFAULTS.refresh)));
    if (result.theme !== "light" && result.theme !== "dark") { result.theme = "auto"; }
    return result;
  }
  function loadSettings() {
    try { return copySettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}")); }
    catch (error) { void error; return copySettings(DEFAULTS); }
  }
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); } catch (error) { void error; }
  }
  function saveCache(key, data, updated) {
    try { localStorage.setItem(key, JSON.stringify({ data: data, updated: updated })); } catch (error) { void error; }
  }
  function loadCache(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (error) { void error; return null; }
  }

  function finalPrice(rawPrice) {
    return number(rawPrice, 0) + (state.settings.margin + state.settings.addition) * (1 + state.settings.vat / 100);
  }
  function normalizePrices(payload) {
    var source = payload && payload.prices instanceof Array ? payload.prices : [];
    var voltonRows = payload && payload.rows instanceof Array ? payload.rows : [];
    var output = [];
    var i;
    for (i = 0; i < source.length; i += 1) {
      if (typeof source[i].price === "undefined" || !source[i].startDate || !source[i].endDate) { continue; }
      output.push({
        start: parseDate(source[i].startDate),
        end: parseDate(source[i].endDate),
        raw: number(source[i].price, 0),
        price: finalPrice(source[i].price)
      });
    }
    for (i = 0; i < voltonRows.length; i += 1) {
      if (!voltonRows[i].mtu_start || typeof voltonRows[i].price_eur_mwh === "undefined") { continue; }
      var start = parseDate(voltonRows[i].mtu_start);
      var consumerPrice = number(voltonRows[i].price_eur_mwh, 0) / 10 * 1.255;
      output.push({
        start: start,
        end: new Date(start.getTime() + 15 * 60000),
        raw: consumerPrice,
        price: finalPrice(consumerPrice)
      });
    }
    output.sort(function (a, b) { return a.start.getTime() - b.start.getTime(); });
    return output;
  }
  function reprice() {
    var i;
    for (i = 0; i < state.prices.length; i += 1) { state.prices[i].price = finalPrice(state.prices[i].raw); }
  }
  function currentPeriod(now) {
    var i;
    for (i = 0; i < state.prices.length; i += 1) {
      if (state.prices[i].start <= now && state.prices[i].end > now) { return state.prices[i]; }
    }
    return null;
  }
  function levelForPrice(price) {
    if (price <= state.settings.cheap * 0.55) { return "ERITTÄIN HALPA"; }
    if (price <= state.settings.cheap) { return "HALPA"; }
    if (price >= state.settings.expensive * 1.5) { return "ERITTÄIN KALLIS"; }
    if (price >= state.settings.expensive) { return "KALLIS"; }
    return "NORMAALI";
  }
  function classForPrice(price) {
    if (price <= state.settings.cheap) { return "cheap"; }
    if (price >= state.settings.expensive) { return "expensive"; }
    return "normal";
  }
  function todayPrices(now) {
    return state.prices.filter(function (item) {
      return item.start.getFullYear() === now.getFullYear() && item.start.getMonth() === now.getMonth() && item.start.getDate() === now.getDate();
    });
  }
  function average(items) {
    var total = 0;
    var duration = 0;
    var i;
    var itemDuration;
    for (i = 0; i < items.length; i += 1) {
      itemDuration = Math.max(1, items[i].end.getTime() - items[i].start.getTime());
      total += items[i].price * itemDuration;
      duration += itemDuration;
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
    var partDuration;
    for (i = 0; i < items.length; i += 1) {
      duration = 0;
      weighted = 0;
      for (j = i; j < items.length && duration < target; j += 1) {
        partDuration = Math.min(items[j].end.getTime() - items[j].start.getTime(), target - duration);
        weighted += items[j].price * partDuration;
        duration += partDuration;
      }
      if (duration >= target && (!best || weighted / duration < best.average)) {
        best = { start: items[i].start, end: new Date(items[i].start.getTime() + target), average: weighted / duration };
      }
    }
    return best;
  }

  function renderPrices() {
    var now = new Date();
    var current = currentPeriod(now);
    var today = todayPrices(now);
    var min;
    var max;
    var best;
    var next;
    var change;
    var i;
    if (!state.prices.length) { return; }
    if (current) {
      byId("currentPrice").textContent = formatPrice(current.price, 2);
      byId("priceTime").textContent = formatTime(current.start) + "–" + formatTime(current.end);
      byId("priceLevel").textContent = levelForPrice(current.price);
      for (i = 0; i < state.prices.length; i += 1) {
        if (state.prices[i].start >= current.end) { next = state.prices[i]; break; }
      }
      if (next) {
        byId("nextPrice").textContent = formatPrice(next.price, 2);
        byId("nextPriceTime").textContent = formatTime(next.start) + "–" + formatTime(next.end);
        change = next.price - current.price;
        byId("nextPriceChange").textContent = Math.abs(change) < 0.005 ? "HINTA PYSYY SAMANA" : (change > 0 ? "NOUSEE " : "LASKEE ") + formatPrice(Math.abs(change), 2) + " snt/kWh";
      } else {
        byId("nextPrice").textContent = "--";
        byId("nextPriceTime").textContent = "EI VIELÄ TIEDOSSA";
        byId("nextPriceChange").textContent = "ODOTTAA UUSIA HINTOJA";
      }
    } else {
      byId("currentPrice").textContent = "--";
      byId("priceTime").textContent = "EI NYKYISTÄ HINTAA";
      byId("priceLevel").textContent = "ODOTTAA UUSIA HINTOJA";
      byId("nextPrice").textContent = "--";
      byId("nextPriceTime").textContent = "EI VIELÄ TIEDOSSA";
      byId("nextPriceChange").textContent = "ODOTTAA UUSIA HINTOJA";
    }
    if (today.length) {
      min = today[0];
      max = today[0];
      for (i = 1; i < today.length; i += 1) {
        if (today[i].price < min.price) { min = today[i]; }
        if (today[i].price > max.price) { max = today[i]; }
      }
      byId("averagePrice").textContent = formatPrice(average(today), 2);
      byId("minimumPrice").textContent = formatPrice(min.price, 2);
      byId("minimumTime").textContent = formatTime(min.start);
      byId("maximumPrice").textContent = formatPrice(max.price, 2);
      byId("maximumTime").textContent = formatTime(max.start);
      best = bestWindow(today.filter(function (item) { return item.end > now; }), 90) || bestWindow(today, 90);
      if (best) {
        byId("bestTime").textContent = formatTime(best.start) + "–" + formatTime(best.end);
        byId("bestAverage").textContent = formatPrice(best.average, 2) + " snt/kWh keskim.";
      }
    }
    renderMainChart(now);
    renderDetailChart(now);
  }

  function hourlyGroups(now) {
    var groups = [];
    var start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0, 0, 0);
    var hour;
    var groupStart;
    var groupEnd;
    var items;
    for (hour = 0; hour < 10; hour += 1) {
      groupStart = new Date(start.getTime() + hour * 3600000);
      groupEnd = new Date(groupStart.getTime() + 3600000);
      items = state.prices.filter(function (item) { return item.end > groupStart && item.start < groupEnd; });
      if (items.length) { groups.push({ start: groupStart, price: average(items), current: hour === 0 }); }
    }
    return groups;
  }
  function renderMainChart(now) {
    var groups = hourlyGroups(now);
    var min = Infinity;
    var max = -Infinity;
    var range;
    var html = "";
    var i;
    var height;
    for (i = 0; i < groups.length; i += 1) { min = Math.min(min, groups[i].price); max = Math.max(max, groups[i].price); }
    range = Math.max(1, max - min);
    for (i = 0; i < groups.length; i += 1) {
      height = 20 + ((groups[i].price - min) / range) * 49;
      html += '<span class="main-bar-item ' + classForPrice(groups[i].price) + (groups[i].current ? ' now' : '') + '">' +
        '<span class="main-bar-price">' + formatPrice(groups[i].price, 1) + '</span>' +
        '<span class="main-bar" style="height:' + height.toFixed(0) + '%"></span>' +
        '<span class="main-bar-time">' + formatTime(groups[i].start) + '</span></span>';
    }
    byId("mainChart").innerHTML = html || '<span class="loading-copy">Ei tulevia hintatietoja</span>';
  }
  function renderDetailChart(now) {
    var future = state.prices.filter(function (item) { return item.end > now; });
    var min = Infinity;
    var max = -Infinity;
    var cheapest = null;
    var range;
    var height;
    var current;
    var html = "";
    var i;
    for (i = 0; i < future.length; i += 1) {
      min = Math.min(min, future[i].price);
      max = Math.max(max, future[i].price);
      if (!cheapest || future[i].price < cheapest.price) { cheapest = future[i]; }
    }
    range = Math.max(1, max - min);
    for (i = 0; i < future.length; i += 1) {
      current = future[i].start <= now && future[i].end > now;
      height = 8 + ((future[i].price - min) / range) * 57;
      html += '<div class="detail-item ' + classForPrice(future[i].price) + (current ? ' now' : '') + (future[i] === cheapest ? ' cheapest' : '') + '">' +
        (current ? '<span class="detail-tag">NYT</span>' : (future[i] === cheapest ? '<span class="detail-tag">HALVIN</span>' : '')) +
        '<span class="detail-bar" style="height:' + height.toFixed(0) + '%"></span>' +
        '<span class="detail-price">' + formatPrice(future[i].price, 2) + '</span>' +
        '<span class="detail-time">' + formatTime(future[i].start) + '</span>' +
        '<span class="detail-day">' + formatDay(future[i].start) + '</span></div>';
    }
    byId("detailChart").innerHTML = html || '<span class="loading-copy">Ei tulevia hintatietoja</span>';
    byId("detailFooter").textContent = future.length ? "Jokaisessa pylväässä näkyvät tarkka alkamisaika ja maksettava hinta. Näytetään " + future.length + " tulevaa hintajaksoa." : "Tulevia hintatietoja ei ole saatavilla.";
  }

  function weatherInfo(code, isDay) {
    code = number(code, 0);
    if (code === 0) { return { icon: isDay ? "☀" : "☾", text: "Selkeää" }; }
    if (code === 1) { return { icon: isDay ? "☀" : "☾", text: "Melko selkeää" }; }
    if (code === 2) { return { icon: "☁", text: "Puolipilvistä" }; }
    if (code === 3) { return { icon: "☁", text: "Pilvistä" }; }
    if (code === 45 || code === 48) { return { icon: "≋", text: "Sumua" }; }
    if (code >= 51 && code <= 57) { return { icon: "☂", text: "Tihkusadetta" }; }
    if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) { return { icon: "☂", text: code >= 65 || code === 82 ? "Voimakasta sadetta" : "Sadetta" }; }
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) { return { icon: "❄", text: "Lumisadetta" }; }
    if (code >= 95) { return { icon: "⚡", text: "Ukkosta" }; }
    return { icon: "☁", text: "Vaihtelevaa" };
  }
  function windDirection(degrees) {
    var names = ["P", "KO", "I", "KA", "E", "LO", "L", "LU"];
    return names[Math.round(number(degrees, 0) / 45) % 8];
  }
  function weatherRows(payload, now) {
    var hourly = payload.hourly || {};
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
        if (rows.length >= 8) { break; }
      }
    }
    return rows;
  }
  function renderWeather() {
    var payload = state.weather;
    var current;
    var info;
    var daily;
    var rows;
    var rowInfo;
    var currentProbability;
    var currentTime;
    var html = "";
    var i;
    if (!payload || !payload.current) { return; }
    current = payload.current;
    info = weatherInfo(current.weather_code, number(current.is_day, 1));
    daily = payload.daily || {};
    currentProbability = number(current.precipitation_probability, number(payload.hourly && payload.hourly.precipitation_probability && payload.hourly.precipitation_probability[0], 0));
    currentTime = current.time ? parseDate(current.time) : new Date();
    byId("weatherNow").innerHTML = '<div class="weather-now-icon" aria-hidden="true">' + info.icon + '</div>' +
      '<div class="weather-now-main"><div class="weather-now-label">NYT · ' + formatTime(currentTime) + '</div><div class="weather-now-temp">' + formatTemperature(number(current.temperature_2m, NaN)) + '</div><div class="weather-now-condition">' + escapeHtml(info.text) + '</div></div>' +
      '<dl class="weather-facts"><div><dt>TUNTUU</dt><dd>' + formatTemperature(number(current.apparent_temperature, NaN)) + '</dd></div>' +
      '<div><dt>TUULI</dt><dd>' + formatPrice(number(current.wind_speed_10m, 0) / 3.6, 1) + ' m/s ' + windDirection(current.wind_direction_10m) + '</dd></div>' +
      '<div><dt>SADE</dt><dd>' + formatPrice(number(current.precipitation, 0), 1) + ' mm</dd></div>' +
      '<div><dt>SATEEN RISKI</dt><dd>' + Math.round(currentProbability) + ' %</dd></div></dl>';
    byId("weatherHighLow").textContent = "TÄNÄÄN " + formatTemperature(number(daily.temperature_2m_max && daily.temperature_2m_max[0], NaN)) + " / " + formatTemperature(number(daily.temperature_2m_min && daily.temperature_2m_min[0], NaN));
    byId("weatherCredit").textContent = "SÄÄDATA · " + String(payload.source || "ILMATIETEEN LAITOS").toUpperCase();
    rows = weatherRows(payload, new Date());
    for (i = 0; i < rows.length; i += 1) {
      rowInfo = weatherInfo(rows[i].code, rows[i].isDay);
      html += '<div class="weather-hour"><div class="weather-hour-primary"><span class="weather-hour-time">' + formatTime(rows[i].time) + '</span><span class="weather-hour-icon" aria-hidden="true">' + rowInfo.icon + '</span><span class="weather-hour-condition">' + escapeHtml(rowInfo.text) + '</span></div>' +
        '<div class="weather-hour-temp">' + formatTemperature(rows[i].temperature) + '</div>' +
        '<div class="weather-hour-rain">' + formatPrice(rows[i].precipitation, 1) + ' mm<small>' + Math.round(rows[i].probability) + ' %</small></div></div>';
    }
    byId("hourlyWeather").innerHTML = html || '<div class="weather-loading">Tuntiennustetta ei saatavilla.</div>';
  }

  function fetchJson(url) {
    return new Promise(function (resolve, reject) {
      var request = new XMLHttpRequest();
      var finished = false;
      var timer = setTimeout(function () {
        if (!finished) {
          finished = true;
          request.abort();
          reject(new Error("Aikakatkaisu"));
        }
      }, 12000);
      function finish(error, data) {
        if (finished) { return; }
        finished = true;
        clearTimeout(timer);
        if (error) { reject(error); } else { resolve(data); }
      }
      request.onreadystatechange = function () {
        var data;
        if (request.readyState !== 4) { return; }
        if (request.status < 200 || request.status >= 300) {
          finish(new Error("HTTP " + request.status));
          return;
        }
        try { data = JSON.parse(request.responseText); }
        catch (error) { finish(new Error("Virheellinen tietotiedosto")); return; }
        finish(null, data);
      };
      request.onerror = function () { finish(new Error("Verkkovirhe")); };
      request.open("GET", url, true);
      request.setRequestHeader("Accept", "application/json");
      request.setRequestHeader("Cache-Control", "no-cache");
      request.send(null);
    });
  }
  function bundleUpdated(bundle) {
    var parsed;
    if (!bundle || !bundle.generatedAt) { return Date.now(); }
    parsed = parseDate(bundle.generatedAt).getTime();
    return isFinite(parsed) ? parsed : Date.now();
  }
  function loadBundle() {
    if (!state.bundlePromise) {
      state.bundlePromise = fetchJson("data/latest.json?v=" + Date.now()).then(function (bundle) {
        if (!bundle || !(bundle.prices instanceof Array) || !bundle.weather) { throw new Error("Tietotiedosto on puutteellinen"); }
        if (bundle.location && bundle.location.name) {
          state.dataLocation = String(bundle.location.name);
          updateLocationLabels();
        }
        return bundle;
      });
      state.bundlePromise.then(function () { state.bundlePromise = null; }, function () { state.bundlePromise = null; });
    }
    return state.bundlePromise;
  }
  function loadElectricity() {
    return loadBundle().then(function (bundle) {
      var payload = { prices: bundle.prices };
      var prices = normalizePrices(payload);
      if (!prices.length) { throw new Error("Tyhjä hintatieto"); }
      state.prices = prices;
      state.priceUpdated = bundleUpdated(bundle);
      saveCache(PRICE_CACHE_KEY, payload, state.priceUpdated);
      renderPrices();
    });
  }
  function loadWeather() {
    return loadBundle().then(function (bundle) {
      var payload = bundle.weather;
      if (!payload || !payload.current || !payload.hourly) { throw new Error("Tyhjä säätieto"); }
      state.weather = payload;
      state.weatherUpdated = bundleUpdated(bundle);
      saveCache(WEATHER_CACHE_KEY, payload, state.weatherUpdated);
      renderWeather();
    });
  }
  function refreshAll(manual) {
    var completed = 0;
    var failed = 0;
    if (state.requestRunning) { return; }
    state.requestRunning = true;
    if (manual) { byId("updated").textContent = "PÄIVITETÄÄN…"; }
    function done(error) {
      completed += 1;
      if (error) {
        failed += 1;
        state.lastError = error.message || "Haku epäonnistui";
        if (window.console && window.console.error) { window.console.error("Kotinäytön tietohaku epäonnistui", error); }
      }
      if (completed === 2) {
        state.requestRunning = false;
        if (failed < 2) { state.retryCount = 0; state.lastError = failed ? "Osa tiedoista ei päivittynyt" : ""; }
        else { scheduleRetry(); }
        updateConnection();
        scheduleRefresh();
      }
    }
    loadElectricity().then(function () { done(); }).catch(done);
    loadWeather().then(function () { done(); }).catch(done);
  }
  function scheduleRefresh() {
    clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(function () { refreshAll(false); }, state.settings.refresh * 60000);
  }
  function scheduleRetry() {
    var delay;
    clearTimeout(state.retryTimer);
    state.retryCount = Math.min(state.retryCount + 1, 6);
    delay = Math.min(300000, Math.pow(2, state.retryCount) * 5000);
    state.retryTimer = setTimeout(function () { refreshAll(false); }, delay);
  }
  function updateConnection() {
    var connection = byId("connection");
    var latest = Math.max(state.priceUpdated, state.weatherUpdated);
    var stale = !latest || Date.now() - latest > Math.max(90, state.settings.refresh * 4) * 60000;
    var online = typeof navigator.onLine === "undefined" || navigator.onLine;
    if (!online || stale || state.lastError) { addClass(connection, "offline"); } else { removeClass(connection, "offline"); }
    if (!online) { connection.innerHTML = '<span class="connection-mark"></span>YHTEYS KATKENNUT'; }
    else if (stale && latest) { connection.innerHTML = '<span class="connection-mark"></span>TIETO VANHENTUNUT'; }
    else if (state.lastError) { connection.innerHTML = '<span class="connection-mark"></span>PÄIVITYSVIRHE'; }
    else { connection.innerHTML = '<span class="connection-mark"></span>YHDISTETTY'; }
    byId("updated").textContent = latest ? "PÄIVITETTY " + formatTime(new Date(latest)) : (state.requestRunning ? "HAETAAN TIETOJA…" : "EI VIELÄ TIETOJA");
  }

  function updateClock() {
    var now = new Date();
    byId("clock").textContent = formatTime(now);
    byId("seconds").textContent = pad(now.getSeconds());
    byId("weekday").textContent = weekdays[now.getDay()];
    byId("date").textContent = now.getDate() + ". " + months[now.getMonth()] + " " + now.getFullYear();
    if (now.getSeconds() === 0) { applyTheme(); updateConnection(); }
    if (state.prices.length && now.getMinutes() % 15 === 0 && now.getSeconds() === 0) { renderPrices(); }
  }
  function applyTheme() {
    var theme = state.settings.theme;
    var hour = new Date().getHours();
    var dark = theme === "dark" || (theme === "auto" && (hour >= 21 || hour < 7));
    if (dark) { addClass(document.body, "dark"); } else { removeClass(document.body, "dark"); }
  }
  function updateLocationLabels() {
    var name = String(state.dataLocation || state.settings.location).toUpperCase();
    byId("locationLabel").textContent = name + " · KOTINÄYTTÖ";
    byId("weatherPlace").textContent = name;
  }
  function openOverlay(id, closeId) {
    var overlay = byId(id);
    addClass(overlay, "open");
    overlay.setAttribute("aria-hidden", "false");
    byId(closeId).focus();
  }
  function closeOverlay(id) {
    var overlay = byId(id);
    removeClass(overlay, "open");
    overlay.setAttribute("aria-hidden", "true");
  }
  function fillSettingsForm() {
    byId("settingLocation").value = state.settings.location;
    byId("settingLatitude").value = state.settings.latitude;
    byId("settingLongitude").value = state.settings.longitude;
    byId("settingMargin").value = state.settings.margin;
    byId("settingAddition").value = state.settings.addition;
    byId("settingVat").value = state.settings.vat;
    byId("settingMonthly").value = state.settings.monthly;
    byId("settingCheap").value = state.settings.cheap;
    byId("settingExpensive").value = state.settings.expensive;
    byId("settingTheme").value = state.settings.theme;
    byId("settingRefresh").value = state.settings.refresh;
  }
  function readSettingsForm() {
    return copySettings({
      location: byId("settingLocation").value,
      latitude: byId("settingLatitude").value,
      longitude: byId("settingLongitude").value,
      margin: byId("settingMargin").value,
      addition: byId("settingAddition").value,
      vat: byId("settingVat").value,
      monthly: byId("settingMonthly").value,
      cheap: byId("settingCheap").value,
      expensive: byId("settingExpensive").value,
      theme: byId("settingTheme").value,
      refresh: byId("settingRefresh").value
    });
  }
  function bindEvents() {
    byId("priceButton").onclick = byId("chartButton").onclick = function () { openOverlay("priceOverlay", "closePrice"); };
    byId("closePrice").onclick = function () { closeOverlay("priceOverlay"); byId("chartButton").focus(); };
    byId("settingsButton").onclick = function () { fillSettingsForm(); openOverlay("settingsOverlay", "closeSettings"); };
    byId("closeSettings").onclick = function () { closeOverlay("settingsOverlay"); byId("settingsButton").focus(); };
    byId("refreshButton").onclick = function () { state.lastError = ""; refreshAll(true); };
    byId("settingsForm").onsubmit = function (event) {
      event.preventDefault();
      state.settings = readSettingsForm();
      saveSettings();
      reprice();
      updateLocationLabels();
      applyTheme();
      renderPrices();
      closeOverlay("settingsOverlay");
      state.lastError = "";
      refreshAll(true);
    };
    byId("resetSettings").onclick = function () { state.settings = copySettings(DEFAULTS); fillSettingsForm(); };
    window.addEventListener("online", function () { state.lastError = ""; refreshAll(true); });
    window.addEventListener("pageshow", function () {
      updateClock();
      if (Date.now() - Math.min(state.priceUpdated || 0, state.weatherUpdated || 0) > state.settings.refresh * 60000) { refreshAll(false); }
    });
    window.addEventListener("offline", updateConnection);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) {
        updateClock();
        if (Date.now() - Math.min(state.priceUpdated || 0, state.weatherUpdated || 0) > state.settings.refresh * 60000) { refreshAll(false); }
      }
    });
    document.addEventListener("keydown", function (event) {
      if (event.keyCode === 27) { closeOverlay("priceOverlay"); closeOverlay("settingsOverlay"); }
    });
  }
  function restoreCaches() {
    var priceCache = loadCache(PRICE_CACHE_KEY);
    var weatherCache = loadCache(WEATHER_CACHE_KEY);
    if (priceCache && priceCache.data) {
      state.prices = normalizePrices(priceCache.data);
      state.priceUpdated = number(priceCache.updated, 0);
      renderPrices();
    }
    if (weatherCache && weatherCache.data) {
      state.weather = weatherCache.data;
      state.weatherUpdated = number(weatherCache.updated, 0);
      renderWeather();
    }
  }
  function init() {
    updateLocationLabels();
    applyTheme();
    updateClock();
    bindEvents();
    restoreCaches();
    updateConnection();
    refreshAll(false);
    setInterval(updateClock, 1000);
    setInterval(function () {
      if (!document.hidden && Date.now() - Math.min(state.priceUpdated || 0, state.weatherUpdated || 0) > state.settings.refresh * 60000) { refreshAll(false); }
    }, 60000);
    if ("serviceWorker" in navigator && location.protocol.indexOf("http") === 0) {
      navigator.serviceWorker.register("sw.js?v=20260812-2").then(function (registration) {
        if (registration && registration.update) { registration.update(); }
      }).catch(function () {});
    }
  }

  init();
}());
