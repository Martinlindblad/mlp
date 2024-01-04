/* eslint-disable jsx-a11y/anchor-is-valid */

import Link from 'next/link';
import React from 'react';
import AnimatedName from 'src/src/components/AnimatedComponents/AnimatedName';
import useAboutQuery from 'src/src/hooks/useAboutQuery';
import { ProfessionalProfileintroduction } from 'src/types/DBTypes';

const Footer = (): JSX.Element => {
  const { data: personalInfo } = useAboutQuery('introduction');

  return (
    <footer className="bg-white rounded-lg shadow dark:bg-gray-900 ">
      <div className="w-full max-w-screen-xl mx-auto p-4 md:py-8">
        <div className="sm:flex sm:items-center sm:justify-between">
          <AnimatedName
            personalInfo={
              personalInfo as unknown as ProfessionalProfileintroduction
            }
          />
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
          {/* <Link href="#" className="hover:underline">
            PM Lindblad AB
          </Link> */}
          All Rights Reserved.
        </span>
      </div>
    </footer>
  );
};

export default Footer;
