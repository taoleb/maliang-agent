/**
 * Built-in desktop themes. Names match the CLI skins / dashboard presets.
 * Add new themes here — no code changes needed elsewhere.
 */

import type { DesktopTheme, DesktopThemeColors, DesktopThemeTypography } from './types'

// Color-emoji fonts to append to every stack as a last resort. None of the UI
// text/mono fonts carry emoji glyphs, so without this emoji render as tofu
// boxes on platforms whose default text font lacks them (e.g. Linux/#40464).
// Covers macOS, Windows, Linux, plus the `emoji` generic for anything else.
export const EMOJI_FALLBACK = '"Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji", emoji'

const SYSTEM_SANS =
  '"Segoe WPC", "Segoe UI", -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif, ' +
  EMOJI_FALLBACK

const SYSTEM_MONO =
  '"Cascadia Code", "JetBrains Mono", "SF Mono", ui-monospace, Menlo, Monaco, Consolas, monospace, ' + EMOJI_FALLBACK

export const DEFAULT_TYPOGRAPHY: DesktopThemeTypography = { fontSans: SYSTEM_SANS, fontMono: SYSTEM_MONO }

// Keep `parchment` as the persistent key so existing installs migrate to the
// new workspace without a local-storage reset. The visual identity is now the
// light, ice-blue desktop system used by the chat workspace and every overlay.
const CHANGAN_ICE_COLORS: DesktopThemeColors = {
  background: '#F3F7FC',
  foreground: '#111827',
  card: '#FFFFFF',
  cardForeground: '#111827',
  muted: '#EAF1F8',
  mutedForeground: '#243247',
  popover: '#FFFFFF',
  popoverForeground: '#111827',
  primary: '#215B89',
  primaryForeground: '#FFFFFF',
  secondary: '#E8F1FA',
  secondaryForeground: '#111827',
  accent: '#DFECF8',
  accentForeground: '#111827',
  border: '#C7D7E8',
  input: '#B8CCE1',
  ring: '#3B82B8',
  midground: '#215B89',
  midgroundForeground: '#FFFFFF',
  composerRing: '#5797C8',
  destructive: '#B42318',
  destructiveForeground: '#FFFFFF',
  sidebarBackground: '#F7FAFE',
  sidebarBorder: '#C7D7E8',
  userBubble: '#EDF5FC',
  userBubbleBorder: '#C7D9ED'
}

export const parchmentTheme: DesktopTheme = {
  name: 'parchment',
  label: 'Changan Ice',
  description: 'Light ice-blue workspace with high-contrast dark text.',
  colors: CHANGAN_ICE_COLORS,
  // This product theme is deliberately light in both mode preferences so the
  // chat workspace, settings, and overlays always share one visual system.
  darkColors: CHANGAN_ICE_COLORS,
  typography: {
    fontSans: SYSTEM_SANS,
    fontMono: SYSTEM_MONO
  }
}

export const BUILTIN_THEMES: Record<string, DesktopTheme> = {
  parchment: parchmentTheme
}

export const BUILTIN_THEME_LIST = Object.values(BUILTIN_THEMES)

/** Skin used when nothing is persisted or the persisted name is retired. */
export const DEFAULT_SKIN_NAME = 'parchment'
