/* eslint-disable jsx-a11y/anchor-is-valid */
import Link from 'next/link';
import React from 'react';
import AvatarSvg from '../../../assets/illustrations/face_co.svg';

const AboutCard = (): JSX.Element => {
  return (
    <div className="justify-center relative m-3">
      <div className="animate-[colors_8s_ease-in-out_infinite] w-full h-full -z-10 absolute rounded-full" />

      <Link
        className="hover:scale-105 hover:shadow-lg  shadow-md dark:shadow-gray-100 shadow-gray-900  dark:hover:shadow-gray-100 hover:shadow-gray-900 transition duration-300 ease-in-out mx-auto flex max-w-screen-sm items-center justify-center rounded-full overflow-hidden"
        href="/about"
      >
        <div className="mx-auto  rounded-full md:w-32 md:h-32 w-24 h-24 overflow-hidden relative ">
          <AvatarSvg className="aspect-4/3 w-24 h-24 md:w-32 md:h-32 px-3  scale-105 absolute" />
        </div>
      </Link>
    </div>
  );
};

export default AboutCard;
