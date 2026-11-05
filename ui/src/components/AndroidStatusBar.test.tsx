// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AndroidStatusBar } from "./AndroidStatusBar";
import {
  ThemeProvider,
  useTheme,
  DARK_THEME_COLOR,
  LIGHT_THEME_COLOR,
} from "../context/ThemeContext";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("AndroidStatusBar", () => {
  let container: HTMLDivElement;
  let themeApi: ReturnType<typeof useTheme> | null = null;

  function Probe() {
    themeApi = useTheme();
    return null;
  }

  beforeEach(() => {
    window.localStorage.clear();
    document.head.innerHTML = '<meta name="theme-color" content="#initial">';
    document.body.innerHTML = "";
    document.documentElement.className = "dark";
    document.documentElement.style.colorScheme = "dark";
    themeApi = null;
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  it("updates Android status bar theme-color to dark color on mount", async () => {
    const root = createRoot(container);
    act(() => {
      root.render(
        <ThemeProvider>
          <Probe />
        </ThemeProvider>,
      );
    });

    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    expect(metaThemeColor?.getAttribute("content")).toBe(DARK_THEME_COLOR);

    const metaNavbutton = document.querySelector('meta[name="msapplication-navbutton-color"]');
    expect(metaNavbutton?.getAttribute("content")).toBe(DARK_THEME_COLOR);

    const metaAppleStyle = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    expect(metaAppleStyle?.getAttribute("content")).toBe("black-translucent");

    act(() => {
      root.unmount();
    });
  });

  it("changes Android status bar color when application theme toggles from dark to light", async () => {
    const root = createRoot(container);
    act(() => {
      root.render(
        <ThemeProvider>
          <Probe />
        </ThemeProvider>,
      );
    });

    expect(themeApi?.theme).toBe("dark");
    expect(themeApi?.themeColor).toBe(DARK_THEME_COLOR);
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe(
      DARK_THEME_COLOR,
    );

    act(() => {
      themeApi?.setTheme("light");
    });

    expect(themeApi?.theme).toBe("light");
    expect(themeApi?.themeColor).toBe(LIGHT_THEME_COLOR);
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe(
      LIGHT_THEME_COLOR,
    );
    expect(
      document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.getAttribute("content"),
    ).toBe("default");

    act(() => {
      themeApi?.toggleTheme();
    });

    expect(themeApi?.theme).toBe("dark");
    expect(themeApi?.themeColor).toBe(DARK_THEME_COLOR);
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe(
      DARK_THEME_COLOR,
    );

    act(() => {
      root.unmount();
    });
  });

  it("allows custom status bar color override through color prop", async () => {
    const customColor = "teal";
    const root = createRoot(container);

    act(() => {
      root.render(
        <ThemeProvider>
          <AndroidStatusBar color={customColor} />
          <Probe />
        </ThemeProvider>,
      );
    });

    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    expect(metaThemeColor?.getAttribute("content")).toBe(customColor);

    act(() => {
      root.unmount();
    });
  });

  it("allows overriding status bar color via setThemeColor on ThemeContext", async () => {
    const dynamicColor = "navy";
    const root = createRoot(container);

    act(() => {
      root.render(
        <ThemeProvider>
          <Probe />
        </ThemeProvider>,
      );
    });

    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe(
      DARK_THEME_COLOR,
    );

    act(() => {
      themeApi?.setThemeColor(dynamicColor);
    });

    expect(themeApi?.themeColor).toBe(dynamicColor);
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe(
      dynamicColor,
    );

    act(() => {
      themeApi?.setThemeColor(null);
    });

    expect(themeApi?.themeColor).toBe(DARK_THEME_COLOR);
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe(
      DARK_THEME_COLOR,
    );

    act(() => {
      root.unmount();
    });
  });
});
