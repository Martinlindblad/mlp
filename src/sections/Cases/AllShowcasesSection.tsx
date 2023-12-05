import Link from 'next/link';
import React from 'react';

const AllShowcasesSection = () => {
  return (
    <section
      className="bg-center bg-no-repeat bg-cover bg-gray-700 bg-blend-multiply"
      style={{ backgroundImage: "url('/images/office.png')" }}
    >
      <div className="px-4 mx-auto max-w-screen-xl text-center py-24 lg:py-56">
        <h1 className="mb-4 text-4xl font-extrabold tracking-tight leading-none text-white md:text-5xl lg:text-6xl">
          <span className="inline-block mb-2 text-white">Showcases</span>
        </h1>
        <p className="mb-8 text-lg font-normal text-gray-300 lg:text-xl sm:px-16 lg:px-48">
          See more of my work and projects Ive done in the past.
        </p>
        <div className="flex flex-col space-y-4 sm:flex-row sm:justify-center sm:space-y-0">
          <Link
            href="/showcases"
            className="inline-flex justify-center hover:text-gray-900 items-center py-3 px-5 sm:ms-4 text-base font-medium text-center text-white rounded-lg border border-white hover:bg-gray-100 focus:ring-4 focus:ring-gray-400"
          >
            Learn more
          </Link>
        </div>
      </div>
    </section>
  );
};

export default AllShowcasesSection;
