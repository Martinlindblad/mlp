import React from 'react';
import Layout from '../components/Layouts/Layout';
import ContactForm from '../components/ContactForm';
import Image from 'next/image';

const Contact = (): JSX.Element => {
  return (
    <Layout className="bg-gray-100 justify-center align-center flex-col dark:bg-gray-900 min-h-screen relative">
      <div className="absolute inset-0 bg-black opacity-60"></div>
      <div className="max-w-screen-md relative"></div>
      <Image
        src="/images/beach.webp"
        alt="Beach"
        fill
        className="absolute inset-0 z-0"
        sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, 25vw"
      />
      <ContactForm />
    </Layout>
  );
};

export default Contact;
