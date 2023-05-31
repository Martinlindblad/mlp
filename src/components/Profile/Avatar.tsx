import React from 'react';
import Image from 'next/image';

const Avatar = (): JSX.Element => {
  return (
    <Image
      className=" rounded-full dark:bg-gray-900 bg-gray-400  scale-105 bg-cover h-10 w-10 object-fill"
      src={'/images/profilepicture.webp'}
      alt="Carl Martins Logo"
      width={20}
      height={20}
    />
  );
};

export default Avatar;
