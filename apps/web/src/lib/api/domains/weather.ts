"use client";

import { call } from "../call";
import { getApiClient } from "../client";

/** Location search for the settings area and the current weather for the dashboard context chip. */
export const weatherApi = {
  searchLocations: (query: string, language: "de" | "en") =>
    call(getApiClient().GET("/api/v1/location/search", { params: { query: { q: query, language } } })),
  currentWeather: (signal?: AbortSignal) =>
    call(getApiClient().GET("/api/v1/weather/current", { signal })),
};