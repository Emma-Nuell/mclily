import { createContext, useContext, useEffect, useState } from 'react';
const ThemeContext = createContext();
export function ThemeProvider({ children }) {
  const [preference, setPreference] = useState(() => {
    try {
      const saved = localStorage.getItem('mclily_admin_theme');
      return ['light', 'dark', 'system'].includes(saved) ? saved : 'system';
    } catch {
      return 'system';
    }
  });
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  );
  const theme =
    preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const change = (event) => setSystemDark(event.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
    try {
      localStorage.setItem('mclily_admin_theme', preference);
    } catch {
      /* Preference is usable without storage. */
    }
  }, [theme, preference]);
  return (
    <ThemeContext.Provider
      value={{
        theme,
        preference,
        setPreference,
        toggleTheme: () => setPreference(theme === 'dark' ? 'light' : 'dark'),
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}
// eslint-disable-next-line react-refresh/only-export-components -- Provider and its context hook are intentionally colocated.
export const useTheme = () => useContext(ThemeContext);
