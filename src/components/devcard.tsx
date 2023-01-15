/* eslint-disable jsx-a11y/anchor-is-valid */
import React from 'react';

const DevCard = ({ data }: any): JSX.Element => {
  return (
    <div className="px-5 w-full flex justify-center">
      <a
        href="#"
        className="flex flex-col items-center bg-white border rounded-lg shadow-md md:flex-row md:max-w-xl hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700"
      >
        <div className="flex flex-col justify-between p-4 leading-normal">
          <h5 className="text-3xl font-extrabold px-8 md:text-1xl lg:text-2xl text-center">
            {data.title}
          </h5>
          <p className="text-lg font-normal lg:text-xl px-2 text-center lg:w-2/3 mx-auto py-3">
            {data.description}
          </p>
          <div className=" inline-flex items-center px-3 py-2 text-sm font-medium text-center mx-auto  rounded-lg   ">
            <span>Read more</span>
            <svg
              aria-hidden="true"
              className="w-4 h-4 ml-2 -mr-1"
              fill="currentColor"
              viewBox="0 0 20 20"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" />
            </svg>
          </div>
        </div>
      </a>
    </div>
  );
};
export default DevCard;
