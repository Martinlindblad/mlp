import React from 'react';

const Avatar = (): JSX.Element => {
  return (
    <div className="relative flex py-1 items-center flex-col justify-center ">
      <div className="object-fill h-8 w-8 rounded-full bg-cover bg-center absolute mix-blend-multiple" />
      <div className=" bg-[url('../../assets/profilepicture.png')] rounded-full shadow-indigo-200 dark:shadow-sky-300 opacity-90 shadow-sm bg-cover h-8 w-8 object-fill mix-blend-lighten" />
      <div className=" bg-[url('../../assets/profilepicture.png')] rounded-full  absolute mix-blend-multiply dark:bg-gray-900 opacity-80 bg-gray-400  scale-105 bg-cover h-8 w-8 object-fill" />
    </div>
  );
};

export default Avatar;
