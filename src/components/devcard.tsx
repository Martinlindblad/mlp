import Link from 'next/link';
import React from 'react';
import { PageCardType } from 'src/../types/DBTypes';

const DevCard = ({ data }: { data: PageCardType }): JSX.Element => {
  return (
    <Link
      href={data.link}
      className="rounded flex flex-col py-2 md:flex-row md:w-1/3 h-48 first-letter dark:bg-gray-800 bg-gray-200 'dark:shadow-gray-100 shadow-gray-800 shadow-md"
    >
      <div className="flex flex-col justify-between py-4 leading-normal">
        <h5 className="text-md font-extrabold px-3 text-center">
          {data.title}
        </h5>
        <p className="text-sm font-normal px-5 lg:text-sm text-center  mx-auto py-3">
          {data.description}
        </p>
        <div className=" inline-flex items-center  py-2 text-sm font-medium text-center mx-auto  rounded-lg   ">
          <span className=" hover:text-transparent bg-clip-text bg-gradient-to-r to-sky-600 from-yellow-400">
            Read more
          </span>
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
    </Link>
  );
};
export default DevCard;
