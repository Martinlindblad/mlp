import Image from 'next/image';

import socialMediaImage from '../../assets/social-media.jpg';
export default function Collection() {
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
      <div>
        <Image
          className="rounded w-28 object-cover h-16 sm:w-12 absolute left-10 top-16 "
          src={socialMediaImage}
          alt="Carl Martins Logo"
        />
      </div>
    </div>
  );
}
