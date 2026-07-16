import { motion } from 'framer-motion';
import React from 'react';
import {
  selectAttempt,
  type PendingContactAttempt,
} from '../contact/idempotency';

const ContactFormMessage = ({
  message,
  success,
}: {
  message: string;
  success: boolean;
}) => {
  return (
    <div>
      {message && (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{
            type: 'spring',
            stiffness: 260,
            damping: 20,
          }}
          className={`${
            success ? 'bg-green-500' : 'bg-red-500'
          } bg-green-500 text-white text-sm px-6 py-2 my-8 rounded-md`}
        >
          <p className="text-lg">{message}</p>
        </motion.div>
      )}
    </div>
  );
};

const Form = () => {
  const [email, setEmail] = React.useState('');
  const [subject, setSubject] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [fullName, setFullName] = React.useState('');
  const [successful, setSuccessful] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [pendingAttempt, setPendingAttempt] =
    React.useState<PendingContactAttempt | null>(null);
  const submittingRef = React.useRef(false);

  const [responeMessage, setResponseMessage] = React.useState('');

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submittingRef.current) {
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    let wasSuccessful = false;
    const values = {
      fullName,
      email,
      subject,
      message,
    };

    try {
      const attempt = selectAttempt(pendingAttempt, values, () =>
        crypto.randomUUID(),
      );
      setPendingAttempt(attempt);
      const res = await fetch('/api/contact/route', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': attempt.key,
        },
        body: attempt.canonicalPayload,
      });

      const data = await res.json();

      // Check if the response was not OK and process the error message
      if (!res.ok) {
        // Set the error message from the response, if available
        setResponseMessage(
          data.errorMessage || `HTTP error! status: ${res.status}`,
        );
        setSuccessful(false);
      } else {
        // If the submission was successful, clear the form fields and update state
        if (data.success) {
          setResponseMessage(data.successMessage);
          setSuccessful(true);
          wasSuccessful = true;
          setFullName('');
          setEmail('');
          setSubject('');
          setMessage('');
          setPendingAttempt(null);
        } else {
          setResponseMessage(data.errorMessage || 'An unknown error occurred.');
          setSuccessful(false);
        }
      }
    } catch {
      setResponseMessage(
        "A network error occurred, or the server's response could not be processed.",
      );
      setSuccessful(false);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
      if (wasSuccessful) {
        setTimeout(() => {
          setResponseMessage('');
        }, 5000);
      }
    }
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
            htmlFor="fullName"
            className="block mb-2 text-sm font-medium text-gray-800 dark:text-gray-200"
          >
            Your Name
          </label>
          <input
            onChange={(e) => setFullName(e.target.value)}
            value={fullName}
            type="text"
            id="fullName"
            className="shadow-sm bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-primary-500 focus:border-primary-500 block w-full p-2.5"
            placeholder="Your Name"
            required
          />
        </div>

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
          disabled={submitting}
          aria-disabled={submitting}
          className="py-3 px-5 text-sm font-medium text-center text-white rounded-lg bg-[#6AB04C] hover:opacity-90 focus:ring-4 focus:outline-none focus:ring-primary-300 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {submitting ? 'Sending...' : 'Send Message'}
        </button>
      </form>

      <ContactFormMessage success={successful} message={responeMessage} />
    </div>
  );
};

export default Form;
