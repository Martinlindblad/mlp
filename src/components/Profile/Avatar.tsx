import React from 'react';
import Image from 'next/image';

const Avatar = (): JSX.Element => {
  return (
    <Image
      className=" rounded-full dark:bg-gray-900 bg-gray-400 bg-cover object-fill"
      src={'/images/profilepicture.webp'}
      alt="Carl Martins Logo"
      width={45}
      height={45}
    />
  );
};

export default Avatar;
