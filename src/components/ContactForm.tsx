import React from 'react';
import Image from 'next/image';
import Form from './Form';
import AnimatedFadeInContainer from './Layouts/AnimatedFadeInContainer';
import SocialMediaLinks from './SocialMediaLinks';

// ContactDetails.js - New Component for Contact Details
const ContactDetails = () => (
  <div className="space-y-4">
    {/* Phone */}
    <div className="flex items-center">
      <Image
        src={'/images/phone-icon.png'}
        alt="Phone Icon"
        width={45}
        height={45}
        className="rounded-full bg-[#6AB04C] p-0.5"
      />
      <div className="ml-4">
        <h3 className="text-sm font-semibold text-gray-800">Phone Number</h3>
        <p className="text-sm text-gray-600">(123) 456-7890</p>
      </div>
    </div>

    {/* Email */}
    <div className="flex items-center">
      <Image
        src={'/images/mail-icon.png'}
        alt="Email Icon"
        width={45}
        height={45}
        className="rounded-full bg-[#6AB04C] p-0.5"
      />
      <div className="ml-4">
        <h3 className="text-sm font-semibold text-gray-800">Email Address</h3>
        <p className="text-sm text-gray-600">info@example.com</p>
      </div>
    </div>
  </div>
);

// ContactMe.js
const ContactMe = () => (
  <div className="max-w-md mx-auto mt-10">
    <h2 className="text-2xl font-bold ">My contact details</h2>
    <div className="bg-[#6AB04C] w-12 h-0.5 my-3" />
    <p className="text-gray-500 text-sm mb-10">
      Send me a message and I will get back to you as soon as possible.
    </p>
    <ContactDetails />
    <div className="mt-10">
      <SocialMediaLinks />
    </div>
  </div>
);

// ContactForm.js
const ContactForm = () => (
  <div className="flex items-center justify-center pt-6 lg:pt-0 relative bg-cover bg-top min-h-screen w-full">
    <div className="container mx-auto">
      <div className="relative z-10 px-4 sm:px-6 lg:px-8">
        <AnimatedFadeInContainer
          type="FadeInBottom"
          className="grid grid-cols-1 lg:grid-cols-2 gap-8"
        >
          <div className="lg:col-span-1 flex flex-col justify-center">
            <h2 className="text-4xl font-bold mb-4">Get in touch</h2>
            <p className="mb-4 text-lg text-gray-600">
              Use the contcat form to get in touch with me. I will get back to
              you as soon as possible.
            </p>
            <ContactMe />
          </div>
          {/* Form Section */}
          <div className="lg:col-span-1">
            <Form />
          </div>
        </AnimatedFadeInContainer>
      </div>
    </div>
  </div>
);

export default ContactForm;
