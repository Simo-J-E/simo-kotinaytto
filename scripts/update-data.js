"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const config = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8"));
const USER_AGENT = "Simo-Kotinaytto/2.0 (+https://github.com/simo-j-e/simo-kotinaytto)";

function finite(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function fetchJson(url, headers) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: Object.assign({ Accept: "application/json", "User-Agent": USER_AGENT }, headers || {})
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} (${url})`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function firstWorking(attempts, label) {
  const errors = [];
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (error) {
      errors.push(error && error.message ? error.message : String(error));
    }
  }
  throw new Error(`${label} ei latautunut: ${errors.join(" | ")}`);
}

function normalizePriceRows(rows) {
  const sorted = rows
    .filter((row) => row && row.startDate && row.endDate && Number.isFinite(Number(row.price)))
    .map((row) => ({
      price: Math.round(Number(row.price) * 10000) / 10000,
      startDate: new Date(row.startDate).toISOString(),
      endDate: new Date(row.endDate).toISOString()
    }))
    .filter((row) => !Number.isNaN(Date.parse(row.startDate)) && !Number.isNaN(Date.parse(row.endDate)))
    .sort((a, b) => Date.parse(a.startDate) - Date.parse(b.startDate));
  const cutoffPast = Date.now() - 24 * 60 * 60 * 1000;
  const cutoffFuture = Date.now() + 72 * 60 * 60 * 1000;
  return sorted.filter((row) => Date.parse(row.endDate) > cutoffPast && Date.parse(row.startDate) < cutoffFuture);
}

async function electricityFromVolton() {
  const payload = await fetchJson("https://public-data.volton.energy/v1/day-ahead-spot-fi/latest.json");
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const normalized = normalizePriceRows(rows.map((row, index) => {
    const start = row.mtu_start;
    const nextStart = rows[index + 1] && rows[index + 1].mtu_start;
    const end = row.mtu_end || nextStart || new Date(Date.parse(start) + 15 * 60 * 1000).toISOString();
    return {
      price: finite(row.price_eur_mwh, NaN) / 10 * 1.255,
      startDate: start,
      endDate: end
    };
  }));
  if (!normalized.length) throw new Error("Volton palautti tyhjän hinnaston");
  return { source: "Volton / Nord Pool", prices: normalized };
}

async function electricityFromPorssisahko() {
  const payload = await fetchJson("https://api.porssisahko.net/v1/latest-prices.json");
  const normalized = normalizePriceRows(Array.isArray(payload.prices) ? payload.prices : []);
  if (!normalized.length) throw new Error("Pörssisähkö.net palautti tyhjän hinnaston");
  return { source: "Pörssisähkö.net", prices: normalized };
}

function nearestHourlyIndex(hourly, currentTime) {
  if (!hourly || !Array.isArray(hourly.time) || !hourly.time.length) return 0;
  const target = Date.parse(currentTime);
  let best = 0;
  let distance = Infinity;
  hourly.time.forEach((value, index) => {
    const nextDistance = Math.abs(Date.parse(value) - target);
    if (nextDistance < distance) {
      distance = nextDistance;
      best = index;
    }
  });
  return best;
}

async function weatherFromOpenMeteo() {
  const params = new URLSearchParams({
    latitude: String(config.latitude),
    longitude: String(config.longitude),
    current: "temperature_2m,apparent_temperature,precipitation,precipitation_probability,weather_code,wind_speed_10m,wind_direction_10m,is_day",
    hourly: "temperature_2m,apparent_temperature,precipitation,precipitation_probability,weather_code,wind_speed_10m,wind_direction_10m,is_day",
    daily: "temperature_2m_max,temperature_2m_min",
    timezone: config.timezone || "Europe/Helsinki",
    forecast_days: "4"
  });
  const payload = await fetchJson(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
  if (!payload || !payload.current || !payload.hourly || !payload.daily) throw new Error("Open-Meteo palautti puutteellisen ennusteen");
  const index = nearestHourlyIndex(payload.hourly, payload.current.time);
  if (!Number.isFinite(Number(payload.current.precipitation_probability))) {
    payload.current.precipitation_probability = finite(payload.hourly.precipitation_probability && payload.hourly.precipitation_probability[index], 0);
  }
  payload.source = "Open-Meteo";
  return payload;
}

function symbolToWmo(symbol) {
  const value = String(symbol || "").toLowerCase();
  if (value.indexOf("thunder") !== -1) return 95;
  if (value.indexOf("snow") !== -1 || value.indexOf("sleet") !== -1) return value.indexOf("shower") !== -1 ? 85 : 71;
  if (value.indexOf("rain") !== -1) {
    if (value.indexOf("shower") !== -1) return value.indexOf("heavy") !== -1 ? 82 : 80;
    return value.indexOf("heavy") !== -1 ? 65 : (value.indexOf("light") !== -1 ? 61 : 63);
  }
  if (value.indexOf("fog") !== -1) return 45;
  if (value.indexOf("partlycloudy") !== -1) return 2;
  if (value.indexOf("cloudy") !== -1) return 3;
  if (value.indexOf("fair") !== -1) return 1;
  if (value.indexOf("clear") !== -1) return 0;
  return 3;
}

function localParts(value) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: config.timezone || "Europe/Helsinki",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(value));
  const result = {};
  parts.forEach((part) => { if (part.type !== "literal") result[part.type] = part.value; });
  return result;
}

function metRow(row) {
  const instant = row.data && row.data.instant && row.data.instant.details ? row.data.instant.details : {};
  const next = row.data && (row.data.next_1_hours || row.data.next_6_hours) ? (row.data.next_1_hours || row.data.next_6_hours) : {};
  const details = next.details || {};
  const symbol = next.summary && next.summary.symbol_code ? next.summary.symbol_code : "cloudy";
  const parts = localParts(row.time);
  return {
    time: row.time,
    temperature: finite(instant.air_temperature, NaN),
    precipitation: finite(details.precipitation_amount, 0),
    probability: finite(details.probability_of_precipitation, 0),
    weatherCode: symbolToWmo(symbol),
    isDay: symbol.indexOf("_day") !== -1 ? 1 : (symbol.indexOf("_night") !== -1 ? 0 : (finite(parts.hour, 12) >= 7 && finite(parts.hour, 12) < 20 ? 1 : 0)),
    windSpeed: finite(instant.wind_speed, 0),
    windDirection: finite(instant.wind_from_direction, 0),
    localDate: `${parts.year}-${parts.month}-${parts.day}`
  };
}

async function weatherFromMetNorway() {
  const url = `https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=${encodeURIComponent(config.latitude)}&lon=${encodeURIComponent(config.longitude)}`;
  const payload = await fetchJson(url);
  const timeseries = payload && payload.properties && Array.isArray(payload.properties.timeseries) ? payload.properties.timeseries : [];
  const rows = timeseries.map(metRow).filter((row) => Number.isFinite(row.temperature));
  if (!rows.length) throw new Error("MET Norway palautti tyhjän ennusteen");
  const now = Date.now();
  let current = rows[0];
  rows.forEach((row) => {
    if (Math.abs(Date.parse(row.time) - now) < Math.abs(Date.parse(current.time) - now)) current = row;
  });
  const days = [];
  rows.forEach((row) => {
    let day = days.find((candidate) => candidate.date === row.localDate);
    if (!day) {
      day = { date: row.localDate, max: row.temperature, min: row.temperature };
      days.push(day);
    }
    day.max = Math.max(day.max, row.temperature);
    day.min = Math.min(day.min, row.temperature);
  });
  return {
    source: "MET Norway",
    current: {
      time: current.time,
      temperature_2m: current.temperature,
      apparent_temperature: current.temperature,
      precipitation: current.precipitation,
      precipitation_probability: current.probability,
      weather_code: current.weatherCode,
      wind_speed_10m: current.windSpeed * 3.6,
      wind_direction_10m: current.windDirection,
      is_day: current.isDay
    },
    hourly: {
      time: rows.map((row) => row.time),
      temperature_2m: rows.map((row) => row.temperature),
      apparent_temperature: rows.map((row) => row.temperature),
      precipitation: rows.map((row) => row.precipitation),
      precipitation_probability: rows.map((row) => row.probability),
      weather_code: rows.map((row) => row.weatherCode),
      wind_speed_10m: rows.map((row) => row.windSpeed * 3.6),
      wind_direction_10m: rows.map((row) => row.windDirection),
      is_day: rows.map((row) => row.isDay)
    },
    daily: {
      time: days.slice(0, 4).map((day) => day.date),
      temperature_2m_max: days.slice(0, 4).map((day) => day.max),
      temperature_2m_min: days.slice(0, 4).map((day) => day.min)
    }
  };
}

async function main() {
  const [electricity, weather] = await Promise.all([
    firstWorking([electricityFromVolton, electricityFromPorssisahko], "Sähkötieto"),
    firstWorking([weatherFromOpenMeteo, weatherFromMetNorway], "Säätieto")
  ]);
  const output = {
    generatedAt: new Date().toISOString(),
    location: {
      name: String(config.location || "Turku"),
      latitude: finite(config.latitude, 60.4518),
      longitude: finite(config.longitude, 22.2666)
    },
    electricitySource: electricity.source,
    prices: electricity.prices,
    weather
  };
  if (!output.prices.length || !output.weather.current || !output.weather.hourly) throw new Error("Valmis tietotiedosto on puutteellinen");
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  fs.writeFileSync(path.join(root, "data", "latest.json"), `${JSON.stringify(output)}\n`, "utf8");
  console.log(`Päivitetty: ${output.prices.length} hintaa, sää ${output.weather.source}, sähkö ${output.electricitySource}`);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
