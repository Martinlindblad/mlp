/* eslint-disable jsx-a11y/anchor-is-valid */
import { motion } from 'framer-motion';
import { useTheme } from 'next-themes';
import Link from 'next/link';
import React, { useMemo } from 'react';
import AnimatedContainer from 'src/src/components/Layouts/AnimatedContainer';
import Logo from 'src/src/components/SVG/Logo';
import useIntroductionQuery from 'src/src/hooks/useIntroductiontQuery';

const Footer = (): JSX.Element => {
  const { data: aboutData } = useIntroductionQuery();
  const { theme } = useTheme();

  const CharacterString = useMemo(() => {
    if (aboutData) {
      const nameString = aboutData?.name + ' ' + aboutData?.surname;
      const stringArr = Array.from(nameString);
      return stringArr;
    }
    return [];
  }, [aboutData]);

  const container = useMemo(
    () => ({
      hidden: {
        opacity: 0,
        scale: 0,
      },
      visible: {
        opacity: 1,
        scale: 1,
        visible: {
          opacity: 1,
          transition: {
            delay: 0.4,
            duration: 0.5,
          },
        },
      },
    }),
    [],
  );
  return (
    <footer className="bg-white rounded-lg shadow dark:bg-gray-900 ">
      <div className="w-full max-w-screen-xl mx-auto p-4 md:py-8">
        <div className="sm:flex sm:items-center sm:justify-between">
          <Link
            href="/"
            className="flex items-center mb-4 sm:mb-0 space-x-4 rtl:space-x-reverse"
          >
            <h1 className="text-2xl sm:text-3xl md:text-4xl lg:text-4xl xl:text-4xl  font-bold tracking-wider dark:text-gray-100">
              <AnimatedContainer
                key={'IntroductionNameContainer'}
                containerVariant={container}
                className="flex-row flex w-full flex-wrap "
              >
                <Logo containerStyle="w-10 mr-4" />
                {CharacterString.map((character, index) => (
                  <motion.span
                    className={` ${
                      theme === 'dark'
                        ? 'animate-[darkColors_3s_ease-in-out]'
                        : 'animate-[lightColors_3s_ease-in-out]'
                    } ${
                      index > 6 ? ' text-blue-500 font-thin' : ' font-extrabold'
                    } `}
                    variants={{
                      hidden: {
                        opacity: 0,
                      },
                      visible: {
                        opacity: 1,
                        transition: {
                          delay: index * 0.1,
                          duration: 0.7,
                        },
                      },
                    }}
                    key={`IntroductionName${index}_${character}`}
                  >
                    {character === ' ' ? '\u00A0' : character}
                  </motion.span>
                ))}
              </AnimatedContainer>
            </h1>
          </Link>
          <ul className="flex flex-wrap items-center mb-6 text-sm font-medium text-gray-500 sm:mb-0 dark:text-gray-400">
            <li>
              <Link href="/about" className="hover:underline me-4 md:me-6">
                About
              </Link>
            </li>
            <li>
              <Link href="/experience" className="hover:underline me-4 md:me-6">
                My Experience
              </Link>
            </li>
            <li>
              <Link href="/contact" className="hover:underline me-4 md:me-6">
                Contact
              </Link>
            </li>
            <li>
              <Link href="#" className="hover:underline">
                PM Lindblad AB
              </Link>
            </li>
          </ul>
        </div>
        <hr className="my-6 border-gray-200 sm:mx-auto dark:border-gray-700 lg:my-8" />
        <span className="block text-sm text-gray-500 sm:text-center dark:text-gray-400">
          © 2023{' '}
          <Link href="#" className="hover:underline">
            PM Lindblad AB™
          </Link>
          . All Rights Reserved.
        </span>
      </div>
    </footer>
  );
};

export default Footer;
