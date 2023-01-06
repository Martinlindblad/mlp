/* eslint-disable jsx-a11y/anchor-is-valid */
import { useState, useEffect } from 'react';
import { HobbyType } from 'src/../types/DBTypes';

export default function Collection() {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [hobbys, setHobbys] = useState<HobbyType[]>();
  useEffect(() => {
    void (async () => {
      const results = await fetch('/api/introduction').then((response) =>
        response.json(),
      );
      setHobbys(results[0]);
    })();
  }, []);
  return (
    <div className=" bg-[url('../../assets/wallpaper.jpg')] bg-cover w-full relative">
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
