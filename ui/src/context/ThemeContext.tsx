import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { HelmetProvider } from "react-helmet-async";
import { AndroidStatusBar } from "../components/AndroidStatusBar";

export type Theme = "light" | "dark";

export interface ThemeContextValue {
  theme: Theme;
  themeColor: string;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setThemeColor: (color: string | null) => void;
}

export const THEME_STORAGE_KEY = "paperclip.theme";
export const DARK_THEME_COLOR = "#18181b";
export const LIGHT_THEME_COLOR = "#ffffff";
const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function resolveThemeFromDocument(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function hasStoredTheme(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark";
  } catch {
    return false;
  }
}

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  const isDark = theme === "dark";
  const root = document.documentElement;
  root.classList.toggle("dark", isDark);
  root.style.colorScheme = isDark ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => resolveThemeFromDocument());
  const [customThemeColor, setCustomThemeColor] = useState<string | null>(null);
  // Track whether the user has explicitly chosen a theme. If false, the
  // theme is being derived from the OS `prefers-color-scheme` and should
  // follow OS-level changes mid-session without being persisted.
  const [hasExplicitChoice, setHasExplicitChoice] = useState<boolean>(() => hasStoredTheme());

  const themeColor = useMemo(
    () => customThemeColor ?? (theme === "dark" ? DARK_THEME_COLOR : LIGHT_THEME_COLOR),
    [customThemeColor, theme],
  );

  const setTheme = useCallback((nextTheme: Theme) => {
    setHasExplicitChoice(true);
    setThemeState(nextTheme);
  }, []);

  const toggleTheme = useCallback(() => {
    setHasExplicitChoice(true);
    setThemeState((current) => (current === "dark" ? "light" : "dark"));
  }, []);

  const setThemeColor = useCallback((color: string | null) => {
    setCustomThemeColor(color);
  }, []);

  useEffect(() => {
    applyTheme(theme);
    if (!hasExplicitChoice) return;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore local storage write failures in restricted environments.
    }
  }, [theme, hasExplicitChoice]);

  // When the user has not made an explicit choice, follow OS-level
  // `prefers-color-scheme` changes so the UI flips alongside the OS theme.
  useEffect(() => {
    if (hasExplicitChoice) return;
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent) => {
      setThemeState(event.matches ? "dark" : "light");
    };
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [hasExplicitChoice]);

  const value = useMemo(
    () => ({
      theme,
      themeColor,
      setTheme,
      toggleTheme,
      setThemeColor,
    }),
    [theme, themeColor, setTheme, toggleTheme, setThemeColor],
  );

  return (
    <HelmetProvider>
      <ThemeContext.Provider value={value}>
        <AndroidStatusBar />
        {children}
      </ThemeContext.Provider>
    </HelmetProvider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}
