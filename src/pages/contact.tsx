import React from 'react';
import Layout from '../components/Layouts/Layout';
import ContactForm from '../components/ContactForm';

const Contact = (): JSX.Element => {
  return (
    <Layout className="bg-slate-100 justify-center align-center flex-col dark:bg-gray-900 min-h-screen relative">
      <ContactForm />
    </Layout>
  );
};

export default Contact;
