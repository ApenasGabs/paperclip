import { useEffect } from "react";
import { Helmet } from "react-helmet-async";
import { useTheme, DARK_THEME_COLOR, LIGHT_THEME_COLOR } from "../context/ThemeContext";

export interface AndroidStatusBarProps {
  /**
   * Optional custom color to override the status bar.
   * If not provided, it automatically follows the application's active themeColor.
   */
  color?: string;
}

/**
 * AndroidStatusBar component.
 *
 * Dynamically synchronizes the Android status bar color with the application theme
 * using React Helmet (react-helmet-async).
 *
 * Android mobile browsers (Chrome, Samsung Internet, Android WebViews, and standalone PWAs)
 * determine the system status bar and navbar branding using the `<meta name="theme-color">` tag.
 */
export function AndroidStatusBar({ color }: AndroidStatusBarProps = {}) {
  const { theme, themeColor } = useTheme();
  const activeColor = color ?? themeColor ?? (theme === "dark" ? DARK_THEME_COLOR : LIGHT_THEME_COLOR);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const existingMetaTags = document.querySelectorAll('meta[name="theme-color"]');
    existingMetaTags.forEach((meta) => {
      meta.setAttribute("content", activeColor);
    });
  }, [activeColor]);

  return (
    <Helmet>
      {/* Android Chrome, Samsung Internet, Android WebViews & PWA status bar */}
      <meta name="theme-color" content={activeColor} />
      {/* Windows phone / nav bar */}
      <meta name="msapplication-navbutton-color" content={activeColor} />
      {/* iOS status bar style fallback */}
      <meta
        name="apple-mobile-web-app-status-bar-style"
        content={theme === "dark" ? "black-translucent" : "default"}
      />
    </Helmet>
  );
}
