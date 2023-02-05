import React from 'react';

const BackgroundAndBorder = ({
  customStyle,
}: {
  customStyle?: any;
}): JSX.Element => {
  return (
    <>
      <div
        className={`${customStyle} custom-border z-0 shadow-sm  shadow-gray-200  h-full w-full absolute opcaity-20 top-0 left-0`}
      />
      <div
        className={`${customStyle} custom-background z-0 h-full w-full absolute opcaity-20 top-0 left-0`}
      />
    </>
  );
};

export default BackgroundAndBorder;
