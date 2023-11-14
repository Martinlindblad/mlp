/* eslint-disable jsx-a11y/anchor-is-valid */
import { motion } from 'framer-motion';
import Link from 'next/link';
import { Props } from 'next/script';
import React from 'react';
import Image from 'next/image';

type CaseItemProp = {
  title: string;
  description: string;
  imageSource: string;
};

export default function CaseItem({
  title,
  description,
  imageSource,
}: CaseItemProp & Props): JSX.Element {
  return (
    <motion.div className="flex flex-row bg-white justify-center items-center w-4/6 h-96  mx-auto overflow-hidden rounded-xl shadow-xl">
      <div className="p-6 text-center">
        <h2 className="text-2xl font-bold text-gray-800 mb-3">{title}</h2>
        <p className="text-gray-600 mb-4">{description}</p>
        <Link href="#">
          <span className="text-white bg-blue-600 hover:bg-blue-700 rounded-lg text-sm px-6 py-3 inline-block">
            Download
          </span>
        </Link>
      </div>
      <div style={{ position: 'relative', width: '500px', height: '300px' }}>
        <Image
          src={imageSource}
          alt="Picture of the author"
          sizes="500px"
          fill
          style={{
            objectFit: 'contain',
          }}
        />
      </div>
    </motion.div>
  );
}
