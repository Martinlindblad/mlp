import React from 'react';
import Image from 'next/image';

const ContactImage = () => {
  return (
    <div className="h-full hover:shadow-xl ">
      <Image
        className="shadow-lg pt-10 "
        width={400}
        height={400}
        src={'/images/phone2.webp'}
        alt={'Contact image'}
      />
    </div>
  );
};

export default ContactImage;
