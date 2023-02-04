import { useTheme } from 'next-themes';
import { useState, useEffect, useMemo } from 'react';

const ThemeButton = ({ incomingClassName }: { incomingClassName?: string }) => {
  const { systemTheme, theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);
  const currentTheme = useMemo(() => {
    return theme === 'system' ? systemTheme : theme;
  }, [systemTheme, theme]);
  if (!mounted) return null;

  const handleChangeColorTheme = () => {
    if (currentTheme === 'light') {
      return setTheme('dark');
    }
    return setTheme('light');
  };
  return (
    <button
      className={`w-10 h-10 ${incomingClassName} ${
        currentTheme === 'dark' ? 'text-gray-100' : 'text-gray-900'
      } `}
      role="button"
      onClick={handleChangeColorTheme}
    >
      <div className="relative">
        <svg
          className={`${
            currentTheme === 'light' ? 'scale-100' : 'scale-0'
          } w-6 h-6 ease-in-out duration-300 absolute`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
          />
        </svg>
        <svg
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
          className={`${
            currentTheme === 'light' ? 'scale-0' : 'scale-100'
          } w-6 h-6 ease-in-out duration-500 `}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
          />
        </svg>
      </div>
    </button>
  );
};

export default ThemeButton;
