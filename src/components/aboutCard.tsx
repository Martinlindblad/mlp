/* eslint-disable jsx-a11y/anchor-is-valid */
import React from 'react';

const AboutCard = (): JSX.Element => {
  return (
    <div className="scale-75 w-1/4 p-2 text-center mx-auto bg-white border rounded-lg shadow-md sm:p-2 dark:bg-gray-800 dark:border-gray-700">
      <h5 className="mb-2 text-3xl font-bold text-gray-900 dark:text-white">
        About me!
      </h5>
      <p className="mb-5 text-base text-gray-500 sm:text-lg dark:text-gray-400">
        Want to get to know me and my work more in detail?
      </p>
      <div className="items-center justify-center space-y-2 sm:flex sm:space-y-0 sm:space-x-4">
        <a
          href="/pages/about"
          className="w-full sm:w-auto bg-gray-800 hover:bg-gray-700 focus:ring-4 focus:outline-none focus:ring-gray-300 text-white rounded-lg inline-flex items-center justify-center px-4 py-2.5 dark:bg-gray-700 dark:hover:bg-gray-600 dark:focus:ring-gray-700"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke-width="1.5"
            stroke="currentColor"
            className="w-6 h-6"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.963 0a9 9 0 10-11.963 0m11.963 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>

          <div className="text-left">
            <div className="mb-1 text-xs">Download on the</div>
            <div className="-mt-1 font-sans text-sm font-semibold">
              Click here!
            </div>
          </div>
        </a>
      </div>
    </div>
  );
};

export default AboutCard;
