import { useCallback, useEffect, useState } from "react";

export type ThemeMode = "dark" | "light";

const STORAGE_KEY = "shenbian-theme";

/**
 * 画布内的颜色不走 CSS（Canvas/WebGL 直接吃颜色值），
 * 因此每种模式给一份画布调色板；页面 UI 的颜色在 styles.css 里用变量切换。
 */
export interface CanvasPalette {
  background: string;
  /** 节点标签文字。 */
  label: string;
  /** 选中节点的外环。 */
  selectionRing: string;
  /** 高亮链路边。 */
  highlightLink: string;
  /** 高亮状态下被弱化的边。 */
  dimLink: string;
  /** 高亮状态下被弱化节点的透明度。 */
  dimNodeAlpha: number;
}

export const CANVAS_PALETTES: Record<ThemeMode, CanvasPalette> = {
  dark: {
    background: "#0b1020",
    label: "rgba(226, 232, 240, 0.92)",
    selectionRing: "#f8fafc",
    highlightLink: "rgba(248, 250, 252, 0.95)",
    dimLink: "rgba(100, 116, 139, 0.10)",
    dimNodeAlpha: 0.18,
  },
  light: {
    background: "#f1f5f9",
    label: "rgba(30, 41, 59, 0.92)",
    selectionRing: "#0f172a",
    highlightLink: "rgba(15, 23, 42, 0.9)",
    dimLink: "rgba(100, 116, 139, 0.16)",
    dimNodeAlpha: 0.16,
  },
};

function initialMode(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "dark" || stored === "light") return stored;
  } catch {
    // 隐私模式等场景读不到 localStorage，落回系统偏好。
  }
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/** 全局明暗模式：挂在 <html data-theme> 上，偏好只存主题这一个键。 */
export function useThemeMode(): [ThemeMode, () => void] {
  const [mode, setMode] = useState<ThemeMode>(initialMode);

  useEffect(() => {
    document.documentElement.dataset.theme = mode;
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // 无法持久化时保持当次会话内生效即可。
    }
  }, [mode]);

  const toggle = useCallback(
    () => setMode((current) => (current === "dark" ? "light" : "dark")),
    [],
  );
  return [mode, toggle];
}
