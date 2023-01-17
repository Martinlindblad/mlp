/* eslint-disable jsx-a11y/anchor-is-valid */
import Link from 'next/link';
import React from 'react';

const AboutCard = (): JSX.Element => {
  return (
    <div className="px-5 justify-center">
      <Link
        href="/about"
        className="flex flex-col items-center border rounded-lg  md:flex-row md:max-w-xl hover:bg-gray-100 0 dark:hover:bg-gray-700 justify-center p-3"
      >
        <p className="text-1xl font-medium text-transparent bg-clip-text bg-gradient-to-r to-sky-600 from-gold-400">
          More about me
        </p>
        <div className="pl-3 font-sans text-sm font-semibold">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="w-6 h-6"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
            />
          </svg>
        </div>
      </Link>
    </div>
  );
};

export default AboutCard;