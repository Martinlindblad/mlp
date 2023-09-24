import React from 'react';

const BackgroundAndBorder = ({
  customStyle,
}: {
  customStyle?: any;
}): JSX.Element => {
  return (
    <>
      <div
        className={`${customStyle} custom-border z-0 shadow-sm  dark:shadow-gray-200 shadow-gray-800   h-full w-full absolute opcaity-20 top-0 left-0`}
      />
      <div
        className={`${customStyle} z-0 h-full w-full absolute opcaity-20 top-0 left-0`}
      />
    </>
  );
};

export default BackgroundAndBorder;
