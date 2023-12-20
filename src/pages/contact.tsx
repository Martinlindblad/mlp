import React from 'react';
import Layout from '../components/Layouts/Layout';
import ContactForm from '../components/ContactForm';
import AnimatedName from '../components/AnimatedComponents/AnimatedName';
import useIntroductionQuery from '../hooks/useIntroductiontQuery';
// import Image from 'next/image';

const Contact = (): JSX.Element => {
  const { data: aboutData } = useIntroductionQuery();
  return (
    <Layout className="bg-gray-100 dark:bg-gray-900 justify-center align-center flex-col min-h-screen relative">
      <div className="pt-20 sm:pt-10 pb-6 sm:pb-10 justify-center align-center flex">
        <AnimatedName aboutData={aboutData} />
      </div>
      <ContactForm />
    </Layout>
  );
};

export default Contact;
