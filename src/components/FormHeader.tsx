import React from 'react';

const FormHeader = () => {
  return (
    <>
      <h2 className="mb-4 text-4xl tracking-tight font-extrabold text-center text-gray-900 dark:text-white">
        Contact Me
      </h2>
      <p className="mb-8 lg:mb-16 font-light text-center text-gray-500 dark:text-gray-400 sm:text-xl">
        {`Interested in collaborating or have a project in mind? Feel free
      to reach out and let's discuss how I can help you achieve your
      goals.`}
      </p>
    </>
  );
};

export default FormHeader;
