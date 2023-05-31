/* eslint-disable jsx-a11y/anchor-is-valid */
import Link from 'next/link';
import React from 'react';
import Image from 'next/image';

const AboutCard = (): JSX.Element => {
  return (
    <div className="justify-center relative m-3">
      <div className="animate-[colors_8s_ease-in-out_infinite] w-full h-full -z-10 absolute rounded-full" />

      <Link
        className="hover:scale-105 hover:shadow-lg  shadow-md dark:shadow-gray-100 shadow-gray-900  dark:hover:shadow-gray-100 hover:shadow-gray-900 transition duration-300 ease-in-out mx-auto flex max-w-screen-sm items-center justify-center rounded-full overflow-hidden"
        href="/about"
      >
        <div className="mx-auto  rounded-full lg:w-28 lg:h-28 w-24 h-24 overflow-hidden relative ">
          <Image
            className="h-18 lg:w-32 lg:bottom-3 bottom-2 px-3  scale-125 absolute"
            src={'/images/profilepicture.webp'}
            alt="Carl Martins Logo"
            width={20}
            height={20}
          />
        </div>
      </Link>
    </div>
  );
};

export default AboutCard;
