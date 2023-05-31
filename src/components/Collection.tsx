import React from 'react';

export default function Collection() {
  return (
    <div className=" bg-[public/wallpaper.webp] bg-cover w-full relative">
      <div className="p-10 col-span-3">
        <div className="py-1 ">
          <p className="text-white fw-">About me</p>
        </div>
        <div className="py-1 ">
          <p className="text-white fw-">My gallery</p>
        </div>
        <div className="py-1 ">
          <p className="text-white fw-">Hobbys</p>
        </div>
        <div className="py-1 ">
          <p className="text-white fw-">Media</p>
        </div>
      </div>
      <div></div>
    </div>
  );
}
