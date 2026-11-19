import React, { createContext, useContext, useEffect, useState } from 'react';

const ThemeContext = createContext();

export const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('mcl_theme') || 'system';
  });

  const [activeTheme, setActiveTheme] = useState('light');

  useEffect(() => {
    const root = document.documentElement;

    const applyTheme = (isDark) => {
      if (isDark) {
        root.classList.add('dark');
        setActiveTheme('dark');
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#111110');
      } else {
        root.classList.remove('dark');
        setActiveTheme('light');
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#F5F5F3');
      }
    };

    localStorage.setItem('mcl_theme', theme);
    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      applyTheme(mediaQuery.matches);

      const handler = (e) => applyTheme(e.matches);
      mediaQuery.addEventListener('change', handler);
      return () => mediaQuery.removeEventListener('change', handler);
    } else {
      applyTheme(theme === 'dark');
      localStorage.setItem('mcl_theme', theme);
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme(activeTheme === 'dark' ? 'light' : 'dark');
  };

  return (
    <ThemeContext.Provider value={{ theme, activeTheme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
export default ThemeContext;
