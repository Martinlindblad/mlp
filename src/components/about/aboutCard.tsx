/* eslint-disable jsx-a11y/anchor-is-valid */
import Link from 'next/link';
import React from 'react';
import Avatar from '../profile/Avatar';

const AboutCard = (): JSX.Element => {
  return (
    <div className="justify-center relative   ">
      <div className="animate-[colors_8s_ease-in-out_infinite] w-full h-full -z-10 absolute" />

      <Link
        className="hover:scale-105 hover:shadow-lg shadow-md dark:shadow-gray-100 shadow-gray-900  dark:hover:shadow-gray-100 hover:shadow-gray-900 transition duration-300 ease-in-out mx-auto flex max-w-screen-sm items-center justify-center rounded-xl overflow-hidden"
        href="/about"
      >
        <div className="w-full rounded-xl border p-0 overflow-hidden">
          <div className="flex items-center justify-center dark:bg-gray-900 bg-gray-200  py-2 px-6">
            <Avatar />
            <p className="text-sm opacity-90 font-medium px-3 ">
              More about me
            </p>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-6 h-6 "
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
              />
            </svg>
          </div>
        </div>
      </Link>
    </div>
  );
};

export default AboutCard;
