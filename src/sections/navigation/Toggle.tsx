import * as React from 'react';

export const MenuToggle = ({
  toggle,
  isOpen,
}: {
  toggle: React.MouseEventHandler<HTMLButtonElement> | undefined;
  isOpen: boolean;
}) => (
  <button
    onClick={toggle}
    role="button"
    className="outline-none cursor-pointer fixed top-5 right-10 h-14  rounded-full bg-transparent z-50  p-4 gradientContainer animate-[gradient_16s_ease-in-out_infinite]"
  >
    <div className="relative">
      <svg
        className={`${
          isOpen ? 'scale-100' : 'scale-0'
        } w-6 h-6 ease-in-out duration-100 absolute`}
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M6 18L18 6M6 6l12 12"
          stroke-linecap="round"
          stroke-linejoin="round"
        ></path>
      </svg>
      <svg
        className={`${
          isOpen ? 'scale-0' : 'scale-100'
        } w-6 h-6 ease-in-out duration-500 `}
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M3.75 5.25h16.5m-16.5 4.5h16.5m-16.5 4.5h16.5m-16.5 4.5h16.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        ></path>
      </svg>
    </div>
  </button>
);
