/* eslint-disable jsx-a11y/anchor-is-valid */
import Link from 'next/link';
import React from 'react';
import Avatar from '../profile/avatar';

const AboutCard = (): JSX.Element => {
  return (
    <div className="justify-center">
      <Link
        className="mx-auto flex max-w-screen-sm items-center justify-center"
        href="/about"
      >
        <div className="w-full rounded-md bg-gradient-to-r from-blue-500 via-yellow-500 to-blue-500 p-1">
          <div className="flex  items-center justify-center dark:bg-gray-900 bg-gray-100 back py-2 px-6">
            <Avatar />
            <p className="text-1xl font-medium px-3 ">More about me</p>
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
        </div>
      </Link>
    </div>
  );
};

export default AboutCard;
