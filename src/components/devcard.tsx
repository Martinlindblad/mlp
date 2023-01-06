/* eslint-disable jsx-a11y/anchor-is-valid */
import React from 'react';

const DevCard = (): JSX.Element => {
  return (
    <div className="px-5 py-10">
      <a
        href="#"
        className="flex flex-col items-center bg-white border rounded-lg shadow-md md:flex-row md:max-w-xl hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700"
      >
        <div className="flex flex-col justify-between p-4 leading-normal">
          <h5 className="mb-2 text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
            Technologys and frameworks
          </h5>
          <p className="mb-3 font-normal text-gray-700 dark:text-gray-400">
            Here are the main technologys and frameworks I use.
          </p>
          <a
            href="#"
            className="mx-auto inline-flex items-center px-3 py-2 text-sm font-medium text-center text-white  rounded-lg  focus:outline-none  "
          >
            Read more
            <svg
              aria-hidden="true"
              class="w-4 h-4 ml-2 -mr-1"
              fill="currentColor"
              viewBox="0 0 20 20"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                fill-rule="evenodd"
                d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z"
                clip-rule="evenodd"
              ></path>
            </svg>
          </a>
        </div>
      </a>
    </div>
  );
};
export default DevCard;
