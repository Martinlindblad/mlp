/* eslint-disable jsx-a11y/anchor-is-valid */
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import useWindowDimensions from 'src/hooks/useWindowDimensions';
import cmImage from '../../../assets/cm.jpg';
import ThemeButton from '../../components/themeButton';

export default function Navbar() {
  const router = useRouter();
  const [animateHeader, setAnimateHeader] = useState<boolean>(false);
  const { width } = useWindowDimensions();
  const [burgerMenuOpen, setBurgerMenuOpen] = useState<boolean>(false);

  useEffect(() => {
    const listener = () => {
      if (window.scrollY > 70) {
        setAnimateHeader(true);
      } else setAnimateHeader(false);
    };
    window.addEventListener('scroll', listener);
    return () => {
      window.removeEventListener('scroll', listener);
    };
  }, []);

  const handleOnBurgerMenuPressed = useCallback(() => {
    return setBurgerMenuOpen(!burgerMenuOpen);
  }, [burgerMenuOpen]);

  const image = useMemo(() => {
    return cmImage;
  }, []);

  const navLinks = [
    { name: 'Home', path: '/' } as const,
    {
      name: 'About',
      path: '/about',
    } as const,
    {
      name: 'Frameworks',
      path: '/frameworks',
    } as const,
    {
      name: 'Experience',
      path: '/experience',
    } as const,

    {
      name: 'Contact',
      path: '#contact',
    } as const,
  ];

  return (
    <nav
      className={`dark:border-gray-200 fixed z-50 top-0 border-gray-800 px-2 sm:px-4 py-2.5 rounded w-full bg-transparent
      trasition ease-in-out duration-300 md:scale-105
      ${
        animateHeader
          ? 'bg-transparent md:scale-100'
          : 'dark:shadow-gray-100 shadow-gray-900 shadow-md'
      }
      `}
    >
      <div className="container flex flex-wrap items-center justify-between mx-auto">
        <Link href="https://carlmartins.com" className="flex item-center">
          <div className="h-6 flex-1 lg:pb-12 mr-3 sm:h-9 ml-4">
            <Image
              className="rounded-full w-6  sm:w-12"
              src={image}
              alt="Carl Martins Logo"
            />
          </div>
        </Link>
        <div className="flex flex-row justify-end align items-center">
          <ThemeButton />

          <div className="flex flex-row justify-end align items-center">
            <button
              onClick={handleOnBurgerMenuPressed}
              data-collapse-toggle="navbar-default"
              type="button"
              className="inline-flex items-center p-2 ml-3 text-sm text-gray-500 rounded-lg md:hidden hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:text-gray-400 dark:hover:bg-gray-700 dark:focus:ring-gray-600"
              aria-controls="navbar-default"
              aria-expanded="false"
            >
              <span className="sr-only">Open main menu</span>
              <div className="relative">
                <svg
                  className={`${
                    burgerMenuOpen ? 'scale-0' : 'scale-100'
                  } w-6 h-6 ease-in-out duration-300 absolute`}
                  aria-hidden="true"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z"></path>
                </svg>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className={`${
                    burgerMenuOpen ? 'scale-100' : 'scale-0'
                  } w-6 h-6 ease-in-out duration-500 `}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </div>
            </button>
          </div>

          <div
            className={
              width && width > 414
                ? ''
                : `w-full absolute md:relative md:w-auto trasition ease-in-out duration-300 ${
                    Boolean(burgerMenuOpen)
                      ? 'translate-y-0 scale-100 right-0 opacity-95'
                      : 'fixed z-50 -translate-y-30 scale-0'
                  }`
            }
            id="navbar-default"
          >
            <ul
              className="flex flex-col items-start  justify-center w-screen h-auto p-10 md:p-0 top-8 md:top-0 border fixed border-gray-100 rounded-lg  md:w-fit md:flex md:relative
            md:flex-row md:space-x-8  md:text-sm md:font-medium md:border-0 md:bg-transparent bg-gray-100 dark:bg-gray-900  md:dark:bg-transparent dark:border-gray-700"
            >
              {navLinks.map((link) => {
                return (
                  <li
                    key={`navbar-item-${link.name}-${link.path}`}
                    className={`${
                      router.asPath === link.path
                        ? 'dark:bg-neutral-300 dark:text-neutral-900 md:dark:text-gray-100 font-bold md:dark:bg-gray-900 md:bg-gray-100 bg-neutral-700 md:text-gray-900 text-neutral-100'
                        : ''
                    } block p-2  my-1 md:my-0 self-center relative rounded md:bg-transparent  md:p-0`}
                  >
                    <Link href={link.path} aria-current="page">
                      <p className="text-left">{link.name}</p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    </nav>
  );
}
