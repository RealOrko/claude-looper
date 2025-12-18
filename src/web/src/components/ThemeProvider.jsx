import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Moon, Sun, Monitor } from 'lucide-react';

const ThemeContext = createContext(null);

// Theme options
export const THEMES = {
  DARK: 'dark',
  LIGHT: 'light',
  SYSTEM: 'system',
};

// Get system preference
function getSystemTheme() {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'dark';
}

// Theme Provider component
export function ThemeProvider({ children, defaultTheme = THEMES.DARK }) {
  const [theme, setTheme] = useState(() => {
    // Check localStorage first
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('theme');
      if (stored && Object.values(THEMES).includes(stored)) {
        return stored;
      }
    }
    return defaultTheme;
  });

  const [resolvedTheme, setResolvedTheme] = useState(() => {
    if (theme === THEMES.SYSTEM) {
      return getSystemTheme();
    }
    return theme;
  });

  // Update resolved theme when theme changes
  useEffect(() => {
    if (theme === THEMES.SYSTEM) {
      setResolvedTheme(getSystemTheme());
    } else {
      setResolvedTheme(theme);
    }
  }, [theme]);

  // Listen for system theme changes
  useEffect(() => {
    if (theme !== THEMES.SYSTEM) return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e) => {
      setResolvedTheme(e.matches ? 'dark' : 'light');
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolvedTheme);
    document.body.className = `theme-${resolvedTheme}`;
  }, [resolvedTheme]);

  // Save to localStorage
  useEffect(() => {
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      if (prev === THEMES.DARK) return THEMES.LIGHT;
      if (prev === THEMES.LIGHT) return THEMES.DARK;
      return THEMES.DARK;
    });
  }, []);

  const value = {
    theme,
    resolvedTheme,
    setTheme,
    toggleTheme,
    isDark: resolvedTheme === 'dark',
    isLight: resolvedTheme === 'light',
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

// Hook to use theme
export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

// Theme toggle button component
export function ThemeToggle({ showLabel = false, className = '' }) {
  const { theme, setTheme, resolvedTheme, toggleTheme } = useTheme();

  const icons = {
    dark: Moon,
    light: Sun,
    system: Monitor,
  };

  const Icon = icons[theme] || Moon;

  return (
    <div className={`theme-toggle ${className}`}>
      <button
        className="theme-toggle-btn"
        onClick={toggleTheme}
        title={`Current: ${theme} theme (Click to toggle)`}
      >
        <Icon size={18} />
        {showLabel && <span>{theme}</span>}
      </button>
    </div>
  );
}

// Theme selector dropdown
export function ThemeSelector({ className = '' }) {
  const { theme, setTheme } = useTheme();

  return (
    <div className={`theme-selector ${className}`}>
      <button
        className={`theme-option ${theme === THEMES.LIGHT ? 'active' : ''}`}
        onClick={() => setTheme(THEMES.LIGHT)}
        title="Light theme"
      >
        <Sun size={16} />
      </button>
      <button
        className={`theme-option ${theme === THEMES.DARK ? 'active' : ''}`}
        onClick={() => setTheme(THEMES.DARK)}
        title="Dark theme"
      >
        <Moon size={16} />
      </button>
      <button
        className={`theme-option ${theme === THEMES.SYSTEM ? 'active' : ''}`}
        onClick={() => setTheme(THEMES.SYSTEM)}
        title="System theme"
      >
        <Monitor size={16} />
      </button>
    </div>
  );
}

export default ThemeProvider;
