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
        fill
        sizes="100vw"
        className="absolute z-0 object-cover"
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
        </div>
      </div>
    </motion.div>
  );
}
