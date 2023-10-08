import React from 'react';
import Layout from '../components/Layouts/Layout';
import ContactForm from '../components/ContactForm';
// import Image from 'next/image';

const Contact = (): JSX.Element => {
  return (
    <Layout className="bg-gray-100 dark:bg-gray-900 justify-center align-center flex-col min-h-screen relative">
      <ContactForm />
    </Layout>
  );
};

export default Contact;
