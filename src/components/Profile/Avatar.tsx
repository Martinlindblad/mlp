import React from 'react';

const Avatar = (): JSX.Element => {
  return (
    <div className=" bg-[url('../../assets/profilepicture.png')] rounded-full   mix-blend-multiply dark:bg-gray-900 bg-gray-400  scale-105 bg-cover h-10 w-10 object-fill" />
  );
};

export default Avatar;
