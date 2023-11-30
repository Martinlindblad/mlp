import React from 'react';

const ContactFormMessage = ({ message }: { message: string }) => (
  <div className="bg-green-500 text-white text-sm p-3 rounded-md">
    {message}
  </div>
);

const Form = () => {
  const [email, setEmail] = React.useState('');
  const [subject, setSubject] = React.useState('');
  const [message, setMessage] = React.useState('');

  const [responeMessage, setResponseMessage] = React.useState('');

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, subject, message }),
      });

      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }

      const data = await res.json();

      const { successMessage, errorMessage } = data;

      if (errorMessage) {
        setResponseMessage(errorMessage);
      } else {
        setResponseMessage(successMessage);
      }
    } catch (error) {
      setResponseMessage(
        "A network error occurred, or the server's response was not JSON.",
      );
    }

    setEmail('');
    setSubject('');
    setMessage('');
  };

  return (
    <div className="p-2 lg:p-12 relative  rounded-md">
      <form
        action="#"
        className="space-y-8"
        onSubmit={(formData) => handleSubmit(formData)}
      >
        <div>
          <label
            htmlFor="email"
            className="block mb-2 text-sm font-medium text-gray-800 dark:text-gray-200"
          >
            Your Email
          </label>
          <input
            onChange={(e) => setEmail(e.target.value)}
            value={email}
            type="email"
            id="email"
            className="shadow-sm bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-primary-500 focus:border-primary-500 block w-full p-2.5"
            placeholder="your.email@example.com"
            required
          />
        </div>
        <div>
          <label
            htmlFor="subject"
            className="block mb-2 text-sm font-medium text-gray-800 dark:text-gray-200"
          >
            Subject
          </label>
          <input
            onChange={(e) => setSubject(e.target.value)}
            value={subject}
            type="text"
            id="subject"
            className="block p-3 w-full text-sm text-gray-900 bg-gray-50 rounded-lg border border-gray-300 shadow-sm focus:ring-primary-500 focus:border-primary-500"
            placeholder="Your message subject"
            required
          />
        </div>
        <div className="sm:col-span-2">
          <label
            htmlFor="message"
            className="block mb-2 text-sm font-medium text-gray-800 dark:text-gray-200"
          >
            Your Message
          </label>
          <textarea
            onChange={(e) => setMessage(e.target.value)}
            value={message}
            id="message"
            rows={6}
            className="block p-2.5 w-full text-sm text-gray-900 bg-gray-50 rounded-lg shadow-sm border border-gray-300 focus:ring-primary-500 focus:border-primary-500"
            placeholder="Write your message here..."
            required
          ></textarea>
        </div>
        <button
          type="submit"
          className="py-3 px-5 text-sm font-medium text-center text-white rounded-lg bg-[#6AB04C] hover:opacity-90 focus:ring-4 focus:outline-none focus:ring-primary-300"
        >
          Send Message
        </button>
      </form>

      {responeMessage ? <ContactFormMessage message={responeMessage} /> : null}
    </div>
  );
};

export default Form;
