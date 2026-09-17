import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { I18nProvider, useI18n, type Locale } from "./i18n";

const LOCALE_STORAGE_KEY = "nightsky-trail.locale.v1";

function MapLayerTranslationProbe() {
  const { tx } = useI18n();
  return (
    <>
      <span>{tx("Wanderland")}</span>
      <span>{tx("Veloland")}</span>
      <span>{tx("Wasser & WCs")}</span>
      <span>{tx("SAC-Hütten")}</span>
    </>
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe.each([
  [
    "en",
    [
      "Hiking in Switzerland",
      "Cycling in Switzerland",
      "Water & toilets",
      "SAC huts",
    ],
  ],
  ["fr", ["La Suisse à pied", "La Suisse à vélo", "Eau & WC", "Cabanes CAS"]],
  ["it", ["Svizzera a piedi", "Svizzera in bici", "Acqua & WC", "Capanne CAS"]],
] as const)("map layer translations (%s)", (locale: Locale, expected) => {
  it("translates every user-facing map layer", () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);

    render(
      <I18nProvider>
        <MapLayerTranslationProbe />
      </I18nProvider>,
    );

    expected.forEach((label) => {
      expect(screen.getByText(label)).toBeInTheDocument();
    });
  });
});
