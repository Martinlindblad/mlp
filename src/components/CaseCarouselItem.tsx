/* eslint-disable jsx-a11y/anchor-is-valid */
import { motion } from 'framer-motion';
import Link from 'next/link';
import React from 'react';
import { ObjectId } from 'mongodb';
import Image from 'next/image';

type CaseCarouselItemProp = {
  id: ObjectId;
  title: string;
  description: string;
  imageSource: string;
  from: string;
  to: string;
};

export default function CaseCarouselItem({
  id,
  title,
  description,
  imageSource,
  from,
  to,
}: CaseCarouselItemProp): JSX.Element {
  return (
    <motion.div className="relative flex justify-center items-center h-full shadow-xl py-20 md:py-10">
      {/* Background Image */}
      <Image
        src={imageSource}
        alt="Background"
        layout="fill"
        objectFit="cover"
        className="absolute z-0 "
      />

      {/* Gradient Overlay */}
      {from && to && (
        <div
          className="absolute top-0 left-0 bottom-0 w-full  z-10"
          style={{
            background: `linear-gradient(to bottom, rgba(${from}, 0.4), rgba(${to}, 0.4))`,
          }}
        />
      )}

      {/* Content */}
      <div className="relative z-20 p-5 md:p-10 max-w-2xl text-center">
        <h2 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl xl:text-6xl font-bold text-gray-800 mb-3">
          {title}
        </h2>
        <p className="text-gray-600 mb-4 text-sm sm:text-base md:text-lg lg:text-xl">
          {description}
        </p>
        {/* Buttons and links */}
        <div className="flex flex-col sm:flex-row space-y-4 sm:space-y-0 sm:space-x-4 pt-10 justify-center align-center">
          <Link
            href={`/cases/${id}`}
            className="flex-grow sm:flex-grow-0 inline-flex cursor-pointer items-center justify-center
            px-4 py-2 text-sm sm:text-base font-medium text-center text-white rounded-lg bg-lime-700
            hover:bg-gray-800 focus:ring-4 focus:ring-gray-300 dark:focus:ring-gray-900 transition ease-in-out duration-300"
          >
            <span>Go to case</span>
            <svg
              className="w-5 h-5 ml-2 -mr-1"
              fill="currentColor"
              viewBox="0 0 20 20"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                fillRule="evenodd"
                d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z"
                clipRule="evenodd"
              ></path>
            </svg>
          </Link>
          <Link
            href="#"
            className="flex-grow sm:flex-grow-0 inline-flex cursor-pointer items-center justify-center
            px-4 py-2 text-sm sm:text-base font-medium text-center text-gray-900 border border-gray-300 rounded-lg hover:bg-gray-300
             focus:ring-4 focus:ring-gray-100 dark:border-gray-700 dark:hover:bg-gray-700 dark:focus:ring-gray-800 transition ease-in-out duration-300"
          >
            <span>Visit my github</span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="#fff"
              className="w-5 h-5 ml-2 -mr-1"
            >
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
            </svg>
          </Link>
        </div>
      </div>
    </motion.div>
  );
}
